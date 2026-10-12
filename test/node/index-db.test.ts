// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionIndex, cacheHitRate } from '../../src/node/index-db.js';

const T0 = Date.parse('2026-10-12T06:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const J = (o: unknown) => JSON.stringify(o) + '\n';
const usage = {
  input_tokens: 10,
  output_tokens: 100,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: 9000,
  output_tokens_details: { thinking_tokens: 40 },
};

function fixture(): { root: string; projects: string; main: string } {
  const root = mkdtempSync(join(tmpdir(), 'tc-index-'));
  const projects = join(root, 'projects');
  const proj = join(projects, 'C--work-app');
  mkdirSync(join(proj, 's1', 'subagents'), { recursive: true });
  const main = join(proj, 's1.jsonl');
  writeFileSync(
    main,
    J({
      type: 'user',
      timestamp: at(0),
      cwd: 'C:\\work\\app',
      sessionId: 's1',
      version: '2.1.296',
      message: { role: 'user', content: 'fix the login bug, token sk-ant-api03-' + 'x'.repeat(40) },
    }) +
      // one API message written as two rows (one per content block): counted once
      J({
        type: 'assistant',
        timestamp: at(1),
        cwd: 'C:\\work\\app',
        message: { id: 'm1', model: 'claude-opus-5-5', usage, content: [{ type: 'thinking', thinking: '' }] },
      }) +
      J({
        type: 'assistant',
        timestamp: at(1),
        cwd: 'C:\\work\\app',
        message: { id: 'm1', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] },
      }) +
      J({
        type: 'user',
        timestamp: at(2),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'failed' }] },
      }) +
      J({ type: 'attachment', attachment: { type: 'silent_turn_reminder', text: 'ignored' } }) +
      J({ type: 'ai-title', aiTitle: 'Login bug', sessionId: 's1' }),
  );
  writeFileSync(
    join(proj, 's1', 'subagents', 'agent-a.jsonl'),
    J({
      type: 'assistant',
      isSidechain: true,
      timestamp: at(3),
      message: { id: 'm2', model: 'claude-haiku-5-5', usage, content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: {} }] },
    }),
  );
  return { root, projects, main };
}

test('a first pass reads everything once; a second pass reads nothing', () => {
  const f = fixture();
  const idx = new SessionIndex(':memory:');
  try {
    const r1 = idx.update(f.projects);
    assert.equal(r1.scanned, 2);
    assert.equal(r1.messages, 2); // m1 counted once, m2 from the subagent
    const r2 = idx.update(f.projects);
    assert.equal(r2.updated, 0);
    const t = idx.totals(0);
    assert.equal(t.messages, 2);
    assert.equal(t.output, 200);
    assert.equal(t.thinking, 80);
    assert.equal(t.agentTokens, 10110);
    assert.equal(cacheHitRate(t), 18000 / (20 + 2000 + 18000));
  } finally {
    idx.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('sessions carry title, masked first prompt, tools and errors', () => {
  const f = fixture();
  const idx = new SessionIndex(':memory:');
  try {
    idx.update(f.projects);
    const s = idx.session('s1')!;
    assert.equal(s.title, 'Login bug');
    assert.equal(s.cwd, 'C:\\work\\app');
    assert.equal(s.prompts, 1);
    assert.ok(s.firstPrompt?.startsWith('fix the login bug'));
    assert.ok(!s.firstPrompt?.includes('x'.repeat(40)), 'the secret is masked before it is stored');
    assert.equal(s.tools, 2);
    assert.equal(s.toolErrors, 1);
    assert.equal(s.model, 'claude-opus-5-5');
    assert.deepEqual(
      idx.tools({}).map((x) => [x.name, x.calls, x.errors, x.byAgents]),
      [
        ['Bash', 1, 1, 0],
        ['Read', 1, 0, 1],
      ],
    );
    assert.equal(idx.sessions({ search: 'login' }).length, 1);
    assert.equal(idx.sessions({ search: '100%_' }).length, 0);
  } finally {
    idx.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('appended lines are read incrementally; a line still being written waits for the next pass', () => {
  const f = fixture();
  const idx = new SessionIndex(':memory:');
  try {
    idx.update(f.projects);
    const half = JSON.stringify({ type: 'assistant', timestamp: at(5), message: { id: 'm3', model: 'claude-opus-5-5', usage, content: [] } });
    appendFileSync(f.main, half.slice(0, 40));
    assert.equal(idx.update(f.projects).messages, 0);
    appendFileSync(f.main, half.slice(40) + '\n');
    assert.equal(idx.update(f.projects).messages, 1);
    assert.equal(idx.totals(0).messages, 3);
  } finally {
    idx.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

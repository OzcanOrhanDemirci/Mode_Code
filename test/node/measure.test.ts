// SPDX-License-Identifier: Apache-2.0
// `mode-code measure` on the disk (node/measure.ts): the transcripts and the event log of the days asked, nothing older.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonlFiles, measure } from '../../src/node/measure.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function call(at: string, req: string, o: { session?: string; cwd?: string; model?: string; side?: boolean; output?: number; content?: unknown[] } = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    requestId: req,
    sessionId: o.session ?? 's1',
    cwd: o.cwd ?? 'C:/dev/app',
    ...(o.side ? { isSidechain: true } : {}),
    message: {
      id: `msg_${req}`,
      model: o.model ?? 'claude-opus-5-5',
      content: o.content ?? [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: o.output ?? 1000 },
    },
  });
}

test('the days asked, every folder deep, a project by part of its folder, and the servers not called', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-measure-'));
  try {
    const claude = join(root, 'claude');
    const data = join(root, 'data');
    const dir = join(claude, 'projects', 'C--dev-app');
    mkdirSync(join(dir, 's1', 'subagents'), { recursive: true });
    mkdirSync(join(data, 'events', '2026-10'), { recursive: true });
    const tool = (id: string, name: string) => [{ type: 'tool_use', id, name, input: { command: 'git commit -m x' } }];
    writeFileSync(
      join(dir, 's1.jsonl'),
      [
        call('2026-10-18T10:00:00.000Z', 'a', { content: tool('t1', 'mcp__dart__analyze') }),
        call('2026-10-18T10:05:00.000Z', 'b', { content: tool('t2', 'Bash') }),
        call('2026-10-18T10:10:00.000Z', 'c', { cwd: 'C:/dev/other' }),
        'not json',
      ].join('\n'),
    );
    writeFileSync(join(dir, 's1', 'subagents', 'agent-1.jsonl'), call('2026-10-18T10:03:00.000Z', 'd', { side: true, model: 'claude-sonnet-5-5' }));
    const old = join(dir, 'old.jsonl');
    writeFileSync(old, call('2026-10-01T10:00:00.000Z', 'e'));
    const weekAgo = new Date(NOW - 30 * 86_400_000);
    utimesSync(old, weekAgo, weekAgo);
    const reading = (at: string, week: number) => JSON.stringify({ kind: 'reading', at: Date.parse(at), week, weekResetsAt: 1 });
    writeFileSync(
      join(data, 'events', '2026-10', 's1.mod.jsonl'),
      [reading('2026-10-18T09:00:00.000Z', 10), reading('2026-10-18T11:00:00.000Z', 12)].join('\n'),
    );

    const r = measure({ claudeDir: claude, dataDir: data, days: 2, now: NOW, servers: ['dart', 'my.db', 'firebase'] });
    assert.equal(r.calls, 4, 'the month-old file is left out');
    assert.equal(r.readings, 2);
    assert.equal(r.point?.points, 2);
    assert.deepEqual(
      r.tasks.map((t) => [t.endedBy, t.calls]),
      [
        ['commit', 3],
        ['open', 1],
      ],
    );
    assert.deepEqual(
      r.models.map((m) => [m.model, m.subagents > 0]),
      [
        ['claude-opus-5-5', false],
        ['claude-sonnet-5-5', true],
      ],
    );
    assert.deepEqual(r.unusedServers, ['firebase', 'my.db']);
    const one = measure({ claudeDir: claude, dataDir: data, days: 2, now: NOW, project: 'OTHER' });
    assert.deepEqual(
      one.tasks.map((t) => t.cwd),
      ['C:/dev/other'],
    );
    assert.equal(one.point?.points, 2, 'a weekly point is measured on every call, whatever the project');
    assert.deepEqual(measure({ claudeDir: join(root, 'none'), dataDir: join(root, 'none'), days: 1, now: NOW }).tasks, []);
    assert.deepEqual(jsonlFiles(join(root, 'none'), 0), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

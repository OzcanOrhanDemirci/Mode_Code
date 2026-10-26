// SPDX-License-Identifier: Apache-2.0
// `mode-code measure` on the disk (node/measure.ts): the transcripts and the event log of the days asked, nothing older.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test("how the committed work held, read from the repository's history, and the resets with what they read again", () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-measure-'));
  try {
    const claude = join(root, 'claude');
    const data = join(root, 'data');
    const repo = join(root, 'app');
    const dir = join(claude, 'projects', 'app');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(data, 'events', '2026-10'), { recursive: true });
    const git = (args: string[], at?: string) =>
      execFileSync('git', args, {
        cwd: repo,
        env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    git(['init', '-q']);
    git(['config', 'user.name', 'ada']);
    git(['config', 'user.email', 'ada@example.invalid']);
    const commitAt = (file: string, subject: string, at: string) => {
      writeFileSync(join(repo, file), `${subject}\n`);
      git(['add', '-A']);
      git(['commit', '-q', '-m', subject], at);
    };
    // Task 1 commits the parser, task 2 the docs; a later fix touches the parser within the day.
    commitAt('src/parser.ts', 'feat: add the parser', '2026-10-15T10:05:30Z');
    commitAt('README.md', 'docs: the parser', '2026-10-15T11:05:30Z');
    commitAt('src/parser.ts', 'fix(parser): an empty line', '2026-10-15T20:00:00Z');
    const tool = (command: string) => [{ type: 'tool_use', id: `t${command.length}`, name: 'Bash', input: { command } }];
    writeFileSync(
      join(dir, 's1.jsonl'),
      [
        call('2026-10-15T10:00:00.000Z', 'a', { cwd: repo }),
        call('2026-10-15T10:05:00.000Z', 'b', { cwd: repo, content: tool('git commit -m "feat: add the parser"') }),
        call('2026-10-15T11:00:00.000Z', 'c', { cwd: repo }),
        call('2026-10-15T11:05:00.000Z', 'd', { cwd: repo, content: tool('git commit -m "docs: the parser"') }),
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 's2.jsonl'),
      [call('2026-10-15T11:10:00.000Z', 'e', { session: 's2', cwd: repo }), call('2026-10-15T11:11:00.000Z', 'f', { session: 's2', cwd: repo })].join('\n'),
    );
    const at = (iso: string) => Date.parse(iso);
    writeFileSync(
      join(data, 'events', '2026-10', 's2.mod.jsonl'),
      [
        JSON.stringify({ kind: 'reset', phase: 'carried', session: 's2', from: 's1', at: at('2026-10-15T11:09:00Z'), tokens: 250_000 }),
        JSON.stringify({ kind: 'resetRead', session: 's2', at: at('2026-10-15T11:11:00Z'), before: 250_000, first: 40_000, ready: 52_000, calls: 2 }),
        JSON.stringify({ kind: 'reset', phase: 'carried', session: 'elsewhere', at: at('2026-10-15T11:09:00Z'), tokens: 250_000 }),
      ].join('\n'),
    );
    const r = measure({ claudeDir: claude, dataDir: data, days: 7, now: NOW });
    assert.deepEqual(
      r.tasks.map((t) => [t.session, t.endedBy, t.traces.fixed.in48h, t.traces.fixed.in14d]),
      [
        ['s1', 'commit', true, true],
        ['s1', 'commit', false, null],
        ['s2', 'open', null, null],
      ],
    );
    assert.deepEqual(r.held, { judged48: 2, fixed48: 1, judged14: 1, fixed14: 1, succeeded: 1, perSuccess: r.tasks.reduce((n, t) => n + t.units, 0) });
    // The reset of a conversation measured here goes on its first task; one whose calls are not here is not counted.
    assert.deepEqual(r.tasks[2]!.traces.reset, { before: 250_000, ready: 52_000 });
    assert.equal(r.resets.count, 1);
    assert.equal(r.resets.reread, 52_000);
    // Two calls after the reset: what they no longer read is less than the new start's write, so this one lost a little.
    const saved = 2 * ((210_000 * 0.2) / 1e6) * 0.76 - (40_000 * (4 * 1.25 - 0.2 * 0.76)) / 1e6;
    assert.ok(Math.abs(r.resets.saved! - saved) < 1e-12, String(r.resets.saved));
    // Without the history nothing is judged, and nothing more is said of the resets.
    const blind = measure({ claudeDir: claude, dataDir: data, days: 7, now: NOW, git: false });
    assert.deepEqual(blind.held, {
      judged48: 0,
      fixed48: 0,
      judged14: 0,
      fixed14: 0,
      succeeded: 2,
      perSuccess: blind.tasks.reduce((n, t) => n + t.units, 0) / 2,
    });
    const none = measure({ claudeDir: join(root, 'none'), dataDir: join(root, 'none'), days: 1, now: NOW });
    assert.deepEqual(none.resets, { count: 0, reread: null, saved: null });
    assert.equal(none.held.perSuccess, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

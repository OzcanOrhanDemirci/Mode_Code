// SPDX-License-Identifier: Apache-2.0
// How the work held and what the resets did (core/measure.ts): the resets in Mode_Code's events with what each read
// again and saved, the commits git lists, a later fix of what a task committed within 48 hours and 14 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandDirs,
  commitsOf,
  commitsOfTask,
  fixedAfter,
  fixedAnywhere,
  fixedWithin,
  LOG_FORMAT,
  resetSaving,
  resetsOf,
  tasksOf,
  type Call,
  type Commit,
} from '../../src/core/measure.js';

const H = 3_600_000;
const T0 = Date.parse('2026-10-20T10:00:00Z');

test('the resets in the events: each carried one with what its conversation read again; skips and other kinds are not', () => {
  const lines = [
    { kind: 'reset', phase: 'start', session: 'a', at: T0, tokens: 250_000 },
    { kind: 'reset', phase: 'carried', session: 'b', from: 'a', at: T0 + 5, tokens: 250_000 },
    { kind: 'reset', phase: 'skip', why: 'busy', session: 'b', at: T0 + 9 },
    { kind: 'resetRead', session: 'b', at: T0 + 20, before: 250_000, first: 40_000, ready: 61_000, calls: 4 },
    { kind: 'reset', phase: 'carried', session: 'c', at: T0 - 50, tokens: 300_000 },
    { kind: 'reset', phase: 'carried', at: T0 },
    { kind: 'reset', phase: 'carried', session: 'd', at: 'soon' },
    { kind: 'resetRead', at: T0 },
    null,
  ];
  assert.deepEqual(resetsOf(lines as never), [
    { at: T0 - 50, session: 'c', from: '', before: 300_000, first: null, ready: null },
    { at: T0 + 5, session: 'b', from: 'a', before: 250_000, first: 40_000, ready: 61_000 },
  ]);
});

const call = (session: string, model = 'claude-opus-5-5', sidechain = false): Call => ({
  key: `${session}${Math.random()}`,
  session,
  at: T0,
  model,
  cwd: '',
  sidechain,
  input: 0,
  write5m: 0,
  write1h: 0,
  read: 1000,
  output: 10,
});

test('what a reset saved: the context left behind, not read again by each own call, less the new start written once', () => {
  const r = { at: T0, session: 'b', from: 'a', before: 250_000, first: 50_000, ready: 60_000 };
  // Opus: a read is $0.2 a million, weighed 0.76; a write is 1.25 × $4, weighed 1.
  const calls = [call('b'), call('b'), call('b', 'claude-opus-5-5', true), call('a'), call('b', 'unknown-model')];
  const saved = 2 * ((200_000 * 0.2) / 1e6) * 0.76 - (50_000 * (4 * 1.25 - 0.2 * 0.76)) / 1e6;
  assert.ok(Math.abs(resetSaving(r, calls)! - saved) < 1e-12, String(resetSaving(r, calls)));
  // A start larger than what was left saves nothing on the reads, and still pays for its write.
  assert.ok(resetSaving({ ...r, first: 300_000 }, [call('b')])! < 0);
  // Not measured, or no call of its own: nothing to say, or nothing saved.
  assert.equal(resetSaving({ ...r, first: null }, calls), null);
  assert.equal(resetSaving(r, [call('a')]), 0);
  assert.equal(resetSaving(r, [call('b', 'unknown-model')]), 0);
});

test("git's log as LOG_FORMAT writes it: hash, time, subject and files, oldest first; anything else is left out", () => {
  assert.equal(LOG_FORMAT, '--format=%x1e%H%x1f%ct%x1f%s');
  const text = [
    '\x1eabc1234\x1f1760000100\x1ffix(parser): a | b\x1fx',
    '',
    'src/parser.ts',
    'docs/parser.md',
    '',
    '\x1eabc0000\x1f1760000000\x1ffeat: add the parser',
    '',
    'src/parser.ts',
    '\x1enot-a-hash\x1f1760000200\x1fx',
    '\x1eabc9999\x1fsoon\x1fx',
  ].join('\n');
  assert.deepEqual(commitsOf(text), [
    { hash: 'abc0000', at: 1_760_000_000_000, subject: 'feat: add the parser', files: ['src/parser.ts'] },
    { hash: 'abc1234', at: 1_760_000_100_000, subject: 'fix(parser): a | b\x1fx', files: ['src/parser.ts', 'docs/parser.md'] },
  ]);
  assert.deepEqual(commitsOf(''), []);
});

const commit = (at: number, subject: string, files: string[]): Commit => ({ hash: `h${at}`, at, subject, files });

test('a fix is a later fix: or revert: within the window that shares a code file; notes and lock files tie nothing', () => {
  const c = commit(T0, 'feat: parser', ['src/parser.ts', 'CHANGELOG.md', 'package.json']);
  const fixedBy = (n: Commit, window = 48 * H) => fixedWithin(c, [c, n], window);
  for (const subject of ['fix: x', 'fix(parser): x', 'fix!: x', 'revert: x', 'Revert "feat: parser"', 'FIX: x'])
    assert.equal(fixedBy(commit(T0 + H, subject, ['src/parser.ts'])), true, subject);
  for (const subject of ['feat: x', 'fixes: x', 'prefix: x', 'docs: fix the typo', 'reverted: x', 'fixture: x'])
    assert.equal(fixedBy(commit(T0 + H, subject, ['src/parser.ts'])), false, subject);
  assert.equal(fixedBy(commit(T0 + 48 * H, 'fix: x', ['src/parser.ts'])), true);
  assert.equal(fixedBy(commit(T0 + H, 'fix: x', ['src/other.ts', 'src/parser.ts'])), true, 'one shared file is enough');
  assert.equal(fixedBy(commit(T0 + 48 * H + 1, 'fix: x', ['src/parser.ts'])), false);
  assert.equal(fixedBy(commit(T0, 'fix: x', ['src/parser.ts'])), false, 'at the same moment is no later');
  assert.equal(fixedBy(commit(T0 - H, 'fix: x', ['src/parser.ts'])), false);
  for (const file of ['CHANGELOG.md', 'package.json', 'src/other.ts']) assert.equal(fixedBy(commit(T0 + H, 'fix: x', [file])), false, file);
  for (const file of ['notes.txt', 'yarn.lock', 'run.log', 'a/package-lock.json', 'docs/changelog/1.md'])
    assert.equal(fixedWithin(commit(T0, 'feat: x', [file]), [commit(T0 + H, 'fix: x', [file])], 48 * H), false, file);
  assert.equal(fixedWithin(commit(T0, 'feat: x', ['src/a.mdx']), [commit(T0 + H, 'fix: x', ['src/a.mdx'])], 48 * H), true);
});

test("a task's commits: those its commands named, a minute before its first call to a quarter of an hour past its last, never into the next task", () => {
  const t = { from: T0, to: T0 + H, committed: ['git add -A && git commit -s -m "feat(parser): read the empty line as none"'] };
  const subject = 'feat(parser): read the empty line as none';
  const cs = [-60_001, -60_000, 0, H + 15 * 60_000, H + 15 * 60_000 + 1].map((d) => commit(T0 + d, subject, []));
  assert.deepEqual(
    commitsOfTask(t, cs).map((c) => c.at - T0),
    [-60_000, 0, H + 15 * 60_000],
  );
  assert.deepEqual(
    commitsOfTask(t, cs, T0 + H).map((c) => c.at - T0),
    [-60_000, 0],
  );
  // Another session's commit in the same minutes, a subject past its first 30 characters, or an empty one: not the task's.
  assert.deepEqual(commitsOfTask(t, [commit(T0, 'docs: something else', [])], Infinity), []);
  assert.equal(commitsOfTask(t, [commit(T0, 'feat(parser): read the empty li and more', [])]).length, 1);
  assert.deepEqual(commitsOfTask({ ...t, committed: ['git commit -m ""'] }, [commit(T0, '', [])]), []);
  assert.deepEqual(commitsOfTask({ ...t, committed: [] }, cs), []);
});

test('fixed within a window: true when a fix came, false once the window has passed, else not yet known; nothing committed is null', () => {
  const own = [commit(T0, 'feat: a', ['a.ts']), commit(T0 + H, 'feat: b', ['b.ts'])];
  const all = [...own, commit(T0 + 2 * H, 'fix: b', ['b.ts'])];
  assert.equal(fixedAfter(own, all, 48 * H, T0 + 3 * H), true);
  assert.equal(fixedAfter(own, own, 48 * H, T0 + 3 * H), null);
  assert.equal(fixedAfter(own, own, 48 * H, T0 + H + 48 * H - 1), null, 'the last commit has not had its two days');
  assert.equal(fixedAfter(own, own, 48 * H, T0 + H + 48 * H), false);
  assert.equal(fixedAfter([], all, 48 * H, T0 + 100 * H), null);
});

test("several repositories' answers as one: any fix is a fix, any unknown leaves it unknown, none is null", () => {
  assert.equal(fixedAnywhere([false, true, null]), true);
  assert.equal(fixedAnywhere([true]), true);
  assert.equal(fixedAnywhere([false, false]), false);
  assert.equal(fixedAnywhere([false]), false);
  assert.equal(fixedAnywhere([false, null]), null);
  assert.equal(fixedAnywhere([null]), null);
  assert.equal(fixedAnywhere([]), null);
});

test('the folders a commit command works in: git -C and cd, quotes taken off, each once, in order', () => {
  assert.deepEqual(commandDirs('git -C /c/dev/app add -A && git -C "/c/dev/my app" commit -m x'), ['/c/dev/app', '/c/dev/my app']);
  assert.deepEqual(commandDirs("cd /c/dev/app && git commit -m x; cd '../other' && git push"), ['/c/dev/app', '../other']);
  assert.deepEqual(commandDirs('git -C x add . && git -C x commit -m y && cd x'), ['x']);
  assert.deepEqual(commandDirs('cd\n/c/dev'), []);
  assert.deepEqual(commandDirs('echo cd /tmp && git commit -m "cd /x"'), []);
  assert.deepEqual(commandDirs('git commit -m x'), []);
});

test("a task keeps its commit commands as written: a shell's, run and not refused, a commit's only", () => {
  const at = (s: number) => Date.parse('2026-10-20T10:00:00Z') + s * 1000;
  const calls: Call[] = [0, 1, 2, 3, 4].map((i) => ({ ...call('s1'), key: `k${i}`, at: at(i) }));
  const uses = [
    { key: 'k0', id: 'u0', name: 'Bash', input: { command: 'git commit -m "feat: one"' }, at: at(0) },
    { key: 'k1', id: 'u1', name: 'Bash', input: { command: 'git commit -m "feat: refused"' }, at: at(1) },
    { key: 'k2', id: 'u2', name: 'Write', input: { file_path: 'a.ts', command: 'git commit -m "feat: no shell"' }, at: at(2) },
    { key: 'k3', id: 'u3', name: 'Bash', input: { command: 'git status' }, at: at(3) },
    { key: 'k4', id: 'u4', name: 'PowerShell', input: { command: 'git commit -m "feat: two"' }, at: at(4) },
  ];
  const results = [{ id: 'u1', chars: 10, refused: true }];
  const [t] = tasksOf(calls, [], uses as never, results as never);
  assert.deepEqual(t!.traces.committed, ['git commit -m "feat: one"', 'git commit -m "feat: two"']);
  assert.equal(
    tasksOf(calls.slice(0, 1), [], [{ ...uses[0]!, input: { command: `git commit -m "${'x'.repeat(700)}"` } }] as never)[0]!.traces.committed[0]!.length,
    600,
  );
});

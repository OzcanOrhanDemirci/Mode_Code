// SPDX-License-Identifier: Apache-2.0
/**
 * The safety net's pure part (src/core/net.ts): its id, what git says read back, what `git clean` is asked
 * instead of running, a record read back, the steps back that overwrite nothing, and which nets go.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDryRunArgs,
  isNetId,
  keepRef,
  keptAnything,
  netId,
  netsToPrune,
  parseCleanDryRun,
  parseNetRecord,
  parseRefs,
  parseShas,
  restoreSteps,
  type NetRecord,
} from '../../src/core/net.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const NOW = Date.parse('2026-10-20T21:07:09Z');

const record = (over: Partial<NetRecord> = {}): NetRecord => ({
  v: 1,
  id: '20261020-210709-abc',
  at: NOW,
  session: 's1',
  rule: 'git.discard-work',
  tool: 'Bash',
  command: 'git reset --hard',
  plan: { kind: 'refs', repo: '/dev/app' },
  refs: [],
  work: null,
  stashes: [],
  remote: null,
  files: [],
  bytes: 0,
  ...over,
});

test("a net's id sorts by its time and is a folder's name, never a path; its commits live under refs/modecode/net", () => {
  assert.equal(netId(NOW, 'x9y8z7w6'), '20261020-210709-x9y8z7');
  assert.equal(netId(NOW, 'A-B/c'), '20261020-210709-c');
  assert.ok(isNetId('20261020-210709-x9y8z7'));
  for (const bad of ['../x', '20261020-210709-', '20261020-210709-ABC', '2026-10-20', '20261020-210709-abcdefg']) assert.ok(!isNetId(bad), bad);
  assert.equal(keepRef('20261020-210709-abc', A), `refs/modecode/net/20261020-210709-abc/${A}`);
});

test('what git says, read back: the tips worth keeping, commit ids, what clean would remove', () => {
  assert.deepEqual(
    parseRefs(
      `${A} refs/heads/main\n${B} refs/remotes/origin/HEAD\n${B} refs/remotes/origin/main\n${C} refs/tags/v1\n${A} refs/modecode/net/x/${A}\nnot a line\n`,
    ),
    [
      { name: 'refs/heads/main', sha: A },
      { name: 'refs/remotes/origin/main', sha: B },
      { name: 'refs/tags/v1', sha: C },
    ],
  );
  assert.deepEqual(parseShas(`${A}\n\n  ${B}  \nxyz\n`), [A, B]);
  assert.deepEqual(parseCleanDryRun('Would remove build.tmp\nWould remove dist/\nWould skip repository vendor/lib\n'), ['build.tmp', 'dist/']);
});

test("git clean is asked what it would remove with the call's own flags and paths, -n in place of -f", () => {
  assert.deepEqual(cleanDryRunArgs(['-fdx']), ['clean', '-n', '-dx']);
  assert.deepEqual(cleanDryRunArgs(['-f', '-d', '--', 'build', '-f']), ['clean', '-n', '-d', '--', 'build', '-f']);
  assert.deepEqual(cleanDryRunArgs(['--force', '-i', '-q', '-X', 'out']), ['clean', '-n', '-X', 'out']);
  assert.deepEqual(cleanDryRunArgs(['-fq']), ['clean', '-n']);
  assert.deepEqual(cleanDryRunArgs(['-e', '*.log', '-f']), ['clean', '-n', '-e', '*.log']);
  for (const long of ['--force', '--interactive', '--quiet']) assert.deepEqual(cleanDryRunArgs([long, '-d']), ['clean', '-n', '-d'], long);
});

test('a record read back whole; anything else is not one', () => {
  const r = record({ refs: [{ name: 'refs/heads/main', sha: A }], work: B, stashes: [C], files: [{ from: '/x/a', to: '/n/f/0' }] });
  assert.deepEqual(parseNetRecord(JSON.stringify(r)), r);
  for (const bad of [
    null,
    '',
    '{',
    '[]',
    '5',
    'null',
    JSON.stringify({ ...r, v: 2 }),
    JSON.stringify({ ...r, id: '../x' }),
    JSON.stringify({ ...r, id: 5 }),
    JSON.stringify({ ...r, at: 'now' }),
    JSON.stringify({ ...r, rule: 5 }),
    JSON.stringify({ ...r, plan: { kind: 'odd' } }),
    JSON.stringify({ ...r, plan: 'refs' }),
    JSON.stringify({ ...r, plan: null }),
  ])
    assert.equal(parseNetRecord(bad), null, String(bad));
  // Broken parts are left out, not the record.
  const odd = parseNetRecord(JSON.stringify({ ...r, refs: [{ name: 1 }, r.refs[0]], files: 'x', remote: { remote: 'o' }, session: 5, work: 7, bytes: 'x' }))!;
  assert.deepEqual([odd.refs, odd.files, odd.remote, odd.session, odd.work, odd.bytes], [r.refs, [], null, null, null, 0]);
  // Each part of a kept ref, file and remote tip is needed; a part missing leaves that one out.
  const parts = parseNetRecord(
    JSON.stringify({
      ...r,
      refs: [null, { sha: A }, { name: 'refs/heads/x' }, { name: 'refs/heads/y', sha: B }],
      files: [null, { from: '/a' }, { to: '/b' }, { from: '/c', to: '/d' }],
      stashes: [A, 5],
    }),
  )!;
  assert.deepEqual([parts.refs, parts.files, parts.stashes], [[{ name: 'refs/heads/y', sha: B }], [{ from: '/c', to: '/d' }], [A]]);
  const tip = { remote: 'origin', branch: 'f', sha: A };
  assert.deepEqual(parseNetRecord(JSON.stringify({ ...r, remote: tip }))!.remote, tip);
  for (const broken of [{ ...tip, remote: 1 }, { ...tip, branch: 1 }, { ...tip, sha: 1 }, 'x'])
    assert.equal(parseNetRecord(JSON.stringify({ ...r, remote: broken }))!.remote, null, JSON.stringify(broken));
  assert.equal(parseNetRecord(JSON.stringify({ ...r, bytes: 12 }))!.bytes, 12);
});

test('a net that kept nothing is none', () => {
  assert.ok(!keptAnything(record()));
  assert.ok(keptAnything(record({ refs: [{ name: 'refs/heads/main', sha: A }] })));
  assert.ok(keptAnything(record({ work: A })));
  assert.ok(keptAnything(record({ stashes: [A] })));
  assert.ok(keptAnything(record({ remote: { remote: 'origin', branch: 'feature', sha: A } })));
  assert.ok(keptAnything(record({ files: [{ from: '/a', to: '/b' }] })));
});

test('the steps back overwrite nothing: a lost branch comes back, a moved one gets a branch beside it, the changes go to the stash', () => {
  const r = record({
    refs: [
      { name: 'refs/heads/main', sha: A },
      { name: 'refs/heads/gone', sha: B },
      { name: 'refs/heads/same', sha: C },
      { name: 'refs/tags/v1', sha: C },
      { name: 'refs/tags/kept', sha: C },
      { name: 'refs/remotes/origin/main', sha: A },
    ],
    work: B,
    stashes: [C, B],
  });
  const now = new Map([
    ['refs/heads/main', C],
    ['refs/heads/same', C],
    ['refs/tags/kept', C],
  ]);
  assert.deepEqual(
    restoreSteps(r, now, new Set([A]), () => true),
    [
      { kind: 'git', repo: '/dev/app', args: ['branch', '--', 'modecode/net-20261020-210709-abc/main', A], what: 'modecode/net-20261020-210709-abc/main' },
      { kind: 'git', repo: '/dev/app', args: ['branch', '--', 'gone', B], what: 'gone' },
      { kind: 'git', repo: '/dev/app', args: ['tag', '--', 'v1', C], what: 'v1' },
      { kind: 'git', repo: '/dev/app', args: ['stash', 'store', '-m', 'mode-code net 20261020-210709-abc', B], what: 'stash' },
      { kind: 'git', repo: '/dev/app', args: ['stash', 'store', '-m', 'mode-code net 20261020-210709-abc', C], what: 'stash' },
    ],
  );
  // The stash as it was, oldest first, the uncommitted changes on top, each once.
  assert.deepEqual(
    restoreSteps(record({ stashes: [C, A], work: B }), new Map(), new Set(), () => true).map((s) => (s.kind === 'git' ? s.args.at(-1) : '')),
    [A, C, B],
  );
  // Put back once already: the branch beside it is there, nothing again.
  const again = new Map([...now, ['refs/heads/modecode/net-20261020-210709-abc/main', A], ['refs/heads/gone', B], ['refs/tags/v1', C]]);
  assert.deepEqual(
    restoreSteps(r, again, new Set([A, B, C]), () => true),
    [],
  );
});

test("a remote branch is the person's to put back, with the command; a file comes back only where nothing is", () => {
  const remote = record({
    rule: 'git.force-push',
    plan: { kind: 'remote', repo: '/dev/app', remote: 'origin', branch: 'feature' },
    remote: { remote: 'origin', branch: 'feature', sha: A },
  });
  assert.deepEqual(
    restoreSteps(remote, new Map([['refs/remotes/origin/feature', B]]), new Set(), () => true),
    [{ kind: 'person', command: `git push --force-with-lease=feature:${B} origin ${A}:refs/heads/feature`, what: 'origin/feature' }],
  );
  // Deleted on the remote: its tracking branch went too, so the push expects none there.
  assert.deepEqual(restoreSteps(remote, new Map(), new Set(), () => true)[0], {
    kind: 'person',
    command: `git push --force-with-lease=feature: origin ${A}:refs/heads/feature`,
    what: 'origin/feature',
  });
  assert.deepEqual(
    restoreSteps(remote, new Map([['refs/remotes/origin/feature', A]]), new Set(), () => true),
    [],
  );
  const files = record({
    rule: 'git.clean',
    plan: { kind: 'paths', paths: ['/x/a', '/x/b'] },
    files: [
      { from: '/x/a', to: '/n/0' },
      { from: '/x/b', to: '/n/1' },
    ],
  });
  assert.deepEqual(
    restoreSteps(files, new Map(), new Set(), (p) => p === '/x/b'),
    [{ kind: 'copy', from: '/n/0', to: '/x/a' }],
  );
});

test('nets go after their days or past the most kept, the oldest first', () => {
  const day = 86_400_000;
  const nets = [
    { id: 'a', at: NOW - 20 * day },
    { id: 'b', at: NOW - 13 * day },
    { id: 'c', at: NOW - day },
    { id: 'd', at: NOW },
  ];
  assert.deepEqual(netsToPrune(nets, NOW), ['a']);
  // Exactly its days old: still kept.
  assert.deepEqual(netsToPrune([{ id: 'e', at: NOW - 14 * day }], NOW), []);
  assert.deepEqual(netsToPrune(nets, NOW, 14, 2), ['b', 'a']);
  assert.deepEqual(netsToPrune(nets, NOW, 14 - 1 / 24, 4).sort(), ['a']);
  assert.deepEqual(netsToPrune([], NOW), []);
});

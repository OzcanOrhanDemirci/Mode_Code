// SPDX-License-Identifier: Apache-2.0
/**
 * Every branch of the memory sync (core/memory-sync.ts) with git answered by script: the failures real
 * repositories cannot be made to show on demand (a lock held, a commit refused for want of a name, a pull
 * that leaves a rebase half done, a push rejected and then a pull that cannot join), each read back as the
 * outcome the person is told. The same steps run against real repositories in test/node/memory-sync.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NOTE_BYTES, syncMemory, type Runner, type SyncInput } from '../../src/core/memory-sync.js';

type Answer = { exitCode?: number; stdout?: string; stderr?: string } | Error;
type Script = (args: string[]) => Answer | undefined;

/** git answered by a script: the arguments after `-C <dir>`; unanswered calls fail loudly so a test sees them. */
function fake(script: Script) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(argv) {
      const args = argv.slice(3);
      calls.push(args.join(' '));
      const a = script(args);
      if (a instanceof Error) throw a;
      if (!a) return { exitCode: 99, stdout: '', stderr: `unscripted: git ${args.join(' ')}` };
      return { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
    },
  };
  return { runner, calls };
}

const files = new Map<string, string>([['/m/a.md', 'note a']]);
const input = (over: Partial<SyncInput> = {}): SyncInput => ({
  dir: '/m',
  remote: true,
  steps: { commit: true, pull: true, push: true },
  message: () => 'msg',
  readFile: async (p) => files.get(p) ?? null,
  secrets: (t) => (t.includes('SECRET') ? 1 : 0),
  ...over,
});

/** A repository at /m with an upstream, nothing changed, nothing to send: each test overrides what it needs. */
const base =
  (over: Record<string, Answer> = {}): Script =>
  (args) => {
    const a = args.join(' ');
    if (a in over) return over[a];
    if (a === 'rev-parse --show-toplevel') return { stdout: '/m\n' };
    if (a.startsWith('status')) return { stdout: '' };
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { stdout: 'origin/main\n' };
    if (a === 'pull --rebase --autostash --quiet') return {};
    if (a === 'rev-list --count @{upstream}..HEAD') return { stdout: '0\n' };
    if (a === 'rev-list --left-right --count @{upstream}...HEAD') return { stdout: '0\t0\n' };
    return undefined;
  };

test('not a work tree: nothing is touched, and git’s first line (without its prefix) is the detail', async () => {
  const a = fake(base({ 'rev-parse --show-toplevel': { exitCode: 128, stderr: 'fatal: not a git repository\nhint: more' } }));
  const r = await syncMemory(a.runner, input());
  assert.deepEqual([r.repo, r.commit, r.pull, r.push, r.detail], [false, 'skipped', 'skipped', 'skipped', 'not a git repository']);
  assert.deepEqual(a.calls, ['rev-parse --show-toplevel']);
  const empty = await syncMemory(fake(base({ 'rev-parse --show-toplevel': { stdout: '  \n' } })).runner, input());
  assert.deepEqual([empty.repo, empty.detail], [false, 'not a git work tree']);
  const silent = await syncMemory(fake(base({ 'rev-parse --show-toplevel': { exitCode: 1, stderr: '' } })).runner, input());
  assert.equal(silent.detail, 'not a git work tree');
});

test('the commit step: a lock held, a failure, nothing readable, the size limit to the byte, a secret', async () => {
  const st = 'status --porcelain=v1 -z --untracked-files=all -- .';
  const busy = await syncMemory(fake(base({ [st]: { exitCode: 128, stderr: "fatal: Unable to create '/m/.git/index.lock': File exists." } })).runner, input());
  assert.equal(busy.commit, 'busy');
  const failed = await syncMemory(fake(base({ [st]: { exitCode: 128, stderr: 'fatal: bad' } })).runner, input());
  assert.deepEqual([failed.commit, failed.detail], ['failed', 'bad']);
  // An entry that cannot be read (a nested repository listed as a folder) is left as it is.
  const unreadable = await syncMemory(fake(base({ [st]: { stdout: '?? nested/\0' } })).runner, input());
  assert.deepEqual([unreadable.commit, unreadable.held], ['none', []]);
  const big = (n: number) => new Map([['/m/big.md', 'x'.repeat(n)]]);
  const at = await syncMemory(
    fake(base({ [st]: { stdout: '?? big.md\0' }, 'add -A -- :(top,literal)big.md': {}, 'commit --quiet -m msg --only -- :(top,literal)big.md': {} })).runner,
    input({ readFile: async (p) => big(MAX_NOTE_BYTES).get(p) ?? null }),
  );
  assert.deepEqual([at.commit, at.held], ['ok', []], 'exactly at the limit goes');
  const over = await syncMemory(
    fake(base({ [st]: { stdout: '?? big.md\0' } })).runner,
    input({ readFile: async (p) => big(MAX_NOTE_BYTES + 1).get(p) ?? null }),
  );
  assert.deepEqual([over.commit, over.held], ['held', [{ path: 'big.md', reason: 'large' }]]);
  // A multi-byte character counts as its bytes.
  const wide = await syncMemory(fake(base({ [st]: { stdout: '?? big.md\0' } })).runner, input({ readFile: async () => 'ş'.repeat(MAX_NOTE_BYTES / 2 + 1) }));
  assert.equal(wide.commit, 'held');
  const secret = await syncMemory(fake(base({ [st]: { stdout: '?? s.md\0' } })).runner, input({ readFile: async () => 'SECRET' }));
  assert.deepEqual([secret.commit, secret.held], ['held', [{ path: 's.md', reason: 'secret' }]]);
});

test('staging and committing: in chunks of a hundred, only the changed files, and why a commit failed', async () => {
  const st = 'status --porcelain=v1 -z --untracked-files=all -- .';
  const many = (n: number) => Array.from({ length: n }, (_, i) => `?? n${i}.md\0`).join('');
  const notes = new Map(Array.from({ length: 101 }, (_, i) => [`/m/n${i}.md`, 'n']));
  const read = async (p: string) => notes.get(p) ?? null;
  const ok = (args: string[]) => (args[0] === 'add' || args[0] === 'commit' ? {} : undefined);
  const hundred = fake((args) => ok(args) ?? base({ [st]: { stdout: many(100) } })(args));
  assert.equal((await syncMemory(hundred.runner, input({ readFile: read }))).committed, 100);
  assert.equal(hundred.calls.filter((c) => c.startsWith('add')).length, 1);
  assert.match(
    hundred.calls.find((c) => c.startsWith('commit'))!,
    /^commit --quiet -m msg --only -- :\(top,literal\)n0\.md/,
  );
  const hundredOne = fake((args) => ok(args) ?? base({ [st]: { stdout: many(101) } })(args));
  assert.equal((await syncMemory(hundredOne.runner, input({ readFile: read }))).committed, 101);
  assert.equal(hundredOne.calls.filter((c) => c.startsWith('add')).length, 2);
  assert.equal(
    hundredOne.calls.find((c) => c.startsWith('commit')),
    'commit --quiet -m msg',
    'past one chunk the staged set is committed',
  );
  const one = { [st]: { stdout: '?? a.md\0' } };
  const addBusy = await syncMemory(
    fake(base({ ...one, 'add -A -- :(top,literal)a.md': { exitCode: 128, stderr: 'fatal: index.lock exists' } })).runner,
    input(),
  );
  assert.equal(addBusy.commit, 'busy');
  const addFailed = await syncMemory(fake(base({ ...one, 'add -A -- :(top,literal)a.md': { exitCode: 128, stderr: 'fatal: nope' } })).runner, input());
  assert.deepEqual([addFailed.commit, addFailed.detail], ['failed', 'nope']);
  const commit = (answer: Answer) => base({ ...one, 'add -A -- :(top,literal)a.md': {}, 'commit --quiet -m msg --only -- :(top,literal)a.md': answer });
  const who = await syncMemory(fake(commit({ exitCode: 128, stderr: '*** Please tell me who you are.' })).runner, input());
  assert.deepEqual([who.commit, who.detail], ['identity', '*** Please tell me who you are.']);
  assert.equal((await syncMemory(fake(commit({ exitCode: 128, stderr: 'index.lock' })).runner, input())).commit, 'busy');
  const hook = await syncMemory(fake(commit({ exitCode: 1, stdout: 'pre-commit hook said no' })).runner, input());
  assert.deepEqual([hook.commit, hook.detail], ['failed', 'pre-commit hook said no'], 'a refusal printed to stdout is the detail');
});

test('the upstream: taken as git reports it; a branch without one follows origin’s branch of its name, when there is one', async () => {
  const up = 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}';
  const none = { [up]: { exitCode: 128, stderr: 'no upstream' } };
  const adopt = (over: Record<string, Answer>) =>
    base({
      ...none,
      'symbolic-ref --quiet --short HEAD': { stdout: 'main\n' },
      'fetch --quiet origin': {},
      'rev-parse --verify --quiet refs/remotes/origin/main': { stdout: 'abc\n' },
      'branch --set-upstream-to=origin/main': {},
      'rev-parse --verify --quiet HEAD': { exitCode: 1 },
      ...over,
    });
  const adopted = fake(adopt({}));
  const r = await syncMemory(adopted.runner, input());
  assert.equal(r.pull, 'ok');
  assert.ok(adopted.calls.includes('branch --set-upstream-to=origin/main'));
  for (const [what, over] of [
    ['a detached head', { 'symbolic-ref --quiet --short HEAD': { exitCode: 1 } }],
    [
      'an empty branch name',
      {
        'symbolic-ref --quiet --short HEAD': { stdout: '\n' },
        'rev-parse --verify --quiet refs/remotes/origin/': { stdout: 'abc' },
        'branch --set-upstream-to=origin/': {},
      },
    ],
    ['git failing but printing a name', { 'symbolic-ref --quiet --short HEAD': { exitCode: 1, stdout: 'main\n' } }],
    ['an unreachable origin', { 'fetch --quiet origin': { exitCode: 128, stderr: 'Could not resolve host' } }],
    ['origin without the branch', { 'rev-parse --verify --quiet refs/remotes/origin/main': { exitCode: 1 } }],
    ['the upstream not set', { 'branch --set-upstream-to=origin/main': { exitCode: 1 } }],
  ] as const) {
    const f = fake(adopt(over as Record<string, Answer>));
    const res = await syncMemory(f.runner, input());
    assert.equal(res.pull, 'none', what);
    assert.equal(res.ahead, null, what);
  }
  // An upstream that reads empty counts as none.
  const blank = await syncMemory(fake(adopt({ [up]: { stdout: '  \n' }, 'symbolic-ref --quiet --short HEAD': { exitCode: 1 } })).runner, input());
  assert.equal(blank.pull, 'none');
});

test('the pull: a conflict is undone with its files named; a rebase left half done is undone; failures are sorted', async () => {
  const pull = 'pull --rebase --autostash --quiet';
  const conflicted = fake(
    base({ [pull]: { exitCode: 1, stderr: 'CONFLICT (content)' }, 'diff --name-only --diff-filter=U': { stdout: 'MEMORY.md\nb.md\n' }, 'rebase --abort': {} }),
  );
  const c = await syncMemory(conflicted.runner, input());
  assert.deepEqual([c.pull, c.conflicts, c.push, c.detail], ['conflict', ['MEMORY.md', 'b.md'], 'skipped', 'could not join the changes in MEMORY.md, b.md']);
  assert.ok(conflicted.calls.includes('rebase --abort'));
  const half = fake(
    base({
      [pull]: { exitCode: 1, stderr: 'error: cannot rebase' },
      'diff --name-only --diff-filter=U': { stdout: '' },
      'rev-parse --verify --quiet REBASE_HEAD': { stdout: 'abc' },
      'rebase --abort': {},
    }),
  );
  const h = await syncMemory(half.runner, input());
  assert.deepEqual([h.pull, h.detail], ['failed', 'cannot rebase']);
  assert.ok(half.calls.includes('rebase --abort'));
  const sorted = async (stderr: string, stdout = '') =>
    (
      await syncMemory(
        fake(
          base({
            [pull]: { exitCode: 1, stderr, stdout },
            'diff --name-only --diff-filter=U': { exitCode: 1 },
            'rev-parse --verify --quiet REBASE_HEAD': { exitCode: 1 },
          }),
        ).runner,
        input(),
      )
    ).pull;
  assert.equal(await sorted('fatal: Could not resolve host: github.com'), 'offline');
  assert.equal(await sorted('fatal: Authentication failed'), 'auth');
  assert.equal(await sorted('fatal: index.lock'), 'busy');
  assert.equal(await sorted('', 'Updates were rejected'), 'failed', 'what a pull cannot be is sorted as a plain failure');
  assert.equal(await sorted('*** Please tell me who you are.'), 'failed');
});

test('the push: nothing to send, a first push, a rejection pulled once and sent again, a rejection that cannot be joined', async () => {
  const ahead = (n: number) => ({ 'rev-list --count @{upstream}..HEAD': { stdout: `${n}\n` } });
  const quiet = fake(base(ahead(0)));
  assert.equal((await syncMemory(quiet.runner, input())).push, 'none');
  assert.ok(!quiet.calls.some((c) => c.startsWith('push')));
  const sending = fake(base({ ...ahead(2), 'push --quiet': {} }));
  const sent = await syncMemory(sending.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([sent.repo, sent.push], [true, 'ok']);
  assert.ok(!sending.calls.some((c) => c.startsWith('pull')), 'a push that went through is not followed by a pull');
  assert.equal(sending.calls.filter((c) => c.endsWith('@{upstream}')).length, 1, 'an upstream known before the push is not asked for again');
  // No upstream: a first push when there is a commit, nothing without one.
  const up = 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}';
  const noUp = { [up]: { exitCode: 1 }, 'symbolic-ref --quiet --short HEAD': { exitCode: 1 } };
  assert.equal((await syncMemory(fake(base({ ...noUp, 'rev-parse --verify --quiet HEAD': { exitCode: 1 } })).runner, input())).push, 'none');
  let pushed = false;
  const first = fake((args) => {
    const a = args.join(' ');
    if (a === 'push --quiet --set-upstream origin HEAD') {
      pushed = true;
      return {};
    }
    if (a === up) return pushed ? { stdout: 'origin/main\n' } : { exitCode: 1 };
    return base({ 'symbolic-ref --quiet --short HEAD': { exitCode: 1 }, 'rev-parse --verify --quiet HEAD': { stdout: 'abc' } })(args);
  });
  const f = await syncMemory(first.runner, input());
  assert.deepEqual([f.push, f.ahead, f.behind], ['ok', 0, 0], 'after a first push the upstream is read again');
  // Rejected: one pull, one more push.
  let tries = 0;
  const again = fake((args) => {
    if (args.join(' ') === 'push --quiet') return ++tries === 1 ? { exitCode: 1, stderr: ' ! [rejected] main -> main (fetch first)' } : {};
    return base(ahead(1))(args);
  });
  const g = await syncMemory(again.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([g.push, tries, g.pull], ['ok', 2, 'skipped']);
  assert.ok(again.calls.includes('pull --rebase --autostash --quiet'), 'pulled once, even on a turn that does not pull');
  // Rejected and the pull cannot join: the push stays rejected, nothing is forced.
  const stuck = fake(
    base({
      ...ahead(1),
      'push --quiet': { exitCode: 1, stderr: ' ! [rejected] (fetch first)' },
      'pull --rebase --autostash --quiet': { exitCode: 1 },
      'diff --name-only --diff-filter=U': { stdout: 'MEMORY.md\n' },
      'rebase --abort': {},
    }),
  );
  const s = await syncMemory(stuck.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([s.push, s.conflicts], ['rejected', ['MEMORY.md']]);
  assert.equal(stuck.calls.filter((c) => c === 'push --quiet').length, 1);
  assert.ok(!stuck.calls.some((c) => c.includes('--force')));
  // Rejected and the pull fails for another reason: one push only, the rejection stays.
  const offline = fake(
    base({
      ...ahead(1),
      'push --quiet': { exitCode: 1, stderr: ' ! [rejected] (fetch first)' },
      'pull --rebase --autostash --quiet': { exitCode: 1, stderr: 'Could not resolve host' },
      'diff --name-only --diff-filter=U': { exitCode: 1 },
      'rev-parse --verify --quiet REBASE_HEAD': { exitCode: 1 },
    }),
  );
  const o = await syncMemory(offline.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([o.push, offline.calls.filter((c) => c === 'push --quiet').length], ['rejected', 1]);
  // Other refusals, sorted; a push never reports a missing identity.
  const refused = async (stderr: string, stdout = '') =>
    (await syncMemory(fake(base({ ...ahead(1), 'push --quiet': { exitCode: 1, stderr, stdout } })).runner, input())).push;
  assert.equal(await refused('fatal: Could not resolve host: github.com'), 'offline');
  assert.equal(await refused('remote: Permission denied'), 'auth');
  assert.equal(await refused('', 'index.lock'), 'busy');
  // A push refused for another reason than a rejection is not followed by a pull and a second try.
  const down = fake(base({ ...ahead(1), 'push --quiet': { exitCode: 1, stderr: 'fatal: Could not resolve host' } }));
  await syncMemory(down.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([down.calls.filter((c) => c === 'push --quiet').length, down.calls.some((c) => c.startsWith('pull'))], [1, false]);
  const said = await syncMemory(fake(base({ ...ahead(1), 'push --quiet': { exitCode: 1, stderr: '', stdout: 'remote said no' } })).runner, input());
  assert.equal(said.detail, 'remote said no', 'a refusal printed to stdout is the detail');
  assert.equal(await refused('Please tell me who you are'), 'failed');
  assert.equal(await refused('fatal: odd'), 'failed');
});

test('the counts after a sync, a remote that hangs, the first problem kept as the detail', async () => {
  const counts = 'rev-list --left-right --count @{upstream}...HEAD';
  const r = await syncMemory(fake(base({ [counts]: { stdout: '3\t1\n' } })).runner, input());
  assert.deepEqual([r.behind, r.ahead], [3, 1]);
  assert.deepEqual(
    [
      (await syncMemory(fake(base({ [counts]: { stdout: 'odd' } })).runner, input())).ahead,
      (await syncMemory(fake(base({ [counts]: { exitCode: 1, stdout: '3\t1' } })).runner, input())).ahead,
    ],
    [null, null],
  );
  // A call that runs out of time on the network is the network's; any other error is a failure.
  const hang = await syncMemory(fake(base({ 'pull --rebase --autostash --quiet': new Error('timed out after 60000 ms: git pull') })).runner, input());
  assert.equal(hang.pull, 'offline');
  assert.match(hang.detail, /^operation timed out: /);
  const broke = await syncMemory(fake(base({ 'pull --rebase --autostash --quiet': new Error('spawn git ENOENT') })).runner, input());
  assert.deepEqual([broke.pull, broke.detail], ['failed', 'spawn git ENOENT']);
  // Only the first problem is the detail.
  const two = await syncMemory(
    fake(
      base({
        'status --porcelain=v1 -z --untracked-files=all -- .': { exitCode: 1, stderr: 'fatal: first' },
        'pull --rebase --autostash --quiet': { exitCode: 1, stderr: 'fatal: second' },
        'diff --name-only --diff-filter=U': { exitCode: 1 },
        'rev-parse --verify --quiet REBASE_HEAD': { exitCode: 1 },
      }),
    ).runner,
    input(),
  );
  assert.equal(two.detail, 'first');
  // Without a remote, nothing goes out and no upstream is asked for.
  const local = fake(base());
  const l = await syncMemory(local.runner, input({ remote: false }));
  assert.deepEqual([l.pull, l.push, l.ahead], ['skipped', 'skipped', null]);
  assert.ok(!local.calls.some((c) => c.includes('@{upstream}')));
});

test('what the pulls brought in: the files and the index lines, counted from where the store stood before them', async () => {
  const head = 'rev-parse --verify --quiet HEAD';
  const names = 'diff --name-only --no-renames --relative -z abc HEAD -- .';
  const lines = 'diff --unified=0 --no-color --no-ext-diff --relative abc HEAD -- MEMORY.md';
  const answered = (over: Record<string, Answer> = {}) =>
    fake(base({ [head]: { stdout: 'abc\n' }, [names]: { stdout: 'MEMORY.md\0a.md\0' }, [lines]: { stdout: '@@ -1 +1 @@\n-old\n+new\n' }, ...over }));
  const r = await syncMemory(answered().runner, input());
  assert.deepEqual([r.pulled, r.index], [['MEMORY.md', 'a.md'], { removed: ['old'], added: ['new'] }]);
  // Only other files: the index is not asked about.
  const o = answered({ [names]: { stdout: 'a.md\0' } });
  const ro = await syncMemory(o.runner, input());
  assert.deepEqual([ro.pulled, ro.index], [['a.md'], null]);
  assert.ok(!o.calls.includes(lines));
  // git cannot list them: nothing; it cannot show the index's change: the files without the lines.
  const nl = await syncMemory(answered({ [names]: { exitCode: 128 } }).runner, input());
  assert.deepEqual([nl.pulled, nl.index], [[], null]);
  const nd = await syncMemory(answered({ [lines]: { exitCode: 128 } }).runner, input());
  assert.deepEqual([nd.pulled, nd.index], [['MEMORY.md', 'a.md'], null]);
  // Nothing came in (a pull that failed, a turn that does not pull, no remote, no history yet): nothing is asked.
  for (const [over, inp] of [
    [{ 'pull --rebase --autostash --quiet': { exitCode: 1, stderr: 'fatal: bad' } }, input()],
    [{}, input({ steps: { commit: true, pull: false, push: true } })],
    [{}, input({ remote: false })],
    [{ [head]: { exitCode: 1 } }, input()],
  ] as const) {
    const a = answered(over);
    const x = await syncMemory(a.runner, inp);
    assert.deepEqual([x.pulled, x.index], [[], null]);
    assert.ok(!a.calls.includes(names));
  }
  assert.ok(!answered().calls.length, 'nothing is run before the sync');
  const local = answered();
  await syncMemory(local.runner, input({ remote: false }));
  assert.ok(!local.calls.includes(head), 'a store without a remote is not asked where it stood');
  // A push the remote turned away pulls once: what that pull brings in counts too.
  let tries = 0;
  const rejected = fake((args) => {
    if (args.join(' ') === 'push --quiet') return ++tries === 1 ? { exitCode: 1, stderr: ' ! [rejected] main -> main (fetch first)' } : {};
    return base({ 'rev-list --count @{upstream}..HEAD': { stdout: '1\n' }, [head]: { stdout: 'abc\n' }, [names]: { stdout: 'b.md\0' } })(args);
  });
  const p = await syncMemory(rejected.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([p.push, p.pulled], ['ok', ['b.md']]);
});

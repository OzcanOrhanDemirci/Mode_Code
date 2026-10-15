// SPDX-License-Identifier: Apache-2.0
/**
 * Every branch of the memory sync (core/memory-sync.ts) with git answered by script: the failures real
 * repositories cannot be made to show on demand (a lock held, a commit refused for want of a name, a pull
 * that leaves a rebase half done, a push rejected and then a pull that cannot join), each read back as the
 * outcome the person is told. The same steps run against real repositories in test/node/memory-sync.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSeen, looksOnly, MAX_NOTE_BYTES, parseSeen, syncMemory, syncPlan, type Runner, type SyncInput } from '../../src/core/memory-sync.js';

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

/** A pull in two steps: a fetch that leaves FETCH_HEAD alone, then a join with the upstream by name. */
const FETCH = 'fetch --quiet --no-write-fetch-head';
const REBASE = 'rebase --autostash --quiet';
const MERGE = 'merge --ff-only --quiet @{upstream}';

/** A repository at /m with an upstream, nothing changed, nothing to send: each test overrides what it needs. */
const base =
  (over: Record<string, Answer> = {}): Script =>
  (args) => {
    const a = args.join(' ');
    if (a in over) return over[a];
    if (a === 'rev-parse --show-toplevel') return { stdout: '/m\n' };
    if (a.startsWith('status')) return { stdout: '' };
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { stdout: 'origin/main\n' };
    if (a === FETCH || a === REBASE || a === MERGE) return {};
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
  const pull = REBASE;
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
  const sorted = async (stderr: string, stdout = '', step = FETCH) =>
    (
      await syncMemory(
        fake(
          base({
            [step]: { exitCode: 1, stderr, stdout },
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
  assert.equal(await sorted("error: cannot lock ref 'refs/remotes/origin/main': is at abc but expected def"), 'busy');
  assert.equal(await sorted('fatal: index.lock', '', pull), 'busy', 'a join that keeps meeting a lock');
  assert.equal(await sorted('', 'Updates were rejected'), 'failed', 'what a pull cannot be is sorted as a plain failure');
  assert.equal(await sorted('*** Please tell me who you are.'), 'failed');
  assert.ok(!conflicted.calls.some((c) => c.startsWith('pull')), 'never git pull: it reads FETCH_HEAD');
});

test('the pull in two steps: another fetch at the same moment is waited out, an old git fetches without the flag', async () => {
  // A second session fetched the same commits at the same moment: the lock is the other's. Once more, after it.
  const tries = new Map<string, number>();
  const raced = (step: string, stderr: string) =>
    fake((args) => {
      const a = args.join(' ');
      if (a !== step) return base()(args);
      tries.set(step, (tries.get(step) ?? 0) + 1);
      return tries.get(step) === 1 ? { exitCode: 1, stderr } : {};
    });
  const f = await syncMemory(
    raced(FETCH, "error: cannot lock ref 'refs/remotes/origin/main': Unable to create '/m/.git/refs/remotes/origin/main.lock': File exists.").runner,
    input(),
  );
  const j = await syncMemory(raced(REBASE, "fatal: Unable to create '/m/.git/index.lock': File exists.").runner, input());
  const m = await syncMemory(
    raced(MERGE, "fatal: Unable to create '/m/.git/index.lock': File exists.").runner,
    input({ pullMode: 'ff-only', steps: { commit: false, pull: true, push: false } }),
  );
  assert.deepEqual([f.pull, j.pull, m.pull, f.detail, j.detail], ['ok', 'ok', 'ok', '', '']);
  assert.deepEqual([tries.get(FETCH), tries.get(REBASE), tries.get(MERGE)], [2, 2, 2]);
  // Only a lock is tried again: a network that is down is not asked twice.
  const down = fake(base({ [FETCH]: { exitCode: 128, stderr: 'fatal: Could not resolve host: github.com' } }));
  assert.equal((await syncMemory(down.runner, input())).pull, 'offline');
  assert.equal(down.calls.filter((c) => c.startsWith('fetch')).length, 1);
  // git before 2.29 does not know --no-write-fetch-head: a plain fetch, then the join.
  const old = fake(base({ [FETCH]: { exitCode: 129, stderr: "error: unknown option `no-write-fetch-head'\nusage: git fetch" }, 'fetch --quiet': {} }));
  assert.equal((await syncMemory(old.runner, input())).pull, 'ok');
  assert.deepEqual(
    old.calls.filter((c) => c.startsWith('fetch') || c.startsWith('rebase')),
    [FETCH, 'fetch --quiet', REBASE],
  );
  const oldDown = fake(
    base({ [FETCH]: { exitCode: 129, stderr: 'error: unknown option' }, 'fetch --quiet': { exitCode: 128, stderr: 'fatal: Authentication failed' } }),
  );
  assert.equal((await syncMemory(oldDown.runner, input())).pull, 'auth');
  // A fetch that did not go through is not followed by a join.
  assert.ok(!down.calls.includes(REBASE));
});

test('the push: nothing to send, a first push, a rejection pulled once and sent again, a rejection that cannot be joined', async () => {
  const ahead = (n: number) => ({ 'rev-list --count @{upstream}..HEAD': { stdout: `${n}\n` } });
  const quiet = fake(base(ahead(0)));
  assert.equal((await syncMemory(quiet.runner, input())).push, 'none');
  assert.ok(!quiet.calls.some((c) => c.startsWith('push')));
  const sending = fake(base({ ...ahead(2), 'push --quiet': {} }));
  const sent = await syncMemory(sending.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([sent.repo, sent.push], [true, 'ok']);
  assert.ok(!sending.calls.some((c) => c.startsWith('fetch') || c.startsWith('rebase')), 'a push that went through is not followed by a pull');
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
  assert.deepEqual(
    again.calls.filter((c) => c === FETCH || c === REBASE),
    [FETCH, REBASE],
    'pulled once, even on a turn that does not pull',
  );
  // Rejected and the pull cannot join: the push stays rejected, nothing is forced.
  const stuck = fake(
    base({
      ...ahead(1),
      'push --quiet': { exitCode: 1, stderr: ' ! [rejected] (fetch first)' },
      [REBASE]: { exitCode: 1 },
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
      [FETCH]: { exitCode: 1, stderr: 'Could not resolve host' },
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
  assert.deepEqual([down.calls.filter((c) => c === 'push --quiet').length, down.calls.some((c) => c.startsWith('fetch'))], [1, false]);
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
  const hang = await syncMemory(fake(base({ [FETCH]: new Error('timed out after 60000 ms: git fetch') })).runner, input());
  assert.equal(hang.pull, 'offline');
  assert.match(hang.detail, /^operation timed out: /);
  const broke = await syncMemory(fake(base({ [FETCH]: new Error('spawn git ENOENT') })).runner, input());
  assert.deepEqual([broke.pull, broke.detail], ['failed', 'spawn git ENOENT']);
  // Only the first problem is the detail.
  const two = await syncMemory(
    fake(
      base({
        'status --porcelain=v1 -z --untracked-files=all -- .': { exitCode: 1, stderr: 'fatal: first' },
        [FETCH]: { exitCode: 1, stderr: 'fatal: second' },
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

test('what the pulls brought in: the files and the index lines, from where the store stood before them to where they left it', async () => {
  const head = 'rev-parse --verify --quiet HEAD';
  const pull = REBASE;
  const names = 'diff --name-only --no-renames --relative -z abc def -- .';
  const lines = 'diff --unified=0 --no-color --no-ext-diff --relative abc def -- MEMORY.md';
  /** HEAD is abc until a pull goes through, def after. */
  const answered = (over: Record<string, Answer> = {}) => {
    let moved = false;
    const a = fake((args) => {
      const k = args.join(' ');
      if (k in over) {
        if (k === pull && !(over[k] instanceof Error) && !(over[k] as { exitCode?: number }).exitCode) moved = true;
        return over[k];
      }
      if (k === pull) moved = true;
      if (k === head) return { stdout: moved ? 'def\n' : 'abc\n' };
      return base({ [names]: { stdout: 'MEMORY.md\0a.md\0' }, [lines]: { stdout: '@@ -1 +1 @@\n-old\n+new\n' } })(args);
    });
    return a;
  };
  const r = await syncMemory(answered().runner, input());
  assert.deepEqual([r.pulled, r.index, r.head], [['MEMORY.md', 'a.md'], { removed: ['old'], added: ['new'] }, 'def']);
  // Only other files: the index is not asked about.
  const o = answered({ [names]: { stdout: 'a.md\0' } });
  const ro = await syncMemory(o.runner, input());
  assert.deepEqual([ro.pulled, ro.index], [['a.md'], null]);
  assert.ok(!o.calls.includes(lines));
  // git cannot list them, or lists none: nothing; it cannot show the index's change: the files without the lines.
  const nl = await syncMemory(answered({ [names]: { exitCode: 128 } }).runner, input());
  assert.deepEqual([nl.pulled, nl.index], [[], null]);
  const empty = await syncMemory(answered({ [names]: { stdout: '' } }).runner, input());
  assert.deepEqual([empty.pulled, empty.index], [[], null]);
  const nd = await syncMemory(answered({ [lines]: { exitCode: 128 } }).runner, input());
  assert.deepEqual([nd.pulled, nd.index], [['MEMORY.md', 'a.md'], null]);
  // Nothing came in (a pull that failed, a turn that does not pull, no remote): nothing is asked.
  for (const [over, inp] of [
    [{ [pull]: { exitCode: 1, stderr: 'fatal: bad' } }, input()],
    [{}, input({ steps: { commit: true, pull: false, push: true } })],
    [{}, input({ remote: false })],
  ] as const) {
    const a = answered(over);
    const x = await syncMemory(a.runner, inp);
    assert.deepEqual([x.pulled, x.index], [[], null]);
    assert.ok(!a.calls.some((c) => c.startsWith('diff --name-only --no-renames')));
  }
  // A pull that went through but left HEAD where it was brought nothing.
  const still = fake(base({ [head]: { stdout: 'abc\n' } }));
  assert.deepEqual((await syncMemory(still.runner, input())).pulled, []);
  assert.ok(!still.calls.some((c) => c.startsWith('diff --name-only --no-renames')));
  // No history yet: no head, nothing to compare.
  const none = fake(base({ [head]: { exitCode: 1 } }));
  const n = await syncMemory(none.runner, input());
  assert.deepEqual([n.head, n.pulled], [null, []]);
  // A push the remote turned away pulls once: what that pull brings in counts too.
  let tries = 0;
  let moved = false;
  const rejected = fake((args) => {
    const k = args.join(' ');
    if (k === 'push --quiet') return ++tries === 1 ? { exitCode: 1, stderr: ' ! [rejected] main -> main (fetch first)' } : {};
    if (k === pull) moved = true;
    if (k === head) return { stdout: moved ? 'def\n' : 'abc\n' };
    return base({ 'rev-list --count @{upstream}..HEAD': { stdout: '1\n' }, [names]: { stdout: 'b.md\0' } })(args);
  });
  const p = await syncMemory(rejected.runner, input({ steps: { commit: true, pull: false, push: true } }));
  assert.deepEqual([p.push, p.pulled], ['ok', ['b.md']]);
});

test('what arrived by another hand since this computer last saw the store is reported too, apart from what this sync committed', async () => {
  const head = 'rev-parse --verify --quiet HEAD';
  const commit = 'commit --quiet -m msg --only -- :(top,literal)a.md';
  const st = 'status --porcelain=v1 -z --untracked-files=all -- .';
  // The person's own hook pulled after the last session (old → abc); this sync commits a.md (abc → c0m), then pulls (c0m → def).
  const answered = (over: Record<string, Answer> = {}) => {
    let at = 'abc';
    return fake((args) => {
      const k = args.join(' ');
      if (k in over) return over[k];
      if (k === head) return { stdout: `${at}\n` };
      if (k === st) return { stdout: at === 'abc' ? '?? a.md\0' : '' };
      if (k === 'add -A -- :(top,literal)a.md') return {};
      if (k === commit) {
        at = 'c0m';
        return {};
      }
      if (k === REBASE) {
        at = 'def';
        return {};
      }
      if (k === 'merge-base --is-ancestor old abc') return {};
      if (k === 'diff --name-only --no-renames --relative -z old abc -- .') return { stdout: 'MEMORY.md\0' };
      if (k === 'diff --unified=0 --no-color --no-ext-diff --relative old abc -- MEMORY.md') return { stdout: '@@ -1,0 +2 @@\n+- From the other computer.\n' };
      if (k === 'diff --name-only --no-renames --relative -z c0m def -- .') return { stdout: 'b.md\0' };
      return base()(args);
    });
  };
  const r = await syncMemory(answered().runner, input({ since: 'old' }));
  assert.deepEqual([r.pulled, r.index, r.commit, r.head], [['MEMORY.md', 'b.md'], { removed: [], added: ['- From the other computer.'] }, 'ok', 'def']);
  // Where it was last seen is where it stands: only this sync's pull counts.
  const same = answered();
  const s = await syncMemory(same.runner, input({ since: 'abc' }));
  assert.deepEqual(s.pulled, ['b.md']);
  assert.ok(!same.calls.some((c) => c.startsWith('merge-base')));
  // A history rewritten since (the last seen commit is no ancestor): what it was cannot be told, only this pull.
  const rewritten = answered({ 'merge-base --is-ancestor old abc': { exitCode: 1 } });
  assert.deepEqual((await syncMemory(rewritten.runner, input({ since: 'old' }))).pulled, ['b.md']);
  // A look without any step reports what arrived since, and where it stands.
  const look = answered();
  const l = await syncMemory(look.runner, input({ since: 'old', steps: { commit: false, pull: false, push: false } }));
  assert.deepEqual([l.pulled, l.head, l.commit, l.pull, l.push], [['MEMORY.md'], 'abc', 'skipped', 'skipped', 'skipped']);
  assert.ok(!look.calls.some((c) => c.startsWith('pull') || c.startsWith('push') || c.startsWith('commit')));
  // Blank or missing: no comparison.
  for (const since of ['', '  ', null, undefined]) assert.deepEqual((await syncMemory(answered().runner, input({ since }))).pulled, ['b.md'], String(since));
});

test('only a fast-forward, for a store its owner commits: nothing of theirs is committed, rebased or sent', async () => {
  const ff = MERGE;
  const run = async (answer: Answer, step = ff) => {
    const a = fake(base({ [step]: answer }));
    const r = await syncMemory(a.runner, input({ pullMode: 'ff-only', steps: { commit: false, pull: true, push: false } }));
    assert.ok(!a.calls.some((c) => c.startsWith('pull') || c.startsWith('commit') || c.startsWith('push') || c.startsWith('rebase')), a.calls.join('|'));
    return r;
  };
  assert.equal((await run({})).pull, 'ok');
  const diverged = await run({ exitCode: 128, stderr: "hint: Diverging branches can't be fast-forwarded\nfatal: Not possible to fast-forward, aborting." });
  assert.deepEqual([diverged.pull, diverged.detail], ['diverged', "Diverging branches can't be fast-forwarded"]);
  assert.equal((await run({ exitCode: 128, stderr: 'fatal: Not possible to fast-forward, aborting.' })).pull, 'diverged');
  const dirty = await run({
    exitCode: 1,
    stderr:
      'error: Your local changes to the following files would be overwritten by merge:\n\tMEMORY.md\n\tnotes/a b.md\nPlease commit your changes or stash them before you merge.\nAborting\n',
  });
  assert.deepEqual([dirty.pull, dirty.conflicts], ['conflict', ['MEMORY.md', 'notes/a b.md']]);
  const untracked = await run({
    exitCode: 1,
    stderr:
      'error: The following untracked working tree files would be overwritten by merge:\n\tnew.md\nPlease move or remove them before you merge.\nAborting',
  });
  assert.deepEqual([untracked.pull, untracked.conflicts], ['conflict', ['new.md']]);
  assert.equal((await run({ exitCode: 1, stderr: 'fatal: unable to access: Could not resolve host: github.com' }, FETCH)).pull, 'offline');
  assert.equal((await run({ exitCode: 1, stderr: 'remote: Repository not found.' }, FETCH)).pull, 'auth');
  assert.equal((await run(new Error('timed out after 60000 ms'), FETCH)).pull, 'offline');
  assert.equal((await run({ exitCode: 128, stderr: "fatal: Unable to create '/m/.git/index.lock': File exists." })).pull, 'busy');
  assert.equal((await run({ exitCode: 1, stderr: 'fatal: something else' })).pull, 'failed');
  assert.equal((await run(new Error('spawn git ENOENT'))).pull, 'failed');
  // A pull that could not join is not followed by a push, even when one was asked for.
  const both = fake(base({ [ff]: { exitCode: 128, stderr: 'fatal: Not possible to fast-forward, aborting.' } }));
  const b = await syncMemory(both.runner, input({ pullMode: 'ff-only' }));
  assert.deepEqual([b.pull, b.push], ['diverged', 'skipped']);
});

test("each mode's steps for each trigger; the seen records and their newest", () => {
  const plan = (m: 'auto' | 'pull' | 'manual', t: 'start' | 'turn' | 'manual') => {
    const p = syncPlan(m, t);
    return `${+p.steps.commit}${+p.steps.pull}${+p.steps.push} ${p.pullMode}${looksOnly(p) ? ' look' : ''}`;
  };
  assert.deepEqual(
    (['auto', 'pull', 'manual'] as const).map((m) => (['start', 'turn', 'manual'] as const).map((t) => plan(m, t))),
    [
      ['111 rebase', '101 rebase', '111 rebase'],
      ['010 ff-only', '000 ff-only look', '010 ff-only'],
      ['000 rebase look', '000 rebase look', '111 rebase'],
    ],
  );
  assert.equal(parseSeen('{"head":"abcdef1","at":5}')?.head, 'abcdef1');
  for (const t of [null, '', 'x', '{"head":"zz","at":5}', '{"head":"abcdef1"}', '{"head":"abc","at":5}', '{"head":"abcdef1","at":"5"}'])
    assert.equal(parseSeen(t), null, String(t));
  assert.equal(lastSeen([{ head: 'aaaaaaa', at: 1 }, null, { head: 'bbbbbbb', at: 3 }, { head: 'ccccccc', at: 2 }]), 'bbbbbbb');
  assert.equal(lastSeen([null, null]), null);
  assert.equal(
    lastSeen([
      { head: 'aaaaaaa', at: 2 },
      { head: 'bbbbbbb', at: 2 },
    ]),
    'aaaaaaa',
    'the first of equals stays',
  );
});

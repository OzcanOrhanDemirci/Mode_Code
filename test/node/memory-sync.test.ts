// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store's sync on real repositories in a temporary folder (docs/memory.md): a bare repository
 * stands for GitHub, two clones for two computers. Commits, pulls, pushes, a push rejected and retried, a
 * conflict undone, a secret held back, a store inside a larger repository, an unreachable remote.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyGitError, heldText, outgoingSecrets, parseAllowed, syncMemory, syncProblem, type Runner, type SyncInput } from '../../src/core/memory-sync.js';
import { commitMessage } from '../../src/core/memory.js';
import { scanSecrets } from '../../src/core/secrets/scan.js';
import { lookStore, nodeRunner, recordSync, seenSince, stepsFor } from '../../src/node/memory.js';
import { layout } from '../../src/core/layout.js';
import { readText } from '../../src/node/fsx.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
// The person's own git settings (core.autocrlf on Windows, signing, hooks) stay out: every git here, the
// sync's own included, reads an empty global file and no system one.
const gitHome = mkdtempSync(join(tmpdir(), 'tc-gitcfg-'));
after(() => rmSync(gitHome, { recursive: true, force: true }));
const globalConfig = join(gitHome, 'gitconfig');
writeFileSync(globalConfig, '');
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A bare "GitHub" with one first commit, and a clone of it as one computer's store. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'tc-memsync-'));
  const remote = join(root, 'github.git');
  run(root, 'init', '--bare', '-q', '-b', 'main', remote);
  const seed = join(root, 'seed');
  run(root, 'clone', '-q', remote, seed);
  identity(seed);
  run(seed, 'checkout', '-q', '-B', 'main');
  writeFileSync(join(seed, 'MEMORY.md'), '# Memory\n- [one](one.md) — first note\n');
  run(seed, 'add', '.');
  run(seed, 'commit', '-q', '-m', 'start');
  run(seed, 'push', '-q', '-u', 'origin', 'main');
  const clone = (name: string) => {
    const dir = join(root, name);
    run(root, 'clone', '-q', remote, dir);
    identity(dir);
    return dir;
  };
  return { root, remote, clone, done: () => rmSync(root, { recursive: true, force: true }) };
}

function identity(dir: string) {
  run(dir, 'config', 'user.email', 'test@example.com');
  run(dir, 'config', 'user.name', 'Test');
  run(dir, 'config', 'commit.gpgsign', 'false');
}

const input = (dir: string, trigger: 'start' | 'turn' | 'manual', remote = true): SyncInput => ({
  dir,
  remote,
  steps: stepsFor(trigger),
  message: (c) => commitMessage(c, 'abcdef1234', 'en'),
  readFile: async (p) => readText(p),
  secrets: (t) => scanSecrets(t).length,
});

test('a change here is committed and sent; the other computer brings it in at its next start', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    const b = w.clone('b');
    writeFileSync(join(a, 'one.md'), 'Prefers pnpm.\n');
    writeFileSync(join(a, 'MEMORY.md'), '# Memory\n- [one](one.md) — package manager\n');
    const turn = await syncMemory(nodeRunner, input(a, 'turn'));
    assert.deepEqual(
      [turn.repo, turn.commit, turn.committed, turn.pull, turn.push, turn.ahead, turn.behind, turn.held],
      [true, 'ok', 2, 'skipped', 'ok', 0, 0, []],
    );
    assert.equal(run(a, 'log', '-1', '--format=%s'), 'memory: 1 added, 1 changed (session abcdef12)');
    const start = await syncMemory(nodeRunner, input(b, 'start'));
    assert.deepEqual([start.commit, start.pull, start.push, start.ahead, start.behind], ['none', 'ok', 'none', 0, 0]);
    assert.equal(readFileSync(join(b, 'one.md'), 'utf8'), 'Prefers pnpm.\n');
    // What came in, for Claude, whose index may predate it.
    assert.deepEqual(
      [[...start.pulled].sort(), start.index],
      [['MEMORY.md', 'one.md'], { removed: ['- [one](one.md) — first note'], added: ['- [one](one.md) — package manager'] }],
    );
    // Nothing changed: nothing to do, nothing reported.
    const idle = await syncMemory(nodeRunner, input(b, 'turn'));
    assert.deepEqual([idle.commit, idle.push, idle.detail, idle.pulled], ['none', 'none', '', []]);
    const again = await syncMemory(nodeRunner, input(b, 'start'));
    assert.deepEqual([again.pull, again.pulled, again.index], ['ok', [], null], 'a pull that brings nothing tells nothing');
  } finally {
    w.done();
  }
});

test('a push the remote rejects (it moved on) is pulled once and sent again', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    const b = w.clone('b');
    writeFileSync(join(a, 'a.md'), 'from a\n');
    await syncMemory(nodeRunner, input(a, 'turn'));
    writeFileSync(join(b, 'b.md'), 'from b\n');
    // b has not pulled: its push is rejected, then joined with a's change and sent.
    const r = await syncMemory(nodeRunner, input(b, 'turn'));
    assert.deepEqual([r.commit, r.push, r.ahead, r.behind, r.pulled, r.index], ['ok', 'ok', 0, 0, ['a.md'], null]);
    assert.ok(existsSync(join(b, 'a.md')));
    run(a, 'pull', '-q');
    assert.ok(existsSync(join(a, 'b.md')));
  } finally {
    w.done();
  }
});

test('a conflict is undone and reported: the files stay as they were, nothing is forced', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    const b = w.clone('b');
    writeFileSync(join(a, 'MEMORY.md'), '# Memory\n- written on a\n');
    await syncMemory(nodeRunner, input(a, 'turn'));
    writeFileSync(join(b, 'MEMORY.md'), '# Memory\n- written on b\n');
    const r = await syncMemory(nodeRunner, input(b, 'start'));
    assert.equal(r.commit, 'ok');
    assert.equal(r.pull, 'conflict');
    assert.deepEqual(r.conflicts, ['MEMORY.md']);
    assert.equal(r.push, 'skipped');
    assert.match(r.detail, /could not join the changes in MEMORY\.md/);
    assert.equal(readFileSync(join(b, 'MEMORY.md'), 'utf8'), '# Memory\n- written on b\n');
    assert.equal(run(b, 'status', '--porcelain'), '', 'no rebase left half done, nothing staged');
    assert.equal(r.ahead, 1);
    // The remote still has a's version: nothing was forced over it.
    assert.match(run(w.root, '--git-dir', w.remote, 'show', 'main:MEMORY.md'), /written on a/);
  } finally {
    w.done();
  }
});

test('a file that looks like it holds a secret is held back; the rest goes', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    writeFileSync(join(a, 'ok.md'), 'Uses Node 24.\n');
    writeFileSync(join(a, 'token.md'), `The deploy token is ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}\n`);
    const r = await syncMemory(nodeRunner, input(a, 'turn'));
    assert.deepEqual([r.commit, r.committed, r.push], ['ok', 1, 'ok']);
    assert.deepEqual(r.held, [{ path: 'token.md', reason: 'secret' }]);
    assert.equal(run(w.root, '--git-dir', w.remote, 'ls-tree', '--name-only', 'main').split('\n').includes('token.md'), false);
    // Only the held file left: nothing to commit, and it is said.
    const again = await syncMemory(nodeRunner, input(a, 'turn'));
    assert.deepEqual([again.commit, again.held.map((h) => h.path)], ['held', ['token.md']]);
    // A file too large for a note is held back too.
    writeFileSync(join(a, 'big.md'), 'x'.repeat(1_000_001));
    const big = await syncMemory(nodeRunner, input(a, 'turn'));
    assert.deepEqual(
      big.held.map((h) => h.reason),
      ['large', 'secret'],
    );
  } finally {
    w.done();
  }
});

test('a store inside a larger repository commits only its own files, by paths from the top', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    const store = join(a, 'memory notes');
    mkdirSync(join(store, 'handoffs', 'app'), { recursive: true });
    writeFileSync(join(store, 'handoffs', 'app', 'n1.md'), 'handoff\n');
    writeFileSync(join(store, 'MEMORY.md'), '# Index\n');
    writeFileSync(join(a, 'tools.js'), 'console.log(1)\n');
    const r = await syncMemory(nodeRunner, input(store, 'turn'));
    assert.deepEqual([r.commit, r.committed, r.push], ['ok', 2, 'ok']);
    assert.equal(run(a, 'status', '--porcelain'), '?? tools.js', 'the rest of the repository is left as it was');
    assert.deepEqual(run(a, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['memory notes/MEMORY.md', 'memory notes/handoffs/app/n1.md']);
    // What another computer changes comes in by the store's own paths; the rest of the repository is not the memory's.
    const c = w.clone('c');
    writeFileSync(join(c, 'memory notes', 'MEMORY.md'), '# Index\n- Uses pnpm.\n');
    writeFileSync(join(c, 'build.js'), 'console.log(2)\n');
    run(c, 'add', '-A');
    run(c, 'commit', '-q', '-m', 'from c');
    run(c, 'push', '-q');
    const start = await syncMemory(nodeRunner, input(store, 'start'));
    assert.deepEqual([start.pull, start.pulled, start.index], ['ok', ['MEMORY.md'], { removed: [], added: ['- Uses pnpm.'] }]);
  } finally {
    w.done();
  }
});

test('local only: commits with no remote to pull from or push to; a plain folder is no repository', { skip: !hasGit && 'git is not installed' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-memlocal-'));
  try {
    const dir = join(root, 'memory');
    mkdirSync(dir);
    const plain = await syncMemory(nodeRunner, input(dir, 'start', false));
    assert.deepEqual([plain.repo, plain.commit, plain.pull, plain.push], [false, 'skipped', 'skipped', 'skipped']);
    run(dir, 'init', '-q', '-b', 'main');
    identity(dir);
    writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n');
    const r = await syncMemory(nodeRunner, input(dir, 'start', false));
    assert.deepEqual([r.repo, r.commit, r.committed, r.pull, r.push, r.ahead], [true, 'ok', 1, 'skipped', 'skipped', null]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'a remote that cannot be reached leaves the commit here and says so; the first push sets the upstream',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-memoff-'));
    try {
      const dir = join(root, 'memory');
      mkdirSync(dir);
      run(dir, 'init', '-q', '-b', 'main');
      identity(dir);
      run(dir, 'remote', 'add', 'origin', join(root, 'missing.git'));
      writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n');
      const r = await syncMemory(nodeRunner, input(dir, 'start'));
      assert.equal(r.commit, 'ok');
      assert.equal(r.pull, 'none', 'no upstream and nothing to follow');
      assert.notEqual(r.push, 'ok');
      assert.ok(r.detail.length > 0);
      // The remote appears (an empty repository on GitHub): the first push sends everything and sets the upstream.
      run(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'missing.git'));
      const again = await syncMemory(nodeRunner, input(dir, 'turn'));
      assert.deepEqual([again.commit, again.push, again.ahead, again.behind], ['none', 'ok', 0, 0]);
      assert.equal(run(dir, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("git's failures are sorted by what the person can do", () => {
  assert.equal(classifyGitError("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"), 'offline');
  assert.equal(classifyGitError('fatal: Authentication failed for https://github.com/a/b.git'), 'auth');
  assert.equal(classifyGitError('ERROR: Repository not found.\nfatal: Could not read from remote repository.'), 'auth');
  assert.equal(classifyGitError(' ! [rejected]        main -> main (fetch first)'), 'rejected');
  assert.equal(classifyGitError("fatal: Unable to create '/m/.git/index.lock': File exists."), 'busy');
  assert.equal(classifyGitError('Author identity unknown\n*** Please tell me who you are.'), 'identity');
  assert.equal(classifyGitError('operation timed out: git push'), 'offline');
  assert.equal(classifyGitError('fatal: something else'), 'failed');
});

test(
  'only bringing in, on real repositories: a fast-forward; both sides moved or a local edit in the way leave everything as it was',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const w = world();
    try {
      const a = w.clone('a');
      const b = w.clone('b');
      const pullOnly = (dir: string): SyncInput => ({ ...input(dir, 'start'), steps: { commit: false, pull: true, push: false }, pullMode: 'ff-only' });
      writeFileSync(join(a, 'MEMORY.md'), '# Memory\n- [one](one.md) — from a\n');
      run(a, 'commit', '-q', '-am', 'from a');
      run(a, 'push', '-q');
      const ff = await syncMemory(nodeRunner, pullOnly(b));
      assert.deepEqual([ff.pull, ff.commit, ff.push, ff.pulled, ff.index?.added], ['ok', 'skipped', 'skipped', ['MEMORY.md'], ['- [one](one.md) — from a']]);
      assert.equal(ff.head, run(b, 'rev-parse', 'HEAD'));
      // b's owner commits something of their own, a sends another change: a fast-forward cannot join them.
      writeFileSync(join(b, 'mine.md'), 'mine\n');
      run(b, 'add', 'mine.md');
      run(b, 'commit', '-q', '-m', 'mine');
      const mine = run(b, 'rev-parse', 'HEAD');
      writeFileSync(join(a, 'two.md'), 'two\n');
      run(a, 'add', 'two.md');
      run(a, 'commit', '-q', '-m', 'two');
      run(a, 'push', '-q');
      const diverged = await syncMemory(nodeRunner, pullOnly(b));
      assert.deepEqual([diverged.pull, diverged.pulled], ['diverged', []]);
      assert.equal(run(b, 'rev-parse', 'HEAD'), mine, 'nothing rebased or merged');
      assert.ok(!existsSync(join(b, 'two.md')));
      // A fresh clone with an edit of its own in the way of what comes in.
      const c = w.clone('c');
      run(c, 'reset', '-q', '--hard', 'HEAD~2');
      writeFileSync(join(c, 'MEMORY.md'), '# Memory\n- edited here, not committed\n');
      const blocked = await syncMemory(nodeRunner, pullOnly(c));
      assert.deepEqual([blocked.pull, blocked.conflicts], ['conflict', ['MEMORY.md']]);
      assert.equal(readFileSync(join(c, 'MEMORY.md'), 'utf8'), '# Memory\n- edited here, not committed\n');
    } finally {
      w.done();
    }
  },
);

test(
  'what the owner brought in by hand since this computer last saw the store is reported at the next look',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const w = world();
    try {
      const a = w.clone('a');
      const b = w.clone('b');
      const seen = run(b, 'rev-parse', 'HEAD');
      writeFileSync(join(a, 'MEMORY.md'), '# Memory\n- [one](one.md) — first note\n- [two](two.md) — from a\n');
      run(a, 'commit', '-q', '-am', 'from a');
      run(a, 'push', '-q');
      // b's owner pulls with their own hook; the next session's look tells what arrived since `seen`.
      run(b, 'pull', '-q', '--ff-only');
      const look = await syncMemory(nodeRunner, { ...input(b, 'start'), steps: { commit: false, pull: false, push: false }, since: seen });
      assert.deepEqual([look.pulled, look.index], [['MEMORY.md'], { removed: [], added: ['- [two](two.md) — from a'] }]);
      // Seen where it stands: nothing more to tell.
      const again = await syncMemory(nodeRunner, { ...input(b, 'start'), steps: { commit: false, pull: false, push: false }, since: look.head });
      assert.deepEqual(again.pulled, []);
    } finally {
      w.done();
    }
  },
);

test(
  'where each writer last saw the store: recorded with a sync, noted by a look when it moved, the newest of them read back',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const w = world();
    try {
      const a = w.clone('a');
      const l = layout(join(w.root, 'data').replace(/\\/g, '/'));
      assert.equal(seenSince(l), null);
      const r = await syncMemory(nodeRunner, input(a, 'turn'));
      recordSync(l, 'cli', 'manual', null, r);
      assert.equal(seenSince(l), run(a, 'rev-parse', 'HEAD'));
      assert.equal(JSON.parse(readFileSync(join(l.stateDir, 'memory-sync.cli.json'), 'utf8')).trigger, 'manual');
      // The owner commits by hand; a look notes it, and a second look with nothing new writes nothing.
      writeFileSync(join(a, 'two.md'), 'two\n');
      run(a, 'add', 'two.md');
      run(a, 'commit', '-q', '-m', 'by hand');
      lookStore(l, a, 'hook');
      const seen = join(l.stateDir, 'memory-seen.hook.json');
      assert.equal(JSON.parse(readFileSync(seen, 'utf8')).head, run(a, 'rev-parse', 'HEAD'));
      const stamp = readFileSync(seen, 'utf8');
      lookStore(l, a, 'hook');
      assert.equal(readFileSync(seen, 'utf8'), stamp);
      assert.equal(seenSince(l), run(a, 'rev-parse', 'HEAD'), 'the newest of the writers');
      // Not a repository: nothing noted; a record without a head leaves where it was seen alone.
      const plain = mkdtempSync(join(tmpdir(), 'tc-plain-'));
      const cliSeen = readFileSync(join(l.stateDir, 'memory-seen.cli.json'), 'utf8');
      lookStore(l, plain, 'cli');
      assert.equal(readFileSync(join(l.stateDir, 'memory-seen.cli.json'), 'utf8'), cliSeen);
      recordSync(l, 'hook', 'turn', 's', { ...r, head: null });
      assert.equal(JSON.parse(readFileSync(seen, 'utf8')).head, run(a, 'rev-parse', 'HEAD'));
      rmSync(plain, { recursive: true, force: true });
      // A state folder that cannot be written: nothing thrown.
      const blocked = layout(join(w.root, 'blocked-file').replace(/\\/g, '/'));
      writeFileSync(join(w.root, 'blocked-file'), 'x');
      assert.doesNotThrow(() => recordSync(blocked, 'cli', 'manual', null, r));
      assert.doesNotThrow(() => lookStore(blocked, a, 'cli'));
    } finally {
      w.done();
    }
  },
);

test(
  'another fetch at the same moment fills FETCH_HEAD with several heads: the pull neither reads it nor writes it',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const w = world();
    try {
      const a = w.clone('a');
      const stores = { rebase: w.clone('b'), 'ff-only': w.clone('c') } as const;
      writeFileSync(join(a, 'MEMORY.md'), '# Memory\n- [one](one.md) — first note\n- [two](two.md) — from a\n');
      run(a, 'commit', '-q', '-am', 'from a');
      run(a, 'push', '-q');
      for (const [mode, dir] of Object.entries(stores) as ['rebase' | 'ff-only', string][]) {
        // What two fetches at once leave (measured on the author's machine, 2026-10-15): a `git pull` reading
        // this refuses with "Cannot rebase onto multiple branches" or "Cannot fast-forward to multiple branches".
        const fetchHead = join(dir, '.git', 'FETCH_HEAD');
        const crowded = `${run(dir, 'rev-parse', 'HEAD')}\t\tbranch 'main' of ${w.remote}\n`.repeat(3);
        writeFileSync(fetchHead, crowded);
        const seen: string[] = [];
        const watching: Runner = {
          async run(argv, opts) {
            const r = await nodeRunner.run(argv, opts);
            if (argv.includes('fetch')) seen.push(readFileSync(fetchHead, 'utf8'));
            return r;
          },
        };
        const r = await syncMemory(watching, { ...input(dir, 'start'), steps: { commit: false, pull: true, push: false }, pullMode: mode });
        assert.deepEqual([r.pull, r.detail, r.behind], ['ok', '', 0], mode);
        assert.match(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), /from a/, mode);
        assert.deepEqual(seen, [crowded], `${mode}: one fetch, and FETCH_HEAD as the other fetch left it`);
      }
    } finally {
      w.done();
    }
  },
);

test('a commit made by hand that adds a secret is not pushed until its fingerprint is allowed', { skip: !hasGit && 'git is not installed' }, async () => {
  const w = world();
  try {
    const a = w.clone('a');
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
    // Committed by hand (as Claude does with git commit): the sync's own commit step never saw it.
    writeFileSync(join(a, 'deploy.md'), `The deploy token is ${token}\n`);
    run(a, 'add', '.');
    run(a, 'commit', '-q', '-m', 'notes');
    // Taken out again in a later commit: the history still carries it.
    writeFileSync(join(a, 'deploy.md'), 'The deploy token is in the keychain.\n');
    run(a, 'commit', '-q', '-am', 'tidy');
    const gate = { ...input(a, 'turn'), outgoing: outgoingSecrets(new Set()) };
    const r = await syncMemory(nodeRunner, gate);
    assert.equal(r.push, 'held');
    assert.deepEqual(
      r.held.map((h) => [h.path, h.reason, h.kind, h.fingerprint?.length]),
      [['deploy.md', 'secret', 'github-token', 64]],
    );
    assert.equal(heldText(r.held[0]!), 'deploy.md <REDACTED:github-token>');
    assert.ok(!JSON.stringify(r).includes(token), 'the value is never in the result');
    assert.equal(syncProblem(r), 'held');
    assert.equal(run(w.root, '--git-dir', w.remote, 'log', '--oneline', 'main').split('\n').length, 1, 'nothing reached the remote');
    // Allowed by its fingerprint (a false alarm the person looked at): it goes.
    const allowed = parseAllowed(JSON.stringify({ allowed: [{ fingerprint: r.held[0]!.fingerprint, at: 'x' }] }));
    const again = await syncMemory(nodeRunner, { ...gate, outgoing: outgoingSecrets(allowed) });
    assert.deepEqual([again.push, again.held], ['ok', []]);
  } finally {
    w.done();
  }
});

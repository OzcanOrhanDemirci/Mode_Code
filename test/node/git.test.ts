// SPDX-License-Identifier: Apache-2.0
/**
 * git as the footer and the belt read it, on real repositories in a temporary folder: a bare "remote", a
 * clone with an upstream, a folder without git. Every state of the memory line, measured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitFacts, memoryStatus, repoStatus } from '../../src/node/git.js';

const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const hasGit = spawnSync('git', ['--version']).status === 0;

test('the memory line in every state git can be in', { skip: !hasGit && 'git is not installed' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-git-'));
  try {
    const remote = join(root, 'remote.git');
    const repo = join(root, 'memory');
    run(root, 'init', '--bare', '-q', '-b', 'main', remote);
    run(root, 'clone', '-q', remote, repo);
    run(repo, 'config', 'user.email', 'test@example.com');
    run(repo, 'config', 'user.name', 'Test');
    run(repo, 'config', 'commit.gpgsign', 'false');
    run(repo, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.md'), 'one\n');
    run(repo, 'add', '.');
    run(repo, 'commit', '-q', '-m', 'one');
    // No upstream yet.
    assert.deepEqual(memoryStatus([repo], null), { state: 'noUpstream' });
    run(repo, 'push', '-q', '-u', 'origin', 'main');
    const before = Date.now();
    assert.deepEqual(memoryStatus([repo], before + 60_000), { state: 'unchanged' });
    // A change not committed, then committed but not pushed, then pushed during the turn.
    writeFileSync(join(repo, 'a.md'), 'two\n');
    assert.deepEqual(memoryStatus([repo], before), { state: 'dirty', count: 1 });
    run(repo, 'commit', '-q', '-am', 'two');
    assert.deepEqual(memoryStatus([repo], before), { state: 'ahead', count: 1 });
    run(repo, 'push', '-q');
    assert.deepEqual(memoryStatus([repo], before - 5000), { state: 'pushed' });
    // Folders that are not repositories are left out; none at all hides the line.
    const plain = join(root, 'plain');
    mkdirSync(plain);
    assert.deepEqual(memoryStatus([plain], null), { state: null });
    assert.deepEqual(memoryStatus([plain, repo], before + 60_000), { state: 'unchanged' });

    const st = repoStatus(repo);
    assert.equal(st.isRepo, true);
    assert.equal(st.hasUpstream, true);
    assert.equal(st.ahead, 0);
    assert.equal(repoStatus(plain).isRepo, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'git facts for the belt: the branch, the remote, aliases; asked once per process; never a prompt',
  { skip: !hasGit && 'git is not installed' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-gitfacts-'));
    try {
      run(root, 'init', '-q', '-b', 'trunk');
      run(root, 'remote', 'add', 'origin', 'https://example.com/ada/app.git');
      run(root, 'config', 'alias.p', 'push --force');
      const f = gitFacts();
      assert.equal(await f.currentBranch(root), 'trunk');
      assert.equal(await f.remoteUrl(root), 'https://example.com/ada/app.git');
      assert.equal(await f.remoteUrl(root, 'upstream'), null);
      assert.equal(await f.alias(root, 'p'), 'push --force');
      assert.equal(await f.alias(root, 'nope'), null);
      // An alias name that is not a plain word is never handed to git.
      assert.equal(await f.alias(root, '--global x'), null);
      const outside = mkdtempSync(join(tmpdir(), 'tc-nogit-'));
      try {
        assert.equal(await f.currentBranch(outside), null);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      assert.deepEqual(git(join(root, 'does-not-exist'), ['status']), { ok: false, out: '' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

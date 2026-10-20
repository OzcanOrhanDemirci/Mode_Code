// SPDX-License-Identifier: Apache-2.0
/**
 * git as the footer and the belt read it, on real repositories in a temporary folder: a bare "remote", a
 * clone with an upstream, a folder without git. Every state of the memory line, measured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { git, gitFacts, gitProgram, memoryStatus, repoStatus } from '../../src/node/git.js';
import { noProgramsFromWorkingFolder } from '../../src/node/env.js';

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

/** A program that only leaves a mark in its own folder: the settings below name it, Mode_Code's calls must never run it. */
function marker(root: string) {
  const dir = join(root, 'marks');
  mkdirSync(dir);
  const file = join(dir, 'mark.sh');
  writeFileSync(file, '#!/bin/sh\necho ran > "$(dirname "$0")/m_$$"\ncat\n');
  chmodSync(file, 0o755);
  const marks = () => readdirSync(dir).filter((f) => f.startsWith('m_'));
  return {
    path: file.replace(/\\/g, '/'),
    /** How many times it ran since the last look. */
    take: () => {
      const n = marks();
      for (const f of n) rmSync(join(dir, f));
      return n.length;
    },
  };
}

/** A repository with two commits of f.txt. */
function twoCommits(repo: string) {
  run(join(repo, '..'), 'init', '-q', '-b', 'main', repo);
  run(repo, 'config', 'user.email', 'test@example.com');
  run(repo, 'config', 'user.name', 'Test');
  run(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'f.txt'), 'one\n');
  run(repo, 'add', '.');
  run(repo, 'commit', '-q', '-m', 'one');
  writeFileSync(join(repo, 'f.txt'), 'one\ntwo\n');
  run(repo, 'commit', '-q', '-am', 'two');
}

/** git asked plainly, the way a person would type it; its exit code does not matter here. */
const plain = (dir: string, ...args: string[]) =>
  spawnSync('git', ['-C', dir, '--no-pager', ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

test("a repository's own settings never make Mode_Code's git run a program", { skip: !hasGit && 'git is not installed' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-gitsafe-'));
  try {
    const m = marker(root);
    const repo = join(root, 'repo');
    twoCommits(repo);
    // What a repository can say for itself (its .git folder came with it): a file system monitor, a filter
    // over f.txt's content, a converter for its diffs, an outside diff program.
    run(repo, 'config', 'core.fsmonitor', m.path);
    run(repo, 'config', 'filter.x.clean', `sh '${m.path}' clean`);
    run(repo, 'config', 'diff.y.textconv', `sh '${m.path}' conv`);
    writeFileSync(join(repo, '.git', 'info', 'attributes'), 'f.txt filter=x diff=y\n');
    // Its time changed and its content did not: git reads the content again, through the filter.
    let day = 0;
    const touched = () => utimesSync(join(repo, 'f.txt'), new Date(2001, 0, ++day), new Date(2001, 0, day));

    // The settings are live: plain git runs the program for each of them.
    touched();
    plain(repo, 'status', '--porcelain');
    assert.ok(m.take() > 0, 'status runs the monitor');
    touched();
    plain(repo, '-c', 'core.fsmonitor=false', 'status', '--porcelain');
    assert.ok(m.take() > 0, 'status runs the filter');
    plain(repo, 'diff', 'HEAD~1', 'HEAD');
    assert.ok(m.take() > 0, 'diff runs the converter');
    run(repo, 'config', 'diff.external', m.path);
    plain(repo, 'diff', 'HEAD~1', 'HEAD');
    assert.ok(m.take() > 0, 'diff runs the outside program');

    // Mode_Code's calls run none of them, and still answer.
    touched();
    const st = repoStatus(repo);
    assert.deepEqual([st.isRepo, st.dirty, st.hasUpstream], [true, 0, false]);
    touched();
    assert.equal(git(repo, ['status', '--porcelain=v1']).ok, true);
    assert.match(git(repo, ['diff', '--stat', 'HEAD~1', 'HEAD']).out, /f\.txt \| 1 \+/);
    assert.match(git(repo, ['diff', 'HEAD~1', 'HEAD']).out, /^\+two$/m);
    assert.match(git(repo, ['log', '-1', '-p']).out, /^\+two$/m);
    assert.equal(git(repo, ['show', 'HEAD:f.txt']).out, 'one\ntwo');
    assert.equal(await gitFacts().currentBranch(repo), 'main');
    assert.equal(m.take(), 0);

    // A filter whose name the command line cannot say: the call that would read through it is not made.
    run(repo, 'config', 'filter.a=b.clean', `sh '${m.path}' clean`);
    touched();
    assert.deepEqual(git(repo, ['status', '--porcelain=v1']), { ok: false, out: '' });
    assert.equal(repoStatus(repo).dirty, 0);
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out, 'main');
    assert.equal(m.take(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status stays out of submodules, which have settings of their own', { skip: !hasGit && 'git is not installed' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-gitsub-'));
  try {
    const m = marker(root);
    const sub = join(root, 'sub');
    const top = join(root, 'top');
    twoCommits(sub);
    twoCommits(top);
    run(top, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.replace(/\\/g, '/'), 'sub');
    run(top, 'commit', '-q', '-m', 'sub');
    const inner = join(top, 'sub');
    run(inner, 'config', 'filter.w.clean', `sh '${m.path}' clean`);
    writeFileSync(join(run(inner, 'rev-parse', '--absolute-git-dir'), 'info', 'attributes'), 'f.txt filter=w\n');
    let day = 0;
    const touched = () => utimesSync(join(inner, 'f.txt'), new Date(2001, 0, ++day), new Date(2001, 0, day));

    touched();
    plain(top, 'status', '--porcelain');
    assert.ok(m.take() > 0, "plain status reads the submodule through the submodule's filter");
    touched();
    assert.deepEqual([repoStatus(top).isRepo, repoStatus(top).dirty], [true, 0]);
    assert.equal(m.take(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('git is looked up in the absolute folders on PATH only', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-gitpath-'));
  try {
    const name = process.platform === 'win32' ? 'git.exe' : 'git';
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', name), '');
    assert.equal(gitProgram(['.', 'bin', '', join(root, 'bin')].join(delimiter)), join(root, 'bin', name));
    assert.equal(gitProgram(['.', 'bin', ''].join(delimiter)), null);
    assert.equal(gitProgram(join(root, 'missing')), null);
    // A folder where git's file should be is not git.
    mkdirSync(join(root, 'odd', name), { recursive: true });
    assert.equal(gitProgram(join(root, 'odd')), null);
    // Without git, every call answers nothing.
    const was = process.env.PATH;
    process.env.PATH = join(root, 'missing');
    try {
      assert.deepEqual(git(root, ['--version']), { ok: false, out: '' });
    } finally {
      process.env.PATH = was;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows: no program is taken from the working folder, git or any other', { skip: process.platform !== 'win32' && 'only Windows looks there' }, (t) => {
  const env: NodeJS.ProcessEnv = {};
  noProgramsFromWorkingFolder('linux', env);
  assert.deepEqual(env, {});
  noProgramsFromWorkingFolder('win32', env);
  assert.deepEqual(env, { NoDefaultCurrentDirectoryInExePath: '1' });

  const root = mkdtempSync(join(tmpdir(), 'tc-gitcwd-'));
  const here = process.cwd();
  const was = process.env.NoDefaultCurrentDirectoryInExePath;
  try {
    // Any program will do as the stand-in: it is not git.
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'hostname.exe'), join(root, 'git.exe'));
    delete process.env.NoDefaultCurrentDirectoryInExePath;
    process.chdir(root);
    const bare = () => spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
    // Node 24.15 (libuv 1.51) looks there first, measured 2026-10-20; a runtime that does not proves less here.
    const looksHere = !/^git version/.test(bare());
    if (!looksHere) t.diagnostic(`Node ${process.versions.node} did not take the stand-in from the working folder`);
    assert.match(git(root, ['--version']).out, /^git version/);
    assert.ok(!gitProgram()!.toLowerCase().startsWith(root.toLowerCase()));
    noProgramsFromWorkingFolder();
    assert.match(bare(), /^git version/);
  } finally {
    process.chdir(here);
    if (was === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
    else process.env.NoDefaultCurrentDirectoryInExePath = was;
    rmSync(root, { recursive: true, force: true });
  }
});

test('which branches are merged into the current one: deleting them loses no commit', { skip: !hasGit && 'git is not installed' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'tc-merged-'));
  try {
    run(repo, 'init', '-q', '-b', 'main');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'one');
    run(repo, 'branch', 'old');
    run(repo, 'switch', '-q', '-c', 'ahead');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'two');
    run(repo, 'switch', '-q', 'main');
    const f = gitFacts();
    assert.deepEqual([await f.merged!(repo, 'old'), await f.merged!(repo, 'ahead'), await f.merged!(repo, 'nope')], [true, false, false]);
    assert.equal(await gitFacts().merged!(join(repo, 'not-a-repo'), 'old'), null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

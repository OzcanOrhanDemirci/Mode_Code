// SPDX-License-Identifier: Apache-2.0
/**
 * git and the GitHub CLI for the memory setup (node/memory-tools.ts): versions read, a tool found where its
 * installer puts it when the PATH does not know it yet, the installer for each system, and GitHub's answers
 * (signed in or not, a repository private, public, empty or missing, a create refused).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Runner } from '../../src/core/memory-sync.js';
import { findTool, ghCreatePrivate, ghRepo, ghUser, installPlan, noreplyEmail, versionOf } from '../../src/node/memory-tools.js';

/** Programs answered by a table: command line → answer; anything else does not exist. */
function programs(table: Record<string, { exitCode?: number; stdout?: string; stderr?: string } | 'throw'>): Runner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(argv) {
      const key = argv.join(' ');
      calls.push(key);
      const a = table[key];
      if (!a) throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: 'ENOENT' });
      if (a === 'throw') throw new Error('timed out');
      return { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
    },
  };
}

test('versions as git and gh print them', () => {
  assert.equal(versionOf('git version 2.47.1.windows.2'), '2.47.1');
  assert.equal(versionOf('gh version 2.63.0 (2024-11-27)\nhttps://github.com/cli/cli/releases/tag/v2.63.0'), '2.63.0');
  assert.equal(versionOf('git version 2.39'), '2.39');
  assert.equal(versionOf('something else'), null);
});

test('a tool on the PATH, or where its installer put it when the PATH does not know it yet', async () => {
  assert.deepEqual(await findTool(programs({ 'git --version': { stdout: 'git version 2.47.1\n' } }), 'git', 'win32', () => false), {
    command: 'git',
    version: '2.47.1',
  });
  const after = programs({ 'C:/Program Files/GitHub CLI/gh.exe --version': { stdout: 'gh version 2.63.0 (2024-11-27)\n' } });
  assert.deepEqual(await findTool(after, 'gh', 'win32', (p) => p === 'C:/Program Files/GitHub CLI/gh.exe'), {
    command: 'C:/Program Files/GitHub CLI/gh.exe',
    version: '2.63.0',
  });
  // A program that answers but fails, or prints no version, does not count.
  assert.equal(await findTool(programs({ 'git --version': { exitCode: 1, stdout: 'git version 2.47.1' } }), 'git', 'linux'), null);
  assert.equal(await findTool(programs({ 'gh --version': { stdout: 'hello' } }), 'gh', 'darwin', () => false), null);
  assert.equal(await findTool(programs({}), 'gh', 'linux'), null);
});

test('the installer for each system, or the page to download from', () => {
  const has =
    (...ps: string[]) =>
    (p: string) =>
      ps.includes(p);
  assert.deepEqual(installPlan('gh', 'win32', has('winget')).argv, [
    'winget',
    'install',
    '--id',
    'GitHub.cli',
    '--exact',
    '--source',
    'winget',
    '--accept-package-agreements',
    '--accept-source-agreements',
  ]);
  assert.equal(installPlan('git', 'win32', has('winget')).argv?.[3], 'Git.Git');
  assert.deepEqual(installPlan('gh', 'win32', has()), { argv: null, page: 'https://cli.github.com' });
  assert.deepEqual(installPlan('gh', 'darwin', has('brew')).argv, ['brew', 'install', 'gh']);
  assert.deepEqual(installPlan('git', 'darwin', has()).argv, ['xcode-select', '--install']);
  assert.deepEqual(installPlan('gh', 'darwin', has()), { argv: null, page: 'https://cli.github.com' });
  assert.deepEqual(installPlan('gh', 'linux', has('apt-get', 'dnf')).argv, ['sudo', 'apt-get', 'install', '-y', 'gh']);
  assert.deepEqual(installPlan('git', 'linux', has('dnf')).argv, ['sudo', 'dnf', 'install', '-y', 'git']);
  assert.deepEqual(installPlan('gh', 'linux', has('pacman')).argv, ['sudo', 'pacman', '-S', '--noconfirm', 'github-cli']);
  assert.deepEqual(installPlan('git', 'linux', has('pacman')).argv, ['sudo', 'pacman', '-S', '--noconfirm', 'git']);
  assert.deepEqual(installPlan('gh', 'linux', has('zypper')).argv, ['sudo', 'zypper', 'install', '-y', 'gh']);
  assert.deepEqual(installPlan('git', 'linux', has()), { argv: null, page: 'https://git-scm.com/downloads' });
});

test("GitHub's answers: who is signed in, a repository's privacy and emptiness, a create refused", async () => {
  const signedIn = programs({
    'gh auth status --hostname github.com': {},
    'gh api user --jq [.login, .id] | @tsv': { stdout: 'ada\t42\n' },
  });
  assert.deepEqual(await ghUser(signedIn, 'gh'), { login: 'ada', id: 42 });
  assert.equal(await ghUser(programs({ 'gh auth status --hostname github.com': { exitCode: 1 } }), 'gh'), null);
  assert.equal(await ghUser(programs({ 'gh auth status --hostname github.com': {}, 'gh api user --jq [.login, .id] | @tsv': { stdout: 'odd' } }), 'gh'), null);
  const view = (stdout: string, exitCode = 0) => programs({ 'gh repo view ada/m --json nameWithOwner,visibility,isEmpty,url': { stdout, exitCode } });
  assert.deepEqual(await ghRepo(view('{"nameWithOwner":"ada/m","visibility":"PRIVATE","isEmpty":true,"url":"https://github.com/ada/m"}'), 'gh', 'ada/m'), {
    nameWithOwner: 'ada/m',
    private: true,
    empty: true,
    url: 'https://github.com/ada/m',
  });
  assert.equal((await ghRepo(view('{"nameWithOwner":"ada/m","visibility":"PUBLIC","isEmpty":false}'), 'gh', 'ada/m'))?.private, false);
  assert.equal((await ghRepo(view('{"nameWithOwner":"ada/m","visibility":"public"}'), 'gh', 'ada/m'))?.private, false);
  assert.equal(await ghRepo(view('', 1), 'gh', 'ada/m'), null);
  assert.equal(await ghRepo(view('not json'), 'gh', 'ada/m'), null);
  assert.equal(await ghRepo(view('{}'), 'gh', 'ada/m'), null);
  const create = 'gh repo create ada/m --private --description Claude Code memory';
  assert.equal(await ghCreatePrivate(programs({ [create]: {} }), 'gh', 'ada/m', 'Claude Code memory'), null);
  assert.equal(
    await ghCreatePrivate(programs({ [create]: { exitCode: 1, stderr: 'name already exists' } }), 'gh', 'ada/m', 'Claude Code memory'),
    'name already exists',
  );
  assert.equal(await ghCreatePrivate(programs({ [create]: 'throw' }), 'gh', 'ada/m', 'Claude Code memory'), 'timed out');
  assert.equal(noreplyEmail('ada', 42), '42+ada@users.noreply.github.com');
});

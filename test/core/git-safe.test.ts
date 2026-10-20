// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterDriversQuery, gitCandidates, needsFilterDrivers, repoFilterDrivers, SAFE_GIT_CONFIG, safeGitArgs } from '../../src/core/git-safe.js';

const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];

test('every call: the folder, no pager, no file system monitor, no signature check', () => {
  assert.deepEqual(SAFE_GIT_CONFIG, ['core.fsmonitor=false', 'log.showSignature=false']);
  assert.deepEqual(safeGitArgs('/p', ['rev-parse', 'HEAD']), ['-C', '/p', '--no-pager', ...SAFE, 'rev-parse', 'HEAD']);
  assert.deepEqual(safeGitArgs('/p', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ['x']), [
    '-C',
    '/p',
    '--no-pager',
    ...SAFE,
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]);
  assert.deepEqual(safeGitArgs('/p', ['--version']), ['-C', '/p', '--no-pager', ...SAFE, '--version']);
  assert.deepEqual(safeGitArgs('/p', []), ['-C', '/p', '--no-pager', ...SAFE]);
});

test("a call that reads the work tree switches each of the repository's filters off; status stays out of submodules", () => {
  const off = (d: string) => ['-c', `filter.${d}.clean=`, '-c', `filter.${d}.smudge=`, '-c', `filter.${d}.process=`, '-c', `filter.${d}.required=false`];
  assert.deepEqual(safeGitArgs('/p', ['status', '--porcelain=v1', '--', '.'], ['x', 'a.b']), [
    '-C',
    '/p',
    '--no-pager',
    ...SAFE,
    ...off('x'),
    ...off('a.b'),
    'status',
    '--ignore-submodules=dirty',
    '--porcelain=v1',
    '--',
    '.',
  ]);
  assert.deepEqual(safeGitArgs('/p', ['ls-files', '--others'], ['x']), ['-C', '/p', '--no-pager', ...SAFE, ...off('x'), 'ls-files', '--others']);
  assert.deepEqual(safeGitArgs('/p', ['status']), ['-C', '/p', '--no-pager', ...SAFE, 'status', '--ignore-submodules=dirty']);
  assert.equal(needsFilterDrivers(['status']), true);
  assert.equal(needsFilterDrivers(['diff', 'a..b']), true);
  assert.equal(needsFilterDrivers(['ls-files']), true);
  for (const other of [['log'], ['show'], ['rev-parse'], ['config'], []]) assert.equal(needsFilterDrivers(other), false, other.join(' '));
});

test('a call that can show a diff runs no converter and no outside diff program', () => {
  const off = ['-c', 'filter.x.clean=', '-c', 'filter.x.smudge=', '-c', 'filter.x.process=', '-c', 'filter.x.required=false'];
  assert.deepEqual(safeGitArgs('/p', ['diff', '--stat', 'a..b'], ['x']), [
    '-C',
    '/p',
    '--no-pager',
    ...SAFE,
    ...off,
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--stat',
    'a..b',
  ]);
  assert.deepEqual(safeGitArgs('/p', ['show', 'b:package.json'], ['x']), [
    '-C',
    '/p',
    '--no-pager',
    ...SAFE,
    'show',
    '--no-ext-diff',
    '--no-textconv',
    'b:package.json',
  ]);
  assert.deepEqual(safeGitArgs('/p', ['log', '-1']), ['-C', '/p', '--no-pager', ...SAFE, 'log', '--no-ext-diff', '--no-textconv', '-1']);
});

test("the filter drivers to switch off: the repository's own, by name, never the person's", () => {
  assert.deepEqual(filterDriversQuery('/p'), ['-C', '/p', '--no-pager', ...SAFE, 'config', '--show-scope', '--name-only', '--get-regexp', '^filter\\.']);
  // As git 2.55 answers (measured 2026-10-20): Git LFS set by the person and the system, two of the repository's.
  const out = [
    'system\tfilter.lfs.clean',
    'system\tfilter.lfs.required',
    'global\tfilter.lfs.process',
    'local\tfilter.x.required',
    'local\tfilter.x.process',
    'local\tfilter.z.clean',
    'worktree\tfilter.w.smudge',
    'command\tfilter.c.clean',
    '',
  ].join('\n');
  assert.deepEqual(repoFilterDrivers(out), ['x', 'z', 'w']);
  // A name with dots keeps them; the key is the last part.
  assert.deepEqual(repoFilterDrivers('local\tfilter.a.b.c.clean\n'), ['a.b.c']);
  // The repository may take over a driver the person set: then it is switched off too.
  assert.deepEqual(repoFilterDrivers('global\tfilter.lfs.clean\nlocal\tfilter.lfs.clean\n'), ['lfs']);
  assert.deepEqual(repoFilterDrivers(''), []);
  assert.deepEqual(repoFilterDrivers('local\tcore.fsmonitor\nlocal\tfilter.only\nlocal filter.x.clean\n'), []);
  // A name the command line cannot say ("=" ends the setting's name there): the call must not run.
  assert.equal(repoFilterDrivers('local\tfilter.a=b.clean\n'), null);
  assert.equal(repoFilterDrivers('local\tfilter.x.clean\nworktree\tfilter.=.process\n'), null);
  assert.deepEqual(repoFilterDrivers('global\tfilter.a=b.clean\n'), []);
});

test('where git may be: absolute folders on PATH only, in order, with git.exe on Windows', () => {
  assert.deepEqual(gitCandidates('C:\\Program Files\\Git\\cmd;.;;bin;C:relative;"D:\\Tools\\";\\\\server\\share\\git;D:/x/', 'win32'), [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'D:\\Tools\\git.exe',
    '\\\\server\\share\\git\\git.exe',
    'D:/x\\git.exe',
  ]);
  assert.deepEqual(gitCandidates('C:\\', 'win32'), ['C:\\git.exe']);
  // A folder on the current drive's root ("\only", "/also") depends on where the call runs; a device path does not.
  assert.deepEqual(gitCandidates('\\only;/also;\\\\?\\C:\\x', 'win32'), ['\\\\?\\C:\\x\\git.exe']);
  assert.deepEqual(gitCandidates('/usr/local/bin::.:bin:/usr/bin/:/', 'linux'), ['/usr/local/bin/git', '/usr/bin/git', '/git']);
  assert.deepEqual(gitCandidates('/opt/homebrew/bin', 'darwin'), ['/opt/homebrew/bin/git']);
  assert.deepEqual(gitCandidates('', 'linux'), []);
});

// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoot, isUnder, pathKey, resolvePath, type PathEnv } from '../../src/core/paths.js';

const WIN: PathEnv = { platform: 'win32', home: 'C:/Users/ada', cwd: 'C:/dev/app' };
const MAC: PathEnv = { platform: 'darwin', home: '/Users/ada', cwd: '/Users/ada/dev/app' };
const LINUX: PathEnv = { platform: 'linux', home: '/home/ada', cwd: '/home/ada/dev/app' };

test('every Windows spelling of the same file resolves to one form', () => {
  const want = 'C:/Users/ada/.claude/settings.json';
  for (const p of [
    'C:\\Users\\ada\\.claude\\settings.json',
    'c:/Users/ada/.claude/settings.json',
    '/c/Users/ada/.claude/settings.json',
    '/cygdrive/c/Users/ada/.claude/settings.json',
    '\\\\?\\C:\\Users\\ada\\.claude\\settings.json',
    '~/.claude/settings.json',
    '~\\.claude\\settings.json',
    '$HOME/.claude/settings.json',
    '${HOME}/.claude/settings.json',
    '%USERPROFILE%\\.claude\\settings.json',
    '$env:USERPROFILE\\.claude\\settings.json',
    '../../Users/ada/.claude/settings.json',
    'C:/Users/ada/projects/../.claude/./settings.json',
  ]) {
    assert.equal(resolvePath(p, WIN), want, p);
  }
});

test('Windows: rooted path without a drive uses the current drive; UNC stays UNC', () => {
  assert.equal(resolvePath('/Users/ada', WIN), 'C:/Users/ada');
  assert.equal(resolvePath('\\\\server\\share\\x\\..\\y', WIN), '//server/share/y');
});

test('POSIX resolution', () => {
  assert.equal(resolvePath('~/.claude', LINUX), '/home/ada/.claude');
  assert.equal(resolvePath('../../../../..', LINUX), '/');
  assert.equal(resolvePath('src/./a/../b', MAC), '/Users/ada/dev/app/src/b');
});

test('comparison ignores case on Windows and macOS, not on Linux', () => {
  assert.ok(isUnder(resolvePath('~/.Claude/Settings.json', WIN), 'C:/Users/ada/.claude', 'win32'));
  assert.ok(isUnder(resolvePath('~/.Claude/Settings.json', MAC), '/Users/ada/.claude', 'darwin'));
  assert.ok(!isUnder(resolvePath('~/.Claude/Settings.json', LINUX), '/home/ada/.claude', 'linux'));
});

test('isUnder does not confuse siblings with a shared prefix', () => {
  assert.ok(!isUnder('C:/Users/ada/.claude-backup/x', 'C:/Users/ada/.claude', 'win32'));
  assert.ok(isUnder('C:/Users/ada/.claude', 'C:/Users/ada/.claude', 'win32'));
  assert.ok(isUnder('C:/anything', 'C:/', 'win32'));
});

test('roots are recognised', () => {
  assert.ok(isRoot('/'));
  assert.ok(isRoot('C:/'));
  assert.ok(isRoot('//srv/share'));
  assert.ok(!isRoot('C:/Users'));
  assert.equal(pathKey('C:/Users/', 'win32'), 'c:/users');
  assert.equal(pathKey('C:/', 'win32'), 'c:/');
});

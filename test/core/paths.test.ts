// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAliases,
  baseName,
  couldBeShortName,
  expandHome,
  expandShortNames,
  isShortNameSegment,
  isRoot,
  isUnder,
  joinPath,
  pathKey,
  resolvePath,
  type PathEnv,
} from '../../src/core/paths.js';

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

test("Windows: /tmp is Git Bash's mount of the user's temporary folder", () => {
  assert.equal(resolvePath('/tmp/claude/x', WIN), 'C:/Users/ada/AppData/Local/Temp/claude/x');
  assert.equal(resolvePath('/tmp', WIN), 'C:/Users/ada/AppData/Local/Temp');
  assert.equal(resolvePath('/tmpfiles/x', WIN), 'C:/tmpfiles/x');
  assert.equal(resolvePath('/tmp/x', LINUX), '/tmp/x');
});

test('POSIX resolution', () => {
  assert.equal(resolvePath('~/.claude', LINUX), '/home/ada/.claude');
  assert.equal(resolvePath('../../../../..', LINUX), '/');
  assert.equal(resolvePath('src/./a/../b', MAC), '/Users/ada/dev/app/src/b');
  // Found by a property run with more cases: a last name that trims to "." or ".." folds like one.
  assert.equal(resolvePath('. /a/..', MAC), '/Users/ada/dev/app');
  assert.equal(resolvePath('src/.. /a/..', LINUX), resolvePath('.', LINUX));
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

test('8.3 short names: the forms Windows generates, and nothing else', () => {
  for (const s of ['TERMIN~1', 'CLAUDE~1.JSO', 'PROGRA~2', 'TE1A2B~5', 'A~1', 'termin~12', 'MYLONG~1.TXT']) assert.equal(isShortNameSegment(s), true, s);
  for (const s of ['~1', 'TERMINAL~1', 'a~b', 'x~1.html', 'file~', 'name.txt', '~', 'ab~1.c.d', 'with space~1']) assert.equal(isShortNameSegment(s), false, s);
});

test('8.3 short names: which long names a short name can stand for (forms measured on Windows 11)', () => {
  assert.equal(couldBeShortName('TERMIN~1', '.terminal-code'), true);
  assert.equal(couldBeShortName('CLAUDE~1', '.claude'), true);
  assert.equal(couldBeShortName('CLAUDE~1.JSO', '.claude.json'), true);
  assert.equal(couldBeShortName('ADA~1.LOV', 'ada.lovelace'), true);
  assert.equal(couldBeShortName('MYLONG~1.TXT', 'My.Long.File.Name.txt'), true);
  assert.equal(couldBeShortName('PROGRA~1', 'Program Files x'), true);
  assert.equal(couldBeShortName('A_B_C_~1', 'a+b=c;d'), true);
  assert.equal(couldBeShortName('AR-E~1', 'çağrı-öğe'), true);
  assert.equal(couldBeShortName('TE1A2B~5', '.terminal-code'), true); // hashed form
  assert.equal(couldBeShortName('CLAUDE~1.TXT', '.claude.json'), false);
  assert.equal(couldBeShortName('TERMIN~1', '.claude'), false);
  assert.equal(couldBeShortName('XY1A2B~5', '.terminal-code'), false);
  assert.equal(couldBeShortName('not-short', '.terminal-code'), false);
  assert.equal(couldBeShortName('__~1', '.terminal-code'), false); // nothing left to compare
});

test('8.3 short names are written out against the longest known path, on Windows only', () => {
  const known = ['C:/Users/ada', 'C:/Users/ada/.claude', 'C:/Users/ada/.claude.json', 'C:/Users/ada/.terminal-code'];
  assert.equal(expandShortNames('C:/Users/ada/TERMIN~1/config.json', known, 'win32'), 'C:/Users/ada/.terminal-code/config.json');
  assert.equal(expandShortNames('C:/Users/ada/CLAUDE~1/settings.json', known, 'win32'), 'C:/Users/ada/.claude/settings.json');
  assert.equal(expandShortNames('C:/USERS/ADA/termin~1', known, 'win32'), 'C:/Users/ada/.terminal-code');
  assert.equal(expandShortNames('C:/Users/ada/OTHER~1/x', known, 'win32'), 'C:/Users/ada/OTHER~1/x');
  assert.equal(expandShortNames('C:/Users/ada/.terminal-code/x', known, 'win32'), 'C:/Users/ada/.terminal-code/x');
  assert.equal(expandShortNames('D:/Users/ada/TERMIN~1/x', known, 'win32'), 'D:/Users/ada/TERMIN~1/x');
  assert.equal(expandShortNames('/home/ada/TERMIN~1/x', ['/home/ada/.terminal-code'], 'linux'), '/home/ada/TERMIN~1/x');
  assert.equal(expandShortNames('C:/Users/ada/TERMIN~1', [], 'win32'), 'C:/Users/ada/TERMIN~1');
});

test('aliases move a path from where a link leads to its protected spelling', () => {
  const aliases = [{ real: 'D:/dotfiles/claude', spelled: 'C:/Users/ada/.claude' }];
  assert.equal(applyAliases('D:/dotfiles/claude/settings.json', aliases, 'win32'), 'C:/Users/ada/.claude/settings.json');
  assert.equal(applyAliases('d:/DOTFILES/claude', aliases, 'win32'), 'C:/Users/ada/.claude');
  assert.equal(applyAliases('D:/dotfiles/claude-other/x', aliases, 'win32'), 'D:/dotfiles/claude-other/x');
  assert.equal(applyAliases('/srv/x/settings.json', [{ real: '/srv/x', spelled: '/home/ada/.claude' }], 'linux'), '/home/ada/.claude/settings.json');
  assert.equal(applyAliases('/SRV/x/settings.json', [{ real: '/srv/x', spelled: '/home/ada/.claude' }], 'linux'), '/SRV/x/settings.json');
  assert.equal(applyAliases('/srv/x', [], 'linux'), '/srv/x');
});

test('home forms, names and joins', () => {
  assert.equal(expandHome('~', 'C:/Users/ada'), 'C:/Users/ada');
  assert.equal(expandHome('~\\x', 'C:/Users/ada'), 'C:/Users/ada\\x');
  assert.equal(expandHome('${HOME}/x', '/home/ada'), '/home/ada/x');
  assert.equal(expandHome('%HOMEDRIVE%%HOMEPATH%\\x', 'C:/Users/ada'), 'C:/Users/ada\\x');
  assert.equal(expandHome('${env:USERPROFILE}/x', 'C:/Users/ada'), 'C:/Users/ada/x');
  assert.equal(expandHome('~ada/x', '/home/ada'), '~ada/x');
  assert.equal(expandHome('$HOMEX/x', '/home/ada'), '$HOMEX/x');
  assert.equal(baseName('C:/Users/ada/.claude'), '.claude');
  assert.equal(baseName('/'), '/');
  assert.equal(joinPath('C:/x/', '/y\\z/', 'w'), 'C:/x/y/z/w');
  assert.equal(joinPath('/', ''), '/');
  assert.equal(joinPath(''), '/');
});

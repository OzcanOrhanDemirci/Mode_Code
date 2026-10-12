// SPDX-License-Identifier: Apache-2.0
/**
 * The tool's own files and Claude Code's settings are recognised however a path to them is spelled. Each
 * case is a file write that the belt evaluates; nothing is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, winCtx, macCtx, linuxCtx, write, bash } from '../helpers/belt.js';

const TOOL = 'deny self.tool-files';
const SETTINGS = 'deny self.claude-settings';

test('Windows: the data folder in every spelling an agent writes', async () => {
  for (const p of [
    'C:/Users/ada/.terminal-code/config.json',
    'C:\\Users\\ada\\.terminal-code\\config.json',
    'c:/users/ADA/.Terminal-Code/Config.json',
    '/c/Users/ada/.terminal-code/config.json',
    '/cygdrive/c/Users/ada/.terminal-code/config.json',
    '\\\\?\\C:\\Users\\ada\\.terminal-code\\config.json',
    '~/.terminal-code/config.json',
    '$HOME/.terminal-code/config.json',
    '%USERPROFILE%\\.terminal-code\\config.json',
    '$env:USERPROFILE\\.terminal-code\\config.json',
    'C:/dev/app/../../Users/ada/.terminal-code/config.json',
    '../../Users/ada/.terminal-code/state/x.json',
  ])
    assert.equal(summary(await write(p)), TOOL, p);
});

test('Windows: 8.3 short names of protected folders are written out before the check', async () => {
  assert.equal(summary(await write('C:/Users/ada/TERMIN~1/config.json')), TOOL);
  assert.equal(summary(await write('C:\\Users\\ada\\termin~1\\config.json')), TOOL);
  assert.equal(summary(await write('C:/Users/ada/CLAUDE~1/settings.json')), SETTINGS);
  assert.equal(summary(await write('C:/Users/ada/CLAUDE~1.JSO')), SETTINGS);
  // The hashed form Windows uses after a few clashes keeps two letters of the name.
  assert.equal(summary(await write('C:/Users/ada/TE1A2B~5/config.json')), TOOL);
  // Forms measured on Windows 11: a dot keeps a three-letter extension, punctuation becomes "_", letters
  // outside ASCII are dropped.
  assert.equal(
    summary(
      await write(
        'C:/Users/ADA~1.LOV/.terminal-code/config.json',
        'x',
        winCtx({ home: 'C:/Users/ada.lovelace', dataDir: 'C:/Users/ada.lovelace/.terminal-code' }),
      ),
    ),
    TOOL,
  );
  assert.equal(summary(await write('C:/Users/ada/A_B_C_~1/x.md', 'x', winCtx({ memoryDirs: ['C:/Users/ada/a+b=c;d'] }))), 'ask self.memory-shrink');
  assert.equal(summary(await write('C:/Users/ada/AR-E~1/x.md', 'x', winCtx({ memoryDirs: ['C:/Users/ada/çağrı-öğe'] }))), 'ask self.memory-shrink');
});

test('Windows: a short name that cannot stand for a protected folder changes nothing', async () => {
  assert.equal(summary(await write('C:/dev/app/BUILD~1/out.txt')), 'allow');
  assert.equal(summary(await write('C:/Users/ada/DOCUME~1x/out.txt')), 'allow');
  // Short names are a Windows thing: elsewhere "~1" is an ordinary part of a name.
  assert.equal(summary(await write('/home/ada/TERMIN~1/config.json', 'x', linuxCtx())), 'allow');
});

test("Claude Code's settings, global config and plugin registry", async () => {
  for (const p of [
    'C:/Users/ada/.claude/settings.json',
    'C:/Users/ada/.claude/settings.local.json',
    'C:/Users/ada/.claude.json',
    'C:/Users/ada/.claude/plugins/x.json',
  ])
    assert.equal(summary(await write(p)), SETTINGS, p);
  // With CLAUDE_CONFIG_DIR the settings move, and so does the protection.
  const moved = winCtx({ env: { CLAUDE_CONFIG_DIR: 'D:/claude-config' } });
  assert.equal(summary(await write('D:/claude-config/settings.json', 'x', moved)), SETTINGS);
  assert.equal(summary(await write('D:/claude-config/.claude.json', 'x', moved)), SETTINGS);
});

test('macOS and Linux spellings', async () => {
  assert.equal(summary(await write('/Users/ada/.terminal-code/config.json', 'x', macCtx())), TOOL);
  assert.equal(summary(await write('/USERS/ADA/.TERMINAL-CODE/config.json', 'x', macCtx())), TOOL); // APFS ignores case
  assert.equal(summary(await write('~/.terminal-code/config.json', 'x', linuxCtx())), TOOL);
  // Linux file systems keep case: another case is another folder.
  assert.equal(summary(await write('/home/ada/.Terminal-Code/config.json', 'x', linuxCtx())), 'allow');
});

test('a protected folder behind a link is recognised at the place the link leads to', async () => {
  const ctx = winCtx({ aliases: [{ real: 'D:/dotfiles/claude', spelled: 'C:/Users/ada/.claude' }] });
  assert.equal(summary(await write('D:/dotfiles/claude/settings.json', 'x', ctx)), SETTINGS);
  assert.equal(summary(await write('D:\\dotfiles\\claude\\settings.json', 'x', ctx)), SETTINGS);
  assert.equal(summary(await write('D:/dotfiles/other/settings.json', 'x', ctx)), 'allow');
  const file = macCtx({ aliases: [{ real: '/Users/ada/dotfiles/settings.json', spelled: '/Users/ada/.claude/settings.json' }] });
  assert.equal(summary(await write('/Users/ada/dotfiles/settings.json', 'x', file)), SETTINGS);
  assert.equal(summary(await write('/Users/ada/dotfiles/zshrc', 'x', file)), 'allow');
});

test('a shell command that reaches the data folder through cd and a short name', async () => {
  assert.equal(summary(await bash('cd C:/Users/ada/TERMIN~1 && rm -rf state')), TOOL);
  assert.equal(summary(await bash('echo x > /c/Users/ada/TERMIN~1/config.json')), TOOL);
});

test('a data folder given by its short name (a short TEMP, as on CI machines) meets targets in either spelling', async () => {
  // Seen on GitHub's Windows runners: TEMP is C:/Users/RUNNER~1/..., the home folder is long.
  const short = 'C:/Users/RUNNER~1/AppData/Local/Temp/tc-hook-x';
  const long = 'C:/Users/runneradmin/AppData/Local/Temp/tc-hook-x';
  const base = { home: 'C:/Users/runneradmin', dataDir: short, env: { TEMP: 'C:/Users/RUNNER~1/AppData/Local/Temp' } };
  for (const ctx of [winCtx(base), winCtx({ ...base, aliases: [{ real: long, spelled: short }] })]) {
    assert.equal(summary(await write(`${short}/config.json`, 'x', ctx)), TOOL);
    assert.equal(summary(await write(`${long}/config.json`, 'x', ctx)), TOOL);
    assert.equal(summary(await bash(`rm -rf ${long}`, ctx)), 'deny fs.delete-critical');
  }
  // And the other way round: the data folder long, the target short.
  const longData = winCtx({ home: 'C:/Users/runneradmin', dataDir: long });
  assert.equal(summary(await write(`${short}/config.json`, 'x', longData)), TOOL);
});

// SPDX-License-Identifier: Apache-2.0
// A program name held in a variable: asked about only when the command also looks risky. Harmless commands only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';

const ctx: BeltContext = {
  platform: 'linux',
  home: '/home/ada',
  cwd: '/home/ada/app',
  projectDir: '/home/ada/app',
  env: {},
  dataDir: '/home/ada/.mode-code',
  memoryDirs: [],
  managedSettingsFiles: ['/etc/claude-code/managed-settings.json'],
  lang: 'en',
  config: {},
  git: { currentBranch: async () => 'feature', remoteUrl: async () => null, alias: async () => null },
  fileSize: async () => 4000,
};

const verdict = async (command: string) => (await evaluateToolCall('Bash', { command }, ctx)).verdict;

test('an unknown program in a variable is let through when nothing else looks risky', async () => {
  assert.equal(await verdict('"$TOOL" --version'), 'allow');
  assert.equal(await verdict('$TOOL devices'), 'allow');
  // A risky word inside a path is not a command.
  assert.equal(await verdict('$TOOL /tmp/claude/out.txt'), 'allow');
});

test('an unknown program in a variable is asked about when its arguments hold a forcing flag or a risky word', async () => {
  assert.equal(await verdict('$TOOL --force'), 'ask');
  assert.equal(await verdict('$TOOL shell rm old.log'), 'ask');
  // The commands around it are checked on their own.
  assert.equal(await verdict('$TOOL devices && git status'), 'allow');
});

test('a variable set earlier in the same command names the program', async () => {
  assert.equal(await verdict('TOOL=/opt/tool/bin/tool; $TOOL --force'), 'allow');
});

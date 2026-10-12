// SPDX-License-Identifier: Apache-2.0
// Recursive deletes and the person's registered project folders; a session started in the home folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';

const ctx = (cwd: string): BeltContext => ({
  platform: 'win32',
  home: 'C:/Users/ada',
  cwd,
  projectDir: cwd,
  knownProjects: ['C:/dev/app'],
  env: {},
  dataDir: 'C:/Users/ada/.terminal-code',
  memoryDirs: [],
  managedSettingsFiles: ['C:/Program Files/ClaudeCode/managed-settings.json'],
  lang: 'en',
  config: {},
  git: { currentBranch: async () => 'feature', remoteUrl: async () => null, alias: async () => null },
  fileSize: async () => 4000,
});

const verdict = async (command: string, cwd: string) => (await evaluateToolCall('Bash', { command }, ctx(cwd))).verdict;

test('build output inside a registered project folder is deleted without asking, from any session folder', async () => {
  assert.equal(await verdict('rm -rf C:/dev/app/build', 'C:/Users/ada'), 'allow');
  assert.equal(await verdict('rm -rf C:/dev/app/build', 'C:/dev/other'), 'allow');
});

test('a session started in the home folder does not make the whole home folder a project', async () => {
  assert.equal(await verdict('rm -rf C:/Users/ada/notes/old', 'C:/Users/ada'), 'ask');
});

test('a registered project folder itself is not inside a project', async () => {
  assert.equal(await verdict('rm -rf C:/dev/app', 'C:/Users/ada'), 'ask');
});

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
  dataDir: 'C:/Users/ada/.mode-code',
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

test("a memory folder in Temp is protected however Git Bash spells the path (/tmp is the user's Temp)", async () => {
  const c = { ...ctx('C:/Users/ada'), memoryDirs: ['C:/Users/ada/AppData/Local/Temp/claude/e2e/mem'] };
  const d = await evaluateToolCall('Bash', { command: 'cd /tmp/claude/e2e && rm -rf mem' }, c);
  // Not a temporary folder to delete freely: the memory, asked in Manual, left to the person in full autonomy.
  assert.equal(d.verdict, 'ask');
  assert.ok(d.findings.some((f) => f.rule === 'self.memory-delete'));
  assert.equal((await evaluateToolCall('Bash', { command: 'cd /tmp/claude/e2e && rm -rf mem' }, { ...c, level: 'full' })).verdict, 'deny');
});

test('a registered project folder itself is not inside a project', async () => {
  assert.equal(await verdict('rm -rf C:/dev/app', 'C:/Users/ada'), 'ask');
});

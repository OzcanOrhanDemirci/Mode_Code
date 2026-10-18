// SPDX-License-Identifier: Apache-2.0
// Turning hooks off by a command (self.disable-hooks): setting the value is blocked, reading it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';

const ctx = (platform: 'linux' | 'win32'): BeltContext => {
  const home = platform === 'win32' ? 'C:/Users/ada' : '/home/ada';
  return {
    platform,
    home,
    cwd: `${home}/dev/app`,
    projectDir: `${home}/dev/app`,
    env: {},
    dataDir: `${home}/.mode-code`,
    memoryDirs: [],
    managedSettingsFiles: [],
    lang: 'en',
    config: {},
  };
};
const off = async (command: string, tool = 'Bash') =>
  (await evaluateToolCall(tool, { command }, ctx(tool === 'PowerShell' ? 'win32' : 'linux'))).findings.some((f) => f.rule === 'self.disable-hooks');

test('a command that sets the value turns hooks off: true, 1, or a value known only when it runs', async () => {
  for (const c of [
    `jq '.disableAllHooks = true' s.json > t.json && mv t.json s.json`,
    `python3 -c "import json; d=json.load(open('s.json')); d['disableAllHooks']=1; json.dump(d, open('s.json','w'))"`,
    `jq --argjson v true '.disableAllHooks = $v' s.json > t.json`,
    `jq '.allowManagedHooksOnly = true' s.json > t.json`,
    'claude config set disableAllHooks true',
  ])
    assert.ok(await off(c), c);
  assert.ok(await off('$s.disableAllHooks = $true; $s | ConvertTo-Json | Set-Content s.json', 'PowerShell'));
});

test('a command that only reads the value is left alone, whatever else it does (seen live, 2026-10-18)', async () => {
  for (const c of [
    // The one that was blocked: a grep beside `sed -n`, which prints and writes nothing.
    `sed -n 1,20p s.json; grep -rn disableAllHooks test`,
    `jq '.disableAllHooks' ~/.claude/settings.json`,
    `node -e "console.log(require('./s.json').disableAllHooks)"`,
    'grep -rn disableAllHooks src > found.txt',
    `git commit -m "fix: read disableAllHooks when it is false"`,
    `jq '.disableAllHooks = false' s.json > t.json`,
  ])
    assert.equal(await off(c), false, c);
});

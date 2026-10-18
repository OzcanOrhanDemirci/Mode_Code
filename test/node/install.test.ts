// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookGroups, isOurHook, withOurHooks, withoutOurHooks, withoutOurRecords } from '../../src/node/install.js';

test("the plugin's records leave with it, and the two plugin keys when nothing else is in them", () => {
  const ours = { enabledPlugins: { 'mode-code@mode-code-local': true }, extraKnownMarketplaces: { 'mode-code-local': { source: {} } } };
  assert.deepEqual(withoutOurRecords({ theme: 'dark', ...ours }), { theme: 'dark' });
  assert.deepEqual(withoutOurRecords({ enabledPlugins: {}, extraKnownMarketplaces: {} }), {});
  const others = { enabledPlugins: { 'other@x': false, 'mode-code@mode-code-local': true }, extraKnownMarketplaces: { x: { source: 1 } } };
  assert.deepEqual(withoutOurRecords(others), { enabledPlugins: { 'other@x': false }, extraKnownMarketplaces: { x: { source: 1 } } });
  assert.deepEqual(withoutOurRecords({ enabledPlugins: ['odd'], extraKnownMarketplaces: null }), { enabledPlugins: ['odd'], extraKnownMarketplaces: null });
});

const DATA = 'C:/Users/u/.mode-code';
const NODE = 'C:/Program Files/nodejs/node.exe';
const groups = hookGroups(NODE, `${DATA}/bin/hook.mjs`);

const userSettings = {
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['C:/mine/guard.js'] }] }],
    Notification: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
};

test('the installer adds its hooks after the person own ones, in exec form, blocking on failure', () => {
  const s = withOurHooks(userSettings, groups, DATA) as { hooks: Record<string, { hooks: Record<string, unknown>[] }[]> };
  assert.equal(s.hooks.PreToolUse!.length, 2);
  assert.deepEqual(s.hooks.PreToolUse![0], userSettings.hooks.PreToolUse[0]);
  const ours = s.hooks.PreToolUse![1]!.hooks[0]!;
  assert.equal(ours.command, NODE);
  assert.deepEqual(ours.args, [`${DATA}/bin/hook.mjs`, 'PreToolUse']);
  assert.equal(ours.onFailure, 'block');
  assert.ok(s.hooks.UserPromptSubmit && s.hooks.Stop && s.hooks.SessionStart);
  assert.equal((s as Record<string, unknown>).model, 'opus');
});

test('installing twice does not duplicate; removal restores the settings exactly', () => {
  const once = withOurHooks(userSettings, groups, DATA);
  const twice = withOurHooks(once, groups, DATA);
  assert.deepEqual(twice, once);
  assert.deepEqual(withoutOurHooks(twice, DATA), userSettings);
});

test('removal from settings that only had our hooks leaves no empty hooks object', () => {
  const s = withOurHooks({ theme: 'dark' }, groups, DATA);
  assert.deepEqual(withoutOurHooks(s, DATA), { theme: 'dark' });
});

test('our hooks are told apart by the program path, in any spelling', () => {
  assert.equal(isOurHook({ command: NODE, args: ['C:\\Users\\u\\.mode-code\\bin\\hook.mjs', 'Stop'] }, DATA), true);
  assert.equal(isOurHook({ command: 'node', args: ['C:/other/.mode-code-fork/bin/hook.mjs'] }, DATA), false);
  assert.equal(isOurHook({ command: 'node C:/mine/guard.js' }, DATA), false);
});

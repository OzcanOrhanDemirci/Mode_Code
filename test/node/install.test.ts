// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { hookGroups, isOurHook, withOurHooks, withoutOurHooks, withoutOurRecords } from '../../src/node/install.js';
import { built, cli, world } from '../helpers/proc.js';

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

test('the skill command hook starts at Claude Code 2.1.332 and uses the same blocking exec form', () => {
  const hook = `${DATA}/bin/hook.mjs`;
  const extra = {
    PreSkillShellCommand: [
      { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: NODE, args: [hook, 'PreSkillShellCommand'], timeout: 15, onFailure: 'block' }] },
    ],
  };
  for (const version of ['2.1.331', '2.1.332-rc.1', null, 'unknown']) assert.deepEqual(hookGroups(NODE, hook, version), groups);
  for (const version of ['2.1.332', '2.2.0']) assert.deepEqual(hookGroups(NODE, hook, version), { ...groups, ...extra });
});

test('the doctor notices the missing skill check after a Claude Code upgrade, and reinstall adds it', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ claude: { version: '2.1.331' } });
  try {
    const settingsFile = join(w.claudeDir, 'settings.json');
    // Removal should take out ours wherever it is in the file, while keeping someone else's hook in that event.
    const ownSettings = { theme: 'dark', hooks: { Notification: userSettings.hooks.Notification } };
    writeFileSync(settingsFile, JSON.stringify(ownSettings));
    const settings = () => JSON.parse(readFileSync(settingsFile, 'utf8'));
    const doctor = () => cli(w, ['doctor', '--quick', '--json'], { dist: true }).json?.checks.find((c: { id: string }) => c.id === 'install.hooks');
    const status = () => cli(w, ['status', '--json'], { dist: true }).json?.features.find((c: { id: string }) => c.id === 'belt');
    const install = () => {
      const r = cli(w, ['install', '--yes', '--json'], { dist: true });
      assert.equal(r.code, 0, r.out + r.err);
      return r.json?.manifest;
    };

    assert.equal(install().hooks.PreSkillShellCommand, undefined);
    assert.equal(settings().hooks.PreSkillShellCommand, undefined);
    assert.equal(doctor()?.status, 'ok');
    assert.equal(status()?.state, 'ok');

    for (const version of ['2.1.332-rc.1', 'unknown']) {
      writeFileSync(w.stateFile, JSON.stringify({ ...w.claudeState(), version }));
      const plan = cli(w, ['install', '--dry-run', '--json'], { dist: true }).json?.plan;
      const step = plan?.steps.find((s: { kind: string }) => s.kind === 'settings-hooks');
      assert.equal(step?.targets.includes('PreSkillShellCommand'), false);
    }
    writeFileSync(w.stateFile, JSON.stringify({ ...w.claudeState(), version: '2.1.332' }));
    const plan = cli(w, ['install', '--dry-run', '--json'], { dist: true }).json?.plan;
    const hooksStep = plan?.steps.find((s: { kind: string }) => s.kind === 'settings-hooks');
    assert.equal(hooksStep?.done, false);
    assert.ok(hooksStep?.targets.includes('PreSkillShellCommand'));
    const missing = doctor();
    assert.equal(missing?.status, 'fail');
    assert.deepEqual(missing?.summary.params, { events: 'PreSkillShellCommand', n: 4, of: 5 });
    assert.equal(missing?.hint.key, 'doc.install.hint');
    assert.equal(missing?.repair, 'restore-hooks');
    assert.equal(status()?.reason.key, 'health.belt.noSkillShell');

    const trial = cli(w, ['try', '--print'], { dist: true });
    assert.equal(trial.code, 0, trial.out + trial.err);
    const trialSettings = JSON.parse(readFileSync(join(w.data, 'state', 'try-settings.json'), 'utf8'));
    assert.equal(trialSettings.hooks.PreSkillShellCommand[0].matcher, 'Bash|PowerShell');
    assert.equal(settings().hooks.PreSkillShellCommand, undefined);

    const manifest = install();
    const installed = settings();
    const [group] = installed.hooks.PreSkillShellCommand;
    assert.equal(group.matcher, 'Bash|PowerShell');
    const entry = group.hooks[0];
    assert.ok(isAbsolute(entry.command) && existsSync(entry.command));
    assert.deepEqual(entry, { ...installed.hooks.PreToolUse[0].hooks[0], args: [entry.args[0], 'PreSkillShellCommand'] });
    assert.deepEqual(manifest.hooks.PreSkillShellCommand, [group]);
    assert.deepEqual(doctor()?.summary.params, { n: 5 });
    assert.equal(status()?.state, 'ok');

    const checked = spawnSync(entry.command, entry.args, {
      cwd: w.root,
      env: w.env,
      encoding: 'utf8',
      input: JSON.stringify({
        session_id: 'installer-check',
        cwd: w.root,
        hook_event_name: 'PreSkillShellCommand',
        tool_name: 'Bash',
        tool_input: { command: 'printf hello' },
        command_name: 'sample-skill',
        invoked_by: 'user',
      }),
      timeout: 15_000,
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(checked.stdout, '');
    const history = cli(w, ['belt', 'events'], { dist: true });
    assert.equal(history.code, 0, history.err);
    assert.match(history.out, /allow.*Bash · \/sample-skill \(you opened it\)/);

    const theirs = { type: 'command', command: 'echo ready' };
    group.hooks = [{ ...entry, onFailure: undefined }, theirs, entry];
    writeFileSync(settingsFile, JSON.stringify(installed));
    assert.equal(doctor()?.summary.key, 'doc.install.hooks.changed');
    const repaired = cli(w, ['doctor', '--quick', '--fix', '--json'], { dist: true });
    assert.ok(
      repaired.json?.repairs.some((r: { id: string; verified: boolean }) => r.id === 'restore-hooks' && r.verified),
      repaired.out + repaired.err,
    );
    assert.equal(doctor()?.status, 'ok');

    const u = cli(w, ['uninstall', '--yes', '--json'], { dist: true });
    assert.equal(u.code, 0, u.out + u.err);
    assert.deepEqual(settings(), { ...ownSettings, hooks: { ...ownSettings.hooks, PreSkillShellCommand: [{ matcher: group.matcher, hooks: [theirs] }] } });
  } finally {
    w.done();
  }
});

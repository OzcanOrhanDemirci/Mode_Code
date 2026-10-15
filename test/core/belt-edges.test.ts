// SPDX-License-Identifier: Apache-2.0
/**
 * Edges of the belt that mutation testing showed no test was watching: which rules are locked, how a
 * person's settings change a verdict, the wording of a decision, the multi-file tools, the shell profiles
 * and instruction files that are protected, and short-form path boundaries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decisionText, evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { effectiveVerdict, RULES, RULE_IDS } from '../../src/core/belt/rules.js';
import type { RuleId } from '../../src/core/belt/types.js';
import { couldBeShortName, pathKey, resolvePath } from '../../src/core/paths.js';
import { bash, linuxCtx, macCtx, summary, winCtx, write } from '../helpers/belt.js';

test('the locked rules are exactly the ones that guard the guard, files and disks, secrets leaving, and what cannot be read', () => {
  const locked = RULE_IDS.filter((id) => RULES[id].locked).sort();
  assert.deepEqual(locked, [
    'fs.delete-critical',
    'fs.disk',
    'fs.move-critical',
    'meta.unverifiable',
    'secrets.exfil',
    'self.claude-settings',
    'self.claude-settings-project',
    'self.disable-hooks',
    'self.memory-delete',
    'self.memory-history',
    'self.memory-shrink',
    'self.nested-session',
    'self.plugin-cli',
    'self.tool-files',
  ]);
  // Only the Docker pack is optional, and it is off unless turned on.
  assert.deepEqual(
    RULE_IDS.filter((id) => RULES[id].pack),
    ['docker.volume-delete'],
  );
  assert.equal(effectiveVerdict('docker.volume-delete', {}), null);
  assert.equal(effectiveVerdict('docker.volume-delete', { packs: { dockerVolumes: true } }), 'deny');
});

test('settings change a verdict: an open rule can be switched off or softened, a locked one only made stricter', () => {
  const open: RuleId = 'git.clean';
  assert.equal(effectiveVerdict(open, {}), RULES[open].verdict);
  assert.equal(effectiveVerdict(open, { disabled: [open] }), null);
  assert.equal(effectiveVerdict(open, { verdicts: { [open]: 'warn' } }), 'warn');
  assert.equal(effectiveVerdict(open, { verdicts: { [open]: 'deny' } }), 'deny');
  const locked: RuleId = 'meta.unverifiable';
  assert.equal(effectiveVerdict(locked, { disabled: [locked] }), 'ask', 'a locked rule cannot be switched off');
  assert.equal(effectiveVerdict(locked, { verdicts: { [locked]: 'allow' } }), 'ask', 'nor softened');
  assert.equal(effectiveVerdict(locked, { verdicts: { [locked]: 'ask' } }), 'ask', 'the same verdict stays');
  assert.equal(effectiveVerdict(locked, { verdicts: { [locked]: 'deny' } }), 'deny', 'stricter is fine');
});

test('a decision: switched-off rules drop out, duplicates merge, the strongest verdict leads', () => {
  const f = (rule: RuleId, reason = rule) => ({ rule, verdict: 'deny' as const, reason });
  const d = decide([f('git.clean'), f('git.clean'), f('git.discard-work'), f('self.tool-files')], [], { config: { disabled: ['git.clean'] } });
  assert.deepEqual(
    d.findings.map((x) => `${x.verdict} ${x.rule}`),
    ['deny self.tool-files', 'warn git.discard-work'],
  );
  assert.equal(d.verdict, 'deny');
  assert.equal(decide([], ['x'], { config: {} }).verdict, 'allow');
  assert.deepEqual(decide([], ['eval-dynamic'], { config: {} }).issues, ['eval-dynamic']);
});

test('the words of a decision: head and tail per verdict, and the repeat count only from the second time', () => {
  const deny = decide([{ rule: 'self.tool-files', verdict: 'deny', reason: 'R1' }], [], { config: {} });
  const ask = decide([{ rule: 'git.clean', verdict: 'ask', reason: 'R2' }], [], { config: {} });
  const warn = decide([{ rule: 'git.discard-work', verdict: 'warn', reason: 'R3' }], [], { config: {} });
  const d = decisionText(deny, { lang: 'en' });
  assert.match(d, /^🛡 Blocked by the safety belt:\n• R1 \[self\.tool-files\]\n/);
  assert.match(d, /Do not work around this/);
  assert.match(decisionText(ask, { lang: 'en' }), /R2 \[git\.clean\]/);
  assert.notEqual(decisionText(ask, { lang: 'en' }).split('\n')[0], d.split('\n')[0]);
  assert.equal(decisionText(warn, { lang: 'en' }).split('\n').length, 2, 'a note has no tail');
  assert.equal(decisionText(deny, { lang: 'en' }, { repeatCount: 1 }), d, 'once is not a repeat');
  assert.match(decisionText(deny, { lang: 'en' }, { repeatCount: 2 }), /2/);
  assert.match(decisionText(deny, { lang: 'tr' }), /Emniyet kemeri/);
});

test('MultiEdit and NotebookEdit are judged by what they write', async () => {
  const ctx = winCtx({ fileSize: async () => 8000 });
  const shrink = await evaluateToolCall(
    'MultiEdit',
    {
      file_path: 'C:/dev/notes/memory/a.md',
      edits: [
        { old_string: 'x'.repeat(2000), new_string: 'y' },
        { old_string: 'z'.repeat(10), new_string: '' },
      ],
    },
    ctx,
  );
  assert.equal(summary(shrink), 'ask self.memory-shrink');
  const grow = await evaluateToolCall('MultiEdit', { file_path: 'C:/dev/notes/memory/a.md', edits: [{ old_string: 'a', new_string: 'b'.repeat(3000) }] }, ctx);
  assert.equal(summary(grow), 'allow');
  const token = 'ghp' + '_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYzA1b';
  const nb = await evaluateToolCall('NotebookEdit', { notebook_path: 'C:/dev/app/a.ipynb', new_source: `key = "${token}"` }, ctx);
  assert.equal(summary(nb), 'warn secrets.write');
  assert.equal(summary(await evaluateToolCall('Write', { content: 'x' }, ctx)), 'allow', 'no path: nothing to judge');
});

test('shell profiles, autostart and the global instructions file are protected on every platform', async () => {
  assert.equal(summary(await write('/home/ada/.config/fish/config.fish', 'x', linuxCtx())), 'ask persist.shell-profile');
  assert.equal(summary(await write('/home/ada/.zshrc', 'x', linuxCtx())), 'ask persist.shell-profile');
  assert.equal(summary(await write('/home/ada/dev/app/.zshrc', 'x', linuxCtx())), 'allow', 'a file named like a profile inside a project is not one');
  assert.equal(summary(await write('/etc/profile', 'x', linuxCtx())), 'ask persist.shell-profile');
  assert.equal(summary(await write('C:/Users/ada/Documents/PowerShell/Microsoft.PowerShell_profile.ps1')), 'ask persist.shell-profile');
  assert.equal(summary(await write('C:/Users/ada/OneDrive/Belgeler/WindowsPowerShell/profile.ps1')), 'ask persist.shell-profile');
  assert.equal(summary(await write('C:/Users/ada/.claude/CLAUDE.md')), 'ask self.claude-settings-project');
  assert.equal(summary(await write('/Users/ada/Library/LaunchAgents/x.plist', 'x', macCtx())), 'ask persist.startup');
  assert.equal(summary(await write('C:/Users/ada/.ssh/config')), 'deny persist.ssh');
});

test('a temporary folder set to a protected place does not make that place free to delete', async () => {
  // TEMP misconfigured as the home folder: the home folder stays protected, its insides outside projects asked about.
  const ctx = winCtx({ env: { TEMP: 'C:/Users/ada', TMP: 'C:/Users/ada' } });
  assert.equal(summary(await bash('rm -rf C:/Users/ada', ctx)), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm -rf C:/Users/ada/scratch', ctx)), 'ask fs.delete-outside-project');
});

test('a home folder reached through a link: its shell profiles are still profiles', async () => {
  const ctx = winCtx({ home: 'D:/home/ada', dataDir: 'D:/home/ada/.mode-code', aliases: [{ real: 'D:/home/ada', spelled: 'C:/Users/ada' }] });
  assert.equal(summary(await write('C:/Users/ada/.bashrc', 'x', ctx)), 'ask persist.shell-profile');
  assert.equal(summary(await write('C:/Users/ada/notes/.bashrc', 'x', ctx)), 'allow');
});

test('the heads of a decision are exact for each verdict', () => {
  const one = (verdict: 'deny' | 'ask' | 'warn') =>
    decisionText(decide([{ rule: 'git.clean', verdict, reason: 'R' }], [], { config: { verdicts: { 'git.clean': verdict } } }), { lang: 'en' }).split('\n')[0];
  assert.equal(one('deny'), '🛡 Blocked by the safety belt:');
  assert.equal(one('ask'), '🛡 The safety belt asks for confirmation:');
  assert.equal(one('warn'), '🛡 Safety belt note:');
});

test('path forms at their boundaries', () => {
  const linux = { platform: 'linux' as const, home: '/home/ada', cwd: '/home/ada/app' };
  assert.equal(resolvePath('a/b/ ', linux), '/home/ada/app/a/b');
  assert.equal(resolvePath('a/b/  /', linux), '/home/ada/app/a/b');
  const win = { platform: 'win32' as const, home: 'C:/Users/ada', cwd: 'C:/dev/app' };
  assert.equal(pathKey('/', 'linux'), '/');
  assert.equal(pathKey('C:/', 'win32'), 'c:/');
  assert.equal(pathKey('/a/', 'linux'), '/a');
  assert.equal(pathKey('ab/', 'linux'), 'ab');
  assert.equal(resolvePath('a/b/ /', win), 'C:/dev/app/a/b');
  // An extension is the part after the last dot only when something follows it.
  assert.equal(couldBeShortName('NAME~1', 'name.'), true);
  assert.equal(couldBeShortName('NAME~1.T', 'name.t'), true);
  assert.equal(couldBeShortName('NAME~1.X', 'name.'), false);
});

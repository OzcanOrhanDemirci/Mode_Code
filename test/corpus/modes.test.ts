// SPDX-License-Identifier: Apache-2.0
// The restricted modes against two corpora: reading commands must run (a refusal is a false alarm), changing
// commands must not be judged as reads (that would let a change through). Judged on Windows, macOS and Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandEffects, hidingIssues, strongest, type EffectEnv } from '../../src/core/shell/effects.js';
import { checkMode, type ModeGuard } from '../../src/core/guard.js';
import { CHANGES, CHANGES_PS, READS, READS_PS } from './modes.js';

const ENVS: EffectEnv[] = [
  { platform: 'win32', home: 'C:/Users/ada', cwd: 'C:/dev/app', env: { TEMP: 'C:/Users/ada/AppData/Local/Temp', USERPROFILE: 'C:/Users/ada' } },
  { platform: 'darwin', home: '/Users/ada', cwd: '/Users/ada/dev/app', env: { TMPDIR: '/var/folders/xy/T' } },
  { platform: 'linux', home: '/home/ada', cwd: '/home/ada/dev/app', env: { TMPDIR: '/tmp' } },
];

const all = (r: Record<string, string[]>) => Object.values(r).flat();

test('every reading command is judged to only read, on every platform, in Bash and PowerShell', () => {
  const misses: string[] = [];
  for (const env of ENVS) {
    for (const [cmds, dialect] of [
      [all(READS), 'bash'],
      [all(READS_PS), 'powershell'],
    ] as const) {
      for (const c of cmds) {
        const r = commandEffects(c, dialect, env);
        const k = strongest(r.effects);
        if (k !== 'read' || hidingIssues(r.issues).length)
          misses.push(`${env.platform} ${dialect}: ${c} → ${r.effects.map((e) => `${e.program}:${e.kind}`).join(' ')} ${r.issues.join(',')}`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

test('every reading command runs in chat, research and plan modes (no false alarm)', () => {
  for (const env of ENVS) {
    const temp = Object.values(env.env)[0]!;
    for (const mode of ['chat', 'research', 'plan'] as const) {
      const g: ModeGuard = {
        mode,
        zones: { temp: [temp], work: [`${temp}/mode-code/flows`], plan: [] },
        env: env.env,
        flowStep: null,
        words: { code: 'code', free: 'free' },
      };
      for (const c of all(READS)) assert.equal(checkMode('Bash', { command: c }, g, env, 'en'), null, `${env.platform} ${mode}: ${c}`);
      for (const c of all(READS_PS)) assert.equal(checkMode('PowerShell', { command: c }, g, env, 'en'), null, `${env.platform} ${mode}: ${c}`);
    }
  }
});

test('no changing command is judged to only read, and every one is refused in the project by a restricted mode', () => {
  for (const env of ENVS) {
    const temp = Object.values(env.env)[0]!;
    const g: ModeGuard = { mode: 'research', zones: { temp: [temp], work: [], plan: [] }, env: env.env, flowStep: null, words: { code: 'code', free: 'free' } };
    for (const [cmds, dialect, tool] of [
      [all(CHANGES), 'bash', 'Bash'],
      [all(CHANGES_PS), 'powershell', 'PowerShell'],
    ] as const) {
      for (const c of cmds) {
        const r = commandEffects(c, dialect, env);
        assert.ok(strongest(r.effects) !== 'read' || hidingIssues(r.issues).length > 0, `${env.platform}: ${c} judged a read`);
        assert.notEqual(checkMode(tool, { command: c }, g, env, 'en'), null, `${env.platform}: ${c} let through in research mode`);
      }
    }
  }
});

test('the corpora are of a size that means something', () => {
  assert.ok(all(READS).length + all(READS_PS).length >= 150, String(all(READS).length + all(READS_PS).length));
  assert.ok(all(CHANGES).length + all(CHANGES_PS).length >= 100, String(all(CHANGES).length + all(CHANGES_PS).length));
});

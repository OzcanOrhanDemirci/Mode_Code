// SPDX-License-Identifier: Apache-2.0
/**
 * The false-alarm guard: everyday commands (everyday.ts) must pass the belt in silence on Windows, macOS
 * and Linux. A new rule that makes any of them ask or block fails here, before it reaches anyone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';
import { linuxCtx, macCtx, rulesOf, winCtx } from '../helpers/belt.js';
import { BASH, POWERSHELL } from './everyday.js';

const PLATFORMS: [string, BeltContext][] = [
  ['windows', winCtx()],
  ['macos', macCtx()],
  ['linux', linuxCtx()],
];

for (const [group, commands] of Object.entries(BASH))
  test(`everyday ${group}: silent on every platform (${commands.length} commands)`, async () => {
    const loud: string[] = [];
    for (const [name, ctx] of PLATFORMS)
      for (const command of commands) {
        const d = await evaluateToolCall('Bash', { command }, ctx);
        if (d.verdict !== 'allow' && d.verdict !== 'warn') loud.push(`${name}: ${command} → ${d.verdict} ${rulesOf(d).join(',')}`);
      }
    assert.deepEqual(loud, []);
  });

for (const [group, commands] of Object.entries(POWERSHELL))
  test(`everyday PowerShell ${group}: silent (${commands.length} commands)`, async () => {
    const loud: string[] = [];
    for (const command of commands) {
      const d = await evaluateToolCall('PowerShell', { command }, winCtx());
      if (d.verdict !== 'allow' && d.verdict !== 'warn') loud.push(`${command} → ${d.verdict} ${rulesOf(d).join(',')}`);
    }
    assert.deepEqual(loud, []);
  });

test('the corpus is large enough to mean something, and has no duplicates', () => {
  const bash = Object.values(BASH).flat();
  const ps = Object.values(POWERSHELL).flat();
  assert.ok(bash.length + ps.length >= 150, `${bash.length + ps.length} commands`);
  assert.equal(new Set(bash).size, bash.length, 'a Bash command listed twice');
  assert.equal(new Set(ps).size, ps.length, 'a PowerShell command listed twice');
});

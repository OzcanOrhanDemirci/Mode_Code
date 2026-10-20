// SPDX-License-Identifier: Apache-2.0
/**
 * The ways of working inside Claude Code's own engine (docs/safety-belt.md, "Ways of working"): who answers Claude
 * Code's permission question at each level, and what Manual promises before a commit or a push. The world beneath
 * is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { PROJECT, world } from './world.ts';

const check = ($: any, input: object, id = 'toolu_c') => ($.tool as any).check({ tool: 'Edit', input, tool_use_id: id }) as Promise<any>;
const style = ($: any, n: '7' | '8') => $.command.run({ command: n, args: '' } as any);

test("Manual leaves Claude Code's own question to the person; a question of the person's own goes to them, never to a classifier", async ($, on) => {
  const w = world(on);
  let rule: string | undefined;
  on('tool.check', () => ({ decision: 'ask', reason: 'Edit a file', ...(rule ? { rule } : {}) }));
  const mode = await check($, { file_path: `${PROJECT}/a.ts` });
  expect(mode).toMatchObject({ decision: 'ask' });
  expect(mode.decider).toBeUndefined();
  rule = 'Edit(src/**)';
  expect(await check($, { file_path: `${PROJECT}/src/a.ts` }, 'toolu_r')).toMatchObject({ decision: 'ask', decider: 'person', rule: 'Edit(src/**)' });
  expect(w.events().filter((e: any) => e.kind === 'permission')).toEqual([]);
});

test("Autonomous answers the question Claude Code's mode asks, and records it; a question of the person's own still goes to them", async ($, on) => {
  const w = world(on);
  let rule: string | undefined;
  on('tool.check', () => ({ decision: 'ask', reason: 'Edit a file', ...(rule ? { rule } : {}) }));
  await style($, '8');
  expect(await check($, { file_path: `${PROJECT}/a.ts` })).toMatchObject({ decision: 'allow' });
  expect(w.events().find((e: any) => e.kind === 'permission')).toMatchObject({ tool: 'Edit', answer: 'auto' });
  rule = 'Edit(src/**)';
  expect(await check($, { file_path: `${PROJECT}/src/a.ts` }, 'toolu_r')).toMatchObject({ decision: 'ask', decider: 'person' });
  // A query carries no call: the verdict beneath stands.
  expect(await ($.tool as any).check({ tool: 'Edit', input: { file_path: `${PROJECT}/a.ts` } })).toMatchObject({ decision: 'ask' });
  // Back to Manual: the person answers again.
  await style($, '7');
  rule = undefined;
  expect(await check($, { file_path: `${PROJECT}/a.ts` }, 'toolu_m')).toMatchObject({ decision: 'ask' });
});

test('Manual waits for the person before a commit or a push, whatever else lets it through; Autonomous does not ask', async ($, on) => {
  const w = world(on, { answer: 'block' });
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m wip && git push', tool_use_id: 'toolu_1' } as any);
  expect(w.asked.at(-1)).toMatch(/^Manual: the commit and push waits for you\. git add \. && git commit -m wip && git push Run it\?$/);
  expect(String(r.deny)).toMatch(/^🛡 The user declined the commit and push: in Manual it waits for them\./);
  expect(w.reached).toEqual([]);
  expect(w.events().find((e: any) => e.kind === 'manual')).toMatchObject({ what: ['commit', 'push'], answer: 'block' });
  // A command that neither commits nor pushes is not asked about.
  const asked = w.asked.length;
  expect(((await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'toolu_2' } as any)) as any).deny).toBeUndefined();
  expect(w.asked.length).toBe(asked);
  await style($, '8');
  expect(((await $.tool.call({ tool: 'Bash', command: 'git commit -m wip', tool_use_id: 'toolu_3' } as any)) as any).deny).toBeUndefined();
  expect(w.asked.length).toBe(asked);
});

test('Manual with nobody to ask (a headless run): the commit does not run, and Claude is told how the person can let it', async ($, on) => {
  const w = world(on, { answer: 'nobody' });
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git push', tool_use_id: 'toolu_1' } as any);
  expect(String(r.deny)).toMatch(/^🛡 Blocked: in Manual a push waits for the user, and no one could be asked here/);
  expect(w.reached).toEqual([]);
});

test('Manual, and the person says yes: the push runs', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  expect(((await $.tool.call({ tool: 'Bash', command: 'git push', tool_use_id: 'toolu_2' } as any)) as any).deny).toBeUndefined();
  expect(w.reached).toEqual(['Bash']);
  expect(w.events().find((e: any) => e.kind === 'manual')).toMatchObject({ what: ['push'], answer: 'allow' });
});

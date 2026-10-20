// SPDX-License-Identifier: Apache-2.0
/**
 * The ways of working inside Claude Code's own engine (docs/safety-belt.md, "Ways of working"): who answers Claude
 * Code's permission question at each level, and what Manual promises before a commit or a push. The world beneath
 * is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { DATA, HOME, PROJECT, SESSION, world } from './world.ts';

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

test('a call a safety net makes undoable passes in Autonomous where the safety-net hook runs, and is asked where it does not', async ($, on) => {
  const w = world(on, { answer: 'block' });
  await style($, '8');
  // No safety-net hook in this session: nothing would keep what clean removes, so the person is asked.
  const before = w.asked.length;
  const asked: any = await $.tool.call({ tool: 'Bash', command: 'git clean -fd', tool_use_id: 'toolu_n1' } as any);
  expect(w.asked.length).toBe(before + 1);
  expect(String(asked.deny)).toMatch(/git clean -fd/);
  // The hook has run in this session: it keeps what the call removes before it runs, so the call goes on unasked.
  w.write(`${DATA}/state/sessions/${SESSION}.hook.json`, JSON.stringify({ v: 1, sessionId: SESSION, lastRunAt: 1, blocks: {} }));
  const passed: any = await $.tool.call({ tool: 'Bash', command: 'git clean -fd', tool_use_id: 'toolu_n2' } as any);
  expect(passed.deny).toBeUndefined();
  expect(w.asked.length).toBe(before + 1);
  // Manual still asks, net or not.
  await style($, '7');
  await $.tool.call({ tool: 'Bash', command: 'git clean -fd', tool_use_id: 'toolu_n3' } as any);
  expect(w.asked.length).toBe(before + 2);
});

test('what the person wrote is evidence: a release they named is deleted in Autonomous with a note; one they did not is asked', async ($, on) => {
  const w = world(on, { answer: 'block' });
  await style($, '8');
  await $.prompt.submit({ text: 'Delete the release v1.2.3, it was a mistake.', wait: false, origin: { kind: 'composer' } } as any);
  const before = w.asked.length;
  const named: any = await $.tool.call({ tool: 'Bash', command: 'gh release delete v1.2.3 --yes', tool_use_id: 'toolu_e1' } as any);
  expect(named.deny).toBeUndefined();
  expect(w.asked.length).toBe(before);
  await $.tool.call({ tool: 'Bash', command: 'gh release delete v9.9.9 --yes', tool_use_id: 'toolu_e2' } as any);
  expect(w.asked.length).toBe(before + 1);
  // The record the safety-net hook decides by too.
  expect(w.json(`${DATA}/state/sessions/${SESSION}.prov.json`).said.at(-1)).toMatch(/v1\.2\.3/);
});

test('full autonomy: a step the person clearly asked for goes on once Claude quotes their sentence; a quote they never typed does not', async ($, on) => {
  const w = world(on);
  await $.command.run({ command: '9', args: '' } as any);
  await $.prompt.submit({ text: 'Please delete the file named Q3 plan from the drive.', wait: false, origin: { kind: 'composer' } } as any);
  const call = (id: string) => $.tool.call({ tool: 'mcp__drive__delete_file', file_id: 'abc', name: 'Q3 plan', tool_use_id: id } as any) as Promise<any>;
  // Without the request: left to the person.
  expect(String((await call('toolu_r1')).deny)).toMatch(/Left to the user|leave this step for the user/i);
  // A quote the person never typed is refused, and changes nothing.
  const wrong: any = await $.tool.call({
    tool: 'mcp__mode-code__request',
    quote: 'delete every file on the drive',
    target: 'Q3 plan',
    tool_use_id: 'toolu_r2',
  } as any);
  expect(String(wrong.result)).toMatch(/^Not checked: that sentence is not in what the person typed/);
  expect(String((await call('toolu_r3')).deny)).toMatch(/Left to the user|leave this step for the user/i);
  // Their sentence, word for word: checked, and the step goes on.
  const ok: any = await $.tool.call({
    tool: 'mcp__mode-code__request',
    quote: 'delete the file named Q3 plan from the drive',
    target: 'Q3 plan',
    tool_use_id: 'toolu_r4',
  } as any);
  expect(String(ok.result)).toMatch(/^Checked: the person asked for this in their own words/);
  expect((await call('toolu_r5')).deny).toBeUndefined();
  expect(w.events().find((e: any) => e.kind === 'request')).toMatchObject({ target: 'Q3 plan' });
  // Their next message: the request is done with.
  await $.prompt.submit({ text: 'Thanks, now the docs.', wait: false, origin: { kind: 'composer' } } as any);
  expect(String((await call('toolu_r6')).deny)).toMatch(/Left to the user|leave this step for the user/i);
});

test('a folder this session made is its own to remove; one it did not make is asked', async ($, on) => {
  const w = world(on, { answer: 'block' });
  w.write(`${HOME}/elsewhere/old.txt`, 'kept');
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/scratch/a.txt`, content: 'tmp', tool_use_id: 'toolu_m1' } as any);
  expect(w.json(`${DATA}/state/sessions/${SESSION}.prov.json`).made).toEqual([`${HOME}/scratch/a.txt`.toLowerCase()]);
  const before = w.asked.length;
  expect(((await $.tool.call({ tool: 'Bash', command: `rm -rf ${HOME}/scratch/a.txt`, tool_use_id: 'toolu_m2' } as any)) as any).deny).toBeUndefined();
  expect(w.asked.length).toBe(before);
  await $.tool.call({ tool: 'Bash', command: `rm -rf ${HOME}/elsewhere`, tool_use_id: 'toolu_m3' } as any);
  expect(w.asked.length).toBe(before + 1);
});

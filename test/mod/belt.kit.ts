// SPDX-License-Identifier: Apache-2.0
/**
 * The safety belt inside Claude Code's own engine: the plugin loaded by the engine's host, tool calls
 * raised as a session raises them, the world beneath answered from memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { DATA, PROJECT, world } from './world.ts';

test('a harmless call reaches the tool, untouched', async ($, on) => {
  const w = world(on);
  const reached = w.reached;
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git status' } as any);
  expect(r.deny).toBeUndefined();
  expect(reached).toEqual(['Bash']);
});

test('a write into the tool data folder is refused before the tool runs, and the refusal is logged', async ($, on) => {
  const w = world(on);
  const reached = w.reached;
  const r: any = await $.tool.call({ tool: 'Write', file_path: `${DATA}/config.json`, content: '{}' } as any);
  expect(reached).toEqual([]);
  expect(String(r.deny ?? r.text)).toMatch(/own files/);
  expect(String(r.deny ?? r.text)).toMatch(/self\.tool-files/);
  const e = w.events().find((x: any) => x.kind === 'belt');
  expect(e).toMatchObject({ verdict: 'deny', rules: ['self.tool-files'], source: 'mod' });
  expect(w.modState().blocks['self.tool-files']).toBe(1);
});

test('the same refusal through a shell command, and through cd into the folder', async ($, on) => {
  const w = world(on);
  const reached = w.reached;
  const a: any = await $.tool.call({ tool: 'Bash', command: `echo x > ${DATA}/config.json` } as any);
  const b: any = await $.tool.call({ tool: 'Bash', command: `cd ${DATA} && rm -rf state` } as any);
  expect(String(a.deny ?? a.text)).toMatch(/self\.tool-files/);
  expect(String(b.deny ?? b.text)).toMatch(/self\.tool-files/);
  expect(reached).toEqual([]);
});

test('a Monitor script is read like a Bash command: refused into the data folder, a log watch runs', async ($, on) => {
  const w = world(on);
  const reached = w.reached;
  const a: any = await $.tool.call({ tool: 'Monitor', command: `echo x > ${DATA}/config.json`, description: 'kit', timeout_ms: 60000 } as any);
  expect(String(a.deny ?? a.text)).toMatch(/self\.tool-files/);
  expect(reached).toEqual([]);
  const b: any = await $.tool.call({
    tool: 'Monitor',
    command: `tail -f ${PROJECT}/dev.log | grep --line-buffered ERROR`,
    description: 'kit',
    timeout_ms: 60000,
  } as any);
  expect(b.deny).toBeUndefined();
  expect(reached).toEqual(['Monitor']);
});

test('an "ask" rule asks the person; "allow" lets this one call run and records the approval', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  const reached = w.reached;
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git clean -fdx', tool_use_id: 'toolu_kit_1' } as any);
  expect(w.asked.length).toBe(1);
  expect(w.asked[0]).toMatch(/git clean/);
  expect(r.deny).toBeUndefined();
  expect(reached).toEqual(['Bash']);
  expect(w.modState().approvals.map((x: any) => x.toolUseId)).toContain('toolu_kit_1');
});

test('"block" refuses it, and with no one to ask it is refused too', async ($, on) => {
  const w = world(on, { answer: 'block' });
  const reached = w.reached;
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git clean -fdx', tool_use_id: 'toolu_kit_2' } as any);
  expect(String(r.deny ?? r.text)).toMatch(/git\.clean/);
  expect(reached).toEqual([]);
  expect(w.events().some((e: any) => e.verdict === 'ask' && e.answer === 'block')).toBe(true);
});

test('no one to ask: refused, never let through', async ($, on) => {
  const w = world(on, { answer: 'nobody' });
  const reached = w.reached;
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git clean -fdx' } as any);
  expect(String(r.deny ?? r.text)).toMatch(/git\.clean/);
  expect(reached).toEqual([]);
  expect(w.events().some((e: any) => e.answer === 'none')).toBe(true);
});

test('a broken guard fails closed for tools that change things and open for reads', async ($, on) => {
  // The session cannot even say where it is: the plugin cannot load its context.
  const w = world(on, { cwdFails: true });
  const reached = w.reached;
  const bash: any = await $.tool.call({ tool: 'Bash', command: 'ls' } as any);
  const read: any = await $.tool.call({ tool: 'Read', file_path: `${PROJECT}/README.md` } as any);
  expect(String(bash.deny ?? bash.text)).toMatch(/safety belt|belt/i);
  expect(read.deny).toBeUndefined();
  expect(reached).toEqual(['Read']);
});

test('a note ("warn") lets the call run and tells the model', async ($, on) => {
  world(on);
  const r: any = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' } as any);
  expect(r.deny).toBeUndefined();
  expect((r.context ?? []).join('\n')).toMatch(/git\.discard-work/);
});

test('on Windows: every spelling of the data folder is refused, its 8.3 short name too', async ($, on) => {
  const w = world(on, { windows: true });
  for (const p of [
    'C:/Users/ada/.terminal-code/config.json',
    'C:\\Users\\ada\\.terminal-code\\config.json',
    '/c/Users/ada/.terminal-code/config.json',
    'C:/Users/ada/TERMIN~1/config.json',
  ]) {
    const r: any = await $.tool.call({ tool: 'Write', file_path: p, content: '{}' } as any);
    expect(String(r.deny ?? r.text), p).toMatch(/self\.tool-files/);
  }
  expect(w.reached).toEqual([]);
});

test('a session started in the home folder: a recursive delete inside a registered project runs, outside it asks', async ($, on) => {
  const config = { version: 1, projects: [{ id: 'app', names: ['app'], path: PROJECT }] };
  const w = world(on, { startedAtHome: true, config, answer: 'block' });
  const inside: any = await $.tool.call({ tool: 'Bash', command: `rm -rf ${PROJECT}/.tmp/out` } as any);
  expect(inside.deny).toBeUndefined();
  expect(w.asked).toEqual([]);
  const outside: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf /home/ada/elsewhere/out' } as any);
  expect(w.asked.length).toBe(1);
  expect(String(outside.deny ?? outside.text)).toMatch(/fs\.delete-outside-project/);
});

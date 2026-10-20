// SPDX-License-Identifier: Apache-2.0
/**
 * Parallel agents inside Claude Code's engine (docs/agents.md): each agent's start decided by the plugin (refused, let
 * through, or fitted to an assigned row), the strip and the window, the batch closing itself, ultracode standing the
 * mode aside, and the stop buttons. The world beneath is in memory (see world.ts); Claude Code's own start of an agent
 * and its list of them are answered here as the engine would.
 */
import { test, expect } from 'claude-code/testing';
import { world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const person = async ($: any, args: string) => (await $.command.run({ command: 'parallel', args, origin: { kind: 'composer' } })) as any;
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 } } as any;
const PANE = { title: 'Parallel agents', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} } as any;

/** Claude Code's side of agents: what started (as the hooks left it), and the list it keeps. */
function engine(on: any) {
  const started: any[] = [];
  const list: { id: string; type: string; description: string; status: string }[] = [];
  on('agent.spawn', (_$: any, e: any) => {
    started.push(e);
    const id = `ag${started.length}`;
    list.push({ id, type: e.subagentType, description: e.description, status: 'running' });
    return { model: e.model ?? 'opus', agentId: id };
  });
  on('agent.list', () => ({ value: list }));
  return { started, list };
}

let n = 0;
const spawn = async ($: any, subagentType: string, prompt = 'Look into it.', extra: Record<string, unknown> = {}) =>
  (await $.agent.spawn({ subagentType, prompt, description: 'a task', tool_use_id: `tu${++n}`, ...extra } as any)) as any;

/** The text of drawn children, strings and elements alike, in order: what a pressable shows ("◉ +10 → 51%"). */
function flat(children: unknown[]): string {
  return children.map((c: any) => (typeof c === 'string' ? c : flat(c?.children ?? []))).join('');
}

/** Every word a drawing shows, its wrapped lines joined back: a sentence the window wraps reads whole. */
async function words(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' }))
    .map((t: any) => String(t.text))
    .join(' ')
    .replace(/\s+/g, ' ');
}

async function stripText($: any): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: BAND } as any);
  const t = (await ui.findAll({ type: 'Text' })).map((x: any) => String(x.text)).join(' | ');
  await ui.unmount();
  return t;
}

test('off in the settings: nothing is touched, and the strip shows no agents', async ($, on) => {
  const w = world(on);
  const e = engine(on);
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  expect(e.started.length).toBe(1);
  await $.prompt.submit(typed('Hello.'));
  expect(await stripText($)).not.toMatch(/agents/);
  expect((await person($, '3')).text).toBe('Parallel agents are not on: turn them on in the cockpit (/0) or under Working › Parallel agents.');
  expect(w.events().filter((x: any) => x.kind === 'agents')).toEqual([]);
});

test('on in the settings: every session starts with agents off; the read-only helpers stay free unless the setting says no', async ($, on) => {
  world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  await $.prompt.submit(typed('Hello.'));
  expect(await stripText($)).toMatch(/👥 agents…(?! ?[≤=·])/);
  expect((await spawn($, 'Explore')).deny).toBeUndefined();
  expect((await spawn($, 'Plan')).deny).toBeUndefined();
  const r = await spawn($, 'general-purpose');
  expect(String(r.deny)).toMatch(
    /Parallel agents are off in this session .*: start no working agent, and do the work yourself\. The read-only helpers \(Explore, Plan\) are still yours\./,
  );
  expect(e.started.map((x) => x.subagentType)).toEqual(['Explore', 'Plan']);
});

test('helpers not free: Explore is refused too while agents are off', async ($, on) => {
  world(on, { config: { agents: { enabled: true, helpers: false } } });
  engine(on);
  expect(String((await spawn($, 'Explore')).deny)).toBe(
    'Parallel agents are off in this session (the person sets them on the strip): start no agent and do the work yourself.',
  );
});

test('free: at most N at once, helpers not counted; Claude is told once with the next prompt; only the person sets it', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  expect((await $.command.run({ command: 'parallel', args: '2', origin: { kind: 'plugin', name: 'other' } } as any)).text).toMatch(/only you/i);
  expect((await person($, '2')).text).toBe('Parallel agents: free, at most 2 at once.');
  const told = ((await $.prompt.submit(typed('Refactor the parser.'))) as any).context.join('\n');
  expect(told).toMatch(/turned parallel agents on: use as many as help, at most 2 at once, or none; you are free to/);
  expect((((await $.prompt.submit(typed('And the tests.'))) as any).context ?? []).join('\n')).not.toMatch(/parallel agents on/);
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  expect((await spawn($, 'Explore')).deny).toBeUndefined();
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  expect(String((await spawn($, 'general-purpose')).deny)).toMatch(/At most 2 agent\(s\) at once in this session, and as many are running/);
  expect(await stripText($)).toMatch(/👥 agents… ≤2 · 2/);
  e.list[0]!.status = 'completed';
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  expect(
    w
      .events()
      .filter((x: any) => x.kind === 'agents')
      .map((x: any) => x.action),
  ).toEqual(['set', 'deny']);
});

test('assigned: exactly N for the next request, each fitted to its row; then no more; done, it closes itself and says so', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  expect((await person($, 'exact 2')).text).toMatch(/exactly 2 for your next request/);
  // Before the request: no batch yet.
  expect(String((await spawn($, 'general-purpose')).deny)).toMatch(/none is left to start/);
  const told = ((await $.prompt.submit(typed('Speed up the build.'))) as any).context.join('\n');
  expect(told).toMatch(/the person wants exactly 2 agent\(s\), no fewer and no more/);
  expect(told).toMatch(/1\. code \(general-purpose\): no task given: write it from the request/);
  expect((await spawn($, 'general-purpose', 'Profile the bundler.')).deny).toBeUndefined();
  // An Explore with no research row to fill is Claude's own search: let through, not one of the rows.
  expect((await spawn($, 'Explore', 'Find the slow step.')).deny).toBeUndefined();
  expect((await spawn($, 'general-purpose', 'Cache the deps.')).deny).toBeUndefined();
  expect(e.started.map((x) => [x.subagentType, x.description])).toEqual([
    ['general-purpose', '[1/2] a task'],
    ['Explore', 'a task'],
    ['general-purpose', '[2/2] a task'],
  ]);
  expect(String((await spawn($, 'general-purpose')).deny)).toMatch(/none is left to start/);
  expect(await stripText($)).toMatch(/👥 agents… =2 · 2\/2/);
  for (const a of e.list) a.status = 'completed';
  // The person's next prompt: the batch is over; it closes, and Claude is told with this very prompt.
  const done = ((await $.prompt.submit(typed('Thanks.'))) as any).context.join('\n');
  expect(done).toMatch(/The assigned agents are done, and parallel agents are off again for this session/);
  expect(w.toasts.some((t) => /The assigned agents are done \(2\/2\): parallel agents are off again/.test(t))).toBe(true);
  expect(w.modState().agents.mode).toBe('off');
  expect(await stripText($)).toMatch(/👥 agents…(?! ?[≤=·])/);
  const after = ((await $.prompt.submit(typed('One more thing.'))) as any).context ?? [];
  expect(after.join('\n')).not.toMatch(/assigned agents are done/);
});

test('the window: assigned with a written task and a model; the agent gets the task word for word, the model and the kind', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  await $.prompt.submit(typed('Hello.'));
  await person($, '');
  expect(w.panes).toEqual(['parallel-agents']);
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'parallel-agents', props: PANE } as any);
  // Every choice is its options, each one a press (docs/design.md: arrows never change a value); what applying does is
  // said before it does.
  expect(await pane.findAll({ type: 'Select' })).toEqual([]);
  await pane.press({ key: 'ag-mode-assigned' });
  await pane.input({ key: 'ag-n', text: '2', kind: 'change' });
  expect(await words(pane)).toContain('If you apply Parallel agents: exactly 2 for your next request; the mode closes once they are done.');
  await pane.input({ key: 'ag-task-0', text: 'Measure the cold start.', kind: 'change' });
  await pane.press({ key: 'ag-kind-research' });
  await pane.press({ key: 'ag-model-sonnet' });
  const label = async (key: string) => flat((await pane.find({ key }))?.children ?? []);
  expect([await label('ag-kind-research'), await label('ag-kind-code'), await label('ag-model-sonnet')]).toEqual(['◉ research', '○ code', '◉ sonnet']);
  // The second row: its own task, kind and model; back to the first, its task is still there.
  await pane.press({ key: 'ag-next' });
  expect(await pane.find({ type: 'Text', text: 'Agent 2 of 2' })).toBeDefined();
  expect(await pane.find({ key: 'ag-next' })).toBeUndefined();
  await pane.press({ key: 'ag-prev' });
  expect(await pane.find({ key: 'ag-task-0' })).toMatchObject({ props: { value: 'Measure the cold start.' } });
  await pane.press({ key: 'apply' });
  expect(w.panes).toEqual([]);
  expect(w.modState().agents).toMatchObject({
    mode: 'assigned',
    n: 2,
    rows: [
      { task: 'Measure the cold start.', kind: 'research', model: 'sonnet' },
      { task: '', kind: 'code', model: null },
    ],
  });
  await $.prompt.submit(typed('Make the app start faster.'));
  await spawn($, 'general-purpose', 'Change the loader.');
  await spawn($, 'Explore', 'Look at startup.');
  expect(e.started[0]).toMatchObject({ subagentType: 'general-purpose', description: '[2/2] a task', prompt: 'Change the loader.' });
  expect(e.started[1]).toMatchObject({ subagentType: 'Explore', model: 'sonnet', description: '[1/2] a task' });
  expect(e.started[1].prompt).toMatch(/^Measure the cold start\.\n\n\[Mode_Code\] Context the main session added: Look at startup\.$/);
  await pane.unmount();
});

test('the window refuses a count it cannot take; a read-only mode offers no code agent', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  engine(on);
  await $.command.run({ command: '2', args: '', origin: { kind: 'composer' } } as any);
  await person($, '');
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'parallel-agents', props: PANE } as any);
  await pane.press({ key: 'ag-mode-assigned' });
  await pane.input({ key: 'ag-n', text: '1000', kind: 'change' });
  await pane.press({ key: 'apply' });
  expect((await pane.find({ type: 'Text', text: 'A number of 1 to 999.' }))?.props.color).toBe('error');
  await pane.input({ key: 'ag-n', text: '1', kind: 'change' });
  const kinds = (await pane.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('ag-kind-'));
  expect(kinds).toEqual(['ag-kind-research', 'ag-kind-plan']);
  expect(await pane.find({ type: 'Text', text: 'This mode cannot write: no code agent here.' })).toBeDefined();
  await pane.unmount();
  expect(w.modState().agents.mode).toBe('off');
});

test('above 20 the window says what decides, and the toast keeps to what was set; a typed count says it on the line', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  engine(on);
  await person($, '');
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'parallel-agents', props: PANE } as any);
  await pane.press({ key: 'ag-mode-free' });
  await pane.input({ key: 'ag-n', text: '20', kind: 'change' });
  expect(await pane.find({ key: 'ag-many' })).toBeUndefined();
  await pane.input({ key: 'ag-n', text: '25', kind: 'change' });
  expect(await pane.find({ type: 'Text', text: 'Above 20, what really decides is how many Claude Code runs at once, and the quota.' })).toBeDefined();
  await pane.press({ key: 'apply' });
  await pane.unmount();
  expect(w.toasts.at(-1)).toBe('Parallel agents: free, at most 25 at once.');
  expect((await person($, '21')).text).toBe(
    'Parallel agents: free, at most 21 at once. Above 20, what really decides is how many Claude Code runs at once, and the quota.',
  );
  expect((await person($, '20')).text).toBe('Parallel agents: free, at most 20 at once.');
});

test('a full-autonomy run attached: exactly N waits, said in the window and on the line; at most N is set', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  engine(on);
  const id = '20261018-1200-kit';
  const at = 1_792_300_000_000;
  const dir = `/home/ada/.mode-code/runs/${id}`;
  w.write(
    `${dir}/run.json`,
    JSON.stringify({
      v: 1,
      id,
      task: 'Add rate limiting.',
      project: null,
      cwd: '/home/ada/dev/app',
      sessionId: 'kit-session-1',
      createdAt: at,
      updatedAt: at,
      aliveAt: at,
      status: 'active',
      phase: 'work',
      pause: null,
      budget: { weeklyTarget: 60, source: 'prompt' },
      start: { commit: 'abc1234', branch: 'main', ref: `refs/mode-code/${id}/0`, untracked: [] },
      workDir: dir,
      planPath: `${dir}/plan.md`,
      reportPath: `${dir}/report.md`,
      notesPath: `${dir}/notes.md`,
      plan: null,
      milestones: [],
      deferred: [],
      blockers: [],
      finish: null,
      activeMs: 0,
      limitFrom: 0,
      runningSince: at,
      history: [{ at, event: 'start' }],
    }),
  );
  w.write(
    '/home/ada/.mode-code/state/sessions/kit-session-1.mod.json',
    JSON.stringify({ v: 1, sessionId: 'kit-session-1', aliveAt: at, runId: id, interaction: 'full', interactionBefore: 'default' }),
  );
  expect((await person($, 'exact 3')).text).toBe('A full-autonomy run is attached: its plan decides the work, so exactly N cannot start now. At most N works.');
  expect(w.modState().agents?.mode ?? 'off').toBe('off');
  await person($, '');
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'parallel-agents', props: PANE } as any);
  const modes = (await pane.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('ag-mode-'));
  expect(modes).toEqual(['ag-mode-off', 'ag-mode-free']);
  await pane.unmount();
  expect((await person($, '3')).text).toBe('Parallel agents: free, at most 3 at once.');
  expect(w.modState().agents).toMatchObject({ mode: 'free', n: 3 });
});

test('workflows and ultracode: never touched; /effort ultracode stands the mode aside, another level brings it back', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  engine(on);
  // Claude Code's own /effort, beneath the plugin.
  on('command.run', { command: 'effort' }, () => ({ text: 'Effort set.' }));
  await $.prompt.submit(typed('Hello.'));
  expect((await spawn($, 'general-purpose', 'x', { workflow: { runId: 'wf_1', index: 1 } })).deny).toBeUndefined();
  await $.command.run({ command: 'effort', args: 'ultracode' } as any).catch(() => undefined);
  expect(w.toasts.at(-1)).toMatch(/Ultracode is on: Claude Code's workflows run the agents/);
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  expect(await stripText($)).toMatch(/👥 agents… · ultracode/);
  await $.command.run({ command: 'effort', args: 'high' } as any).catch(() => undefined);
  expect(w.toasts.at(-1)).toBe('Ultracode is off: your parallel agent setting is back.');
  expect(String((await spawn($, 'general-purpose')).deny)).toMatch(/off in this session/);
  // The word in a prompt: on for that request alone.
  await $.prompt.submit(typed('Rewrite the importer. ultracode'));
  expect((await spawn($, 'general-purpose')).deny).toBeUndefined();
  await $.prompt.submit(typed('Now the docs.'));
  expect(String((await spawn($, 'general-purpose')).deny)).toMatch(/off in this session/);
});

test("stop: every agent at work is stopped with Claude Code's TaskStop; an assigned batch takes no more", async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  await person($, '3');
  await $.prompt.submit(typed('Go.'));
  await spawn($, 'general-purpose');
  await spawn($, 'general-purpose');
  e.list[1]!.status = 'completed';
  expect((await person($, 'stop')).text).toBe('1 agent(s) stopped.');
  expect(w.calls.filter((c: any) => c.tool === 'TaskStop').map((c: any) => c.task_id)).toEqual(['ag1']);
  e.list[0]!.status = 'killed';
  expect((await person($, 'stop')).text).toBe('No agent is running.');
  expect((await person($, 'off')).text).toBe('Parallel agents: off for this session.');
  // What went wrong first (a toast's length), how it is used on a line of its own.
  expect((await person($, 'many')).text).toMatch(/^A number of 1 to 999\.\n\/parallel: the window · .*\/parallel exact 7: exactly 7/);
});

test("the window's agents at work: each one's conversation a press away, or stopped by itself; the window says how it is now", async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  const views: unknown[] = [];
  on('ui.view', (_$: any, x: any) => {
    views.push(x);
    return { value: {} };
  });
  await person($, '3');
  await $.prompt.submit(typed('Go.'));
  await spawn($, 'general-purpose');
  await spawn($, 'Explore');
  await person($, '');
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'parallel-agents', props: PANE } as any);
  expect(await words(pane)).toContain('Now 👥 at most 3 agents at once · 2 at work');
  expect(await words(pane)).toContain('Running now (2)');
  await pane.press({ key: 'ag-view-ag2' });
  expect(views).toEqual([{ agentId: 'ag2' }]);
  expect(w.panes).toEqual([]);
  await person($, '');
  await pane.press({ key: 'ag-stop-ag1' });
  expect(w.calls.filter((c: any) => c.tool === 'TaskStop').map((c: any) => c.task_id)).toEqual(['ag1']);
  void e;
  await pane.unmount();
});

test('an assigned batch whose agents finish in the background closes when the last one ends, without a prompt', async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  const e = engine(on);
  on('turn.complete', (_$: any, x: any) => ({ text: x.answer ?? '' }));
  await person($, 'exact 1');
  await $.prompt.submit(typed('Check the links.'));
  await spawn($, 'general-purpose');
  await $.turn.complete({ answer: 'Started.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(w.modState().agents.mode).toBe('assigned');
  e.list[0]!.status = 'completed';
  await $.turn.complete({ answer: 'Links fine.', durationMs: 5, isAborted: false, turnId: 'a1', agentId: 'ag1', reason: 'answer' } as any);
  await w.clock.advance(2000);
  expect(w.modState().agents.mode).toBe('off');
  expect(w.toasts.at(-1)).toBe('The assigned agents are done (1/1): parallel agents are off again.');
});

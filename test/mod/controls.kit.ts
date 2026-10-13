// SPDX-License-Identifier: Apache-2.0
/**
 * The session's controls inside Claude Code's engine: the slash commands, the strip above the prompt and
 * its presses, the questions of the commands that need a value, the folder's last choice at the start.
 * The world beneath is in memory (see world.ts).
 */
import { test, expect, mock } from 'claude-code/testing';
import { world, DATA, HOME, PROJECT, SESSION } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args })) as any;
/** What a command sends on goes from a timer the moment it is done (see submitAsPerson): the clock moves it. */
const settle = async (w: { clock: { advance(ms: number): Promise<unknown> } }) => {
  await w.clock.advance(5);
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const measure = (week: number, now: number) =>
  ({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 10, resetsAt: new Date(now + 3600_000).toISOString() },
      { kind: 'seven_day', percentUsed: week, resetsAt: new Date(now + 5 * 86400_000).toISOString() },
    ],
    changed: ['rateLimits'],
  }) as any;
const band = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 } } as any;
/** A session record as the mod writes it. */
const record = (id: string, cwd: string, at: number, mode: string, interaction: string) =>
  JSON.stringify({
    v: 1,
    sessionId: id,
    aliveAt: at,
    cwd,
    modVersion: 'x',
    mode,
    turnMode: null,
    flowId: null,
    runId: null,
    nativePlan: null,
    interaction,
    project: null,
    weeklyTarget: null,
    weeklyTargetSource: null,
    wrapUp: false,
    resumeAt: null,
    approvals: [],
    blocks: {},
  });

test("the commands are declared at the start, in the person's language; the mode, the way of working, the menu and the budget act at once", async ($, on) => {
  const w = world(on, { lang: 'tr' });
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  await settle(w);
  expect(w.commands.map((c: any) => c.name)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'devam', 'continue', 'kota', 'quota', 'akis', 'flow']);
  const three = w.commands.find((c: any) => c.name === '3');
  expect(three.description).toMatch(/^Mod: 📐 plan/);
  expect(three.argumentHint).toBe('[metin]');
  expect(three.immediate).toBe(true);
  expect(w.commands.find((c: any) => c.name === 'kota').immediate).toBe(true);
  expect(w.commands.find((c: any) => c.name === 'devam').immediate).toBeUndefined();
  expect(w.commands.find((c: any) => c.name === '8').immediate).toBeUndefined();
});

test('/3 switches to plan mode, says so in its row, tells the model; a write into the project is then refused', async ($, on) => {
  const w = world(on);
  const r = await run($, '3');
  expect(r.text).toBe('Now: 📐 plan · manual');
  expect(r.context.join('\n')).toMatch(/The person ran "\/3", a command of terminal-code/);
  expect(r.context.join('\n')).toMatch(/plan mode: read and plan/);
  expect(w.modState().mode).toBe('plan');
  expect(w.toasts).toEqual([]);
  const write: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/a.ts`, content: 'x' } as any);
  expect(String(write.deny)).toMatch(/plan mode/);
  expect(w.events().some((e: any) => e.kind === 'keyword' && e.keyword === 'plan')).toBe(true);
});

test("/2 with text: research mode first, then the text goes on as the person's own message", async ($, on) => {
  const w = world(on);
  const r = await run($, '2', 'look into the cache');
  await settle(w);
  expect(r.text).toBe('Now: 🔍 research · manual');
  expect(w.modState().mode).toBe('research');
  expect(w.submitted).toContain('look into the cache');
});

test('/7 and /6 change the way of working and nothing else', async ($, on) => {
  const w = world(on);
  await run($, '3');
  const auto = await run($, '7');
  expect(auto.text).toBe('Now: 📐 plan · autonomous');
  expect(auto.context.join('\n')).toMatch(/The way of working is now autonomous/);
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'autonomous' });
  const manual = await run($, '6');
  expect(manual.context.join('\n')).toMatch(/The way of working is now manual: work step by step/);
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'manual' });
});

test('typed as the whole message, "plan" and "otonom" do what /3 and /7 do; in a sentence they are words', async ($, on) => {
  const w = world(on, { lang: 'tr' });
  await $.prompt.submit(typed('Bu bir plan'));
  expect(w.modState()?.mode ?? 'free').toBe('free');
  await $.prompt.submit(typed('plan'));
  await $.prompt.submit(typed('otonom'));
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'autonomous' });
  await $.prompt.submit(typed('Şimdi devam et ama manuel'));
  expect(w.modState().interaction).toBe('autonomous');
});

test('/0 says where the session stands and lists every command', async ($, on) => {
  world(on, { lang: 'tr' });
  await run($, '4');
  const r = await run($, '0');
  expect(r.text).toMatch(/^Şu an: 🔨 kod · manuel/);
  expect(r.text).toMatch(/\*\*\/4 🔨 kod\*\*/);
  expect(r.text).toMatch(/\/9 akış · \/devam · \/kota/);
});

test('/kota: a number or +N, asked when not given; a budget the week has passed is refused', async ($, on) => {
  const w = world(on, { answer: { typed: '70' } });
  await $.session.measure(measure(40, w.clock.now()));
  expect((await run($, 'kota', '29')).text).toBe('The week is at 40% already, past 29%. Give a higher number, or points above now: /kota +5.');
  expect((await run($, 'kota', 'abc')).text).toMatch(/A budget is a number from 0 to 100/);
  expect(w.modState()?.weeklyTarget ?? null).toBe(null);
  const set = await run($, 'kota', '70');
  expect(set.text).toBe('Weekly budget: 70%.');
  expect(set.context.join('\n')).toMatch(/weekly budget set to 70%/);
  expect(w.modState().weeklyTarget).toBe(70);
  const asked = await run($, 'quota');
  expect(w.asked.at(-1)).toBe('Weekly budget? The week is at 40% now.');
  expect(asked.text).toBe('Weekly budget: 70%.');
  await run($, 'kota', '+5');
  expect(w.modState().weeklyTarget).toBe(45);
  expect(w.modState().interaction).toBe('default');
});

test('/kota +5 with no quota reading yet says so; dismissing the question changes nothing', async ($, on) => {
  const w = world(on, { answer: 'nobody' });
  expect((await run($, 'kota', '+5')).text).toMatch(/no quota reading yet/);
  expect((await run($, 'kota')).text).toBe('Nothing changed.');
  expect(w.modState()?.weeklyTarget ?? null).toBe(null);
});

test('/devam lists every registered project and every folder; a number or a name continues it, with a budget', async ($, on) => {
  const w = world(on, { config: { projects: [{ id: 'terminal-code', names: ['terminal'], path: `${HOME}/dev/tc` }] } });
  w.write(`${HOME}/.claude.json`, JSON.stringify({ projects: { [`${HOME}/dev/tc`]: {}, [PROJECT]: {}, [`${HOME}/dev/notes`]: {} } }));
  const list = await run($, 'devam');
  expect(list.text).toMatch(/^What to continue \(3\)/);
  expect(list.text).toMatch(/^1\. terminal ★ · ~\/dev\/tc$/m);
  expect(list.text).toMatch(/^\d\. notes · ~\/dev\/notes$/m);
  const one = await run($, 'devam', '1');
  await settle(w);
  expect(one.text).toBe('Continuing terminal');
  expect(w.submitted.at(-1)).toBe('terminal continue');
  expect(w.modState()).toMatchObject({ interaction: 'autonomous', project: 'terminal-code' });
  // A folder that is not registered: its own project key, and the model is told where it is.
  await run($, 'continue', 'notes quota 30');
  await settle(w);
  expect(w.submitted.at(-1)).toBe('continue quota 30');
  expect(w.modState()).toMatchObject({ project: 'notes', weeklyTarget: 30, interaction: 'autonomous' });
  expect((await run($, 'devam', 'zzz')).text).toBe('Nothing is called "zzz". /devam lists everything.');
});

test('/9 asks which flow; the next message is its task, unless it is a keyword itself', async ($, on) => {
  const w = world(on, { answer: 'third' });
  const r = await run($, '9');
  expect(w.asked.at(-1)).toMatch(/^Which flow\?/);
  expect(r.text).toBe('Flow ready: 🔍 research only. Your next message is its task.');
  await $.prompt.submit(typed('Why is the cache slow?'));
  const id = w.modState().flowId;
  expect(id).toBeTruthy();
  const f = w.json(`${DATA}/flows/${id}/flow.json`);
  expect(f.variant).toBe('research');
  expect(f.task).toMatch(/Why is the cache slow\?/);
});

test('a keyword after /9 is that keyword: nothing starts', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  await run($, '9');
  await $.prompt.submit(typed('stop'));
  expect(w.modState().flowId ?? null).toBe(null);
});

test('/8 on native Windows says at once why it cannot start, and asks nothing', async ($, on) => {
  const w = world(on, { windows: true, answer: 'allow' });
  const r = await run($, '8');
  expect(r.text).toMatch(/^Full autonomy cannot start here:\n- /);
  expect(r.text).toMatch(/Windows/);
  expect(w.asked).toEqual([]);
});

test('the strip above the prompt: every control, those in effect marked, the full-auto one dim on Windows; a press runs the command', async ($, on) => {
  const w = world(on, { windows: true });
  const session = mock.session(on);
  await run($, '3');
  const ui = await $.ui.mount({ plugin: 'terminal-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key);
  expect(keys).toEqual(['strip-1', 'strip-2', 'strip-3', 'strip-4', 'strip-5', 'strip-6', 'strip-7', 'strip-8', 'strip-9', 'strip-0']);
  expect((await ui.find({ key: 'strip-3' }))?.props.variant).toBe('primary');
  expect((await ui.find({ key: 'strip-4' }))?.props.variant).toBeUndefined();
  expect((await ui.find({ type: 'Text', text: '8 full auto' }))?.props.dimColor).toBe(true);
  await ui.press({ key: 'strip-4' });
  expect(w.modState().mode).toBe('code');
  expect(w.toasts.at(-1)).toBe('Now: 🔨 code · manual');
  // What the press changed goes into the conversation at once, as a row the model reads (the brake mid-turn).
  const rows = session.appended().map((r: any) => JSON.stringify(r.message));
  expect(rows.some((t: string) => /The person chose \\"code\\" on terminal-code's mode strip/.test(t))).toBe(true);
  await ui.press({ key: 'strip-8' });
  expect(w.toasts.at(-1)).toMatch(/^Full autonomy cannot start here:/);
  await ui.unmount();
});

test('the strip yields to a question of Claude Code, and fits a narrow terminal', async ($, on) => {
  world(on);
  await run($, '0');
  // Under a question the plugin draws nothing and hands the band on (the kit has no engine beneath to draw it).
  let handedOn = '';
  try {
    await $.ui.mount({ plugin: 'terminal-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, hasSurvey: true } } as any);
  } catch (err) {
    handedOn = String(err);
  }
  expect(handedOn).toMatch(/no implementation for ui\.render/);
  const narrow = await $.ui.mount({ plugin: 'terminal-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, bodyColumns: 50 } } as any);
  expect((await narrow.findAll({ type: 'Button' })).length).toBe(10);
  expect(await narrow.find({ type: 'Text', text: '3📐' })).toBeDefined();
  await narrow.unmount();
});

test("a new session takes up this folder's last choice, says so, and tells the model with the first prompt", async ($, on) => {
  const w = world(on);
  const now = w.clock.now();
  w.write(`${DATA}/state/sessions/older.mod.json`, record('older', PROJECT, now - 5000, 'plan', 'full'));
  w.write(`${DATA}/state/sessions/elsewhere.mod.json`, record('elsewhere', `${HOME}/dev/other`, now - 1000, 'chat', 'manual'));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  expect(w.modState()).toMatchObject({ sessionId: SESSION, mode: 'plan', interaction: 'autonomous' });
  expect(w.toasts).toContain("This folder's last choice: 📐 plan · autonomous");
  const r: any = await $.prompt.submit(typed('hello'));
  expect(r.context.join('\n')).toMatch(/This session starts as the person last left this folder/);
  const again: any = await $.prompt.submit(typed('and then?'));
  expect(again.context.join('\n')).not.toMatch(/last left this folder/);
});

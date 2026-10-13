// SPDX-License-Identifier: Apache-2.0
/**
 * The session's controls inside Claude Code's engine: the slash commands, the strip above the prompt and
 * its presses, the questions of the commands that need a value, the folder's last choice at the start.
 * The world beneath is in memory (see world.ts).
 */
import { test, expect, mock } from 'claude-code/testing';
import { world, DATA, HOME, PROJECT, SESSION, WIN } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args })) as any;
/** A command as the engine stamps where it came from: the person's Enter, the bridge (a phone), the SDK. */
const runFrom = async ($: any, command: string, origin: { kind: string } | undefined, args = '') =>
  (await $.command.run({ command, args, ...(origin ? { origin } : {}) })) as any;
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

test('/0 from the phone says where the session stands and lists every command; it opens nothing', async ($, on) => {
  const w = world(on, { lang: 'tr' });
  await run($, '4');
  for (const origin of [{ kind: 'bridge' }, { kind: 'sdk' }, undefined]) {
    const r = await runFrom($, '0', origin);
    expect(r.text).toMatch(/^Şu an: 🔨 kod · manuel/);
    expect(r.text).toMatch(/\*\*\/4 🔨 kod\*\*/);
    expect(r.text).toMatch(/\/9 akış · \/devam · \/kota/);
    expect(r.text).toMatch(/Kontrol merkezi bilgisayarda açılır: orada yazılan \/0 onu yeni sekmede açar\.$/);
  }
  expect(w.ran).toEqual([]);
});

/** The installation's record of the Node.js and the command-line program, and the program on the disk. */
const installed = (w: any, cli = 'C:/dev/tc/dist/cli.mjs') => {
  w.write(`${WIN.DATA}/install/manifest.json`, JSON.stringify({ v: 1, app: 'terminal-code', node: 'C:/Program Files/nodejs/node.exe', cli }));
  w.write(cli, '// the control center');
};
const opensTab = (argv: string[]) => (argv[0] === 'wt.exe' ? { exitCode: 0 } : undefined);

test('/0 at the terminal opens the control center in a new tab of Windows Terminal, in the session folder', async ($, on) => {
  const w = world(on, { lang: 'tr', windows: true, env: { WT_SESSION: 'f7502808' }, programs: opensTab });
  installed(w);
  await run($, '4');
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe('Kontrol merkezi yeni sekmede açıldı.');
  expect(r.text.split('\n')[1]).toMatch(/^Şu an: 🔨 kod · manuel · /);
  expect(r.text.split('\n').length).toBe(2);
  expect(w.ran).toEqual([
    ['wt.exe', '-w', '0', 'new-tab', '--title', 'terminal-code', '-d', 'C:/dev/app', 'C:/Program Files/nodejs/node.exe', 'C:/dev/tc/dist/cli.mjs'],
  ]);
  expect(w.events().filter((e: any) => e.kind === 'center')).toEqual([expect.objectContaining({ via: 'windows-terminal', ok: true })]);
});

test('/0 that cannot open says why and how to open it by hand, then the menu', async ($, on) => {
  const w = world(on, {
    windows: true,
    env: { WT_SESSION: 'x' },
    programs: (argv) => (argv[0] === 'wt.exe' ? { exitCode: 1, stderr: 'boom\nmore' } : undefined),
  });
  installed(w);
  const failed = await runFrom($, '0', { kind: 'composer' });
  expect(failed.text.split('\n')[0]).toBe(
    'The control center did not open (windows-terminal: boom). Open it yourself: & "C:/Program Files/nodejs/node.exe" "C:/dev/tc/dist/cli.mjs"',
  );
  expect(failed.text).toMatch(/\n\nNow: free · manual/);
  // The reason is kept in the log too: a toast is cut to the width of the screen.
  expect(w.events().filter((e: any) => e.kind === 'center')).toEqual([
    expect.objectContaining({ via: 'windows-terminal', ok: false, reason: 'windows-terminal: boom' }),
  ]);
});

const APPS = 'C:/Users/ada/AppData/Local/Microsoft/WindowsApps';

test('/0 runs Windows Terminal by its alias, by the full path: Claude Code will not look it up by name in a session opened at home', async ($, on) => {
  // As Claude Code 2.1.296 does: a bare name found in the alias folder, under the session's folder, is refused.
  const refusedByName = (argv: string[]) =>
    argv[0] === `${APPS}/wt.exe` ? { exitCode: 0 } : argv[0] === 'wt.exe' ? { exitCode: 1, stderr: 'not found or is in an unsafe location' } : undefined;
  const w = world(on, { windows: true, startedAtHome: true, env: { WT_SESSION: 'x', LOCALAPPDATA: 'C:/Users/ada/AppData/Local' }, programs: refusedByName });
  installed(w);
  w.link(`${APPS}/wt.exe`);
  w.link(`${APPS}/winget.exe`);
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe('The control center opened in a new tab.');
  expect(w.ran).toEqual([
    [`${APPS}/wt.exe`, '-w', '0', 'new-tab', '--title', 'terminal-code', '-d', WIN.HOME, 'C:/Program Files/nodejs/node.exe', 'C:/dev/tc/dist/cli.mjs'],
  ]);
});

test('/0 does not run a program copied into the alias folder: only a link is an alias; the name goes to Claude Code', async ($, on) => {
  const w = world(on, { windows: true, startedAtHome: true, env: { WT_SESSION: 'x', LOCALAPPDATA: 'C:/Users/ada/AppData/Local' }, programs: opensTab });
  installed(w);
  w.write(`${APPS}/wt.exe`, 'MZ');
  await runFrom($, '0', { kind: 'composer' });
  expect(w.ran.map((argv) => argv[0])).toEqual(['wt.exe']);
});

test('/0 with no record of the installation, or a program that is gone, names the repair and runs nothing', async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: opensTab });
  const none = await runFrom($, '0', { kind: 'composer' });
  expect(none.text.split('\n')[0]).toBe('Where the control center is was not recorded at installation: "terminal-code doctor --fix" records it.');
  w.write(`${WIN.DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: 'C:/n.exe', cli: 'C:/gone/cli.mjs' }));
  const gone = await runFrom($, '0', { kind: 'composer' });
  expect(gone.text.split('\n')[0]).toBe(none.text.split('\n')[0]);
  expect(w.ran).toEqual([]);
});

test('/0 in a terminal that cannot be asked for a tab says the command to type, in its shell', async ($, on) => {
  const w = world(on, { programs: () => ({ exitCode: 0 }) });
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: '/usr/bin/node', cli: `${HOME}/tc/cli.mjs` }));
  w.write(`${HOME}/tc/cli.mjs`, '//');
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe(`No new tab can be opened from this terminal; open the control center yourself: '/usr/bin/node' '${HOME}/tc/cli.mjs'`);
  expect(w.ran).toEqual([]);
});

test('/0 inside tmux opens a window of that tmux, in the session folder', async ($, on) => {
  const w = world(on, { env: { TMUX: '/tmp/tmux-1000/default,1,0' }, programs: (argv) => (argv[0] === 'tmux' ? { exitCode: 0 } : undefined) });
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: '/usr/bin/node', cli: `${HOME}/tc/cli.mjs` }));
  w.write(`${HOME}/tc/cli.mjs`, '//');
  expect((await runFrom($, '0', { kind: 'composer' })).text.split('\n')[0]).toBe('The control center opened in a new tab.');
  expect(w.ran).toEqual([['tmux', 'new-window', '-n', 'terminal-code', '-c', PROJECT, `cd '${PROJECT}' && exec '/usr/bin/node' '${HOME}/tc/cli.mjs'`]]);
});

test('a press on "0" of the strip at the terminal opens the control center; on the phone it says the menu', async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: opensTab });
  installed(w);
  await run($, '3');
  const ui = await $.ui.mount({ plugin: 'terminal-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  await ui.press({ key: 'strip-0' });
  expect(w.toasts.at(-1)).toBe('The control center opened in a new tab.');
  expect(w.ran.length).toBe(1);
  await ui.unmount();
  const phone = await $.ui.mount({ plugin: 'terminal-code', surface: 'mobile', component: 'AbovePrompt', props: band } as any);
  await phone.press({ key: 'strip-0' });
  expect(w.toasts.at(-1)).toMatch(/^Now: 📐 plan · manual/);
  expect(w.ran.length).toBe(1);
  await phone.unmount();
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

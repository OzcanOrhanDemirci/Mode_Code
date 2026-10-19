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
  expect(w.commands.map((c: any) => c.name)).toEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '0',
    '00',
    'devam',
    'continue',
    'kota',
    'quota',
    'akis',
    'flow',
    'tam-otonom',
    'full-auto',
    'bypass',
    'dondur',
    'freeze',
    'ajan',
    'parallel',
    'neden',
    'why',
    'kapat',
    'close',
    'komutlar',
    'commands',
    // In Turkish, the short commands of the person's skills (core/skills.ts).
    'toparla',
    'durum',
    'devir',
    'geri-al',
    'dogrula',
    'bagimsiz-goz',
    'kota-rapor',
    'maliyet-tahmin',
    'paket',
    'guven-denetimi',
    'kemer',
    'guvenlik',
    'proje-tanit',
    'surum-hazirla',
    'pr-hazirla',
    'bagimlilik-guncelle',
    'hafiza-bakim',
    'ders-cikar',
    'oturum-ara',
    'sorun-bildir',
    'magaza-hazirlik',
    'canli-denetim',
    'iddia-denetimi',
    'turkce-metin',
    'derleme-kaynagi',
    'makine-haritasi',
  ]);
  expect(w.commands.find((c: any) => c.name === 'dogrula')).toMatchObject({ description: 'İşi bitti demeden önce taze kanıtla doğrula' });
  expect(w.commands.find((c: any) => c.name === 'komutlar')).toMatchObject({ immediate: true });
  expect(w.commands.find((c: any) => c.name === 'dondur')).toMatchObject({ immediate: true, argumentHint: '[klasör | kapat]' });
  const three = w.commands.find((c: any) => c.name === '3');
  expect(three.description).toMatch(/^Mod: 📐 plan/);
  expect(three.argumentHint).toBe('[metin]');
  expect(three.immediate).toBe(true);
  expect(w.commands.find((c: any) => c.name === 'kota').immediate).toBe(true);
  expect(w.commands.find((c: any) => c.name === '00')).toMatchObject({
    immediate: true,
    description: "Oturumu düzgünce kapatır: devir notu, eşitleme, çıkış; Windows'ta sekmesiyle birlikte",
  });
  expect(w.commands.find((c: any) => c.name === '00').argumentHint).toBeUndefined();
  expect(w.commands.find((c: any) => c.name === 'devam').immediate).toBeUndefined();
  expect(w.commands.find((c: any) => c.name === '8').immediate).toBe(true);
  expect(w.commands.find((c: any) => c.name === '6').immediate).toBeUndefined();
  expect(w.commands.find((c: any) => c.name === 'tam-otonom').immediate).toBeUndefined();
});

test('/3 switches to plan mode, says so in its row, tells the model; a write into the project is then refused', async ($, on) => {
  const w = world(on);
  const r = await run($, '3');
  expect(r.text).toBe('Now: 📐 plan · manual');
  expect(r.context.join('\n')).toMatch(/The person ran "\/3", a command of Mode_Code/);
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

test('/8 and /7 change the way of working and nothing else', async ($, on) => {
  const w = world(on);
  await run($, '3');
  const auto = await run($, '8');
  expect(auto.text).toBe('Now: 📐 plan · autonomous');
  expect(auto.context.join('\n')).toMatch(/The way of working is now autonomous/);
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'autonomous' });
  const manual = await run($, '7');
  expect(manual.context.join('\n')).toMatch(/The way of working is now manual: work step by step/);
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'manual' });
});

test('typed as the whole message, "plan" and "otonom" do what /3 and /8 do; in a sentence they are words', async ($, on) => {
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
    expect(r.text).toMatch(/\/5 serbest · \/6 akış$/m);
    expect(r.text).toMatch(/\/devam · \/kota · \/0 kokpit · \/00 kapat/);
    expect(r.text).toMatch(/Kokpit ve kontrol merkezi bilgisayarda açılır: orada yazılan \/0 kokpiti gösterir\.$/);
  }
  expect(w.ran).toEqual([]);
});

/** The installation's record of the Node.js and the command-line program, and the program on the disk. */
const installed = (w: any, cli = 'C:/dev/tc/dist/cli.mjs') => {
  w.write(`${WIN.DATA}/install/manifest.json`, JSON.stringify({ v: 1, app: 'mode-code', node: 'C:/Program Files/nodejs/node.exe', cli }));
  w.write(cli, '// the control center');
};
const opensTab = (argv: string[]) => (argv[0] === 'wt.exe' ? { exitCode: 0 } : undefined);

// Where no surface draws a pane (a session with no screen), /0 opens the control center itself, as before the cockpit;
// at a screen the cockpit's Control center does the same (test/mod/cockpit.kit.ts).
test('/0 with no pane to draw opens the control center in a new tab of Windows Terminal, in the session folder', async ($, on) => {
  const w = world(on, { lang: 'tr', windows: true, env: { WT_SESSION: 'f7502808' }, programs: opensTab, paneless: true });
  installed(w);
  await run($, '4');
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe('Kontrol merkezi yeni sekmede açıldı.');
  expect(r.text.split('\n')[1]).toMatch(/^Şu an: 🔨 kod · manuel · /);
  expect(r.text.split('\n').length).toBe(2);
  expect(w.ran).toEqual([
    ['wt.exe', '-w', '0', 'new-tab', '--title', 'Mode_Code', '-d', 'C:/dev/app', 'C:/Program Files/nodejs/node.exe', 'C:/dev/tc/dist/cli.mjs'],
  ]);
  expect(w.events().filter((e: any) => e.kind === 'center')).toEqual([expect.objectContaining({ via: 'windows-terminal', ok: true })]);
});

test('/0 that cannot open says why and how to open it by hand, then the menu', async ($, on) => {
  const w = world(on, {
    paneless: true,
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
  const w = world(on, {
    windows: true,
    startedAtHome: true,
    env: { WT_SESSION: 'x', LOCALAPPDATA: 'C:/Users/ada/AppData/Local' },
    programs: refusedByName,
    paneless: true,
  });
  installed(w);
  w.link(`${APPS}/wt.exe`);
  w.link(`${APPS}/winget.exe`);
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe('The control center opened in a new tab.');
  expect(w.ran).toEqual([
    [`${APPS}/wt.exe`, '-w', '0', 'new-tab', '--title', 'Mode_Code', '-d', WIN.HOME, 'C:/Program Files/nodejs/node.exe', 'C:/dev/tc/dist/cli.mjs'],
  ]);
});

test('/0 does not run a program copied into the alias folder: only a link is an alias; the name goes to Claude Code', async ($, on) => {
  const w = world(on, {
    windows: true,
    startedAtHome: true,
    env: { WT_SESSION: 'x', LOCALAPPDATA: 'C:/Users/ada/AppData/Local' },
    programs: opensTab,
    paneless: true,
  });
  installed(w);
  w.write(`${APPS}/wt.exe`, 'MZ');
  await runFrom($, '0', { kind: 'composer' });
  expect(w.ran.map((argv) => argv[0])).toEqual(['wt.exe']);
});

test('/0 with no record of the installation, or a program that is gone, names the repair and runs nothing', async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: opensTab, paneless: true });
  const none = await runFrom($, '0', { kind: 'composer' });
  expect(none.text.split('\n')[0]).toBe('Where the control center is was not recorded at installation: "mode-code doctor --fix" records it.');
  w.write(`${WIN.DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: 'C:/n.exe', cli: 'C:/gone/cli.mjs' }));
  const gone = await runFrom($, '0', { kind: 'composer' });
  expect(gone.text.split('\n')[0]).toBe(none.text.split('\n')[0]);
  expect(w.ran).toEqual([]);
});

test('/0 in a terminal that cannot be asked for a tab says the command to type, in its shell', async ($, on) => {
  const w = world(on, { programs: () => ({ exitCode: 0 }), paneless: true });
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: '/usr/bin/node', cli: `${HOME}/tc/cli.mjs` }));
  w.write(`${HOME}/tc/cli.mjs`, '//');
  const r = await runFrom($, '0', { kind: 'composer' });
  expect(r.text.split('\n')[0]).toBe(`No new tab can be opened from this terminal; open the control center yourself: '/usr/bin/node' '${HOME}/tc/cli.mjs'`);
  expect(w.ran).toEqual([]);
});

test('/0 inside tmux opens a window of that tmux, in the session folder', async ($, on) => {
  const w = world(on, { env: { TMUX: '/tmp/tmux-1000/default,1,0' }, programs: (argv) => (argv[0] === 'tmux' ? { exitCode: 0 } : undefined), paneless: true });
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, node: '/usr/bin/node', cli: `${HOME}/tc/cli.mjs` }));
  w.write(`${HOME}/tc/cli.mjs`, '//');
  expect((await runFrom($, '0', { kind: 'composer' })).text.split('\n')[0]).toBe('The control center opened in a new tab.');
  expect(w.ran).toEqual([['tmux', 'new-window', '-n', 'Mode_Code', '-c', PROJECT, `cd '${PROJECT}' && exec '/usr/bin/node' '${HOME}/tc/cli.mjs'`]]);
});

test('a press on "0" of the strip at the terminal shows the cockpit, and again hides it; on the phone it says the menu', async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: opensTab });
  installed(w);
  await run($, '3');
  const ui: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  const zero = async () => textOf(node(await ui.drawn(), 'strip-0'));
  expect(await zero()).toBe('0 ≡ cockpit ○');
  const toasts = w.toasts.length;
  await ui.press({ key: 'strip-0' });
  // The cockpit appearing is what the press says: no toast, nothing run, and the switch lit.
  expect(w.panes).toEqual(['cockpit']);
  expect(w.toasts.length).toBe(toasts);
  expect(await zero()).toBe('0 ≡ cockpit ●');
  await ui.press({ key: 'strip-0' });
  expect(w.panes).toEqual([]);
  expect(await zero()).toBe('0 ≡ cockpit ○');
  expect(w.ran.length).toBe(0);
  await ui.unmount();
  const phone = await $.ui.mount({ plugin: 'mode-code', surface: 'mobile', component: 'AbovePrompt', props: band } as any);
  await phone.press({ key: 'strip-0' });
  expect(w.toasts.at(-1)).toMatch(/^Now: 📐 plan · manual/);
  expect(w.ran.length).toBe(0);
  expect(w.panes).toEqual([]);
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
  const w = world(on, { config: { projects: [{ id: 'mode-code', names: ['terminal'], path: `${HOME}/dev/tc` }] } });
  w.write(`${HOME}/.claude.json`, JSON.stringify({ projects: { [`${HOME}/dev/tc`]: {}, [PROJECT]: {}, [`${HOME}/dev/notes`]: {} } }));
  const list = await run($, 'devam');
  expect(list.text).toMatch(/^What to continue \(3\)/);
  expect(list.text).toMatch(/^1\. terminal ★ · ~\/dev\/tc$/m);
  expect(list.text).toMatch(/^\d\. notes · ~\/dev\/notes$/m);
  const one = await run($, 'devam', '1');
  await settle(w);
  expect(one.text).toBe('Continuing terminal');
  expect(w.submitted.at(-1)).toBe('terminal continue');
  // Continuing picks the project; the way of working stays as the person set it.
  expect(w.modState()).toMatchObject({ interaction: 'default', mode: 'free', project: 'mode-code' });
  // A folder that is not registered: its own project key, and the model is told where it is.
  await run($, '8');
  await run($, '1');
  await run($, 'continue', 'notes quota 30');
  await settle(w);
  expect(w.submitted.at(-1)).toBe('continue quota 30');
  expect(w.modState()).toMatchObject({ project: 'notes', weeklyTarget: 30, interaction: 'autonomous', mode: 'chat' });
  expect((await run($, 'devam', 'zzz')).text).toBe('Nothing is called "zzz". /devam lists everything.');
});

test('/6 asks which flow; the next message is its task, unless it is a keyword itself', async ($, on) => {
  const w = world(on, { answer: 'third' });
  const r = await run($, '6');
  expect(w.asked.at(-1)).toMatch(/^Which flow\?/);
  expect(r.text).toBe('Flow ready: 🔍 research only. Your next message is its task.');
  await $.prompt.submit(typed('Why is the cache slow?'));
  const id = w.modState().flowId;
  expect(id).toBeTruthy();
  const f = w.json(`${DATA}/flows/${id}/flow.json`);
  expect(f.variant).toBe('research');
  expect(f.task).toMatch(/Why is the cache slow\?/);
});

test('a keyword after /6 is that keyword: nothing starts', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  await run($, '6');
  await $.prompt.submit(typed('stop'));
  expect(w.modState().flowId ?? null).toBe(null);
});

test('/tam-otonom says at once why it cannot start, and asks nothing; on native Windows the platform is no reason', async ($, on) => {
  const w = world(on, { windows: true, answer: 'allow' });
  const r = await runFrom($, 'full-auto', { kind: 'composer' });
  expect(r.text).toMatch(/^Full autonomy cannot start here:\n- /);
  expect(r.text).toMatch(/Turned on/);
  expect(r.text).not.toMatch(/Platform/);
  expect(w.asked).toEqual([]);
});

test('the strip above the prompt: every control, those in effect marked; full autonomy only once turned on, on Windows too; a press runs the command', async ($, on) => {
  const w = world(on, { windows: true, config: { autonomy: { enabled: true } } });
  const session = mock.session(on);
  await run($, '3');
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key);
  // Every control, then under the strip the count of this session's activity: a press opens it.
  expect(keys).toEqual([
    'strip-1',
    'strip-2',
    'strip-3',
    'strip-4',
    'strip-5',
    'strip-6',
    'strip-7',
    'strip-8',
    'strip-full-auto',
    'strip-0',
    'strip-00',
    'strip-activity',
  ]);
  expect((await ui.find({ key: 'strip-3' }))?.props.variant).toBe('primary');
  expect((await ui.find({ key: 'strip-4' }))?.props.variant).toBeUndefined();
  expect((await ui.find({ type: 'Text', text: 'full auto' }))?.props.dimColor).toBeFalsy();
  // The menu and closing stand apart: the room before them grows, so they end the row.
  const pushes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^push-/.test(String(b.key)));
  expect(pushes.map((b: any) => b.props)).toEqual([expect.objectContaining({ flexGrow: 1, minWidth: 2 })]);
  expect((await ui.find({ key: 'strip-rows' }))?.props).toMatchObject({ flexGrow: 1 });
  await ui.press({ key: 'strip-4' });
  expect(w.modState().mode).toBe('code');
  expect(w.toasts.at(-1)).toBe('Now: 🔨 code · manual');
  // What the press changed reaches the model a moment later, as a row it reads (the brake mid-turn).
  const said = () => session.appended().map((r: any) => JSON.stringify(r.message));
  expect(said().some((t: string) => /Mode_Code's mode strip/.test(t))).toBe(false);
  await w.clock.advance(3000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(said().some((t: string) => /The person chose \\"code\\" on Mode_Code's mode strip/.test(t))).toBe(true);
  await ui.press({ key: 'strip-full-auto' });
  // A toast is one line: how many reasons, and where they are.
  expect(w.toasts.at(-1)).toBe('Full autonomy cannot start, for 2 reasons. Type /full-auto to see them.');
  await ui.unmount();
});

test('a press that cannot start full autonomy for one reason says it in plain words, with what to do', async ($, on) => {
  const w = world(on, { lang: 'tr', windows: true, promptMode: 'bypassPermissions', config: { autonomy: { enabled: true } } });
  // A prompt runs the safety-net hook; the session's folder is no git project.
  await $.prompt.submit(typed('merhaba'));
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  await ui.press({ key: 'strip-tam-otonom' });
  expect(w.toasts.at(-1)).toBe("Tam otonom açılamıyor: bu klasör bir git projesi değil. Claude Code'u projenin klasöründe aç.");
  await ui.unmount();
});

test('full autonomy is not on the strip until it is turned on', async ($, on) => {
  world(on);
  await run($, '7');
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key);
  expect(keys).toEqual(['strip-1', 'strip-2', 'strip-3', 'strip-4', 'strip-5', 'strip-6', 'strip-7', 'strip-8', 'strip-0', 'strip-00', 'strip-activity']);
  expect(await ui.find({ type: 'Text', text: 'full auto' })).toBeUndefined();
  await ui.unmount();
});

test('presses close together: the model hears the last of each kind once, a moment after the last press, or with the next prompt', async ($, on) => {
  const w = world(on);
  const session = mock.session(on);
  await run($, '5');
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  await ui.press({ key: 'strip-1' });
  await ui.press({ key: 'strip-2' });
  await ui.press({ key: 'strip-4' });
  await ui.press({ key: 'strip-8' });
  expect(w.modState()).toMatchObject({ mode: 'code', interaction: 'autonomous' });
  expect(session.appended().length).toBe(0);
  await w.clock.advance(3000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const rows = session.appended().map((r: any) => JSON.stringify(r.message));
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatch(/chose \\"code\\"/);
  expect(rows[0]).toMatch(/autonomous/);
  expect(rows[0]).not.toMatch(/chose \\"chat\\"|chose \\"research\\"/);
  // Pressed and then a prompt sent before the moment passed: the note goes with the prompt, and only there.
  await ui.press({ key: 'strip-3' });
  const sent: any = await $.prompt.submit(typed('go on'));
  expect((sent.context ?? []).join('\n')).toMatch(/chose "plan"/);
  await w.clock.advance(3000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(session.appended().length).toBe(1);
  await ui.unmount();
});

test('the flow button: off asks and arms; armed, pressed again it is put away; on, it closes; paused, it goes on', async ($, on) => {
  const w = world(on, { answer: 'third' });
  const strip = async () => {
    const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, isWorking: true } } as any);
    const drawn = { six: (await ui.findAll({ type: 'Text' })).find((t: any) => /^6 flow/.test(t.text)), two: await ui.find({ key: 'strip-2' }) };
    await ui.unmount();
    return drawn;
  };
  await run($, '6');
  expect((await strip()).six).toMatchObject({ text: '6 flow ✎', props: { inverse: true } });
  expect((await run($, '6')).text).toBe('Flow put away: your next message is an ordinary one.');
  expect((await strip()).six?.text).toBe('6 flow…');
  await run($, '6');
  await $.prompt.submit(typed('Why is the cache slow?'));
  const id = w.modState().flowId;
  // Working: the flow lit, research (its step's mode) breathing on the module, not a button.
  const working = await strip();
  expect(working.six).toMatchObject({ text: '6 flow 1/1', props: { inverse: true } });
  expect(working.two?.type).toBe('Client');
  expect(working.two?.props).toMatchObject({ module: expect.stringMatching(/strip-pulse\.js$/), props: { id: '2', label: '2 🔍 research' } });
  // Another mode: the flow pauses and says so on its button; pressed, it goes on.
  await run($, '1');
  expect(w.json(`${DATA}/flows/${id}/flow.json`).status).toBe('paused');
  expect((await strip()).six?.text).toBe('6 flow ⏸ 1/1');
  await run($, '6');
  expect(w.json(`${DATA}/flows/${id}/flow.json`).status).toBe('active');
  // On, pressed: it closes, its record kept.
  const closed = await run($, '6');
  expect(closed.text).toMatch(/^Flow closed\./);
  expect(w.json(`${DATA}/flows/${id}/flow.json`).status).toBe('canceled');
  expect((await strip()).six?.text).toBe('6 flow…');
});

test('the breathing control breathes on its own clock, and a press on it does what a press does', async ($, on) => {
  const w = world(on, { answer: 'third' });
  await run($, '6');
  await $.prompt.submit(typed('Why is the cache slow?'));
  // Between turns, where the person may be typing, it is marked, not breathing: a frame blinks the cursor.
  const between = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  expect((await between.find({ key: 'strip-2' }))?.type).toBe('Button');
  expect((await between.find({ type: 'Text', text: '2 🔍 research' }))?.props).toMatchObject({ bold: true, underline: true });
  await between.unmount();
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, isWorking: true } } as any);
  // Gray, then white, never filled: a filled control is a lit one, and the flow is the one lit.
  const look = async () => (await ui.findAll({ type: 'Text', in: 'strip-2' })).map((t: any) => [t.text, !!t.props.inverse, !!t.props.dimColor, !!t.props.bold]);
  const gray = [['2 🔍 research', false, true, false]];
  const white = [['2 🔍 research', false, false, true]];
  expect(await look()).toEqual(gray);
  await (ui as any).advance(600);
  expect(await look()).toEqual(white);
  await (ui as any).advance(600);
  expect(await look()).toEqual(gray);
  // Pressed: the same press as a button's. A mode chosen while the flow works pauses it.
  await (ui as any).pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'strip-2' } as any);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(w.modState().mode).toBe('research');
  expect(w.json(`${DATA}/flows/${w.modState().flowId}/flow.json`).status).toBe('paused');
  // Anything else posted is left alone.
  await (ui as any).post({ press: 'rm -rf /' }, { in: 'strip-2' }).catch(() => undefined);
  expect(w.modState().mode).toBe('research');
  await ui.unmount();
});

test('with less motion asked for, the working step is marked, not breathing', async ($, on) => {
  world(on, { answer: 'third', config: { accessibility: { reduceMotion: true } } });
  await run($, '6');
  await $.prompt.submit(typed('Why is the cache slow?'));
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  expect((await ui.find({ key: 'strip-2' }))?.type).toBe('Button');
  expect((await ui.find({ type: 'Text', text: '2 🔍 research' }))?.props).toMatchObject({ bold: true, underline: true });
  await ui.unmount();
});

test('the strip yields to a question of Claude Code, and fits a narrow terminal', async ($, on) => {
  world(on);
  await run($, '0');
  // Under a question the plugin draws nothing and hands the band on (the kit has no engine beneath to draw it).
  let handedOn = '';
  try {
    await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, hasSurvey: true } } as any);
  } catch (err) {
    handedOn = String(err);
  }
  expect(handedOn).toMatch(/no implementation for ui\.render/);
  const narrow = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, bodyColumns: 50 } } as any);
  expect((await narrow.findAll({ type: 'Button' })).length).toBe(10);
  expect(await narrow.find({ type: 'Text', text: '3📐' })).toBeDefined();
  await narrow.unmount();
});

/** The drawn tree's node keyed `key` (the kit's `drawn()` keeps each element's hover and key). */
function node(tree: any, key: string): any {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.key === key || tree.props?.key === key) return tree;
  for (const c of tree.children ?? []) {
    const found = node(c, key);
    if (found) return found;
  }
  return null;
}

/** The text of a drawn node, its children in order. */
function textOf(n: any): string {
  if (typeof n === 'string') return n;
  // A Button of one string child carries it as its label.
  if (!n?.children?.length && typeof n?.props?.label === 'string') return n.props.label;
  return (n?.children ?? []).map(textOf).join('');
}

/** Every word a drawing shows, its wrapped lines joined back: a sentence the window wraps reads whole. */
async function words(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' }))
    .map((t: any) => String(t.text))
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** A move of the band's focus ring onto `element`, as the person's Tab makes it (the engine beneath answers it). */
const focusOn = ($: any, element: string) =>
  $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'mode-code', element, origin: { kind: 'person' } });

test("under the strip: what Claude does now, in words; the pointer on a control, or on Mo, shows that one's card there", async ($, on) => {
  world(on, { config: { bypass: { enabled: true } } });
  await run($, '3');
  const ui: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  const drawn = await ui.drawn();
  const say = node(drawn, 'strip-say');
  // One row at this width, of a fixed height: a card shown in its place moves nothing under the pointer.
  expect(say.props).toMatchObject({ flexDirection: 'row', height: 1, overflow: 'hidden', width: 160 });
  expect(textOf(node(drawn, 'say-text'))).toBe('📐 plan: reads and plans; writes the plan only · manual: one step, then it waits for you');
  // Every control's card lies in the line unseen; the pointer on that control reveals it (one hover group).
  const cards = new Map<string, any>(say.children.filter((c: any) => c.hover?.scope).map((c: any) => [c.hover.scope, c]));
  const controls = ['1', '2', '3', '4', '5', '6', '7', '8', 'bypass', '0', '00'];
  for (const id of controls) {
    const scope = node(drawn, `strip-${id}`)?.hover?.scope;
    expect(scope).toBe(`card-${id}`);
    expect(cards.get(scope)).toMatchObject({ props: { display: 'none' }, hover: { display: 'flex', scope } });
  }
  // Each card: how it is now, what a press does, how it is taken back, its command.
  expect(textOf(cards.get('card-3'))).toBe(
    '◉ In effect: Claude reads and plans, and writes the plan only; nothing else changes. · Undo: pick another mode · /3',
  );
  expect(textOf(cards.get('card-4'))).toBe('Press: Claude develops, tests and commits in the project, inside the safety belt. · Undo: pick another mode · /4');
  expect(textOf(cards.get('card-bypass'))).toMatch(/^○ Off\. Press: Its window says what bypass lifts and until when, .+ · Undo: press it again · \/bypass$/);
  expect(textOf(cards.get('card-00'))).toMatch(/^Press: Writes the handoff note.+ · Cannot be undone · \/00$/);
  // Mo: its state in words, and what a click on it does.
  expect(node(drawn, 'mo-at')?.hover?.scope).toBe('card-mo');
  expect(textOf(cards.get('card-mo'))).toBe('Mo: nothing is at work; Claude waits for you. · click: what happened');
  await ui.unmount();
  // Narrower than 120 columns the line is two rows tall, so a card is read whole.
  const narrow: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, bodyColumns: 90 } } as any);
  expect(node(await narrow.drawn(), 'strip-say')?.props).toMatchObject({ height: 2, width: 90 });
  await narrow.unmount();
});

test('the keyboard on the strip: the card of the control under the focus says itself in the line; typing, or a while, takes it away', async ($, on) => {
  const w = world(on, { answer: 'third' });
  on('ui.focus', () => ({}));
  await run($, '6');
  await $.prompt.submit(typed('Why is the cache slow?'));
  const ui: any = await $.ui.mount({
    plugin: 'mode-code',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { ...band, isWorking: true },
  } as any);
  const said = async () => textOf(node(await ui.drawn(), 'say-text'));
  expect((await ui.find({ key: 'strip-2' }))?.type).toBe('Client');
  await focusOn($, 'strip-1');
  expect(await said()).toBe('▸ Press: Claude talks with you and changes no file, in the project or in the memory. · Undo: pick another mode · /1');
  // A module takes no focus: under the keyboard the breathing step is a button too, so Tab reaches it.
  expect((await ui.find({ key: 'strip-2' }))?.type).toBe('Button');
  await focusOn($, 'strip-6');
  expect(await said()).toBe('▸ Press: The flow closes; its record and what it wrote stay. · Undo: "flow cancel" · /6');
  // The focus on what has no card (the activity count): the line says what Claude does now again.
  await focusOn($, 'strip-activity');
  expect(await said()).toMatch(/^🔍 research: reads and searches/);
  // The person types at the prompt: the keyboard has left the strip.
  await focusOn($, 'strip-4');
  expect(await said()).toMatch(/^▸ Press: Claude develops/);
  await $.prompt.submit(typed('Go on.'));
  expect(await said()).not.toMatch(/^▸/);
  // Esc back to the prompt is not told: the card leaves by itself.
  await focusOn($, 'strip-4');
  expect(await said()).toMatch(/^▸/);
  await w.clock.advance(21_000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(await said()).not.toMatch(/^▸/);
  await ui.unmount();
});

test("the count of this session's activity, and Mo, open the control center at its Activity page; from the phone they say where it opens", async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: opensTab });
  installed(w);
  await run($, '3');
  const ui: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  expect(textOf(node(await ui.drawn(), 'strip-activity'))).toMatch(/^activity \d+…$/);
  await ui.press({ key: 'strip-activity' });
  expect(w.ran.at(-1)).toEqual([
    'wt.exe',
    '-w',
    '0',
    'new-tab',
    '--title',
    'Mode_Code',
    '-d',
    'C:/dev/app',
    'C:/Program Files/nodejs/node.exe',
    'C:/dev/tc/dist/cli.mjs',
    'open',
    'home/activity',
  ]);
  expect(w.toasts.at(-1)).toBe('The control center opened in a new tab.');
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'mo' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(w.ran.length).toBe(2);
  expect(w.ran.at(-1)?.slice(-2)).toEqual(['open', 'home/activity']);
  await ui.unmount();
  const desk: any = await $.ui.mount({ plugin: 'mode-code', surface: 'desktop', component: 'AbovePrompt', props: band } as any);
  await desk.press({ key: 'strip-activity' });
  expect(w.toasts.at(-1)).toBe('The cockpit and the control center open on the computer: /0 typed there shows the cockpit.');
  expect(w.ran.length).toBe(2);
  await desk.unmount();
});

test("an agent's conversation in view: the line under the strip says so, and leads back to the main one", async ($, on) => {
  world(on);
  const views: unknown[] = [];
  on('ui.view', (_$: any, e: any) => {
    views.push(e);
    return { value: {} };
  });
  await run($, '3');
  const ui: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: { ...band, view: { agentId: 'a1' } } } as any);
  expect(textOf(node(await ui.drawn(), 'say-text'))).toBe("👥 You are looking at an agent's conversation; your next Enter goes to it.");
  await ui.press({ key: 'strip-main' });
  expect(views).toEqual([{}]);
  await ui.unmount();
});

const PANE = { title: '', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} } as any;

test('/kota at the computer: a window to pick or type the budget, what it will hold said first; one the week passed is said in it', async ($, on) => {
  const w = world(on);
  await $.session.measure(measure(40, w.clock.now()));
  const r = await runFrom($, 'kota', { kind: 'composer' });
  expect(r.text).toBe('Weekly budget');
  expect(w.panes).toEqual(['weekly-budget']);
  expect(w.asked).toEqual([]);
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'weekly-budget', props: PANE } as any);
  expect(await pane.findAll({ type: 'Select' })).toEqual([]);
  const said = await words(pane);
  expect(said).toContain('Now The week is at 40% · no budget of your own (the limit is 99%)');
  expect(said).toContain('If you apply This session wraps up as the week nears 50% and stops there.');
  expect(textOf(node(await pane.drawn(), 'quota-+10'))).toBe('◉ +10 → 50%');
  await pane.press({ key: 'quota-+20' });
  expect(await words(pane)).toContain('nears 60%');
  // Typed, a number the week has passed: said in the window, which stays.
  await pane.input({ key: 'quota-typed', text: '30' });
  expect(await words(pane)).toContain('✗ The week is at 40% already, past 30%.');
  expect(w.modState()?.weeklyTarget ?? null).toBe(null);
  expect(w.panes).toEqual(['weekly-budget']);
  await pane.input({ key: 'quota-typed', text: '', kind: 'change' });
  await pane.press({ key: 'apply' });
  expect(w.panes).toEqual([]);
  expect(w.modState().weeklyTarget).toBe(60);
  expect(w.toasts.at(-1)).toBe('Weekly budget: 60%.');
  await pane.unmount();
});

test('/6 at the computer: a window to pick the flow; a task written there starts it, none leaves the next message to be its task', async ($, on) => {
  const w = world(on);
  expect((await runFrom($, '6', { kind: 'composer' })).text).toBe('Start a flow');
  const pane: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'Pane', requestId: 'start-flow', props: PANE } as any);
  expect(await words(pane)).toContain('If you apply With a task written here the flow starts now; without one, your next message is its task.');
  await pane.press({ key: 'flow-research' });
  expect(textOf(node(await pane.drawn(), 'flow-research'))).toBe('◉ 🔍 research only');
  await pane.press({ key: 'apply' });
  expect(w.panes).toEqual([]);
  expect(w.toasts.at(-1)).toBe('Flow ready: 🔍 research only. Your next message is its task.');
  await $.prompt.submit(typed('Why is the cache slow?'));
  expect(w.json(`${DATA}/flows/${w.modState().flowId}/flow.json`).variant).toBe('research');
  await run($, '6');
  // A task written in the window: the flow starts with it at once, as the person's own message.
  await runFrom($, '6', { kind: 'composer' });
  await pane.input({ key: 'flow-task', text: 'Make the cold start faster.' });
  await settle(w);
  expect(w.submitted.at(-1)).toBe('Make the cold start faster.\n\nflow research');
  await pane.unmount();
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
  expect(r.context.join('\n')).toMatch(
    /This session took up the mode and the way of working last used in this folder\. What holds now.*Mode, plan mode.*Way of working, autonomous/,
  );
  const again: any = await $.prompt.submit(typed('and then?'));
  expect(again.context.join('\n')).not.toMatch(/last used in this folder/);
});

test('a manual the person picked is their last choice too; free with nothing picked is not one', async ($, on) => {
  const w = world(on);
  const now = w.clock.now();
  w.write(`${DATA}/state/sessions/older.mod.json`, record('older', PROJECT, now - 5000, 'free', 'manual'));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  expect(w.modState()).toMatchObject({ mode: 'free', interaction: 'manual' });
  const r: any = await $.prompt.submit(typed('hello'));
  expect(r.context.join('\n')).toMatch(/Mode, free mode.*Way of working, manual: work step by step/);
});

test('nothing to take up when the last session here was never set', async ($, on) => {
  const w = world(on);
  const now = w.clock.now();
  w.write(`${DATA}/state/sessions/older.mod.json`, record('older', PROJECT, now - 5000, 'free', 'default'));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  expect(w.modState()).toMatchObject({ mode: 'free', interaction: 'default' });
  expect(w.toasts.some((t: string) => /last choice/.test(t))).toBe(false);
  const r: any = await $.prompt.submit(typed('hello'));
  expect((r.context ?? []).join('\n')).not.toMatch(/last used in this folder/);
});

test('the first prompt tells what holds after the presses and its own keyword, never the choice it started from', async ($, on) => {
  // The person, 2026-10-13: the session took up code · manual, they pressed chat, then typed "terminal devam";
  // the model read "chat, manual" and "continue: work autonomously" together, and the strip went free · autonomous.
  const w = world(on, { config: { projects: [{ id: 'mode-code', names: ['terminal'] }] } });
  const now = w.clock.now();
  w.write(`${DATA}/state/sessions/older.mod.json`, record('older', PROJECT, now - 5000, 'code', 'manual'));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  await run($, '1');
  const r: any = await $.prompt.submit(typed('terminal devam'));
  const said = r.context.join('\n');
  expect(w.modState()).toMatchObject({ mode: 'chat', interaction: 'manual', project: 'mode-code' });
  expect(said).toMatch(/Keyword "continue" for project "terminal": pick the work up where it stopped\. The keyword changes neither/);
  expect(said).toMatch(/Mode, chat mode: conversation only.*Way of working, manual: work step by step/);
  // One statement of what holds: the continue note says it, so the folder's note does not repeat it.
  expect(said).not.toMatch(/last used in this folder|autonom|starts as/);
});

test("a mode typed as the first prompt: the folder's note comes first and already says the new mode", async ($, on) => {
  const w = world(on);
  const now = w.clock.now();
  w.write(`${DATA}/state/sessions/older.mod.json`, record('older', PROJECT, now - 5000, 'code', 'autonomous'));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const r: any = await $.prompt.submit(typed('plan'));
  const notes: string[] = r.context;
  const folder = notes.findIndex((n) => /last used in this folder/.test(n));
  const keyword = notes.findIndex((n) => /Keyword "plan"/.test(n));
  expect(folder >= 0 && keyword > folder).toBe(true);
  expect(notes[folder]).toMatch(/Mode, plan mode.*Way of working, autonomous/);
  expect(w.modState()).toMatchObject({ mode: 'plan', interaction: 'autonomous' });
});

// ── closing: /00 ──

/** Claude Code beneath: the exit the plugin asks for (as /exit), the turns it runs and one it stops. */
const engine = (on: any, exit: () => any = () => ({ text: '' })) => {
  const exits: any[] = [];
  const aborted: string[] = [];
  on('command.run', { command: 'exit' }, (_$: any, e: any) => {
    exits.push(e);
    return exit();
  });
  on('turn.abort', (_$: any, e: any) => {
    aborted.push(e.turnId);
    return { value: undefined };
  });
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  return { exits, aborted };
};
/** The starter of the helper that closes the tab: Windows PowerShell, which says it is armed. */
const starter = (argv: string[]) => (/powershell\.exe$/i.test(argv[0]!) ? { exitCode: 0, stdout: 'armed pwsh.exe\r\n' } : undefined);
/** The close runs from a timer, step after step: the clock moves it, and every step it awaits settles. */
const closed = async (w: any, done: () => boolean) => {
  await w.clock.advance(5);
  for (let i = 0; i < 400 && !done(); i++) await Promise.resolve();
};

test('/00 closes an idle session at once: it says so, starts the helper that closes the tab, then Claude Code exits as for /exit', async ($, on) => {
  const w = world(on, { lang: 'tr', windows: true, env: { SYSTEMROOT: 'C:\\WINDOWS' }, programs: starter });
  const cc = engine(on);
  const r = await run($, '00');
  expect(r.text).toBe('Oturum kapanıyor: önce devir notu ve eşitleme, sonra Claude Code çıkar ve sekmesi kapanır.');
  expect(w.asked).toEqual([]);
  // Not from the command's own hook, which Claude Code refuses: from a timer, once the row is shown.
  expect(cc.exits).toEqual([]);
  await closed(w, () => cc.exits.length > 0);
  expect(w.ran.map((argv) => argv.slice(0, 5))).toEqual([
    ['C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'],
  ]);
  expect(cc.exits.length).toBe(1);
  expect(cc.aborted).toEqual([]);
  expect(w.events().filter((e: any) => e.kind === 'close')).toEqual([
    expect.objectContaining({ via: 'command', busy: false, tab: 'armed', detail: 'pwsh.exe' }),
  ]);
  // Once is enough: a second one while it closes asks for nothing more.
  expect((await run($, 'kapat')).text).toBe('Oturum zaten kapanıyor.');
  await closed(w, () => false);
  expect(cc.exits.length).toBe(1);
  // The end itself still marks the session ended.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: {} } as any);
  expect(w.modState().endedAt).toBe(w.clock.now());
});

test('/00 while Claude works asks first; "Cancel" leaves the work and the session as they were', async ($, on) => {
  const w = world(on, { answer: 'block' });
  const cc = engine(on);
  await $.turn.start({ text: 'Refactor it.', turnId: 't1' } as any);
  expect((await run($, '00')).text).toBe('Nothing changed.');
  expect(w.asked).toEqual(['Claude is working right now. Stop it and close the session?']);
  await closed(w, () => false);
  expect([cc.exits, cc.aborted]).toEqual([[], []]);
  // The main turn's end is the end of the work; a subagent's turn is not Claude at work in the session.
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  await $.turn.start({ text: 'look', turnId: 'a1', agentId: 'agent-1' } as any);
  await run($, '00');
  expect(w.asked.length).toBe(1);
});

test('/00 while Claude works, confirmed: the turn is stopped, then the session closes; off Windows the tab is left to the person', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  const cc = engine(on);
  await $.turn.start({ text: 'Refactor it.', turnId: 't7' } as any);
  const r = await run($, '00');
  expect(w.asked).toEqual(['Claude is working right now. Stop it and close the session?']);
  expect(r.text).toBe('The session is closing: the handoff note and the sync first, then Claude Code exits. Close the tab yourself.');
  await closed(w, () => cc.exits.length > 0);
  expect(cc.aborted).toEqual(['t7']);
  expect(cc.exits.length).toBe(1);
  expect(w.ran).toEqual([]);
  expect(w.events().filter((e: any) => e.kind === 'close')).toEqual([expect.objectContaining({ busy: true, tab: 'off' })]);
});

test('"00" on the strip closes too, from the phone as well; an exit Claude Code refuses is said, and /00 can be tried again', async ($, on) => {
  const w = world(on);
  let refuse = true;
  const cc = engine(on, () => {
    if (refuse) throw new Error('refused here');
    return { text: '' };
  });
  await run($, '0');
  const phone = await $.ui.mount({ plugin: 'mode-code', surface: 'mobile', component: 'AbovePrompt', props: band } as any);
  await phone.press({ key: 'strip-00' });
  expect(w.toasts.at(-1)).toMatch(/^The session is closing: /);
  await closed(w, () => w.toasts.length > 1);
  // A hook that throws is skipped, so here the engine says why no exit ran: the reason is passed on as it came.
  expect(w.toasts.at(-1)).toMatch(/^Claude Code did not exit; \/exit closes it\. \(.+\)$/);
  expect(w.events().filter((e: any) => e.kind === 'close')).toEqual([expect.objectContaining({ via: 'strip' })]);
  refuse = false;
  expect((await run($, '00')).text).toMatch(/^The session is closing: /);
  await closed(w, () => cc.exits.length > 1);
  expect(cc.exits.length).toBe(2);
  await phone.unmount();
});

test('a keyword typed with a slash is applied and said so; one typo from a keyword is offered, not applied', async ($, on) => {
  const w = world(on, { lang: 'tr', answer: 'third' });
  await run($, '6');
  await $.prompt.submit(typed('Önbellek neden yavaş?'));
  const id = w.modState().flowId;
  const slash: any = await $.prompt.submit(typed('/akış iptal'));
  expect(w.json(`${DATA}/flows/${id}/flow.json`).status).toBe('canceled');
  expect(w.toasts.some((t: string) => /akış iptal anahtar kelimesi olarak anlaşıldı \(\/akış iptal yazılmıştı\)/.test(t))).toBe(true);
  expect((slash.context ?? []).join('\n')).toMatch(/canceled the flow/);
  await run($, '4');
  const near: any = await $.prompt.submit(typed('serbes'));
  expect(w.modState().mode).toBe('code');
  expect(w.toasts.at(-1)).toMatch(/"serbes": "serbest" mi demek istedin\?/);
  expect((near.context ?? []).join('\n')).toMatch(/looks like the keyword "serbest" with a typo; it was not applied/);
});

test('/why: every part and why; one part by its word; "last" names the last refusal and its rule; Claude asks the same', async ($, on) => {
  const w = world(on, { config: { bypass: { enabled: true } }, answer: 'block' });
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  const all = await run($, 'why');
  expect(all.text).toMatch(/^Safety belt: on: it checks every command and file write\n {2}- the safety belt is always on/);
  expect(all.text).toMatch(/\nBypass: off in this session: ⚡ on the strip switches it on\n {2}- "Allow bypass" is on \(Automation › Bypass\)/);
  expect((await run($, 'why', 'agents')).text).toMatch(
    /^Agents: Claude decides how many agents it starts\n {2}- "Parallel agents" is off|^Agents: Claude decides how many agents it starts\n {2}- ".+" is off \(Automation › Parallel agents\)$/,
  );
  expect((await run($, 'why', 'last')).text).toBe('Nothing was refused in this session.');
  // A command the belt blocks, then why: the line, and the rule's own reasons.
  await $.tool.call({ tool: 'Bash', command: 'git clean -fdx', tool_use_id: 'w1' } as any);
  const last = await run($, 'why', 'last');
  expect(last.text).toMatch(/· You blocked Bash: .+\n.+\n {2}- its own verdict: ask/);
  expect((await run($, 'why', 'nonsense')).text).toMatch(/^No such subject\. Ask one of: belt, mode, /);
  // Claude asks through its tool, behind tool search, and gets the same words.
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(w.registered.find((t: any) => t.name === 'why')?.isDeferred).toBe(true);
  const told: any = await $.tool.call({ tool: 'mcp__mode-code__why', about: 'bypass', tool_use_id: 'w2' } as any);
  expect(String(told.result)).toMatch(/^Bypass: off in this session/);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The cockpit inside Claude Code's engine (docs/design.md, The cockpit): opened and closed by the person, kept open for
 * the next session, what Claude may do now worked out from the session, every line saying itself to the pointer and
 * the keyboard, a permission allowed after its warning and taken back, what is at work, the activity, the quota. The
 * world beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, WIN } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args, origin: { kind: 'composer' } })) as any;
const band = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 } } as any;
const DOCK = { title: 'Cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as any;
const mount = ($: any, props: any = DOCK, surface = 'terminal') =>
  $.ui.mount({ plugin: 'mode-code', surface, component: 'Pane', requestId: 'cockpit', props } as any) as Promise<any>;

/** The drawn tree's node keyed `key`. */
function node(tree: any, key: string): any {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.key === key || tree.props?.key === key) return tree;
  for (const c of tree.children ?? []) {
    const found = node(c, key);
    if (found) return found;
  }
  return null;
}

/** The text of a drawn node, its children in order; lines of a column joined with a space. */
function textOf(n: any): string {
  if (typeof n === 'string') return n;
  if (!n?.children?.length && typeof n?.props?.label === 'string') return n.props.label;
  const sep = n?.props?.flexDirection === 'column' ? ' ' : '';
  return (n?.children ?? []).map(textOf).join(sep);
}

/** Every word the drawing shows, wrapped lines joined back. */
async function words(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' }))
    .map((t: any) => String(t.text))
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** What the body shows, the cards unseen in the line above it left out. */
async function body(ui: any): Promise<string> {
  const root = await ui.drawn();
  return textOf(root.children.at(-1)).replace(/\s+/g, ' ');
}

/** The cards that lie unseen in the line the cockpit opens with, by scope. */
async function cards(ui: any): Promise<Map<string, string>> {
  const say = node(await ui.drawn(), 'ck-say');
  return new Map(say.children.filter((c: any) => c.hover?.scope).map((c: any) => [c.hover.scope, textOf(c)]));
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

test('/0 shows the cockpit beside the conversation and lights the strip; /0 again hides it; the next session finds it as it was left', async ($, on) => {
  const w = world(on);
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  const opened = await run($, '0');
  expect(opened.text).toBe('The cockpit is open: beside the conversation on a wide screen, above the prompt otherwise. /0 closes it.');
  expect(w.panes).toEqual(['cockpit']);
  expect(w.json(`${DATA}/state/cockpit.json`)).toEqual({ v: 1, open: true });
  const strip: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  expect(textOf(node(await strip.drawn(), 'strip-0'))).toBe('0 ≡ cockpit ●');
  // Its card on the strip says what a press does now: close it.
  expect(await words(strip)).toContain('● On. Press: The cockpit closes; the session goes on. · Undo: press it again · /0');
  const closed = await run($, '0');
  expect(closed.text).toBe('The cockpit is closed. /0 opens it again.');
  expect(w.panes).toEqual([]);
  expect(textOf(node(await strip.drawn(), 'strip-0'))).toBe('0 ≡ cockpit ○');
  expect(w.json(`${DATA}/state/cockpit.json`)).toEqual({ v: 1, open: false });
  await strip.unmount();
  // A new session where the person left it open opens it in its place; left closed, it stays closed.
  await run($, '0');
  await $.session.start({ source: 'startup', cwd: '/home/ada/dev/app' } as any);
  await flush();
  expect(w.panes).toEqual(['cockpit']);
});

test('Claude right now: worked out from the session, in words; chat mode changes the lines, and a press shows the reasons', async ($, on) => {
  world(on);
  await run($, '0');
  const ui = await mount($);
  const line = async (id: string) => textOf(node(await ui.drawn(), `can-${id}`));
  expect(await line('write')).toBe("✓ Changes the project's files");
  expect(await line('risky')).toBe('? Asks you before a risky step');
  expect(await line('delete')).toBe('? Asks before deleting outside the project');
  expect(await line('self')).toBe('✗ Cannot touch its own protection');
  expect(await line('style')).toBe('· One step, then it waits for you');
  expect(await line('agents')).toBe('✓ Starts helper agents as it sees fit');
  // Chat: no file changes, so no risky step and no delete; the way of working is the person's choice still.
  await run($, '1');
  await run($, '8');
  expect(await line('write')).toBe('✗ Changes no file (💬 chat)');
  expect(await line('risky')).toBe('✗ Takes no risky step in this mode');
  expect(await line('delete')).toBe('✗ Cannot delete outside the project');
  expect(await line('style')).toBe('✓ Goes on without asking you');
  // A press opens the line's reasons, worked out by the why engine; again, it closes them.
  expect(await body(ui)).not.toContain('Pick another mode on the strip');
  await ui.press({ key: 'can-write' });
  const open = await body(ui);
  expect(open).toContain('Mode: 💬 chat.');
  expect(open).toContain('You chose it on the strip, with a keyword or a /number. Pick another mode on the strip, or with /1 to /5.');
  await ui.press({ key: 'can-write' });
  expect(await body(ui)).not.toContain('Pick another mode on the strip');
  await ui.unmount();
});

test('every line says itself: a card for each, unseen in the line the cockpit opens with, revealed by the pointer; the keyboard shows it too', async ($, on) => {
  world(on);
  on('ui.focus', () => ({}));
  await run($, '0');
  const ui = await mount($);
  const drawn = await ui.drawn();
  const say = node(drawn, 'ck-say');
  // A fixed height: a card shown in its place moves nothing under the pointer.
  expect(say.props).toMatchObject({ flexDirection: 'row', overflow: 'hidden', width: 50 });
  expect(say.props.height).toBeGreaterThanOrEqual(2);
  expect(textOf(node(drawn, 'ck-now'))).toBe('What Claude may do now, what is at work, and your quota. Point at anything: it says what it is here.');
  const all = await cards(ui);
  // Every pressable carries the scope of its card.
  for (const key of ['can-write', 'can-delete', 'quick-agents', 'quick-fullAuto', 'quick-freeze', 'budget', 'center']) {
    expect(node(drawn, key)?.hover?.scope).toBe(key);
    expect(all.get(key)?.length ?? 0).toBeGreaterThan(20);
  }
  expect(all.get('can-delete')).toBe('Delete outside the project: ask. Its own verdict: ask. Press: why, and what changes it.');
  expect(all.get('quick-fullAuto')).toMatch(/ Now: not allowed yet\. Press: first what allowing it means; nothing changes until you confirm\.$/);
  // The keyboard on a line: its card, marked as the focus, while the cockpit holds the keyboard; Esc hands it back
  // unannounced, so a cockpit that does not hold it says what it is for again.
  await $.ui.focus({ component: 'Pane', requestId: 'cockpit', plugin: 'mode-code', element: 'can-risky', origin: { kind: 'person' } });
  await flush();
  expect(textOf(node(await ui.drawn(), 'ck-now'))).toMatch(/^What Claude may do now/);
  await ui.unmount();
  const focused = await mount($, { ...DOCK, isFocused: true });
  expect(textOf(node(await focused.drawn(), 'ck-now'))).toMatch(/^▸ Safety belt: on: it checks every command and file write\./);
  await focused.unmount();
});

test('a permission from Quick settings: its warning first, Cancel changes nothing; Allow writes it with its record, and undo takes it back', async ($, on) => {
  const w = world(on);
  await run($, '0');
  const ui = await mount($);
  expect(textOf(node(await ui.drawn(), 'quick-fullAuto'))).toMatch(/^Full autonomy +○ not allowed yet$/);
  await ui.press({ key: 'quick-fullAuto' });
  expect(await body(ui)).toMatch(/! A full-autonomy run carries one task to its end .+ only you start a run\. \[ Allow \] \[ Cancel \]/);
  await ui.press({ key: 'quick-fullAuto-no' });
  expect(await body(ui)).not.toMatch(/A full-autonomy run carries/);
  expect(w.read(`${DATA}/config.json`)).toBeNull();
  await ui.press({ key: 'quick-fullAuto' });
  await ui.press({ key: 'quick-fullAuto-yes' });
  expect(w.json(`${DATA}/config.json`).autonomy.enabled).toBe(true);
  const rows = w
    .read(`${DATA}/state/changes.jsonl`)!
    .trim()
    .split('\n')
    .map((l: string) => JSON.parse(l));
  expect(rows).toEqual([expect.objectContaining({ who: 'cockpit', path: 'autonomy.enabled', from: false, to: true })]);
  expect(await body(ui)).toMatch(/^✓ Changed: Full autonomy: off → on ?\[ Undo \]/);
  // Now on the strip, as its opener.
  expect(textOf(node(await ui.drawn(), 'quick-fullAuto'))).toMatch(/^Full autonomy +○ off$/);
  const strip: any = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: band } as any);
  expect(await words(strip)).toContain('full auto…');
  await strip.unmount();
  await ui.press({ key: 'undo' });
  expect(w.json(`${DATA}/config.json`).autonomy.enabled).toBe(false);
  expect(w.toasts.at(-1)).toBe('Taken back: Full autonomy: on → off.');
  const after = w
    .read(`${DATA}/state/changes.jsonl`)!
    .trim()
    .split('\n')
    .map((l: string) => JSON.parse(l));
  expect(after.at(-1)).toMatchObject({ who: 'undo', path: 'autonomy.enabled', from: true, to: false });
  expect(await body(ui)).not.toContain('Changed:');
  await ui.unmount();
});

test("an allowed control is the strip's own press: the agents open their window, the freeze takes this folder and ends", async ($, on) => {
  const w = world(on, { config: { agents: { enabled: true } } });
  w.write('/home/ada/dev/app/README.md', '# app');
  await run($, '0');
  const ui = await mount($);
  await ui.press({ key: 'quick-agents' });
  expect(w.panes).toEqual(['cockpit', 'parallel-agents']);
  await ui.press({ key: 'quick-freeze' });
  expect(w.modState().frozen).toBe('/home/ada/dev/app');
  expect(textOf(node(await ui.drawn(), 'quick-freeze'))).toMatch(/^Freeze +● on: app$/);
  expect(textOf(node(await ui.drawn(), 'can-write'))).toBe('✓ Changes files only in app');
  await ui.press({ key: 'quick-freeze' });
  expect(w.modState().frozen).toBeNull();
  await ui.unmount();
});

test('at work now: the call running with its time counted by the surface; an agent at work can be opened or stopped', async ($, on) => {
  const w = world(on, {
    config: { agents: { enabled: true } },
    results: { Bash: () => new Promise((r) => (release = () => r({ result: 'ok' }))) },
  });
  let release: () => void = () => {};
  const list = [{ id: 'ag1', type: 'Explore', description: 'Find the slow step', status: 'running' }];
  on('agent.list', () => ({ value: list }) as any);
  const views: unknown[] = [];
  on('ui.view', (_$: any, e: any) => {
    views.push(e);
    return { value: {} };
  });
  await run($, '0');
  const ui = await mount($);
  expect(textOf(node(await ui.drawn(), 'state'))).toBe('○ Claude waits for your message');
  const call = $.tool.call({ tool: 'Bash', command: 'npm test\nnpm run lint', tool_use_id: 'tu1' } as any);
  await flush();
  const drawn = await ui.drawn();
  expect(textOf(node(drawn, 'call'))).toBe('● Bash · npm test');
  expect(node(drawn, 'ck-clock')).toMatchObject({ type: 'Client', props: { module: expect.stringMatching(/cockpit-clock\.js$/) } });
  release();
  await call;
  await flush();
  expect(node(await ui.drawn(), 'call')).toBeNull();
  expect(textOf(node(await ui.drawn(), 'agent-ag1'))).toMatch(/Find the slow step · Explore/);
  await ui.press({ key: 'view-ag1' });
  expect(views).toEqual([{ agentId: 'ag1' }]);
  // The cockpit stays beside the agent's conversation.
  expect(w.panes).toEqual(['cockpit']);
  await ui.press({ key: 'stop-ag1' });
  expect(w.calls.filter((c: any) => c.tool === 'TaskStop').map((c: any) => c.task_id)).toEqual(['ag1']);
  expect(w.toasts.at(-1)).toBe('1 agent(s) stopped.');
  await ui.unmount();
});

test('the activity: what waits for you first; a line with a place opens the control center there; All activity and Control center too', async ($, on) => {
  const w = world(on, { windows: true, env: { WT_SESSION: 'x' }, programs: (argv) => (argv[0] === 'wt.exe' ? { exitCode: 0 } : undefined) });
  w.write(
    `${WIN.DATA}/install/manifest.json`,
    JSON.stringify({ v: 1, app: 'mode-code', node: 'C:/Program Files/nodejs/node.exe', cli: 'C:/dev/tc/dist/cli.mjs' }),
  );
  w.write('C:/dev/tc/dist/cli.mjs', '// the control center');
  await run($, '0');
  const ui = await mount($);
  expect(await words(ui)).toContain('Nothing yet. What Mode_Code does as Claude works shows here, each line with its why.');
  // The belt stops a call: a line, with the rule behind it, and the place it is changed.
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main', tool_use_id: 'tu9' } as any).catch(() => undefined);
  await flush();
  expect(await words(ui)).toContain('In this session');
  const line = textOf(node(await ui.drawn(), 'act-0'));
  expect(line).toMatch(/^\d\d:\d\d(?: [AP]M)? [✗?] /);
  await ui.press({ key: 'act-0' });
  expect(w.ran.at(-1)?.slice(-2)?.[0]).toBe('open');
  expect(String(w.ran.at(-1)?.at(-1))).toMatch(/^protection\/rules\//);
  await ui.press({ key: 'all-activity' });
  expect(w.ran.at(-1)?.slice(-2)).toEqual(['open', 'activity/feed']);
  await ui.press({ key: 'center' });
  expect(w.ran.at(-1)?.at(-1)).toBe('C:/dev/tc/dist/cli.mjs');
  expect(w.toasts.at(-1)).toBe('The control center opened in a new tab.');
  await ui.unmount();
});

test('the quota: two meters with where the work wraps up and when each period starts over; the budget a press away', async ($, on) => {
  const w = world(on);
  const now = w.clock.now();
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 46, resetsAt: new Date(now + 2 * 3600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 30, resetsAt: new Date(now + 4 * 86400_000).toISOString() },
    ],
    changed: ['rateLimits'],
  } as any);
  await run($, '0');
  const ui = await mount($);
  const five = textOf(node(await ui.drawn(), 'quota-five'));
  expect(five).toMatch(/^5-hour█+░*│░* 46%\d\d:\d\d/);
  expect(textOf(node(await ui.drawn(), 'quota-week'))).toMatch(/^Week█+░*│?░* 30%\S+ \d\d:\d\d/);
  const all = await cards(ui);
  expect(all.get('quota-five')).toMatch(/^The 5-hour period: 46% used; it starts over at \d\d:\d\d(?: [AP]M)? \(in 2 h 0 min\)\. The work wraps up at 95%\.$/);
  expect(await words(ui)).toContain('No budget: the week stops at 99%');
  await ui.press({ key: 'budget' });
  expect(w.panes).toEqual(['cockpit', 'weekly-budget']);
  await ui.unmount();
});

test("Turkish: the cockpit speaks the person's language; a surface that draws no module shows no running time", async ($, on) => {
  world(on, { lang: 'tr' });
  await run($, '0');
  const ui = await mount($, { ...DOCK, isFocused: true }, 'mobile');
  const text = await words(ui);
  expect(text).toContain('Claude şu an');
  expect(text).toContain('Projenin dosyalarını değiştirir');
  expect(text).toContain('Hızlı ayarlar');
  expect(textOf(node(await ui.drawn(), 'ck-now'))).toBe('Tab gezer · Enter ya da boşluk basar · Esc isteme döner. Her satır kendini burada anlatır.');
  await ui.unmount();
});

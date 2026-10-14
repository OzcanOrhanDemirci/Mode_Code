// SPDX-License-Identifier: Apache-2.0
/**
 * The behavior layer inside Claude Code's engine, beyond the belt: keywords, the quota guard and its
 * resume timer on a mocked clock, the session state kept through a compaction, the footer lines, quiet
 * long work. The world beneath is in memory (see world.ts).
 */
import { test, expect, mock } from 'claude-code/testing';
import { DATA, PROJECT, SESSION, WIN, world } from './world.ts';

const PROJECTS = { projects: [{ id: 'terminal-code', names: ['terminal'] }] };
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const reading = (five: number, week: number, resetsIn: number, now: number) =>
  ({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: five, resetsAt: new Date(now + resetsIn).toISOString() },
      { kind: 'seven_day', percentUsed: week, resetsAt: new Date(now + 5 * 86400_000).toISOString() },
    ],
    changed: ['rateLimits'],
  }) as any;

test('"<project> continue" names the project and tells the model; the mode and the way of working stay', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const r: any = await $.prompt.submit(typed('terminal devam'));
  expect(r.context.join('\n')).toMatch(
    /Keyword "continue" for project "terminal": pick the work up where it stopped\. The keyword changes neither the mode nor the way of working.*Mode, free mode.*Way of working, manual/,
  );
  expect(w.toasts).toEqual(['Keyword: continue · terminal']);
  expect(w.modState()).toMatchObject({ interaction: 'default', mode: 'free', project: 'terminal-code' });
  expect(w.events().some((e: any) => e.kind === 'keyword' && e.keyword === 'continue')).toBe(true);
});

test('"<project> continue" keeps chat and manual, and autonomous where the person chose it', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  await $.prompt.submit(typed('sohbet'));
  await $.prompt.submit(typed('manuel'));
  const r: any = await $.prompt.submit(typed('terminal devam'));
  expect(w.modState()).toMatchObject({ mode: 'chat', interaction: 'manual', project: 'terminal-code' });
  expect(r.context.join('\n')).toMatch(/Mode, chat mode: conversation only.* until the person picks another mode\. Way of working, manual/);
  await $.prompt.submit(typed('otonom'));
  await $.prompt.submit(typed('kod'));
  const r2: any = await $.prompt.submit(typed('terminal devam'));
  expect(w.modState()).toMatchObject({ mode: 'code', interaction: 'autonomous' });
  expect(r2.context.join('\n')).toMatch(/Mode, code mode.*Way of working, autonomous: go on without asking/);
  // "manual <project> continue" names the way of working; the mode it leaves.
  await $.prompt.submit(typed('manuel terminal devam'));
  expect(w.modState()).toMatchObject({ mode: 'code', interaction: 'manual' });
});

test("a keyword typed before a paste is seen: the session is that project's", async ($, on) => {
  const w = world(on, { config: PROJECTS });
  await $.prompt.submit(typed('terminal devam (\n\n<pasted_content id="025f">\n Kontrol merkezi açılamadı\n</pasted_content id="025f">\n\n)'));
  expect(w.modState()).toMatchObject({ project: 'terminal-code' });
  expect(w.events().some((e: any) => e.kind === 'keyword' && e.keyword === 'continue' && e.project === 'terminal-code')).toBe(true);
});

test('a sentence that happens to contain the word is not a keyword', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const r: any = await $.prompt.submit(typed('terminal devam ederken bir şey sorayım'));
  expect(r.context.join('\n')).not.toMatch(/Keyword/);
  expect(w.toasts).toEqual([]);
});

test('only the person types keywords: a prompt from somewhere else is left alone', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const r: any = await $.prompt.submit({ text: 'terminal devam', wait: false, origin: { kind: 'task-notification' } } as any);
  expect((r.context ?? []).join('\n')).not.toMatch(/Keyword/);
  expect(w.modState()?.interaction ?? 'default').not.toBe('autonomous');
});

/** Another session's record, and its hook's record of the process it runs in when there is one. */
const other = (w: any, data: string, id: string, aliveAt: number, cwd: string, extra: Record<string, unknown> = {}, host?: { pid: number; name: string }) => {
  w.write(`${data}/state/sessions/${id}.mod.json`, JSON.stringify({ v: 1, sessionId: id, aliveAt, cwd, ...extra }));
  if (host) w.write(`${data}/state/sessions/${id}.hook.json`, JSON.stringify({ v: 1, sessionId: id, lastRunAt: aliveAt, blocks: {}, host }));
};

test('another session in the folder is said while it runs; one that ended, or whose window was shut, is not', async ($, on) => {
  // The person, 2026-10-14: two sessions closed minutes before were said to be working in the folder.
  const w = world(on, {
    config: PROJECTS,
    programs: (argv) => (argv[0] === 'ps' ? (argv[4] === '111' ? { exitCode: 0, stdout: 'claude\n' } : { exitCode: 1, stdout: '' }) : undefined),
  });
  const now = w.clock.now();
  other(w, DATA, 'running', now - 60_000, PROJECT, {}, { pid: 111, name: 'claude' });
  other(w, DATA, 'ended', now - 7_000, PROJECT, { endedAt: now - 7_000 }, { pid: 111, name: 'claude' });
  other(w, DATA, 'shut', now - 7_000, PROJECT, {}, { pid: 222, name: 'claude' });
  other(w, DATA, 'unknown', now - 60_000, PROJECT); // no record of its process: it is kept as working
  const r: any = await $.prompt.submit(typed('hello'));
  expect(r.context.join('\n')).toMatch(/2 other Claude Code sessions are working in this same folder right now/);
  const said = w.events().find((e: any) => e.kind === 'conflict');
  expect([...said.sessions].sort()).toEqual(['running', 'unknown']);
  expect(w.toasts.some((t) => /2/.test(t))).toBe(true);
  // An ended one is not looked up; the process of one found gone is not looked up again.
  expect(
    w.ran
      .filter((a) => a[0] === 'ps')
      .map((a) => a[4])
      .sort(),
  ).toEqual(['111', '222']);
  await $.prompt.submit(typed('and now?'));
  expect(w.ran.filter((a) => a[0] === 'ps' && a[4] === '222').length).toBe(1);
});

test('on Windows a process number handed to another program is a session gone; a lookup that fails keeps it', async ($, on) => {
  const rows: Record<string, string> = { '111': '"claude.exe","111","Console","1","500 K"', '333': '"notepad.exe","333","Console","1","9 K"' };
  let fails = false;
  const w = world(on, {
    windows: true,
    config: PROJECTS,
    programs: (argv) => {
      if (!/\\System32\\tasklist\.exe$/.test(argv[0]!)) return undefined;
      if (fails) return { exitCode: 1, stdout: '', stderr: 'ERROR: access denied' };
      const pid = /^PID eq (\d+)$/.exec(argv[2]!)?.[1] ?? '';
      return { exitCode: 0, stdout: (rows[pid] ?? 'INFO: No tasks are running which match the specified criteria.') + '\r\n' };
    },
  });
  const now = w.clock.now();
  other(w, WIN.DATA, 'running', now - 60_000, WIN.PROJECT, {}, { pid: 111, name: 'claude.exe' });
  other(w, WIN.DATA, 'reused', now - 60_000, WIN.PROJECT, {}, { pid: 333, name: 'claude.exe' });
  other(w, WIN.DATA, 'shut', now - 60_000, WIN.PROJECT, {}, { pid: 444, name: 'claude.exe' });
  const r: any = await $.prompt.submit(typed('hello'));
  expect(r.context.join('\n')).toMatch(/Another Claude Code session is working in this same folder right now/);
  expect(w.events().find((e: any) => e.kind === 'conflict').sessions).toEqual(['running']);
  expect(w.ran.every((a) => a[0] === 'C:\\Windows\\System32\\tasklist.exe')).toBe(true);
  // When the lookup cannot run or answer, the session stays counted: a warning too many, never one too few.
  fails = true;
  other(w, WIN.DATA, 'quiet', now - 60_000, WIN.PROJECT, {}, { pid: 555, name: 'claude.exe' });
  const r2: any = await $.prompt.submit(typed('again'));
  expect(r2.context.join('\n')).toMatch(/2 other Claude Code sessions are working/);
});

test("a session's end marks it ended before anything else; resumed, it is open again", async ($, on) => {
  const w = world(on, { config: PROJECTS });
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.prompt.submit(typed('hello'));
  expect(w.modState().endedAt).toBe(null);
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: {} } as any);
  expect(w.modState().endedAt).toBe(w.clock.now());
  await $.session.start({ source: 'resume', cwd: PROJECT } as any);
  expect(w.modState().endedAt).toBe(null);
});

test('the quota guard: at 96% of the 5-hour window it asks to wrap up, once, and says so to the model', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(96, 40, 3600_000, now));
  await $.session.measure(reading(96.5, 40, 3600_000, now));
  expect(w.toasts.filter((t) => /wrapping up/.test(t)).length).toBe(1);
  expect(w.modState().wrapUp).toBe(true);
  const next: any = await $.prompt.submit(typed('what next?'));
  expect(next.context.join('\n')).toMatch(/wrap/i);
  expect(w.json('/home/ada/.terminal-code/state/quota.json').windows[0].used).toBe(96.5);
});

test("at the stop line an autonomous session schedules its own resume, a minute after the reset, with the person's keyword", async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('otonom'));
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(99.5, 40, 3600_000, now));
  const state = w.modState();
  expect(state.resumeAt).toBe(now + 3600_000 + 60_000);
  expect(w.submitted).toEqual(['otonom', 'terminal devam']);
  await w.clock.advance(3600_000 + 59_000);
  expect(w.submitted.length).toBe(2);
  await w.clock.advance(2_000);
  expect(w.submitted.length).toBe(3);
  // The resume prompt ends with the continue keyword in the interface language, which reads as the keyword again.
  expect(w.submitted[2]).toMatch(/\nterminal continue$/);
  expect(w.modState()).toMatchObject({ resumeAt: null, wrapUp: false, interaction: 'autonomous' });
  expect(w.events().some((e: any) => e.kind === 'resume')).toBe(true);
});

test('"stop" cancels a scheduled resume; the way of working the person chose stays', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('otonom'));
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(99.5, 40, 600_000, now));
  expect(w.modState().resumeAt).not.toBe(null);
  await $.prompt.submit(typed('dur'));
  await w.clock.advance(3600_000);
  expect(w.submitted).toEqual(['otonom', 'terminal devam', 'dur']);
  expect(w.modState()).toMatchObject({ resumeAt: null, wrapUp: true, interaction: 'autonomous' });
});

test('"continue" with nothing chosen does not resume by itself: the session never became autonomous', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(99.5, 40, 600_000, now));
  expect(w.modState().resumeAt).toBe(null);
  await w.clock.advance(3600_000);
  expect(w.submitted).toEqual(['terminal devam']);
});

test('a manual session does not resume by itself', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('manuel terminal devam'));
  await $.session.measure(reading(99.5, 40, 600_000, now));
  expect(w.modState().resumeAt).toBe(null);
  await w.clock.advance(3600_000);
  expect(w.submitted.length).toBe(1);
});

test('the session state survives a compaction: the summary is asked to keep it, and it is restated after', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const session = mock.session(on);
  let instructions = '';
  on('session.compact', (_$: any, e: any) => {
    instructions = e.instructions ?? '';
    return { messages: e.messages };
  });
  await $.prompt.submit(typed('otonom'));
  await $.prompt.submit(typed('terminal devam'));
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary so far', toolUses: [] }] } as any);
  expect(instructions).toMatch(/Keep this in the summary/);
  expect(instructions).toMatch(/autonomous work on project "terminal"/);
  const rows = session.appended().map((r: any) => JSON.stringify(r.message));
  expect(rows.some((t: string) => /kept across compaction/.test(t))).toBe(true);
  void w;
});

test('quiet long work: the "user has not heard from you" reminder is left out when the module is on', async ($, on) => {
  world(on, { config: { modules: { quietWork: true } } });
  on('prompt.attachment', (_$: any, e: any) => ({ text: 'reminder' }));
  const r: any = await $.prompt.attachment({ type: 'silent_turn_reminder', origin: { kind: 'engine' } } as any);
  expect(r.text).toBe(null);
});

test('the footer lines are drawn under the answer just finished, on every surface, never into the transcript', async ($, on) => {
  world(on, { config: { footer: { mode: 'draw' } } });
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  // Beneath the plugin, the engine's own drawing of an answer: its text.
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, null, e.props.text) as any;
  });
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui: any = await $.ui.mount({
      plugin: 'terminal-code',
      surface,
      component: 'AssistantMessage',
      props: { text: 'Done.', isFirstOfReply: true },
    } as any);
    const drawn = await ui.find({ type: 'Text' });
    expect(drawn?.text).toMatch(/^Done\.\n\nChanges made: No/);
    await ui.unmount();
  }
  // Another answer's text gets no footer of this one.
  const other: any = await $.ui.mount({
    plugin: 'terminal-code',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Something else.', isFirstOfReply: true },
  } as any);
  expect((await other.find({ type: 'Text' }))?.text).toBe('Something else.');
});

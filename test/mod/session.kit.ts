// SPDX-License-Identifier: Apache-2.0
/**
 * The behavior layer inside Claude Code's engine, beyond the belt: keywords, the quota guard and its
 * resume timer on a mocked clock, the session state kept through a compaction, the footer lines, quiet
 * long work. The world beneath is in memory (see world.ts).
 */
import { test, expect, mock } from 'claude-code/testing';
import { world } from './world.ts';

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

test('"<project> continue" makes the session autonomous and tells the model why', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const r: any = await $.prompt.submit(typed('terminal devam'));
  expect(r.context.join('\n')).toMatch(/Keyword "continue" for project "terminal": work autonomously/);
  expect(w.toasts).toEqual(['Keyword: continue · terminal']);
  expect(w.modState()).toMatchObject({ interaction: 'autonomous', project: 'terminal-code' });
  expect(w.events().some((e: any) => e.kind === 'keyword' && e.keyword === 'continue')).toBe(true);
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
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(99.5, 40, 3600_000, now));
  const state = w.modState();
  expect(state.resumeAt).toBe(now + 3600_000 + 60_000);
  expect(w.submitted).toEqual(['terminal devam']);
  await w.clock.advance(3600_000 + 59_000);
  expect(w.submitted.length).toBe(1);
  await w.clock.advance(2_000);
  expect(w.submitted.length).toBe(2);
  // The resume prompt ends with the continue keyword in the interface language, which reads as the keyword again.
  expect(w.submitted[1]).toMatch(/\nterminal continue$/);
  expect(w.modState()).toMatchObject({ resumeAt: null, wrapUp: false, interaction: 'autonomous' });
  expect(w.events().some((e: any) => e.kind === 'resume')).toBe(true);
});

test('"stop" cancels a scheduled resume', async ($, on) => {
  const w = world(on, { config: PROJECTS });
  const now = w.clock.now();
  await $.prompt.submit(typed('terminal devam'));
  await $.session.measure(reading(99.5, 40, 600_000, now));
  await $.prompt.submit(typed('dur'));
  await w.clock.advance(3600_000);
  expect(w.submitted).toEqual(['terminal devam', 'dur']);
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

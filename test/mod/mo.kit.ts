// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the strip above the prompt, inside Claude Code's engine: drawn by its surface module at the strip's
 * left on the terminal, a small Mo beside two rows and its face beside one; not on a phone, not when turned
 * off; what it shows follows what the session does. The world beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, PROJECT } from './world.ts';

const band = (bodyColumns: number, isWorking = false) =>
  ({ hasSurvey: false, isWorking, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 } }) as any;
const mount = ($: any, surface: string, props: any) => $.ui.mount({ plugin: 'mode-code', surface, component: 'AbovePrompt', props } as any);
/** A session that started: its strip and what Mo knows are drawn from then on. */
const start = ($: any, on: any) => {
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  return $.session.start({ source: 'startup', cwd: PROJECT } as any);
};
/** What Mo's module drew, as plain data. */
const moDrawn = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'mo' }));

test("Mo sits at the strip's left: its face beside a strip of one row, a small Mo beside two", async ($, on) => {
  world(on);
  await start($, on);
  const wide = await mount($, 'terminal', band(160));
  const face = await wide.find({ key: 'mo' });
  expect(face?.type).toBe('Client');
  expect(face?.props).toMatchObject({ module: expect.stringMatching(/mo-strip\.js$/), width: 22, height: 1, props: { rows: 1, show: true } });
  expect((await wide.findAll({ type: 'Text', in: 'mo' })).map((t: any) => t.text).join('')).toMatch(/[▀▄▇]/);
  // The controls are still there, beside it.
  expect(await wide.find({ key: 'strip-0' })).toBeDefined();
  await wide.unmount();

  const narrow = await mount($, 'terminal', band(100));
  expect((await narrow.find({ key: 'mo' }))?.props).toMatchObject({ height: 2, props: { rows: 2 } });
  await narrow.unmount();
});

test('Mo steps aside on a phone, on a strip too narrow for it, and when the setting turns it off', async ($, on) => {
  world(on);
  await start($, on);
  const phone = await mount($, 'mobile', band(160));
  expect(await phone.find({ key: 'mo' })).toBeUndefined();
  expect(await phone.find({ key: 'strip-0' })).toBeDefined();
  await phone.unmount();
  const tight = await mount($, 'terminal', band(60));
  expect(await tight.find({ key: 'mo' })).toBeUndefined();
  await tight.unmount();
});

test('with the mascot setting off, the strip is drawn without Mo', async ($, on) => {
  world(on, { config: { modules: { mascot: false } } });
  await start($, on);
  const ui = await mount($, 'terminal', band(160));
  expect(await ui.find({ key: 'mo' })).toBeUndefined();
  expect(await ui.find({ key: 'strip-0' })).toBeDefined();
  await ui.unmount();
});

test('reduced motion: Mo is drawn still', async ($, on) => {
  world(on, { config: { accessibility: { reduceMotion: true } } });
  await start($, on);
  const ui = await mount($, 'terminal', band(160));
  expect((await ui.find({ key: 'mo' }))?.props).toMatchObject({ props: { still: true } });
  await ui.unmount();
});

test('a call the belt refuses: Mo knows when, and its frames move on the clock of the drawing', async ($, on) => {
  world(on);
  await start($, on);
  const ui = await mount($, 'terminal', band(160));
  expect((await ui.find({ key: 'mo' }))?.props).toMatchObject({ props: { blockAt: null } });
  const r: any = await $.tool.call({ tool: 'Write', file_path: `${DATA}/config.json`, content: '{}' } as any);
  expect(String(r.deny ?? r.text)).toMatch(/self\.tool-files/);
  const after = (await ui.find({ key: 'mo' }))?.props as any;
  expect(typeof after.props.blockAt).toBe('number');
  // Nothing of the call runs any more.
  expect(after.props).toMatchObject({ tools: 0, agents: 0, asking: 0 });
  const before = await moDrawn(ui);
  await ui.advance(1000);
  expect(await moDrawn(ui)).not.toBe(before);
  await ui.unmount();
});

test('a finished turn and a stopped one are marked for Mo', async ($, on) => {
  world(on);
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await start($, on);
  const ui = await mount($, 'terminal', band(160, true));
  expect((await ui.find({ key: 'mo' }))?.props).toMatchObject({ props: { working: true, doneAt: null } });
  await $.turn.start({ text: 'Do it.', turnId: 't1' } as any);
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(typeof ((await ui.find({ key: 'mo' }))?.props as any).props.doneAt).toBe('number');
  await $.turn.start({ text: 'Again.', turnId: 't2' } as any);
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't2', reason: 'aborted' } as any);
  expect(typeof ((await ui.find({ key: 'mo' }))?.props as any).props.stoppedAt).toBe('number');
  await ui.unmount();
});

test('at rest Mo stands still: its clock runs and nothing is drawn again; while Claude works it moves', async ($, on) => {
  world(on);
  await start($, on);
  // Every frame Claude Code draws hides and shows the terminal's cursor: at rest, under the person's typing,
  // a moving Mo made it flicker.
  const rest = await mount($, 'terminal', band(160));
  const still = await moDrawn(rest);
  await rest.advance(3000);
  expect(await moDrawn(rest)).toBe(still);
  await rest.unmount();
  const busy = await mount($, 'terminal', band(160, true));
  const first = await moDrawn(busy);
  await busy.advance(1000);
  expect(await moDrawn(busy)).not.toBe(first);
  await busy.unmount();
});

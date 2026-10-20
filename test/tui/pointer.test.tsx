// SPDX-License-Identifier: Apache-2.0
/**
 * The mouse in the control center (docs/design.md, One way to act): the terminal's pointer sequences are taken out of
 * the input before Ink reads it, a click does what Enter does on what it lands on, pointing says what it is and acts
 * on nothing, the wheel scrolls what is under the pointer, and the keys and the mouse reach the same result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MOUSE_OFF, MOUSE_ON, mouseReporting, PointerHub, pointerInput, takePointer, type PointerEvent } from '../../src/tui/pointer.js';
import { noColorAsked } from '../../src/tui/theme.js';
import { draw, FakeData, KEY, sgr, type Screen } from './harness.js';

/** The keys in the bar reach it a frame after the screen that adds them: waits a while for them. */
async function barShows(s: Screen, keys: RegExp): Promise<void> {
  const bar = () => s.text().split('\n').at(-2)!;
  for (let i = 0; i < 100 && !keys.test(bar()); i++) await new Promise((r) => setTimeout(r, 15));
  assert.match(bar(), keys);
}

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('a pointer sequence is read whole: the button, the cell from 0, the modifiers; a release, a move, the wheel', () => {
  const r = takePointer(`${sgr(0, 9, 4)}${sgr(0, 9, 4, true)}${sgr(32 + 4, 11, 5)}${sgr(64, 0, 0)}${sgr(65 + 16, 2, 3)}${sgr(35, 7, 7)}`);
  assert.equal(r.rest, '');
  assert.deepEqual(
    r.events.map((e) => [e.kind, e.button, e.wheel ?? '', e.x, e.y, e.shift, e.ctrl]),
    [
      ['press', 'left', '', 9, 4, false, false],
      ['release', 'left', '', 9, 4, false, false],
      ['move', 'left', '', 11, 5, true, false],
      ['wheel', 'none', 'up', 0, 0, false, false],
      ['wheel', 'none', 'down', 2, 3, false, true],
      ['move', 'none', '', 7, 7, false, false],
    ],
  );
});

test('keys around a pointer sequence stay keys, a sequence the chunk cut waits for the rest, X10 is read too', () => {
  const a = takePointer(`ab${sgr(0, 1, 1)}\u001B[Acd\u001B[<0;12`);
  assert.equal(a.rest, 'ab\u001B[Acd');
  assert.equal(a.events.length, 1);
  assert.equal(a.carry, '\u001B[<0;12');
  const b = takePointer(`${a.carry};3Mx`);
  assert.equal(b.rest, 'x');
  assert.deepEqual([b.events[0]!.x, b.events[0]!.y], [11, 2]);
  // X10: ESC [ M and three bytes, each 32 above its value (button 0, column 5, row 2, 1-based).
  const x10 = takePointer(`\u001B[M${String.fromCharCode(32, 32 + 5, 32 + 2)}q`);
  assert.equal(x10.rest, 'q');
  assert.deepEqual([x10.events[0]!.kind, x10.events[0]!.x, x10.events[0]!.y], ['press', 4, 1]);
  // An Escape alone, or an arrow, is no pointer sequence and is never held back.
  assert.deepEqual(takePointer('\u001B'), { rest: '\u001B', events: [], carry: '' });
});

test('the input Ink reads loses the pointer sequences and keeps everything else of the stream', () => {
  class Input extends EventEmitter {
    isTTY = true;
    chunks: string[] = [];
    raw: boolean | null = null;
    setRawMode(on: boolean) {
      this.raw = on;
      return this;
    }
    read() {
      return this.chunks.shift() ?? null;
    }
  }
  const input = new Input();
  const hub = new PointerHub();
  const seen: PointerEvent[] = [];
  hub.on((e) => seen.push(e));
  const s = pointerInput(input as unknown as NodeJS.ReadStream, hub) as unknown as Input;
  input.chunks.push(sgr(0, 3, 3), `k${sgr(0, 3, 3, true)}`, 'j');
  // A chunk that was only the pointer is skipped: the next read gives the keys after it.
  assert.equal(s.read(), 'k');
  assert.equal(s.read(), 'j');
  assert.equal(s.read(), null);
  assert.equal(seen.length, 2);
  s.setRawMode(true);
  assert.equal(input.raw, true);
  assert.equal(s.isTTY, true);
});

test('a click on a category opens it, as → does; a crumb leads back to its level', async () => {
  const s = await draw(new FakeData());
  try {
    await s.clickText('Protection');
    assert.match(s.text(), /^Mode_Code › Protection/);
    assert.match(s.text(), /Address: protection/);
    await s.clickText('Mode_Code');
    assert.match(s.text(), /^Mode_Code {2,}/);
    // The keyboard reaches the same place.
    await s.press('4');
    assert.match(s.text(), /^Mode_Code › Protection/);
  } finally {
    s.close();
  }
});

test('pointing at a row says what it is in the bar and does nothing else', async () => {
  const s = await draw(new FakeData());
  try {
    const before = s.text().split('\n')[0];
    await s.hoverText('Settings');
    const t = s.text();
    assert.equal(t.split('\n')[0], before);
    const bar = t.split('\n').at(-3)!;
    assert.match(bar, /^▸ Settings: /);
    // Moving off it, onto nothing that explains itself, leaves the bar to the address again.
    await s.hover(0, 0);
    assert.match(s.text(), /Address: now/);
  } finally {
    s.close();
  }
});

test('the wheel over the list moves the selection, as ↓ and ↑ do', async () => {
  const s = await draw(new FakeData());
  try {
    const at = s.find('Activity')!;
    await s.wheel(at.x, at.y, 'down');
    assert.match(s.text(), /│▸ Activity/);
    await s.wheel(at.x, at.y, 'down');
    await s.wheel(at.x, at.y, 'up');
    assert.match(s.text(), /│▸ Activity/);
  } finally {
    s.close();
  }
});

test('a click on a setting changes it, as Enter does; the bar offers to take it back, and u or a click does', async () => {
  const byKey = new FakeData();
  const k = await draw(byKey, { address: 'memory/notes' });
  const byMouse = new FakeData();
  const m = await draw(byMouse, { address: 'memory/notes' });
  try {
    await k.press(KEY.enter);
    await m.clickText('Handoff notes');
    assert.deepEqual(byMouse.saved, byKey.saved);
    assert.deepEqual(byMouse.saved.at(-1), { path: 'memory.handoff.enabled', value: false });
    assert.match(m.text(), /✓ Handoff notes: off\. Saved\. \[ undo · u \]/);
    await m.clickText('[ undo · u ]');
    assert.deepEqual(byMouse.saved.at(-1), { path: 'memory.handoff.enabled', value: true });
    assert.match(m.text(), /Handoff notes: back to on\./);
    await k.press('u');
    assert.deepEqual(byKey.saved.at(-1), { path: 'memory.handoff.enabled', value: true });
  } finally {
    k.close();
    m.close();
  }
});

test('a change that asks first shows what it will do, with apply and cancel as keys and as clicks', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'work/bypass', rows: 44 });
  try {
    await s.clickText('Allow bypass');
    assert.equal(data.saved.length, 0);
    assert.match(flat(s.text()), /! Bypass lets Claude act without asking/);
    await s.clickText('[ cancel · Esc ]');
    assert.doesNotMatch(s.text(), /\[ apply · Enter \]/);
    assert.equal(data.saved.length, 0);
    await s.clickText('Allow bypass');
    await s.clickText('[ apply · Enter ]');
    assert.deepEqual(data.saved.at(-1), { path: 'bypass.enabled', value: true });
  } finally {
    s.close();
  }
});

test('the keys in the bar are clicks too: help opens, Esc closes it; a screen adds its own', async () => {
  const s = await draw(new FakeData(), { address: 'protection/secrets' });
  try {
    // With no memory folder the page leads to where one is added (Enter), then its own key, then the usual ones.
    await barShows(s, /^Enter open {2}s scan again {2}←\/Esc back/);
    await s.clickText('? help');
    assert.match(s.text(), /Keys work the same on every screen/);
    assert.match(s.text(), /A click does what Enter does/);
    await s.clickText('Esc close');
    assert.doesNotMatch(s.text(), /Keys work the same on every screen/);
  } finally {
    s.close();
  }
});

test("each screen's own keys in the bar do what the key does, and its rows take a click", async () => {
  // Recent tasks: a click on a task picks and copies it; "Enter/c" in the bar copies the one picked.
  const tasks = new FakeData();
  tasks.promptList = [
    { text: 'Add a rate limit.', budget: '+20', at: 0 },
    { text: 'Fix the login bug.', budget: '+10', at: 0 },
  ];
  let s = await draw(tasks, { address: 'work/prompts' });
  try {
    await s.clickText('Fix the login bug.');
    assert.deepEqual(tasks.copied, ['Fix the login bug.']);
    await s.clickText('Enter/c copy the whole task');
    assert.deepEqual(tasks.copied, ['Fix the login bug.', 'Fix the login bug.']);
  } finally {
    s.close();
  }
  // A rule template: the bar's a asks first, a second click applies; then x is the one offered.
  const tpl = new FakeData();
  s = await draw(tpl, { address: 'claude-code/templates' });
  try {
    await s.clickText('a apply');
    assert.match(s.text(), /Press a again to apply it/);
    await s.clickText('a apply');
    assert.deepEqual(tpl.applied, ['public-repo']);
    await barShows(s, /^x remove/);
    await s.clickText('x remove');
    await s.clickText('Esc cancel');
    assert.deepEqual(tpl.applied, ['public-repo']);
    await s.clickText('One branch');
    assert.match(s.text(), /▸ ○ One branch/);
  } finally {
    s.close();
  }
  // The belt's test: the tool is a click away, on its tab or on Tab in the bar.
  s = await draw(new FakeData(), { address: 'protection/test' });
  try {
    await s.clickText('File write');
    assert.match(s.text(), /Path:/);
    await s.clickText('Tab shell or file');
    assert.match(s.text(), /Command:/);
  } finally {
    s.close();
  }
  // The report's and the tokens' days, and a scan again.
  for (const [address, before, after] of [
    ['activity/report', /in the last day/, /in the last 7 days/],
    ['quota/tokens', /Last 7 days/, /Last 30 days/],
  ] as const) {
    s = await draw(new FakeData(), { address });
    try {
      assert.match(s.text(), before);
      await s.clickText('p change the days');
      assert.match(s.text(), after);
    } finally {
      s.close();
    }
  }
  s = await draw(new FakeData('en', { memory: { ...new FakeData().config().memory, dirs: ['C:/notes'] } }), { address: 'protection/secrets' });
  try {
    await s.clickText('s scan again');
    assert.match(s.text(), /No secrets found in 3 files./);
  } finally {
    s.close();
  }
});

test('the mouse is reported while the control center is drawn and turned off once, by the app or on the way out', () => {
  const written: string[] = [];
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  const proc = {
    once: (event: string, fn: () => void) => handlers.set(event, fn),
    exit: (code: number) => exits.push(code),
  };
  const m = mouseReporting((x) => written.push(x), proc);
  m.on();
  assert.deepEqual(written, [MOUSE_ON]);
  m.off();
  handlers.get('exit')!();
  assert.deepEqual(written, [MOUSE_ON, MOUSE_OFF]);
  // Killed while drawn: off, then the program ends as the signal asks.
  m.on();
  handlers.get('SIGTERM')!();
  assert.deepEqual(written, [MOUSE_ON, MOUSE_OFF, MOUSE_ON, MOUSE_OFF]);
  assert.deepEqual(exits, [143]);
  handlers.get('SIGHUP')!();
  assert.deepEqual(exits, [143, 129]);
  assert.equal(written.length, 4);
});

test('NO_COLOR asks for no colour when it is set to anything but empty', () => {
  assert.equal(noColorAsked({ NO_COLOR: '1' }), true);
  assert.equal(noColorAsked({ NO_COLOR: '' }), false);
  assert.equal(noColorAsked({}), false);
});

test('every way out ends through the app, so what it turned on (the mouse) goes off while the screen is still its own', async () => {
  for (const out of [['q'], ['\u0003'], [KEY.right, KEY.right, '\u0003'], ['?', '\u0003']]) {
    let quits = 0;
    const s = await draw(new FakeData(), { onQuit: () => quits++ });
    try {
      await s.press(...out);
      assert.equal(quits, 1, JSON.stringify(out));
    } finally {
      s.close();
    }
  }
  let quits = 0;
  const s = await draw(new FakeData(), { onQuit: () => quits++ });
  try {
    await s.clickText('q quit');
    assert.equal(quits, 1);
  } finally {
    s.close();
  }
});

test('a target the pane has scrolled out of view cannot be clicked', async () => {
  const data = new FakeData();
  // Ten rows: the settings list runs past the pane, and what lies under the bar is no target.
  const s = await draw(data, { address: 'memory/notes', rows: 12 });
  try {
    assert.equal(s.find('Away after'), null);
    assert.match(s.text(), /▸ Handoff notes/);
    // The rows the pane cut are laid out where the bar is drawn: a click there reaches none of them.
    const bar = s.text().split('\n').length - 3;
    for (const x of [10, 40, 70]) await s.click(x, bar);
    assert.equal(data.saved.length, 0);
    assert.match(s.text(), /▸ Handoff notes/);
  } finally {
    s.close();
  }
});

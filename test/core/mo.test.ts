// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ART_H, ART_W, GLASS, frame, mix, MO_STATES, type MoState, type Picture, type Rgb } from '../../src/core/mo/art.js';
import { badge, MARK_W, mark1, mark2 } from '../../src/core/mo/marks.js';
import { moState, NO_FACTS, SHOW_FOR, STILL_AT, type MoFacts } from '../../src/core/mo/state.js';
import { ansiOf, hexOf, runsOf, xterm256 } from '../../src/core/mo/cells.js';

const TIMES = [0, 0.1, 0.3, 0.55, 0.9, 1.25, 1.6, 2.4, 3.3, 4.25, 4.4, 5.6, 8.95];

function wellFormed(p: Picture, w: number, h: number): void {
  assert.equal(p.w, w);
  assert.equal(p.h, h);
  assert.equal(p.px.length, h);
  for (const row of p.px) {
    assert.equal(row.length, w);
    for (const c of row) if (c) for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `a color channel out of range: ${v}`);
  }
}

test('every frame of the whole body is 40 x 34 pixels of valid colors, the same for the same moment', () => {
  for (const s of MO_STATES)
    for (const t of TIMES)
      for (const b of ['dark', 'light'] as const) {
        const p = frame(s, t, b);
        wellFormed(p, ART_W, ART_H);
        assert.deepEqual(frame(s, t, b).px, p.px, `${s} at ${t} drawn twice differs`);
      }
});

test('the strip marks are 22 wide: four pixels (two rows) small Mo, two pixels (one row) face', () => {
  for (const s of MO_STATES)
    for (const t of TIMES)
      for (const b of ['dark', 'light'] as const) {
        wellFormed(mark2(s, t, b), MARK_W, 4);
        wellFormed(mark1(s, t, b), MARK_W, 2);
        assert.deepEqual(mark2(s, t, b).px, mark2(s, t, b).px);
      }
});

/** Pixels at which two states' marks differ, over several moments: what an eye can tell apart at a glance. */
function apart(mark: typeof mark2, a: MoState, b: MoState): number {
  let n = 0;
  for (const t of [0.3, 0.9, 1.5, 2.1]) {
    const pa = mark(a, t).px;
    const pb = mark(b, t).px;
    for (let y = 0; y < pa.length; y++) for (let x = 0; x < MARK_W; x++) if (String(pa[y]![x]) !== String(pb[y]![x])) n++;
  }
  return n;
}

test('in the strip every state looks unlike every other, in both sizes (the person, 2026-10-14)', () => {
  for (const a of MO_STATES)
    for (const b of MO_STATES) {
      if (a >= b) continue;
      assert.ok(apart(mark2, a, b) >= 12, `${a} and ${b} look alike in two rows (${apart(mark2, a, b)} pixels apart)`);
      const roomy = (s: MoState, t: number) => mark2(s, t, 'dark', true);
      assert.ok(apart(roomy, a, b) >= 12, `${a} and ${b} look alike in two rows with headroom (${apart(roomy, a, b)} pixels apart)`);
      assert.ok(apart(mark1, a, b) >= 6, `${a} and ${b} look alike in one row (${apart(mark1, a, b)} pixels apart)`);
    }
});

test("thinking, three dots light in turn beside Mo in both sizes, the last one inside the mark's 22 columns", () => {
  const sum = (c: Rgb | null | undefined) => (c ? c[0] + c[1] + c[2] : -1);
  for (const [mark, y] of [
    [mark1, 1],
    [mark2, 1],
  ] as const)
    for (const [t, lit] of [
      [0.1, 0],
      [0.5, 1],
      [0.9, 2],
    ] as const) {
      const dots = [17, 19, 21].map((x) => mark('think', t).px[y]![x]);
      assert.ok(dots.every(Boolean), `${mark.name} at ${t}: a dot is missing`);
      const brightest = dots.map(sum).indexOf(Math.max(...dots.map(sum)));
      assert.equal(brightest, lit, `${mark.name} at ${t}: dot ${lit} should be the lit one`);
    }
});

test('the light of effects fades into the background: a light terminal draws the shield differently, the body the same', () => {
  const dark = frame('block', 1.6, 'dark');
  const light = frame('block', 1.6, 'light');
  assert.notDeepEqual(dark.px, light.px);
  // The body's middle, below the visor, is steel on both.
  const y = dark.glassTop + 5;
  assert.deepEqual(dark.px[y]![dark.bodyX + 6], light.px[y]![light.bodyX + 6]);
});

test('a state that begins blinks first: the change reads as a reaction', () => {
  /** How much light the visor gives: the eyes, open or shut. */
  const visor = (s: MoState, t: number): number => {
    const p = frame(s, t);
    let sum = 0;
    for (let y = p.glassTop; y < p.glassTop + 3; y++)
      for (let x = p.bodyX + 3; x <= p.bodyX + 16; x++) sum += (p.px[y]![x] ?? [0, 0, 0]).reduce((a, v) => a + v, 0);
    return sum;
  };
  for (const s of ['wait', 'agent', 'auto'] as const) assert.ok(visor(s, 0.05) < visor(s, 0.5) * 0.8, `${s} opens with its eyes shut`);
});

const f = (over: Partial<MoFacts>): MoFacts => ({ ...NO_FACTS, ...over });

test('what Mo shows, in order: a refusal, a failure, a question, the turn at work, how it ended, a run, low quota, rest', () => {
  const now = 100_000;
  assert.equal(moState(NO_FACTS, now), 'idle');
  assert.equal(moState(f({ low: true }), now), 'low');
  assert.equal(moState(f({ auto: true, low: true }), now), 'auto');
  assert.equal(moState(f({ working: true }), now), 'think');
  assert.equal(moState(f({ working: true, tools: 1 }), now), 'work');
  assert.equal(moState(f({ working: true, tools: 1, agents: 1 }), now), 'agent');
  assert.equal(moState(f({ working: true, agents: 2, auto: true }), now), 'auto');
  assert.equal(moState(f({ working: true, tools: 1, asking: 1 }), now), 'wait');
  assert.equal(moState(f({ waiting: true }), now), 'wait');
  assert.equal(moState(f({ working: true, asking: 1, errorAt: now - 10 }), now), 'error');
  assert.equal(moState(f({ errorAt: now - 10, blockAt: now - 10 }), now), 'block');
  assert.equal(moState(f({ doneAt: now - 10 }), now), 'done');
  assert.equal(moState(f({ doneAt: now - 10, stoppedAt: now - 5 }), now), 'stopped');
  // A new turn takes over from how the last one ended.
  assert.equal(moState(f({ doneAt: now - 10, working: true }), now), 'think');
});

test('what just happened gives way after its time; a time ahead of the clock is not shown yet', () => {
  const now = 1_000_000;
  for (const [key, state, ms] of [
    ['blockAt', 'block', SHOW_FOR.block],
    ['errorAt', 'error', SHOW_FOR.error],
    ['doneAt', 'done', SHOW_FOR.done],
    ['stoppedAt', 'stopped', SHOW_FOR.stopped],
  ] as const) {
    assert.equal(moState(f({ [key]: now }), now), state);
    assert.equal(moState(f({ [key]: now - ms + 1 }), now), state);
    assert.equal(moState(f({ [key]: now - ms }), now), 'idle');
    assert.equal(moState(f({ [key]: now + 1 }), now), 'idle');
  }
});

test("the badge: Mo's face in one row of five cells, a steel frame over the glass, its eyes in the look's color", () => {
  const eyes = (b: Picture) => [hexOf(b.px[1]![1]!), hexOf(b.px[1]![3]!)];
  for (const look of ['ok', 'look', 'bad', 'off'] as const) {
    const b = badge(look);
    assert.deepEqual([b.w, b.h, b.px.length, b.px.every((r) => r.length === 5)], [5, 2, 2, true]);
    // Every pixel drawn, so each cell is an upper half block of two colors: one cell wide in any terminal.
    assert.deepEqual(
      runsOf(b)[0]!
        .map((r) => r.text)
        .join(''),
      '▀▀▀▀▀',
    );
    assert.equal(hexOf(b.px[1]![2]!), hexOf(GLASS));
    assert.equal(eyes(b)[0], eyes(b)[1]);
  }
  assert.deepEqual(
    (['ok', 'look', 'bad', 'off'] as const).map((l) => eyes(badge(l))[0]),
    ['#39c5cf', '#f5b53d', '#ff4d4d', '#394656'],
  );
});

test('every state has a still moment for reduced motion', () => {
  for (const s of MO_STATES) assert.equal(typeof STILL_AT[s], 'number');
  assert.equal(Object.keys(STILL_AT).length, MO_STATES.length);
});

test('cells: two pixels make one, a missing one leaves the background; runs of one style are joined', () => {
  const red = [255, 0, 0] as const;
  const blue = [0, 0, 255] as const;
  const p: Picture = {
    w: 4,
    h: 2,
    px: [
      [red, red, null, null],
      [blue, blue, blue, null],
    ],
  };
  assert.deepEqual(runsOf(p), [
    [
      { text: '▀▀', fg: '#ff0000', bg: '#0000ff' },
      { text: '▄', fg: '#0000ff', bg: null },
      { text: ' ', fg: null, bg: null },
    ],
  ]);
  // An odd height: the last row's lower half is empty.
  assert.deepEqual(runsOf({ w: 1, h: 1, px: [[red]] }), [[{ text: '▀', fg: '#ff0000', bg: null }]]);
  for (const s of MO_STATES) for (const row of runsOf(mark2(s, 1))) assert.equal(row.map((r) => r.text).join('').length, MARK_W);
  assert.equal(hexOf([1, 171, 255]), '#01abff');
});

test('cells with headroom: the first row leaves its top eighth to the background, one color a cell (the person, 2026-10-14)', () => {
  const red = [255, 0, 0] as const;
  const blue = [0, 0, 255] as const;
  const dim = mix(GLASS, red, 0.1);
  const p: Picture = {
    w: 9,
    h: 4,
    px: [
      [red, red, GLASS, GLASS, red, dim, null, [40, 10, 10], [120, 120, 120]],
      [null, red, GLASS, red, GLASS, blue, red, [10, 40, 10], red],
      [red, null, null, null, null, null, null, null, null],
      [red, null, null, null, null, null, null, null, null],
    ],
  };
  const seven = (c: Rgb) => ({ text: '▇', fg: hexOf(c), bg: null });
  assert.deepEqual(runsOf(p, true)[0], [
    { text: '▇▇', fg: '#ff0000', bg: null }, // alone, or both pixels alike
    { text: '▇', fg: hexOf(GLASS), bg: null }, // the glass on its own
    { text: '▀', fg: hexOf(GLASS), bg: '#ff0000' }, // a shape on the glass keeps its form
    seven(red), // a light over the glass stands out
    seven(blue), // of a dim light and a bright one, the bright one
    { text: '▄', fg: '#ff0000', bg: null }, // nothing above: the half block's room is there already
    seven([40, 10, 10]), // as much color in each: the upper one
    seven(red), // a light under steel (the battery's red cell) still shows
  ]);
  // Only the first row: the rest, and the same picture without headroom, are two pixels a cell.
  assert.deepEqual(runsOf(p, true)[1], runsOf(p)[1]);
  assert.deepEqual(runsOf(p)[0]![0], { text: '▀', fg: '#ff0000', bg: null });
  assert.deepEqual(runsOf(p, true)[1]![0], { text: '▀', fg: '#ff0000', bg: '#ff0000' });
});

test('in the strip nothing but the glass touches the line above, and the two-row Mo lets its head down', () => {
  for (const s of MO_STATES)
    for (const t of TIMES)
      for (const b of ['dark', 'light'] as const) {
        for (const p of [mark1(s, t, b), mark2(s, t, b, true)])
          for (const r of runsOf(p, true)[0]!) if (r.text.includes('▀')) assert.equal(r.fg, hexOf(GLASS), `${s} at ${t}: ${r.fg} touches the line above`);
        // Without the head's top edge, only the antenna (and what goes around) is on the first pixel row.
        const roomy = mark2(s, t, b, true);
        const plain = mark2(s, t, b);
        assert.deepEqual(roomy.px.slice(1), plain.px.slice(1));
        // (The drones of 'agent' fly over it.)
        if (s !== 'agent') for (let x = 6; x <= 12; x++) assert.equal(roomy.px[0]![x], null, `${s} at ${t}: the head's edge at ${x}`);
      }
  assert.notEqual(mark2('idle', 1, 'dark', true).px[0]![14], null);
  assert.notEqual(mark2('idle', 1).px[0]![10], null);
});

test('escape sequences: 24-bit where the terminal takes them, the nearest of 256 colors elsewhere; a line ends reset', () => {
  const p: Picture = {
    w: 2,
    h: 2,
    px: [
      [[255, 0, 0], null],
      [[0, 0, 255], null],
    ],
  };
  const [full] = ansiOf(p, 'truecolor');
  assert.equal(full, '\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀\x1b[0m \x1b[0m');
  const [some] = ansiOf(p, '256');
  assert.equal(some, '\x1b[38;5;196m\x1b[48;5;21m▀\x1b[0m \x1b[0m');
  assert.equal(xterm256([0, 0, 0]), 16);
  assert.equal(xterm256([255, 255, 255]), 231);
  assert.equal(xterm256([128, 128, 128]), 244);
  assert.equal(xterm256([57, 197, 207]), 80);
  // The cube's steps begin at 48 and 115; the gray ramp ends at its 24th gray; a tie goes to the cube.
  assert.equal(xterm256([48, 255, 0]), 82);
  assert.equal(xterm256([47, 255, 0]), 46);
  assert.equal(xterm256([115, 255, 0]), 118);
  assert.equal(xterm256([250, 250, 250]), 231);
  assert.equal(xterm256([240, 240, 240]), 255);
  assert.equal(xterm256([0, 2, 10]), 16);
  // A pixel with only a top half or only a bottom half still gets its color.
  const halves: Picture = {
    w: 2,
    h: 2,
    px: [
      [[255, 0, 0], null],
      [null, [0, 0, 255]],
    ],
  };
  assert.equal(ansiOf(halves, 'truecolor')[0], '\x1b[38;2;255;0;0m▀\x1b[0m\x1b[38;2;0;0;255m▄\x1b[0m\x1b[0m');
});

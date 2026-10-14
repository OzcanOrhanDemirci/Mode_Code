// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the strip above the prompt: a small Mo when the strip takes two rows (`mark2`, 22 x 4 pixels) and
 * only its face when the strip fits on one (`mark1`, 22 x 2). Drawn for their size, not shrunk from the whole
 * body (src/core/mo/art.ts): each state has a sign that reads at a glance, before its meaning does.
 *
 *   idle     dim, a slow breath, a blink now and then      think    violet eyes looking up, three dots in turn
 *   work     a light sweeps the visor, the hands tap       agent    small blue drones circle it
 *   auto     white-hot eyes, flames, a cyan shield         wait     amber, a raised hand
 *   done     mint, a sparkle                               block    red, stern eyes, a red shield
 *   error    red crossed eyes, a shake, a spark            stopped  eyes shut, a z rising
 *   low      dim, a battery with one red cell
 */
import {
  AMBER,
  BACKDROP,
  BLUE,
  CYAN,
  FLAME,
  GLASS,
  MINT,
  RED,
  SPARK,
  STEEL,
  VIOLET,
  clamp,
  dimPicture,
  glow,
  hash,
  mix,
  wave,
  type Backdrop,
  type MoState,
  type Picture,
  type Pixels,
  type Rgb,
} from './art.js';

const TAU = Math.PI * 2;
const gauss = (d: number, s: number): number => Math.exp(-(d * d) / (2 * s * s));

/** The marks' size in pixels; a terminal cell holds two pixels stacked, so 22 columns by 2 rows or 1. */
export const MARK_W = 22;

// Eyes of 2 x 2 pixels: [top left, top right, bottom left, bottom right]. The right eye takes the second
// shape where the two differ.
type Eye = 'open' | 'shut' | 'up' | 'half' | 'stern' | 'cross';
const EYE: Record<Eye, readonly [readonly number[], readonly number[]]> = {
  open: [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ],
  shut: [
    [0, 0, 0.45, 0.45],
    [0, 0, 0.45, 0.45],
  ],
  up: [
    [1, 1, 0, 0],
    [1, 1, 0, 0],
  ],
  half: [
    [0.35, 0.35, 1, 1],
    [0.35, 0.35, 1, 1],
  ],
  stern: [
    [1, 0, 1, 1],
    [0, 1, 1, 1],
  ],
  cross: [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
  ],
};

/** The face of a state at time t: eyes (none while the visor sweeps), their light, where they look, the antenna. */
type Face = { eye: Eye | null; c: Rgb; i: number; look: number; tip: [Rgb, number]; dim: number; shake: number };

function face(state: MoState, t: number): Face {
  const blink = (period: number, offset = 0): boolean => (t + offset) % period > period - 0.16;
  const f: Face = { eye: 'open', c: CYAN, i: 0.9, look: 0, tip: [CYAN, 0.4], dim: 1, shake: 0 };
  switch (state) {
    case 'idle': {
      f.i = 0.58 + 0.14 * wave(t, 3.4);
      const glance = t % 9;
      f.look = glance > 3 && glance < 4.2 ? -1 : glance > 4.6 && glance < 5.8 ? 1 : 0;
      if (blink(4.3)) f.eye = 'shut';
      f.tip = [CYAN, t % 2.2 < 0.2 ? 0.9 : 0.12];
      break;
    }
    case 'think':
      f.eye = blink(5.1, 2) ? 'shut' : 'up';
      f.c = VIOLET;
      f.i = 1;
      f.tip = [VIOLET, 0.4 + 0.6 * clamp(wave(t, 1.2))];
      break;
    case 'work':
      f.eye = null;
      f.tip = [CYAN, t % 0.4 < 0.1 ? 1.2 : 0.25];
      break;
    case 'agent':
      f.i = 0.85;
      if (blink(4.7)) f.eye = 'shut';
      f.tip = [BLUE, 0.9];
      break;
    case 'auto':
      f.i = 1.3;
      if (blink(5.5)) f.eye = 'shut';
      f.tip = [CYAN, 1.2];
      break;
    case 'wait':
      f.c = AMBER;
      f.i = 0.85 + 0.3 * clamp(wave(t, 1.6));
      if (blink(3.6, 1.5)) f.eye = 'shut';
      f.tip = [AMBER, wave(t, 1.6) > 0 ? 1.1 : 0.3];
      break;
    case 'done':
      f.eye = 'up';
      f.c = MINT;
      f.i = 1.05;
      f.tip = [MINT, 1.1];
      break;
    case 'block': {
      const flash = t < 0.9 ? (Math.floor(t / 0.15) % 2 === 0 ? 1.25 : 0.35) : 1;
      f.eye = 'stern';
      f.c = RED;
      f.i = flash;
      f.tip = [RED, flash];
      break;
    }
    case 'error':
      f.eye = 'cross';
      f.c = RED;
      f.i = t < 0.6 ? (Math.floor(t / 0.1) % 2 ? 1.2 : 0.4) : 0.9;
      f.shake = t < 0.6 ? (Math.floor(t / 0.05) % 2 ? 1 : -1) : 0;
      f.tip = [RED, t % 0.9 < 0.1 ? 1.3 : 0.2];
      break;
    case 'stopped':
      f.eye = 'shut';
      f.i = 0.6;
      f.tip = [CYAN, 0];
      break;
    case 'low':
      f.eye = blink(3.2) ? 'shut' : 'half';
      f.i = hash(Math.floor(t * 9)) % 13 === 0 ? 0.08 : 0.4;
      f.tip = [CYAN, 0.08];
      f.dim = 0.72;
      break;
  }
  return f;
}

function canvas(h: number, backdrop: Backdrop) {
  const px: Pixels = Array.from({ length: h }, () => Array<Rgb | null>(MARK_W).fill(null));
  const set = (x: number, y: number, c: Rgb): void => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (cx >= 0 && cy >= 0 && cx < MARK_W && cy < h) px[cy]![cx] = c;
  };
  const bg = BACKDROP[backdrop];
  const fx = (x: number, y: number, c: Rgb, a: number): void => {
    if (a > 0.05) set(x, y, mix(bg, c, a));
  };
  return { px, set, fx };
}

/** Two eyes on glass rows y and y + 1, the left eye's first column xl, the right one's xr. */
function eyes(set: (x: number, y: number, c: Rgb) => void, f: Face, xl: number, xr: number, y: number, isGlass: (x: number) => boolean): void {
  if (!f.eye) return;
  const [left, right] = EYE[f.eye];
  [
    [xl, left],
    [xr, right],
  ].forEach(([x0, shape]) =>
    (shape as readonly number[]).forEach((k, i) => {
      if (k) set((x0 as number) + (i % 2) + f.look, y + Math.floor(i / 2), glow(f.c, f.i * k));
    }),
  );
  // A little of their light on the glass at their outer sides; not between them, so they stay two eyes.
  for (const x of [xl - 1 + f.look, xr + 2 + f.look]) if (isGlass(x)) for (const dy of [0, 1]) set(x, y + dy, mix(GLASS, f.c, 0.12 * Math.min(1, f.i)));
}

/** The light that sweeps the visor while a tool runs, over glass columns a..b. */
function sweep(set: (x: number, y: number, c: Rgb) => void, t: number, a: number, b: number, rows: readonly number[]): void {
  const at = (tt: number): number => a + (b - a) * (0.5 - 0.5 * Math.cos(TAU * tt));
  const head = at(t);
  const tail = at(t - 0.12);
  for (let x = a; x <= b; x++) {
    const i = 0.12 + 1.25 * gauss(x - head, 0.8) + 0.35 * gauss(x - tail, 1.5);
    for (const y of rows) set(x, y, glow(CYAN, i));
  }
}

const BATTERY = ['####.', '#r..#', '####.'];

// ---- two rows: a small Mo, 14 x 4, three columns in; room on both sides for what goes around it ----
//   X the antenna's light   g glass   L R the hands (drawn where the state holds them)
const MINI = ['..345555543X..', '..4gggggggg2..', 'L.4gggggggg2.R', '..3222222221..'];

/**
 * With `headroom` (the strip, where the cells keep a hair of room above them: src/core/mo/cells.ts) the head's
 * top edge is left out and its antenna stands up alone: a cell there holds one color, and the edge would bury
 * the eyes' top half or the glass. The head then sits half a row below the line above.
 */
export function mark2(state: MoState, t: number, backdrop: Backdrop = 'dark', headroom = false): Picture {
  const { px, set, fx } = canvas(4, backdrop);
  const f = face(state, t);
  const mx = 3 + f.shake;
  const lifted = state === 'auto';
  const hot = backdrop === 'light' ? FLAME[1]! : FLAME[0]!; // white would vanish on a light background
  let hl = 2;
  let hr = 2;
  if (state === 'work') {
    hl = Math.floor(t / 0.18) % 2 ? 1 : 2;
    hr = hl === 1 ? 2 : 1;
  } else if (state === 'wait') hr = Math.floor(t / 0.35) % 2 ? 0 : 1;
  else if (state === 'block' || state === 'auto') hl = hr = 1;
  else if (state === 'stopped' || state === 'low') hl = hr = 3;

  // The drones of 'agent' circle it: behind the body on the far side, in front on the near one.
  const front: (() => void)[] = [];
  if (state === 'agent')
    for (let i = 0; i < 3; i++) {
      const a = (TAU * t) / 2.4 + (i * TAU) / 3;
      const draw = (): void => {
        fx(mx + 6.5 + Math.cos(a - 0.35) * 10.5, 1.5 + Math.sin(a - 0.35) * 2.1, BLUE, 0.35);
        set(mx + 6.5 + Math.cos(a) * 10.5, 1.5 + Math.sin(a) * 2.1, glow(BLUE, (t * 3 + i * 0.37) % 1 < 0.5 ? 1.25 : 0.8));
      };
      if (Math.sin(a) > -0.2) front.push(draw);
      else draw();
    }

  MINI.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === 'L' || ch === 'R' || (lifted && y === 3) || (headroom && y === 0 && ch !== 'X')) return;
      set(mx + x, y, ch === 'g' ? GLASS : ch === 'X' ? glow(f.tip[0], f.tip[1]) : STEEL[Number(ch)]!);
    }),
  );
  set(mx, hl, STEEL[4]!);
  set(mx + 13, hr, STEEL[3]!);
  if (state === 'work') sweep(set, t, mx + 3, mx + 10, [1, 2]);
  eyes(set, f, mx + 4, mx + 8, 1, (x) => x >= mx + 3 && x <= mx + 10);

  switch (state) {
    case 'think':
      for (let i = 0; i < 3; i++) for (const y of [1, 2]) fx(17 + i * 2, y, VIOLET, Math.floor(((t / 1.2) % 1) * 3) === i ? 1 : 0.32);
      break;
    case 'auto':
    case 'block': {
      if (lifted) {
        // Two jets under the body's sides (under the eyes they would read as longer eyes).
        const n = Math.floor(t * 12);
        [mx + 2, mx + 10].forEach((x0, side) => {
          const flick = hash(n * 31 + side * 7) % 3;
          set(x0 + side, 3, flick ? hot : FLAME[1]!);
          set(x0 + 1 - side, 3, flick === 1 ? FLAME[1]! : FLAME[2]!);
        });
      }
      const c = lifted ? CYAN : RED;
      const i = lifted ? 0.6 + 0.25 * wave(t, 1.3) : t < 0.9 ? (Math.floor(t / 0.15) % 2 === 0 ? 1 : 0.4) : 0.85;
      for (const [x, y, k] of [
        [1, 0, 0.7],
        [0, 1, 1],
        [0, 2, 1],
        [1, 3, 0.7],
        [18, 0, 0.7],
        [19, 1, 1],
        [19, 2, 1],
        [18, 3, 0.7],
      ] as const)
        fx(x, y, c, i * k);
      break;
    }
    case 'done': {
      const k = clamp(Math.sin((TAU * t) / 1.4));
      fx(19, 1, mix(MINT, [255, 255, 255], 0.5), k);
      for (const [x, y] of [
        [18, 1],
        [20, 1],
        [19, 0],
        [19, 2],
      ] as const)
        fx(x, y, MINT, k * 0.5);
      fx(21, 3, MINT, clamp(-Math.sin((TAU * t) / 1.4)));
      break;
    }
    case 'error': {
      const age = t % 1.2;
      if (age < 0.5) fx(mx + 12 + age * 12, age * 6 - 0.5, SPARK, 1 - age * 1.6);
      break;
    }
    case 'stopped': {
      const p = (t / 2.6) % 1;
      fx(18 + Math.round(p * 2), 3 - Math.round(p * 3), STEEL[5]!, Math.sin(Math.PI * p) * 0.8);
      break;
    }
    case 'low':
      battery(fx, t, 3);
      fx(21, 1, STEEL[5]!, 0.85);
      break;
  }
  for (const draw of front) draw();
  if (f.dim !== 1) dimPicture(px, f.dim);
  return { w: MARK_W, h: 4, px };
}

function battery(fx: (x: number, y: number, c: Rgb, a: number) => void, t: number, rows: number): void {
  BATTERY.slice(0, rows).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') fx(17 + x, y, STEEL[5]!, 0.85);
      if (ch === 'r') fx(17 + x, y, RED, t % 1.2 < 0.7 ? 1 : 0.25);
    }),
  );
}

// ---- one row: the face, 14 x 2, three columns in ----

export function mark1(state: MoState, t: number, backdrop: Backdrop = 'dark'): Picture {
  const { px, set, fx } = canvas(2, backdrop);
  const f = face(state, t);
  const x0 = 3 + f.shake;
  // The drones of 'agent' run a loop around the face: over its top edge one way, behind it the other.
  const front: (() => void)[] = [];
  if (state === 'agent')
    for (let i = 0; i < 3; i++) {
      const u = (t / 2.2 + i / 3) % 1;
      const over = u < 0.5;
      const x = over ? -1 + u * 46 : 22 - (u - 0.5) * 46;
      const draw = (): void => {
        set(x, over ? 0 : 1, glow(BLUE, (t * 3 + i * 0.37) % 1 < 0.5 ? 1.25 : 0.8));
        fx(x + (over ? -1 : 1), over ? 0 : 1, BLUE, 0.35);
      };
      if (over) front.push(draw);
      else draw();
    }
  set(x0, 0, STEEL[4]!);
  set(x0, 1, STEEL[3]!);
  set(x0 + 13, 0, STEEL[3]!);
  set(x0 + 13, 1, STEEL[2]!);
  for (let x = x0 + 1; x <= x0 + 12; x++) for (const y of [0, 1]) set(x, y, GLASS);
  if (state === 'work') sweep(set, t, x0 + 1, x0 + 12, [0, 1]);
  eyes(set, f, x0 + 3, x0 + 9, 0, (x) => x >= x0 + 1 && x <= x0 + 12);

  switch (state) {
    case 'think':
      for (let i = 0; i < 3; i++) fx(18 + i * 2, 1, VIOLET, Math.floor(((t / 1.2) % 1) * 3) === i ? 1 : 0.32);
      break;
    case 'auto': {
      // A jet behind the face: white at the face, cooling and flickering away from it.
      const jet = backdrop === 'light' ? [FLAME[1]!, FLAME[1]!, FLAME[2]!] : FLAME;
      const n = Math.floor(t * 12);
      for (const y of [0, 1]) {
        const len = 2 + (hash(n * 17 + y * 5) % 2);
        for (let i = 0; i < len; i++) set(x0 - 1 - i, y, jet[Math.min(2, i)]!);
      }
      break;
    }
    case 'block': {
      const i = t < 0.9 ? (Math.floor(t / 0.15) % 2 === 0 ? 1 : 0.4) : 0.85;
      for (const x of [x0 - 2, x0 + 15]) for (const y of [0, 1]) fx(x, y, RED, i);
      break;
    }
    case 'done':
      fx(19, 0, mix(MINT, [255, 255, 255], 0.5), clamp(Math.sin((TAU * t) / 1.4)));
      fx(21, 1, MINT, clamp(-Math.sin((TAU * t) / 1.4)));
      break;
    case 'error': {
      const age = t % 1.2;
      if (age < 0.5) fx(x0 + 15 + age * 10, age < 0.25 ? 0 : 1, SPARK, 1 - age * 1.6);
      break;
    }
    case 'stopped': {
      const p = (t / 2.6) % 1;
      fx(19 + Math.round(p * 2), 1 - Math.round(p), STEEL[5]!, Math.sin(Math.PI * p) * 0.8);
      break;
    }
    case 'low':
      battery(fx, t, 2);
      break;
  }
  for (const draw of front) draw();
  if (f.dim !== 1) dimPicture(px, f.dim);
  return { w: MARK_W, h: 2, px };
}

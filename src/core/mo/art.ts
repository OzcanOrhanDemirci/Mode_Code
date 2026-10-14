// SPDX-License-Identifier: Apache-2.0
/**
 * Mo, the project's mascot: a small armored robot that keeps watch while Claude works. Its whole body as
 * pixels, one frame for a state at a time t (seconds since the state began). Pure and deterministic: the
 * control center, the README's picture and the tests draw the same frames. The body is painted by hand;
 * eyes, antenna, hands, legs and effects are drawn per frame so they can move.
 *
 * A pixel is an [r, g, b] color or null, where the surface's own background shows. Two pixels stacked make
 * one terminal cell (src/core/mo/cells.ts).
 */

export type Rgb = readonly [number, number, number];
export type Pixels = (Rgb | null)[][];
export type Picture = { w: number; h: number; px: Pixels };

/** What Mo shows: what Claude is doing, as the session's status words say it (docs/mo.md). */
export type MoState = 'idle' | 'think' | 'work' | 'agent' | 'wait' | 'done' | 'block' | 'error' | 'stopped' | 'auto' | 'low';
export const MO_STATES: readonly MoState[] = ['idle', 'think', 'work', 'agent', 'wait', 'done', 'block', 'error', 'stopped', 'auto', 'low'];

/** The background effects fade into: the terminal's, dark or light. */
export type Backdrop = 'dark' | 'light';

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Steel, from the seam (0) through shadow to highlight (5) and a glint (6). */
export const STEEL: readonly Rgb[] = ['#12171e', '#283240', '#394656', '#4f5e70', '#6b7f95', '#93a8be', '#d5e2ee'].map(hex);
export const GLASS = hex('#0b1f24');
const GLASS_TOP = hex('#10292f');
const GLINT = hex('#2f5560');
export const CYAN = hex('#39c5cf');
export const AMBER = hex('#f5b53d');
export const RED = hex('#ff4d4d');
export const MINT = hex('#5be3b0');
export const VIOLET = hex('#a98bff');
export const BLUE = hex('#6fa0ff');
export const SPARK = hex('#ffd36b');
const SMOKE = hex('#7d848c');
/** A jet's flame: white at the nozzle, cooling away from it. */
export const FLAME: readonly Rgb[] = [hex('#e8feff'), CYAN, hex('#1d5f8a')];
const HOT = new Map<Rgb, Rgb>([
  [CYAN, hex('#d8fcff')],
  [AMBER, hex('#fff0c8')],
  [RED, hex('#ffd6d6')],
  [MINT, hex('#e0fff2')],
  [VIOLET, hex('#efe8ff')],
  [BLUE, hex('#e3edff')],
]);
export const BACKDROP: Record<Backdrop, Rgb> = { dark: hex('#0c0c0c'), light: hex('#f3f3f3') };

const TAU = Math.PI * 2;
export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
export const mix = (a: Rgb, b: Rgb, k: number): Rgb => {
  const f = clamp(k);
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
};
/** A light of color c at intensity i: 0 is dark glass, 1 the color, above 1 toward white hot. */
export const glow = (c: Rgb, i: number): Rgb => (i <= 1 ? mix(GLASS, c, i) : mix(c, HOT.get(c) ?? c, (i - 1) * 1.6));
export const wave = (t: number, period: number, phase = 0): number => Math.sin((TAU * t) / period + phase);
const ease = (x: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));
/** A fixed scramble of an integer: flicker that looks random and is the same every time. */
export const hash = (n: number): number => {
  let x = Math.imul(n, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x ^ (x >>> 13)) >>> 0;
};
/** Colors faded toward gray and dimmed: low energy. */
export function dimPicture(px: Pixels, k: number): void {
  for (const row of px)
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (!c) continue;
      const l = (c[0] + c[1] + c[2]) / 3;
      row[i] = [Math.round((c[0] * 0.6 + l * 0.4) * k), Math.round((c[1] * 0.6 + l * 0.4) * k), Math.round((c[2] * 0.6 + l * 0.4) * k)];
    }
}

// The body, 20 x 13, painted as its left half; the right half is mirrored one tone darker (the light comes
// from the top left).   .  empty   0-6 steel   g glass (the eyes are drawn on it)   C chest light
const LEFT = [
  '.455665555',
  '3444444444',
  '3444444444',
  '3400000000',
  '340ggggggg',
  '340ggggggg',
  '340ggggggg',
  '3411111111',
  '3433333333',
  '345333333C',
  '34333333C1',
  '345333333C',
  '.222222222',
];
const darker = (ch: string): string => (ch >= '2' && ch <= '6' ? String(Number(ch) - 1) : ch);
const BODY = LEFT.map((r) => r + [...r].reverse().map(darker).join(''));
const BODY_W = 20;
const BODY_H = 13;
const GLASS_ROW = 4; // the first of the glass's three rows
const EYE_BOX = [5, 11] as const; // the left column of each 4-wide eye box

// Eyes, 4 x 3 each ('#' full, '+' half). A shape that leans lists the left eye; the right one is its mirror,
// except where both look the same way.
type Eyes = 'open' | 'half' | 'shut' | 'happy' | 'left' | 'right' | 'upRight' | 'angry' | 'cross';
const EYES: Record<Eyes, readonly string[]> = {
  open: ['.##.', '.##.', '.##.'],
  half: ['....', '.##.', '.##.'],
  shut: ['....', '....', '.++.'],
  happy: ['.##.', '#..#', '....'],
  left: ['##..', '##..', '##..'],
  right: ['..##', '..##', '..##'],
  upRight: ['..##', '..##', '....'],
  angry: ['.#..', '.##.', '.##.'],
  cross: ['#..#', '.##.', '#..#'],
};
const SAME_WAY: ReadonlySet<Eyes> = new Set(['left', 'right', 'upRight']);

// Hands float beside the body. The left one as drawn; the right one mirrored, a tone darker.
type Pose = 'fist' | 'palm' | 'thumb';
const HANDS: Record<Pose, readonly string[]> = {
  fist: ['.344.', '34553', '34443', '23332', '.122.'],
  palm: ['.4.4.', '45454', '34443', '34443', '.233.'],
  thumb: ['.4...', '.5...', '3455.', '3444.', '2333.', '.12..'],
};
const handArt = (pose: Pose, right: boolean): readonly string[] => (right ? HANDS[pose].map((r) => [...r].reverse().map(darker).join('')) : HANDS[pose]);

/** The whole picture's size, room for effects around the body included. */
export const ART_W = 40;
export const ART_H = 34;
const GROUND = 29; // the boots' last row
const BODY_X = 10;

type Hand = { pose: Pose; dx: number; dy: number };
type Light = { c: Rgb; i: number };

/** What a state does at time t: the body's place, its face, its hands, and what is drawn around it. */
type Act = {
  lift: number;
  squash: number;
  shake: number;
  eyes: Eyes;
  eyeColor: Rgb;
  eyeI: number;
  look: number;
  core: Light;
  tip: Light;
  sway: number;
  droop: boolean;
  dim: number;
  hands: { l: Hand; r: Hand };
  ring: { c: Rgb; k: number; i: number } | null;
  thrust: boolean;
};

/** One frame of Mo's whole body. */
export function frame(state: MoState, t: number, backdrop: Backdrop = 'dark'): Picture & { glassTop: number; bodyX: number } {
  const bg = BACKDROP[backdrop];
  const px: Pixels = Array.from({ length: ART_H }, () => Array<Rgb | null>(ART_W).fill(null));
  const set = (x: number, y: number, c: Rgb): void => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (cx >= 0 && cy >= 0 && cx < ART_W && cy < ART_H) px[cy]![cx] = c;
  };
  // An effect over the background: faded into it rather than drawn over it.
  const fx = (x: number, y: number, c: Rgb, a: number): void => {
    if (a > 0.04) set(x, y, mix(bg, c, a));
  };
  const front: (() => void)[] = [];
  const behind: (() => void)[] = [];
  const a = act(state, t, fx, set, front, behind);

  const top = GROUND - 4 - BODY_H - a.lift + a.squash; // the body's first row
  const bx = BODY_X + a.shake;

  // Behind the body: the shield, and whatever passes behind it.
  if (a.ring) {
    const cx = bx + BODY_W / 2;
    const cy = top + 6;
    const rx = (BODY_W / 2 + 8.5) * a.ring.k;
    const ry = 13 * a.ring.k;
    const ground = GROUND - a.lift;
    const r = Math.min(rx, ry);
    for (let y = 0; y <= Math.min(ground, ART_H - 1); y++)
      for (let x = 0; x < ART_W; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const edge = Math.max(0, 1 - Math.abs(Math.sqrt(dx * dx + dy * dy) - 1) * r * 1.15);
        if (edge < 0.18) continue;
        const shimmer = 0.62 + 0.38 * Math.cos(Math.atan2(dy, dx) * 2 - t * 3.2);
        fx(x, y, a.ring.c, clamp(a.ring.i * shimmer * edge * Math.min(1, (ground - y + 1) / 4), 0, 1.2));
      }
  }
  for (const draw of behind) draw();

  if (a.thrust) {
    const f = Math.floor(t * 10);
    [bx + 3, bx + 11].forEach((x0, side) => {
      const flick = hash(f * 31 + side * 7) % 3;
      for (let x = x0; x < x0 + 6; x++) {
        const d = Math.abs(x - (x0 + 2.5)) / 3;
        const y = GROUND - a.lift + 1;
        set(x, y, d < 0.5 ? FLAME[0]! : FLAME[1]!);
        if (d < 0.75) set(x, y + 1, d < 0.3 && flick ? FLAME[0]! : FLAME[1]!);
        if (d < 0.4 && flick !== 1) set(x, y + 2, FLAME[2]!);
        if (d < 0.2 && flick === 2) fx(x, y + 3, FLAME[2]!, 0.5);
      }
    });
  }

  // Legs and boots, from the body down to the ground: the legs give when the body sinks onto them.
  const footY = GROUND - a.lift;
  for (const [x0, right] of [
    [bx + 4, false],
    [bx + 12, true],
  ] as const) {
    const tones = right ? [3, 2, 2, 1] : [4, 3, 3, 2];
    for (let y = top + BODY_H; y <= footY - 2; y++) tones.forEach((tone, i) => set(x0 + i, y, STEEL[tone]!));
    const boot = right ? ['233332', '011110'] : ['344443', '122221'];
    boot.forEach((row, dy) => [...row].forEach((ch, i) => set(x0 - 1 + i, footY - 1 + dy, STEEL[Number(ch)]!)));
  }

  // The body.
  for (let y = 0; y < BODY_H; y++)
    for (let x = 0; x < BODY_W; x++) {
      const ch = BODY[y]![x]!;
      if (ch === '.') continue;
      const c = ch === 'g' ? (y === GLASS_ROW ? GLASS_TOP : GLASS) : ch === 'C' ? glow(a.core.c, a.core.i) : STEEL[Number(ch)]!;
      set(bx + x, top + y, c);
    }
  set(bx + 3, top + GLASS_ROW, GLINT);
  set(bx + 4, top + GLASS_ROW, mix(GLASS_TOP, GLINT, 0.5));

  // The eyes, with a little of their light on the glass around them.
  const lit: { x: number; y: number; i: number }[] = [];
  EYE_BOX.forEach((x0, side) => {
    const shape = EYES[a.eyes];
    const rows = side === 1 && !SAME_WAY.has(a.eyes) ? shape.map((r) => [...r].reverse().join('')) : shape;
    rows.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        const x = x0 + dx + a.look;
        if (ch === '.' || x < 3 || x > 16) return;
        const i = a.eyeI * (ch === '+' ? 0.5 : 1);
        set(bx + x, top + GLASS_ROW + dy, glow(a.eyeColor, i));
        lit.push({ x, y: GLASS_ROW + dy, i });
      }),
    );
  });
  for (let y = GLASS_ROW; y < GLASS_ROW + 3; y++)
    for (let x = 3; x <= 16; x++) {
      if (lit.some((l) => l.x === x && l.y === y)) continue;
      const near = lit.reduce((m, l) => (Math.abs(l.x - x) <= 1 && Math.abs(l.y - y) <= 1 ? Math.max(m, l.i) : m), 0);
      if (near) set(bx + x, top + y, mix(px[top + y]![bx + x]!, a.eyeColor, 0.22 * Math.min(1, near)));
    }

  // The antenna: a stalk and a light, swaying, or bent over when Mo is out of energy.
  const ax = bx + 14;
  const tipColor = glow(a.tip.c, a.tip.i);
  set(ax, top - 1, STEEL[2]!);
  if (a.droop) {
    set(ax + 1, top - 2, STEEL[2]!);
    set(ax + 2, top - 2, STEEL[2]!);
    set(ax + 3, top - 1, tipColor);
  } else {
    set(ax + (a.sway > 0 ? 1 : 0), top - 2, STEEL[2]!);
    set(ax + a.sway, top - 3, STEEL[3]!);
    set(ax + a.sway, top - 4, tipColor);
    set(ax + a.sway + 1, top - 4, tipColor);
    set(ax + a.sway, top - 5, mix(tipColor, STEEL[5]!, 0.25));
    set(ax + a.sway + 1, top - 5, tipColor);
  }

  // The hands.
  for (const side of ['l', 'r'] as const) {
    const hand = a.hands[side];
    const art = handArt(hand.pose, side === 'r');
    const x0 = side === 'l' ? bx - 6 + hand.dx : bx + BODY_W + 1 + hand.dx;
    const y0 = top + 6 + hand.dy - (art.length - 5);
    art.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && set(x0 + dx, y0 + dy, STEEL[Number(ch)]!)));
  }

  for (const draw of front) draw();
  if (a.dim !== 1) dimPicture(px, a.dim);
  return { w: ART_W, h: ART_H, px, glassTop: top + GLASS_ROW, bodyX: bx };
}

type Plot = (x: number, y: number, c: Rgb) => void;
type Fade = (x: number, y: number, c: Rgb, a: number) => void;

function act(state: MoState, t: number, fx: Fade, set: Plot, front: (() => void)[], behind: (() => void)[]): Act {
  const fist = (dx = 0, dy = 0): Hand => ({ pose: 'fist', dx, dy });
  const float = (phase: number): number => Math.round(0.9 * wave(t, 2.6, phase));
  const blink = (period: number, offset = 0): boolean => (t + offset) % period > period - 0.16;
  const a: Act = {
    lift: 0,
    squash: 0,
    shake: 0,
    eyes: 'open',
    eyeColor: CYAN,
    eyeI: 1,
    look: 0,
    core: { c: CYAN, i: 0.6 },
    tip: { c: CYAN, i: 0.5 },
    sway: 0,
    droop: false,
    dim: 1,
    hands: { l: fist(0, float(0)), r: fist(0, float(Math.PI / 2)) },
    ring: null,
    thrust: false,
  };
  switch (state) {
    case 'idle': {
      const breathe = wave(t, 3.4);
      a.squash = breathe > 0.55 ? 1 : 0;
      a.core = { c: CYAN, i: 0.5 + 0.2 * breathe };
      a.tip = { c: CYAN, i: t % 2.2 < 0.2 ? 1.1 : 0.15 };
      a.sway = Math.round(wave(t, 3.1) * 0.9);
      const glance = t % 9;
      if (glance > 3 && glance < 4.2) a.eyes = 'left';
      else if (glance > 4.6 && glance < 5.8) a.eyes = 'right';
      if (blink(4.3)) a.eyes = 'shut';
      break;
    }
    case 'think': {
      a.eyes = blink(5.1, 2) ? 'shut' : 'upRight';
      a.eyeColor = VIOLET;
      a.core = { c: VIOLET, i: 0.45 + 0.25 * wave(t, 1.6) };
      a.tip = { c: VIOLET, i: 0.4 + 0.6 * clamp(wave(t, 1.2)) };
      a.hands.r = fist(-4, -2 + Math.round(0.6 * wave(t, 1.9)));
      // Thought bubbles rise one after another beside the antenna.
      for (let i = 0; i < 3; i++) {
        const p = (t / 1.8 + i / 3) % 1;
        const x = BODY_X + 17 + i * 2 + Math.round(p * 2);
        const y = 7 - Math.round(p * 6);
        const size = i === 2 ? 2 : 1;
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) fx(x + dx, y + dy, mix(STEEL[5]!, VIOLET, 0.5), Math.sin(Math.PI * p));
      }
      break;
    }
    case 'work': {
      // Reading: the eyes step along a line, then sweep back to the start of the next.
      const p = t % 2.4;
      const look = p < 1.8 ? -2 + Math.floor(p / 0.45) : 2 - Math.round(ease((p - 1.8) / 0.6) * 4);
      a.look = look;
      a.eyes = blink(6.2, 1) ? 'shut' : 'half';
      a.core = { c: CYAN, i: 0.65 + 0.4 * wave(t, 0.7) };
      a.tip = { c: CYAN, i: t % 0.6 < 0.1 ? 1.2 : 0.25 };
      const tap = (phase: number): number => (Math.sin((TAU * t) / 0.36 + phase) > 0 ? 0 : 1);
      a.hands = { l: fist(2, 3 + tap(0)), r: fist(-2, 3 + tap(Math.PI)) };
      break;
    }
    case 'agent': {
      a.core = { c: CYAN, i: 0.7 + 0.3 * wave(t, 1.1) };
      a.tip = { c: BLUE, i: 0.9 };
      let lead = 0;
      for (let i = 0; i < 3; i++) {
        const angle = (TAU * t) / 3.2 + (i * TAU) / 3;
        const x = BODY_X + BODY_W / 2 + Math.cos(angle) * 16;
        const y = 16 + Math.sin(angle) * 4.5;
        if (i === 0) lead = Math.cos(angle);
        // A drone: two pixels of body and a light that blinks.
        (Math.sin(angle) > 0 ? front : behind).push(() => {
          set(x, y, STEEL[4]!);
          set(x + 1, y, STEEL[3]!);
          set(x + (Math.cos(angle) > 0 ? -1 : 2), y, glow(BLUE, (t * 4 + i) % 1 < 0.5 ? 1.2 : 0.6));
        });
      }
      // The eyes follow the first drone.
      a.eyes = blink(4.7) ? 'shut' : lead > 0.4 ? 'right' : lead < -0.4 ? 'left' : 'open';
      break;
    }
    case 'wait': {
      a.eyeColor = AMBER;
      a.eyes = blink(3.6, 1.5) ? 'shut' : 'open';
      a.eyeI = 0.85 + 0.3 * clamp(wave(t, 1.6));
      a.core = { c: AMBER, i: 0.55 + 0.25 * wave(t, 1.6) };
      a.tip = { c: AMBER, i: wave(t, 1.6) > 0 ? 1.1 : 0.3 };
      a.hands.r = { pose: 'palm', dx: Math.round(wave(t, 0.7)), dy: -7 };
      break;
    }
    case 'done': {
      const jump = t < 0.7 ? Math.sin((Math.PI * t) / 0.7) : 0;
      a.lift = Math.round(jump * 4);
      a.squash = t > 0.7 && t < 0.85 ? 1 : 0;
      a.eyes = 'happy';
      a.eyeColor = MINT;
      a.core = { c: MINT, i: 0.9 };
      a.tip = { c: MINT, i: 1.1 };
      a.hands = { l: fist(0, float(0) - Math.round(jump * 2)), r: t < 0.7 ? fist(0, -Math.round(jump * 3)) : { pose: 'thumb', dx: -1, dy: -4 } };
      // Sparkles: small four-point stars that twinkle in turn.
      if (t >= 0.3)
        [
          [5, 6],
          [33, 4],
          [36, 12],
          [3, 14],
        ].forEach(([x, y], i) => {
          const k = clamp(Math.sin(TAU * (t / 1.4 + i / 4)));
          fx(x!, y!, HOT.get(MINT)!, k);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const)
            fx(x! + dx, y! + dy, MINT, k * 0.55);
        });
      break;
    }
    case 'block': {
      const flash = t < 0.9 ? (Math.floor(t / 0.15) % 2 === 0 ? 1.25 : 0.35) : 0.95 + 0.15 * wave(t, 0.9);
      a.eyeColor = RED;
      a.eyes = 'angry';
      a.eyeI = flash;
      a.core = { c: RED, i: flash };
      a.tip = { c: RED, i: flash };
      const up = ease(t / 0.25);
      a.hands = { l: { pose: 'palm', dx: Math.round(up * 3), dy: -Math.round(up * 3) }, r: { pose: 'palm', dx: -Math.round(up * 3), dy: -Math.round(up * 3) } };
      a.ring = { c: RED, k: t < 0.35 ? 0.55 + 0.45 * Math.sin((Math.PI / 2) * (t / 0.35)) : 1, i: t < 0.9 ? flash * 0.9 : 0.8 + 0.2 * wave(t, 0.9) };
      break;
    }
    case 'error': {
      a.shake = t < 0.6 ? (Math.floor(t / 0.05) % 2 ? 1 : -1) : 0;
      a.eyeColor = RED;
      a.eyes = 'cross';
      a.eyeI = t < 0.6 ? (Math.floor(t / 0.1) % 2 ? 1.2 : 0.4) : 0.8;
      a.core = { c: RED, i: 0.3 + 0.5 * (hash(Math.floor(t * 7)) % 2) };
      a.tip = { c: RED, i: t % 0.9 < 0.1 ? 1.3 : 0.2 };
      a.sway = a.shake;
      a.hands = { l: fist(0, 3), r: fist(0, 3) };
      // Sparks fly from the antenna; smoke rises and fades.
      const tx = BODY_X + 15;
      const ty = 8;
      for (let i = 0; i < 4; i++) {
        const burst = Math.floor(t / 0.9);
        const age = t - burst * 0.9 - i * 0.05;
        if (age < 0 || age > 0.5) continue;
        const dir = (hash(burst * 13 + i) % 7) - 3;
        fx(tx + dir * age * 8, ty - age * 10 + age * age * 30, SPARK, 1 - age * 2);
      }
      for (let i = 0; i < 3; i++) {
        const p = (t / 2.2 + i / 3) % 1;
        const x = tx + 1 + Math.round(Math.sin(p * 5 + i) * 1.5);
        const y = ty - 1 - Math.round(p * 7);
        fx(x, y, SMOKE, (1 - p) * 0.7);
        fx(x + 1, y, SMOKE, (1 - p) * 0.45);
      }
      break;
    }
    case 'stopped': {
      a.squash = 1;
      a.eyes = 'shut';
      a.eyeI = 0.35;
      a.core = { c: CYAN, i: 0.12 + 0.08 * wave(t, 4) };
      a.tip = { c: CYAN, i: 0 };
      a.droop = true;
      a.hands = { l: fist(1, 4), r: fist(-1, 4) };
      // A z rises and fades, then another.
      const Z = ['####', '..#.', '.#..', '####'];
      for (let i = 0; i < 2; i++) {
        const p = (t / 2.6 + i / 2) % 1;
        const x = BODY_X + 17 + i * 4 + Math.round(p * 4);
        const y = 9 - Math.round(p * 8);
        Z.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && fx(x + dx, y + dy, STEEL[5]!, Math.sin(Math.PI * p) * 0.9)));
      }
      break;
    }
    case 'auto': {
      a.lift = 3 + Math.round(wave(t, 1.6));
      a.eyes = blink(5.5) ? 'shut' : 'open';
      a.eyeI = 1.1;
      a.core = { c: CYAN, i: 1.05 + 0.15 * wave(t, 0.5) };
      a.tip = { c: CYAN, i: 1.15 };
      a.sway = -1;
      a.hands = { l: fist(1, 1 + float(0)), r: fist(-1, 1 + float(Math.PI / 2)) };
      a.thrust = true;
      a.ring = { c: CYAN, k: 1, i: 0.45 };
      break;
    }
    case 'low': {
      a.squash = 1;
      a.dim = 0.72;
      a.eyes = blink(3.2) ? 'shut' : 'half';
      a.eyeI = hash(Math.floor(t * 9)) % 13 === 0 ? 0.08 : 0.35;
      a.core = { c: CYAN, i: 0.15 };
      a.tip = { c: CYAN, i: 0.08 };
      a.droop = true;
      a.hands = { l: fist(0, 3 + Math.round(0.5 * wave(t, 4))), r: fist(0, 3 + Math.round(0.5 * wave(t, 4, 1))) };
      // A battery above the head, its one red cell blinking.
      ['#####.', '#r..##', '#####.'].forEach((row, dy) =>
        [...row].forEach((ch, dx) => {
          if (ch === '#') fx(BODY_X + 7 + dx, 3 + dy, STEEL[5]!, 0.9);
          if (ch === 'r') fx(BODY_X + 7 + dx, 3 + dy, RED, t % 1.2 < 0.7 ? 1 : 0.25);
        }),
      );
      break;
    }
  }
  // A short blink as a state begins: the change reads as a reaction. (Not for 'block': it flashes instead.)
  if (t < 0.14 && state !== 'block') a.eyes = 'shut';
  return a;
}

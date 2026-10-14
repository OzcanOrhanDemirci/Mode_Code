// SPDX-License-Identifier: Apache-2.0
/**
 * Mo's pictures for the repository, drawn from the very pixels the program draws (src/core/mo):
 *   docs/images/mo.svg              Mo at rest, thinking, at work and done: a loop for the top of the README
 *   docs/images/mo-states.svg       every state, the whole body and the strip's two marks (docs/mo.md)
 *   docs/images/social-preview.png  Mo stands guard on the control center's window (drawn into the picture;
 *                                   drawing it again changes nothing)
 * A pixel is a square; a row of pixels of one color is one stretch of a path, so the files stay small.
 *
 * Usage: node --import tsx scripts/mo-art.ts     (npm run mo-art)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { frame, MO_STATES, type MoState, type Picture } from '../src/core/mo/art.js';
import { mark1, mark2 } from '../src/core/mo/marks.js';
import { hexOf } from '../src/core/mo/cells.js';
import { STILL_AT } from '../src/core/mo/state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const images = join(root, 'docs', 'images');
const CARD = '#0d1117';
const BORDER = '#30363d';
const LABEL = '#8b949e';

/** The picture as one path per color, offset by (ox, oy) pixels. */
function paths(p: Picture, ox = 0, oy = 0): string {
  const byColor = new Map<string, string[]>();
  p.px.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (!c) {
        x++;
        continue;
      }
      const hex = hexOf(c);
      let end = x + 1;
      while (end < row.length && row[end] && hexOf(row[end]!) === hex) end++;
      const d = byColor.get(hex) ?? [];
      d.push(`M${ox + x} ${oy + y}h${end - x}v1h-${end - x}z`);
      byColor.set(hex, d);
      x = end;
    }
  });
  return [...byColor].map(([hex, d]) => `<path fill="${hex}" d="${d.join('')}"/>`).join('');
}

/** A loop of frames shown one after another, the first one alone where motion is reduced. */
function loop(frames: string[], seconds: number): string {
  const total = (frames.length * seconds).toFixed(2);
  const css =
    `.f{opacity:0;animation:show ${total}s step-end infinite}` +
    `@keyframes show{0%{opacity:1}${(100 / frames.length).toFixed(4)}%{opacity:0}100%{opacity:0}}` +
    frames.map((_, i) => `.f${i}{animation-delay:${(i * seconds).toFixed(2)}s}`).join('') +
    `@media (prefers-reduced-motion:reduce){.f{animation:none}.f0{opacity:1}}`;
  return `<style>${css}</style>${frames.map((f, i) => `<g class="f f${i}">${f}</g>`).join('')}`;
}

// ── the README's loop ──
const STEP = 0.2;
const SCENES: [MoState, number][] = [
  ['idle', 4.6],
  ['think', 2.4],
  ['work', 2.4],
  ['done', 2.2],
];
const heroFrames: string[] = [];
// Each scene opens with the blink a state begins with, as in the strip; the loop's first frame (the one shown
// alone where motion is reduced) has Mo's eyes open.
for (const [state, seconds] of SCENES) for (let t = state === 'idle' ? STEP : 0; t < seconds - 1e-9; t += STEP) heroFrames.push(paths(frame(state, t)));
const scale = 6;
const hero = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${40 * scale}" height="${34 * scale}" viewBox="-2 -2 44 38" shape-rendering="crispEdges" role="img" aria-label="Mo, the Mode_Code mascot: resting, thinking, at work, done">`,
  `<title>Mo, the Mode_Code mascot</title>`,
  `<rect x="-2" y="-2" width="44" height="38" rx="3" fill="${CARD}" stroke="${BORDER}" stroke-width="0.25"/>`,
  loop(heroFrames, STEP),
  `</svg>`,
  '',
].join('\n');
writeFileSync(join(images, 'mo.svg'), hero);
console.log(`mo-art: docs/images/mo.svg: ${heroFrames.length} frames, ${Math.round(hero.length / 1024)} KiB`);

// ── every state, still: the whole body and the strip's marks ──
const NAMES: Record<MoState, string> = {
  idle: 'resting',
  think: 'thinking',
  work: 'at a tool',
  agent: 'agents at work',
  wait: 'waiting for you',
  done: 'done',
  block: 'the belt refused',
  error: 'failed',
  stopped: 'stopped',
  auto: 'full autonomy',
  low: 'quota near its limit',
};
const COLS = 4;
const TILE_W = 46;
const TILE_H = 34 + 1 + 4 + 1 + 2 + 6;
const rows = Math.ceil(MO_STATES.length / COLS);
const W = COLS * TILE_W + 2;
const H = rows * TILE_H + 2;
const tiles = MO_STATES.map((s, i) => {
  const x = 1 + (i % COLS) * TILE_W + 3;
  const y = 1 + Math.floor(i / COLS) * TILE_H;
  const t = STILL_AT[s];
  return (
    paths(frame(s, t), x, y) +
    paths(mark2(s, t), x + 9, y + 35) +
    paths(mark1(s, t), x + 9, y + 40) +
    `<text x="${x + 20}" y="${y + 46.5}" text-anchor="middle">${NAMES[s]}</text>`
  );
});
const sheet = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${H * 4}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img" aria-label="Mo's eleven looks: the whole body, and below it the two-row and one-row marks of the strip">`,
  `<title>Mo's looks</title>`,
  `<style>text{font-family:ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:2.6px;fill:${LABEL}}</style>`,
  `<rect width="${W}" height="${H}" rx="2" fill="${CARD}" stroke="${BORDER}" stroke-width="0.2"/>`,
  ...tiles,
  `</svg>`,
  '',
].join('\n');
writeFileSync(join(images, 'mo-states.svg'), sheet);
console.log(`mo-art: docs/images/mo-states.svg: ${MO_STATES.length} states, ${Math.round(sheet.length / 1024)} KiB`);

// ── the social preview: Mo stands on the control center window's top edge, at its right ──
const png = join(images, 'social-preview.png');
const image = readPng(readFileSync(png));
const still = frame('idle', STILL_AT.idle);
// The body's own pixels only (the frame's room for effects is left out), its boots on the window's edge.
const box = bounds(still);
const S = 4;
const left = 1120;
const bottom = 114;
for (let y = box.y0; y <= box.y1; y++)
  for (let x = box.x0; x <= box.x1; x++) {
    const c = still.px[y]![x];
    if (!c) continue;
    for (let dy = 0; dy < S; dy++)
      for (let dx = 0; dx < S; dx++) {
        const px = left + (x - box.x0) * S + dx;
        const py = bottom - (box.y1 - y + 1) * S + dy + 1;
        const o = (py * image.w + px) * 3;
        image.rgb[o] = c[0];
        image.rgb[o + 1] = c[1];
        image.rgb[o + 2] = c[2];
      }
  }
writeFileSync(png, writePng(image));
console.log('mo-art: docs/images/social-preview.png: Mo drawn in');

function bounds(p: Picture): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  p.px.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }),
  );
  return { x0, y0, x1, y1 };
}

/** An 8-bit RGB PNG, not interlaced (what the social preview is), as its pixels. */
function readPng(b: Buffer): { w: number; h: number; rgb: Buffer } {
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 2 || b[28] !== 0) throw new Error('mo-art: the social preview is not an 8-bit RGB PNG without interlacing');
  const parts: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o);
    if (b.toString('ascii', o + 4, o + 8) === 'IDAT') parts.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = w * 3;
  const rgb = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rgb[y * stride + i - 3]! : 0;
      const up = y ? rgb[(y - 1) * stride + i]! : 0;
      const ul = y && i >= 3 ? rgb[(y - 1) * stride + i - 3]! : 0;
      const p = a + up - ul;
      const paeth = Math.abs(p - a) <= Math.abs(p - up) && Math.abs(p - a) <= Math.abs(p - ul) ? a : Math.abs(p - up) <= Math.abs(p - ul) ? up : ul;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : paeth;
      rgb[y * stride + i] = (line[i]! + pred) & 255;
    }
  }
  return { w, h, rgb };
}

function writePng(img: { w: number; h: number; rgb: Buffer }): Buffer {
  const stride = img.w * 3;
  const raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Mo's pixels as terminal cells: two pixels stacked make one cell, drawn as an upper half block whose
 * foreground is the top pixel and whose background is the bottom one. Where a pixel is empty the
 * terminal's own background shows: the cell becomes a lower half block, or a space. Runs join the cells of
 * one style, for Ink's `Text` and for escape sequences.
 */
import type { Picture, Rgb } from './art.js';

export type Run = { text: string; fg: string | null; bg: string | null };

const two = (n: number): string => n.toString(16).padStart(2, '0');
export const hexOf = (c: Rgb): string => `#${two(c[0])}${two(c[1])}${two(c[2])}`;

/** The picture's rows of cells, each row a list of runs of one style. */
export function runsOf(p: Picture): Run[][] {
  const rows: Run[][] = [];
  for (let y = 0; y < p.h; y += 2) {
    const row: Run[] = [];
    for (let x = 0; x < p.w; x++) {
      const top = p.px[y]?.[x] ?? null;
      const bottom = p.px[y + 1]?.[x] ?? null;
      const cell: Run =
        top && bottom
          ? { text: '▀', fg: hexOf(top), bg: hexOf(bottom) }
          : top
            ? { text: '▀', fg: hexOf(top), bg: null }
            : bottom
              ? { text: '▄', fg: hexOf(bottom), bg: null }
              : { text: ' ', fg: null, bg: null };
      const last = row[row.length - 1];
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text;
      else row.push(cell);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The picture as text with escape sequences, one line per row: 24-bit colors where the terminal takes them,
 * else the nearest of the 256-color palette. Each line ends with the colors reset.
 */
export function ansiOf(p: Picture, depth: 'truecolor' | '256'): string[] {
  const color = (hex: string, layer: 38 | 48): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return depth === 'truecolor' ? `\x1b[${layer};2;${r};${g};${b}m` : `\x1b[${layer};5;${xterm256([r, g, b])}m`;
  };
  return runsOf(p).map(
    (row) => row.map((r) => (r.fg || r.bg ? `${r.fg ? color(r.fg, 38) : ''}${r.bg ? color(r.bg, 48) : ''}${r.text}\x1b[0m` : r.text)).join('') + '\x1b[0m',
  );
}

/** The nearest color of the xterm 256-color palette: its 6 x 6 x 6 cube or its gray ramp. */
export function xterm256(c: Rgb): number {
  const level = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const steps = [0, 95, 135, 175, 215, 255];
  const [r, g, b] = [level(c[0]), level(c[1]), level(c[2])];
  const cube = 16 + 36 * r + 6 * g + b;
  const cubeColor: Rgb = [steps[r]!, steps[g]!, steps[b]!];
  const avg = (c[0] + c[1] + c[2]) / 3;
  const grayIndex = Math.min(23, Math.max(0, Math.round((avg - 8) / 10)));
  const grayValue = 8 + grayIndex * 10;
  const dist = (a: Rgb, q: Rgb): number => (a[0] - q[0]) ** 2 + (a[1] - q[1]) ** 2 + (a[2] - q[2]) ** 2;
  return dist(c, [grayValue, grayValue, grayValue]) < dist(c, cubeColor) ? 232 + grayIndex : cube;
}

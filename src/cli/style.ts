// SPDX-License-Identifier: Apache-2.0
/** Terminal colors for plain command output. Off when NO_COLOR is set, when output is not a terminal, or in plain mode. */
import { textWidth } from '../node/width.js';

let enabled = (() => {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return !!process.stdout.isTTY && process.env.TERM !== 'dumb';
})();

export function setColor(on: boolean): void {
  enabled = on;
}

export function colorOn(): boolean {
  return enabled;
}

/**
 * Whether the terminal takes 24-bit colors: those that say so (COLORTERM), and the ones known to (Windows
 * Terminal, iTerm2, WezTerm, VS Code, Ghostty). Elsewhere (macOS Terminal among them) the 256-color palette.
 */
export function colorDepth(env: NodeJS.ProcessEnv = process.env): 'truecolor' | '256' {
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor';
  if (env.WT_SESSION) return 'truecolor';
  return ['iTerm.app', 'WezTerm', 'vscode', 'ghostty'].includes(env.TERM_PROGRAM ?? '') ? 'truecolor' : '256';
}

const wrap = (open: number, close: number) => (s: string) => (enabled ? `\u001B[${open}m${s}\u001B[${close}m` : s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Visible width of a string: ANSI codes removed, wide characters counted as two. */
export const width = textWidth;

export function padEnd(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - width(s)));
}

export function padStart(s: string, n: number): string {
  return ' '.repeat(Math.max(0, n - width(s))) + s;
}

/** A simple aligned table; the first row is the header (drawn bold). Columns listed in `right` align right. */
export function table(rows: string[][], right: number[] = []): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...rows.map((r) => width(r[c] ?? ''))));
  return rows
    .map((r, i) =>
      r
        .map((cell, c) => {
          const v = right.includes(c) ? padStart(cell, widths[c]!) : padEnd(cell, widths[c]!);
          return i === 0 ? bold(v) : v;
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

// SPDX-License-Identifier: Apache-2.0
/** Prose laid out for a terminal (docs/design.md, Grid and spacing). Pure. */

/**
 * Wraps prose at word boundaries to `width` columns. A line never starts with the space a break fell on (Ink's own
 * wrap keeps it), and a word longer than a line is cut across lines. `measure` gives a string's width in columns;
 * by default one per character.
 */
export function wrapText(text: string, width: number, measure: (s: string) => number = (s) => [...s].length): string[] {
  const w = Math.max(1, Math.floor(width));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= w) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = word;
      // A word wider than the line goes across lines, cut where it no longer fits.
      while (measure(line) > w) {
        let cut = '';
        for (const ch of line) {
          if (measure(cut + ch) > w) break;
          cut += ch;
        }
        out.push(cut);
        line = line.slice(cut.length);
      }
    }
    out.push(line);
  }
  return out;
}

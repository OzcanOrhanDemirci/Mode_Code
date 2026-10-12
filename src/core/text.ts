// SPDX-License-Identifier: Apache-2.0
/**
 * Text helpers shared by the keyword engine, the command parser and the interface. Pure: no Node APIs,
 * because the in-process mod runs this code in an environment without Node.
 */

/**
 * Folds text for matching what people type: case, diacritics and whitespace stop mattering.
 *
 * Built for keyboards in the wild: "termınal devam" (dotless ı), "TERMİNAL DEVAM" (dotted capital İ) and
 * "terminal  devam" all fold to "terminal devam". Note the trap this avoids: `"İ".toLowerCase()` is "i̇",
 * an i followed by a combining dot, so a plain lowercase comparison never matches.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Restricted Damerau-Levenshtein distance (insert, delete, substitute, swap adjacent), capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return Math.min(d[rows - 1]![cols - 1]!, max + 1);
}

/** Cuts text to `max` characters, ending with an ellipsis when it was longer. Counts code points. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return chars.slice(0, max).join('');
  return chars.slice(0, max - 1).join('') + '…';
}

/** Formats `{name}` placeholders. A placeholder with no value stays visible, so a missing argument is noticed. */
export function format(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = params[key];
    return v === undefined ? whole : String(v);
  });
}

/** Columns a string takes in a terminal: wide characters (CJK, most emoji) count two, combining marks none. */
export function textWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\u001B\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) continue;
    const wide =
      cp >= 0x1100 &&
      (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x1f300 && cp <= 0x1faff));
    w += wide ? 2 : 1;
  }
  return w;
}

/** Cuts text to at most `max` terminal columns, ending with an ellipsis when it was longer. */
export function fitWidth(text: string, max: number): string {
  if (max <= 0) return '';
  if (textWidth(text) <= max) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = textWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

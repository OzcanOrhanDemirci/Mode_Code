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

/**
 * Text with every character a reader would not see written out: control characters (a newline and a tab aside),
 * zero-width and direction marks, Unicode tags. A command left to the person is shown so: what they read is what
 * would run.
 */
export function visibleText(text: string): string {
  return text.replace(
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu,
    (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`,
  );
}

/** Formats `{name}` placeholders. A placeholder with no value stays visible, so a missing argument is noticed. */
export function format(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = Object.hasOwn(params, key) ? params[key] : undefined;
    return v === undefined ? whole : String(v);
  });
}

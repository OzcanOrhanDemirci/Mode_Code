// SPDX-License-Identifier: Apache-2.0
/**
 * Terminal widths for the command line and the control center, measured exactly as the control center's
 * layout engine (Ink) measures them: with its own string-width. One measure, so what is cut to fit is cut
 * where the layout puts the edge. (A width table of our own disagreed with it on 756 characters, among them
 * 🛡, ⚪, ✅ and ⛔, which the interface draws; found by the screen-width tests.)
 */
import stringWidth from 'string-width';

/** Columns a string takes in a terminal; ANSI colour codes take none. */
export function textWidth(s: string): number {
  return stringWidth(s);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Cuts text to at most `max` columns, ending with an ellipsis when it was longer; never splits a grapheme. */
export function fitWidth(text: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(text) <= max) return text;
  let out = '';
  let w = 0;
  for (const { segment } of segmenter.segment(text)) {
    const cw = stringWidth(segment);
    if (w + cw > max - 1) break;
    out += segment;
    w += cw;
  }
  return out.trimEnd() + '…';
}

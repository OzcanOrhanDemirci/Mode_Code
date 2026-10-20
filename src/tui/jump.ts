// SPDX-License-Identifier: Apache-2.0
/**
 * Jump mode (docs/design.md, The control center): a label beside everything on the screen a click presses, and typing
 * the label presses it, so the keyboard reaches any target in two or three keys without walking to it. One letter each
 * while there are few targets, two each beyond, so no label is the start of another. Pure.
 */

/** The letters labels are made of, the home row first. */
export const JUMP_LETTERS = 'asdfghjklqwertyuiopzxcvbnm';

/** `n` labels, in the order of the targets they go to. */
export function jumpLabels(n: number): string[] {
  const l = [...JUMP_LETTERS];
  if (n <= l.length) return l.slice(0, n);
  const out: string[] = [];
  for (const a of l) for (const b of l) if (out.length < n) out.push(a + b);
  return out;
}

/** What typing `typed` does: presses the target whose label it is, waits for more, or matches nothing. */
export function jumpMatch(labels: readonly string[], typed: string): { press: number } | 'more' | 'none' {
  const exact = labels.indexOf(typed);
  if (exact >= 0) return { press: exact };
  return labels.some((l) => l.startsWith(typed)) ? 'more' : 'none';
}

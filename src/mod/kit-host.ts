// SPDX-License-Identifier: Apache-2.0
/**
 * The UI kit's Claude Code host (src/core/ux/kit.ts): its boxes, texts and pressables are the elements the surface
 * resolves (`$.ui.resolve(e)`), its colours Claude Code's theme keys, so they follow the person's theme there. The
 * kit sets only props Claude Code takes: the three functions below hold the kit's props to this Claude Code's own
 * declarations, so `npm run test:mod` fails the day one is not.
 */
import type { BoxProps, ButtonProps, TextProps } from 'claude-code';
import { cells } from '../core/controls.js';
import type { Child, KitBox, KitHost, KitPress, KitText } from '../core/ux/kit.js';
import { COLORS } from '../core/ux/tokens.js';

type Tag = Parameters<typeof h>[0];
type Node = ReturnType<typeof h>;

const box = (p: KitBox): BoxProps => p;
const text = (p: KitText): TextProps => p;
// An assignment lets a prop Claude Code lacks through (TypeScript checks extra keys on literals only): name none.
type Only<A, B> = [Exclude<keyof A, keyof B>] extends [never] ? true : Exclude<keyof A, keyof B>;
const boxKeys: Only<KitBox, BoxProps> = true;
const textKeys: Only<KitText, TextProps> = true;
void boxKeys;
void textKeys;
const button = (p: KitPress): Omit<ButtonProps, 'label'> => ({
  key: p.id,
  plain: true,
  onPress: () => p.onPress(),
  ...(p.hotkey ? { hotkey: p.hotkey } : {}),
  ...(p.primary ? { variant: 'primary' as const } : {}),
});

/** Children as the surface takes them: nothing drawn for an absent one. */
const kids = (c: Child<Node>[]): unknown[] => c.filter((x) => x !== null && x !== undefined && x !== false);

/** The kit on a surface's elements; a pressable holds only text there, as Claude Code's Button does. */
export function claudeHost(els: { Box: unknown; Text: unknown; Button: unknown }): KitHost<Node> {
  return {
    box: (p, ...c) => h(els.Box as Tag, box(p), ...kids(c)),
    text: (p, ...c) => h(els.Text as Tag, text(p), ...kids(c)),
    press: (p, ...c) => h(els.Button as Tag, button(p), ...kids(c)),
    color: (m) => COLORS[m].claude,
    plain: false,
    measure: cells,
  };
}

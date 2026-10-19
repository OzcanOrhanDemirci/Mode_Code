// SPDX-License-Identifier: Apache-2.0
/**
 * The UI kit's control-center host (src/core/ux/kit.ts): its boxes and texts are Ink's, its pressables register with
 * the pointer (src/tui/press.tsx), its colours come from the theme, so plain mode, high contrast and NO_COLOR apply.
 */
import { createElement, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { KitHost } from '../core/ux/kit.js';
import type { Meaning } from '../core/ux/tokens.js';
import { textWidth } from '../node/width.js';
import { Pressable } from './press.js';
import type { Theme } from './theme.js';

export function themeColor(theme: Theme, m: Meaning): string | undefined {
  switch (m) {
    case 'on':
      return theme.ok;
    case 'off':
      return theme.muted;
    case 'ask':
      return theme.warn;
    case 'bad':
    case 'bypass':
      return theme.bad;
    case 'focus':
      return theme.accent;
    case 'agents':
      return theme.agents;
  }
}

export function inkHost(theme: Theme): KitHost<ReactNode> {
  return {
    box: (p, ...c) => createElement(Box, p, ...c),
    text: (p, ...c) => createElement(Text, p, ...c),
    press: (p, ...c) => createElement(Pressable, { key: p.id, onPress: p.onPress, describe: p.describe }, ...c),
    color: (m) => themeColor(theme, m),
    plain: theme.plain,
    measure: textWidth,
  };
}

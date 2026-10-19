// SPDX-License-Identifier: Apache-2.0
/**
 * Colors and symbols of the control center, from the design tokens (src/core/ux/tokens.ts). Color never carries
 * meaning alone: every state also has a symbol and a word. Plain mode (accessibility, or terminals without Unicode)
 * swaps every symbol for ASCII and drops borders; high contrast keeps only bold, inverse and the basic colors; no
 * color (NO_COLOR) draws no color at all and changes nothing else.
 */
import type { HealthState } from '../app/health.js';
import { COLORS, mark, type Meaning } from '../core/ux/tokens.js';

export interface Theme {
  plain: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  noColor: boolean;
  accent: string | undefined;
  ok: string | undefined;
  warn: string | undefined;
  bad: string | undefined;
  muted: string | undefined;
  agents: string | undefined;
  border: 'round' | 'single' | undefined;
  sym: {
    ok: string;
    warn: string;
    bad: string;
    off: string;
    absent: string;
    more: string;
    back: string;
    lock: string;
    dot: string;
    sep: string;
    shield: string;
    cursor: string;
  };
  categoryIcon: Record<string, string>;
}

/** NO_COLOR set to anything but empty turns color off (https://no-color.org). */
export function noColorAsked(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NO_COLOR !== undefined && env.NO_COLOR !== '';
}

export function makeTheme(opts: { plain?: boolean; highContrast?: boolean; reduceMotion?: boolean; noColor?: boolean } = {}): Theme {
  const plain = !!opts.plain;
  const hc = !!opts.highContrast;
  const noColor = !!opts.noColor;
  const color = (m: Meaning) => (noColor ? undefined : hc ? COLORS[m].bright : COLORS[m].ink);
  return {
    plain,
    highContrast: hc,
    reduceMotion: !!opts.reduceMotion,
    noColor,
    accent: color('focus'),
    ok: color('on'),
    warn: color('ask'),
    bad: color('bad'),
    muted: color('off'),
    agents: color('agents'),
    border: plain ? undefined : 'round',
    sym: {
      ok: mark('ok', plain),
      warn: mark('look', plain),
      bad: mark('bad', plain),
      off: mark('off', plain),
      absent: mark('none', plain),
      more: mark('more', plain),
      back: mark('back', plain),
      lock: mark('lock', plain),
      dot: plain ? '*' : '•',
      sep: plain ? ' / ' : ' › ',
      shield: plain ? '[belt]' : '🛡',
      cursor: mark('focus', plain),
    },
    categoryIcon: plain
      ? { home: '1', projects: '2', sessions: '3', measure: '4', security: '5', 'claude-code': '6', automation: '7', settings: '8' }
      : { home: '⌂', projects: '▤', sessions: '☰', measure: '▥', security: '⛨', 'claude-code': '◆', automation: '⟳', settings: '⚙' },
  };
}

export function stateColor(t: Theme, s: HealthState): string | undefined {
  return s === 'ok' ? t.ok : s === 'red' ? t.bad : s === 'gray' ? t.warn : t.muted;
}

export function stateSymbol(t: Theme, s: HealthState): string {
  return s === 'ok' ? t.sym.ok : s === 'red' ? t.sym.bad : s === 'gray' ? t.sym.warn : s === 'off' ? t.sym.off : t.sym.absent;
}

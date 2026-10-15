// SPDX-License-Identifier: Apache-2.0
/**
 * Colors and symbols of the control center. Color never carries meaning alone: every state also has a
 * symbol and a word. Plain mode (accessibility, or terminals without Unicode) swaps every symbol for ASCII
 * and drops borders; high contrast keeps only bold, inverse and the basic colors.
 */
import type { HealthState } from '../app/health.js';

export interface Theme {
  plain: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  accent: string;
  ok: string;
  warn: string;
  bad: string;
  muted: string;
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

export function makeTheme(opts: { plain?: boolean; highContrast?: boolean; reduceMotion?: boolean } = {}): Theme {
  const plain = !!opts.plain;
  const hc = !!opts.highContrast;
  return {
    plain,
    highContrast: hc,
    reduceMotion: !!opts.reduceMotion,
    accent: hc ? 'whiteBright' : 'cyan',
    ok: hc ? 'greenBright' : 'green',
    warn: hc ? 'yellowBright' : 'yellow',
    bad: hc ? 'redBright' : 'red',
    muted: hc ? 'white' : 'gray',
    border: plain ? undefined : 'round',
    sym: plain
      ? {
          ok: '[ok]',
          warn: '[~]',
          bad: '[!!]',
          off: '[off]',
          absent: '[--]',
          more: '>',
          back: '<',
          lock: '(locked)',
          dot: '*',
          sep: ' / ',
          shield: '[belt]',
          cursor: '>',
        }
      : { ok: '✓', warn: '◌', bad: '✗', off: '○', absent: '·', more: '›', back: '‹', lock: '🔒', dot: '•', sep: ' › ', shield: '🛡', cursor: '▸' },
    categoryIcon: plain
      ? { home: '1', projects: '2', sessions: '3', measure: '4', security: '5', 'claude-code': '6', automation: '7', settings: '8' }
      : { home: '⌂', projects: '▤', sessions: '☰', measure: '▥', security: '⛨', 'claude-code': '◆', automation: '⟳', settings: '⚙' },
  };
}

export function stateColor(t: Theme, s: HealthState): string {
  return s === 'ok' ? t.ok : s === 'red' ? t.bad : s === 'gray' ? t.warn : t.muted;
}

export function stateSymbol(t: Theme, s: HealthState): string {
  return s === 'ok' ? t.sym.ok : s === 'red' ? t.sym.bad : s === 'gray' ? t.sym.warn : s === 'off' ? t.sym.off : t.sym.absent;
}

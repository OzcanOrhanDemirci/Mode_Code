// SPDX-License-Identifier: Apache-2.0
/**
 * The design tokens (docs/design.md, Colour and marks): what each meaning looks like, in every host. One table, so
 * the control center (Ink), the windows inside Claude Code and the command line draw a state the same way. Colour
 * never carries a meaning alone: every meaning has a mark, and a plain spelling for terminals without Unicode or
 * colour. Pure: the in-process plugin uses it too.
 */

/** What a colour or a mark says. */
export type Meaning = 'on' | 'off' | 'ask' | 'bad' | 'focus' | 'bypass' | 'agents';

/**
 * The colour of each meaning: Ink's names (the 16 basic colours, so the person's terminal theme decides the contrast),
 * their bright variants for high contrast, and the theme keys Claude Code draws with (they follow the person's theme
 * there).
 */
export const COLORS: Record<Meaning, { ink: string; bright: string; claude: string }> = {
  on: { ink: 'green', bright: 'greenBright', claude: 'success' },
  off: { ink: 'gray', bright: 'white', claude: 'inactive' },
  ask: { ink: 'yellow', bright: 'yellowBright', claude: 'warning' },
  bad: { ink: 'red', bright: 'redBright', claude: 'error' },
  focus: { ink: 'cyan', bright: 'whiteBright', claude: 'suggestion' },
  bypass: { ink: 'red', bright: 'redBright', claude: 'error' },
  agents: { ink: 'blue', bright: 'blueBright', claude: 'permission' },
};

/** A mark: the glyph, and how it reads without Unicode or colour. */
export interface Mark {
  glyph: string;
  plain: string;
}

const m = (glyph: string, plain: string): Mark => ({ glyph, plain });

/** Every mark a surface draws, each with one meaning (docs/design.md: one idea, one mark). */
export const MARKS = {
  /** A switch that is on; something on, done, healthy. */
  on: m('●', '[on]'),
  /** A switch that is off; idle, not set. */
  off: m('○', '[off]'),
  ok: m('✓', '[ok]'),
  none: m('·', '[--]'),
  /** It asks you. */
  ask: m('?', '[?]'),
  /** It needs a look. */
  look: m('!', '[!]'),
  /** Blocked, failed. */
  bad: m('✗', '[x]'),
  /** Danger, near a limit. */
  danger: m('▲', '[!!]'),
  /** The focus, the selected row. */
  focus: m('▸', '>'),
  /** Leads somewhere: a link, a page with more. */
  more: m('›', '>'),
  back: m('‹', '<'),
  /** The option chosen among several, and the others. */
  chosen: m('◉', '(*)'),
  option: m('○', '( )'),
  /** Opens a window: nothing changes until you act there. */
  opener: m('…', '...'),
  /** Does something now (on the strip). */
  action: m('▶', '>'),
  bypass: m('⚡', '[bypass]'),
  agents: m('👥', '[agents]'),
  lock: m('🔒', '(locked)'),
  /** A meter's filled and empty cells, and its threshold. */
  fill: m('█', '#'),
  track: m('░', '-'),
  threshold: m('│', '|'),
} as const;

export type MarkName = keyof typeof MARKS;

/** A mark as this surface draws it. */
export function mark(name: MarkName, plain: boolean): string {
  return plain ? MARKS[name].plain : MARKS[name].glyph;
}

/** The mark that goes with a meaning, where a state is shown by itself. */
export const MEANING_MARK: Record<Meaning, MarkName> = {
  on: 'ok',
  off: 'none',
  ask: 'ask',
  bad: 'bad',
  focus: 'focus',
  bypass: 'bypass',
  agents: 'agents',
};

/** How long a notice stays (docs/design.md, Components): a note, the result of an act, something to read. */
export const TOAST_MS = { note: 4000, result: 8000, attention: 15000 } as const;
export type ToastLength = keyof typeof TOAST_MS;

/** The label column of a block: as wide as its longest label plus two, at most 40 (docs/design.md, Grid and spacing). */
export function labelColumn(labels: readonly string[], measure: (s: string) => number = (s) => [...s].length, max = 40): number {
  return Math.min(max, Math.max(0, ...labels.map(measure)) + 2);
}

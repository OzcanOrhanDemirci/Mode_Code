// SPDX-License-Identifier: Apache-2.0
// The values the plugin keeps in Claude Code's session state ($.state), read while drawing.

/** Footer lines per answer, keyed by a hash of the answer's text. */
export type ModeCodeFooters = Record<string, string[]>;

/**
 * What the prompt footer shows: mode labels at the right, quota at the end of the hint line; the line above
 * the prompt; and the strip of controls above it (the mode, the way of working, the flow's place), or null.
 */
export type ModeCodeLabels = {
  modes: string[];
  tail: string;
  band: string;
  /** What the band says, by meaning (src/core/ux/tokens.ts): drawn with its mark and colour; null, as it is. */
  bandMeaning: 'on' | 'ask' | null;
  /** The lines of this session's activity a person reads (src/core/ux/activity.ts): the count under the strip. */
  activity?: number;
  strip: {
    mode: 'free' | 'chat' | 'research' | 'plan' | 'code';
    style: 'manual' | 'autonomous' | 'full';
    flow: { at: string; state: 'running' | 'approval' | 'paused' | 'armed' } | null;
    fullAutoShown: boolean;
    bypass: { shown: boolean; on: boolean; count: number };
    lang: 'en' | 'tr';
    /** The person asked for less motion: the flow's step is marked, not breathing. */
    still: boolean;
  } | null;
};

/**
 * What Mo, the mascot in the strip, knows of the session (src/core/mo/state.ts): what runs and what waits now,
 * and when something last happened that it shows for a few seconds. `at` is the clock these times are on,
 * when they were written: the drawing ages them from there on its own clock.
 */
export type ModeCodeMo = {
  /** Mo is drawn (the setting, and not plain text); `still`: it does not move (reduced motion). */
  show: boolean;
  still: boolean;
  /** The terminal's background as Claude Code's theme says it: what faint light fades into. */
  backdrop: 'dark' | 'light';
  /**
   * Mo is one row tall even beside a strip of two: in Apple's Terminal half blocks leave a gap between rows, and
   * the two-row Mo, whose eyes cross the rows, read as two Mos stacked (the Mac, 2026-10-15).
   */
  oneRow: boolean;
  tools: number;
  agents: number;
  asking: number;
  waiting: boolean;
  auto: boolean;
  low: boolean;
  blockAt: number | null;
  errorAt: number | null;
  doneAt: number | null;
  stoppedAt: number | null;
  at: number;
};

/**
 * The window where full autonomy is started (a pane): the budgets it offers and the one picked, the week's
 * reading they are measured from, a line saying what is missing, the language. The task's text is the plugin's
 * own while it is typed (a redraw on every key would fight the typing), drawn into the field on each redraw.
 */
export type ModeCodeAutoPane = {
  lang: 'en' | 'tr';
  budgets: string[];
  budget: string;
  week: number | null;
  error: string | null;
};

/**
 * The window where the person sets the session's parallel agents (src/core/agents.ts): the mode, its count as typed,
 * an assigned batch's rows (the one being edited), whether this mode can write, whether a full-autonomy run is attached,
 * the agents at work now, and a line saying what is wrong. The task being typed is the plugin's own while it is typed.
 */
export type ModeCodeAgentsPane = {
  lang: 'en' | 'tr';
  /** The session's agents as the window opened, in words: how it is now. */
  current: string;
  mode: 'off' | 'free' | 'assigned';
  n: string;
  rows: { task: string; kind: 'code' | 'research' | 'plan'; model: string | null }[];
  editing: number;
  writable: boolean;
  runActive: boolean;
  running: { id: string; label: string }[];
  error: string | null;
};

/**
 * The control of the strip that holds the keyboard's focus (its command's name), and when it took it: its card shows
 * under the strip. Claude Code says nothing when the focus goes back to the prompt, so the card leaves on its own.
 */
export type ModeCodeStripFocus = { id: string | null; at: number };

/** The window where the weekly budget is set: the week's reading, the budget now, the limit, the option picked. */
export type ModeCodeQuotaPane = {
  lang: 'en' | 'tr';
  week: number | null;
  target: number | null;
  limit: number;
  pick: string;
  error: string | null;
};

/** The window where a flow is started: the one picked; the task typed is the plugin's own while it is typed. */
export type ModeCodeFlowPane = {
  lang: 'en' | 'tr';
  pick: 'full' | 'plan' | 'research' | 'researchPlan';
  error: string | null;
};

/** The window that turns bypass on: for how long, and until when, read as it opened. */
export type ModeCodeBypassPane = {
  lang: 'en' | 'tr';
  hours: number;
  until: string;
  error: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'mode-code': {
      footers: ModeCodeFooters;
      labels: ModeCodeLabels;
      mo: ModeCodeMo;
      autoPane: ModeCodeAutoPane;
      agentsPane: ModeCodeAgentsPane;
      stripFocus: ModeCodeStripFocus;
      quotaPane: ModeCodeQuotaPane;
      flowPane: ModeCodeFlowPane;
      bypassPane: ModeCodeBypassPane;
    };
  }
}

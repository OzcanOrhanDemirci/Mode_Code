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
  strip: {
    mode: 'free' | 'chat' | 'research' | 'plan' | 'code';
    style: 'manual' | 'autonomous' | 'full';
    flow: { at: string; state: 'running' | 'approval' | 'paused' | 'armed' } | null;
    fullAutoShown: boolean;
    fullAutoHere: boolean;
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

declare module 'claude-code' {
  interface PluginState {
    'mode-code': { footers: ModeCodeFooters; labels: ModeCodeLabels; mo: ModeCodeMo };
  }
}

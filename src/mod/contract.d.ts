// SPDX-License-Identifier: Apache-2.0
// The values the plugin keeps in Claude Code's session state ($.state), read while drawing.

/** The answer summary per answer, keyed by a hash of the answer's text. */
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
  /** Those of them that wait for the person: the count says them instead, in the colour of a question. */
  waiting?: number;
  strip: {
    mode: 'free' | 'chat' | 'research' | 'plan' | 'code';
    style: 'manual' | 'autonomous' | 'full';
    flow: { at: string; state: 'running' | 'approval' | 'paused' | 'armed' } | null;
    lang: 'en' | 'tr';
    /** The person asked for less motion: the flow's step is marked, not breathing. */
    still: boolean;
    /** The cockpit is open: "0 ≡ cockpit" is lit. */
    cockpit?: boolean;
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
 * The window where the person sets the session's parallel agents (src/core/agents.ts): the mode, its count as typed,
 * an assigned batch's rows (the one being edited), whether this mode can write, the agents at work now, and a line
 * saying what is wrong. The task being typed is the plugin's own while it is typed.
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

/** A meaning a line is drawn in (src/core/ux/tokens.ts). */
export type ModeCodeCockpitMeaning = 'on' | 'off' | 'ask' | 'bad' | 'focus' | 'agents';
/** What a press in the cockpit does (src/core/ux/cockpit.ts, CockpitAct). */
export type ModeCodeCockpitAct = { label: string; card: string; opens: boolean } & (
  { kind: 'control'; name: string } | { kind: 'center'; address: string } | { kind: 'allow'; path: string }
);

/**
 * What the cockpit shows (src/core/ux/cockpit.ts, CockpitData), worked out by the hooks from the settings and the
 * session and drawn from here; null before the cockpit is first opened in the session.
 */
export type ModeCodeCockpit = {
  data: {
    lang: 'en' | 'tr';
    at: number;
    can: {
      id: string;
      mark: string;
      meaning: ModeCodeCockpitMeaning;
      text: string;
      locked: boolean;
      why: { title: string; now: string; because: string[] };
      card: string;
      act: ModeCodeCockpitAct | null;
    }[];
    now: { id: string; mark: string; meaning: ModeCodeCockpitMeaning; text: string; since: number | null; card: string; agent?: string }[];
    waiting: number;
    activity: { id: string; time: string; mark: string; meaning: ModeCodeCockpitMeaning; text: string; card: string; address: string | null }[];
    activityTotal: number;
    quota: {
      meters: { id: 'five' | 'week'; label: string; pct: number; value: string; threshold: number | null; resets: string; card: string }[];
      budget: string;
      note: string | null;
    };
    quick: {
      id: string;
      label: string;
      value: string;
      on: boolean;
      meaning: ModeCodeCockpitMeaning;
      gate: { path: string; allowed: boolean } | null;
      press: ModeCodeCockpitAct;
      card: string;
    }[];
  } | null;
};

/**
 * What the person opened or started in the cockpit: the line opened to its reasons, a permission waiting for its
 * warning to be confirmed, the last change made there (to take back), and the element under the keyboard's focus.
 */
export type ModeCodeCockpitUi = {
  open: string | null;
  confirm: string | null;
  changed: string | null;
  undo: { path: string; from: string | number | boolean | null; to: string | number | boolean | null } | null;
  focus: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'mode-code': {
      footers: ModeCodeFooters;
      labels: ModeCodeLabels;
      mo: ModeCodeMo;
      agentsPane: ModeCodeAgentsPane;
      stripFocus: ModeCodeStripFocus;
      quotaPane: ModeCodeQuotaPane;
      flowPane: ModeCodeFlowPane;
      cockpit: ModeCodeCockpit;
      cockpitUi: ModeCodeCockpitUi;
    };
  }
}

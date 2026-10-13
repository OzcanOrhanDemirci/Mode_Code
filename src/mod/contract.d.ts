// SPDX-License-Identifier: Apache-2.0
// The values the plugin keeps in Claude Code's session state ($.state), read while drawing.

/** Footer lines per answer, keyed by a hash of the answer's text. */
export type TerminalCodeFooters = Record<string, string[]>;

/**
 * What the prompt footer shows: mode labels at the right, quota at the end of the hint line; the line above
 * the prompt; and the strip of controls above it (the mode, the way of working, the flow's place), or null.
 */
export type TerminalCodeLabels = {
  modes: string[];
  tail: string;
  band: string;
  strip: {
    mode: 'free' | 'chat' | 'research' | 'plan' | 'code';
    style: 'manual' | 'autonomous' | 'full';
    flow: string | null;
    fullAutoHere: boolean;
    lang: 'en' | 'tr';
  } | null;
};

declare module 'claude-code' {
  interface PluginState {
    'terminal-code': { footers: TerminalCodeFooters; labels: TerminalCodeLabels };
  }
}

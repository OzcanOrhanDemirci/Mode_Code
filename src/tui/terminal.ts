// SPDX-License-Identifier: Apache-2.0
/**
 * What the terminal can do beyond drawing (docs/design.md, Graceful in every terminal; plan §5.7): set its window or
 * tab title, show a long job's progress on its tab and taskbar, and make a path a link a click opens. Each is used only
 * where the terminal is known to take it, worked out from what it says about itself; elsewhere nothing is sent, so
 * nothing stray shows. Pure: the sequences, and the reading of the environment.
 */

export interface TerminalCaps {
  /** The window or tab title (OSC 0). */
  title: boolean;
  /** A progress indicator on the tab and the taskbar (OSC 9;4): Windows Terminal, ConEmu. */
  progress: boolean;
  /** Hyperlinks (OSC 8). */
  links: boolean;
}

export const NO_CAPS: TerminalCaps = { title: false, progress: false, links: false };

/** What this terminal takes, from its environment; nothing when output is no terminal, or it says it is dumb. */
export function terminalCaps(env: Readonly<Record<string, string | undefined>>, isTTY: boolean): TerminalCaps {
  if (!isTTY || env.TERM === 'dumb') return NO_CAPS;
  const program = env.TERM_PROGRAM ?? '';
  const term = env.TERM ?? '';
  const vte = Number(env.VTE_VERSION ?? 0);
  const windowsTerminal = !!env.WT_SESSION;
  const conemu = env.ConEmuANSI === 'ON';
  const linking =
    windowsTerminal ||
    ['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'Hyper'].includes(program) ||
    term === 'xterm-kitty' ||
    !!env.KITTY_WINDOW_ID ||
    vte >= 5000;
  return {
    title: windowsTerminal || conemu || linking || program === 'Apple_Terminal' || /^(xterm|screen|tmux|rxvt|alacritty|foot)/.test(term),
    progress: windowsTerminal || conemu,
    links: linking,
  };
}

const OSC = '\u001B]';
const BEL = '\u0007';
const ST = '\u001B\\';

/** Sets the title; an empty one gives the title back to the terminal (its profile or the shell's). */
export function titleSequence(text: string): string {
  return `${OSC}0;${text.replace(/[\u0000-\u001F\u007F]/g, '')}${BEL}`;
}

/** A progress from 0 to 100 on the tab and the taskbar; null clears it. */
export function progressSequence(pct: number | null): string {
  return pct === null ? `${OSC}9;4;0;0${BEL}` : `${OSC}9;4;1;${Math.max(0, Math.min(100, Math.round(pct)))}${BEL}`;
}

/** `text` as a link to `url`; the text alone stays where the terminal shows no links. */
export function linkSequence(url: string, text: string): string {
  return `${OSC}8;;${url}${ST}${text}${OSC}8;;${ST}`;
}

/** A local path as a file URL (`C:\dev\x.md` → `file:///C:/dev/x.md`). */
export function fileUrl(path: string): string {
  const p = path.replace(/\\/g, '/');
  return `file://${p.startsWith('/') ? '' : '/'}${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

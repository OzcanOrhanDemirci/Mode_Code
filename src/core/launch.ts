// SPDX-License-Identifier: Apache-2.0
/**
 * Opening the control center beside a session (`/0`): a new tab of the terminal the session runs in, when
 * that terminal can be told to open one; a new window where it cannot; nothing where no window would be
 * seen (a session over SSH, inside WSL, a terminal this does not know). Pure: it picks the program to run
 * from the environment the session was started in; the plugin runs it (src/mod/register.ts), and says the
 * menu as text when there is nothing to run or it fails.
 */
import type { Platform } from './paths.js';

export type Launcher = 'windows-terminal' | 'windows-console' | 'tmux' | 'wezterm' | 'konsole' | 'gnome-terminal' | 'iterm' | 'mac-terminal';

/** A new tab beside the session, or a window of its own. */
export const OPENS: Record<Launcher, 'tab' | 'window'> = {
  'windows-terminal': 'tab',
  'windows-console': 'window',
  tmux: 'tab',
  wezterm: 'tab',
  konsole: 'tab',
  'gnome-terminal': 'tab',
  iterm: 'tab',
  'mac-terminal': 'window',
};

/** The environment variables the choice reads, as the session's own environment has them. */
export const LAUNCH_ENV = [
  'WT_SESSION',
  'TMUX',
  'TERM_PROGRAM',
  'WEZTERM_PANE',
  'KONSOLE_VERSION',
  'GNOME_TERMINAL_SCREEN',
  'GNOME_TERMINAL_SERVICE',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
  'WSL_DISTRO_NAME',
] as const;

export interface LaunchInput {
  platform: Platform;
  env: Partial<Record<(typeof LAUNCH_ENV)[number], string | undefined>>;
  /** The program and its arguments, absolute paths: the Node.js and the command-line program. */
  program: readonly string[];
  /** The folder it opens in, absolute. */
  cwd: string;
  title: string;
  /** Windows Terminal's program, as `windowsTerminalProgram` names it; `wt.exe` when not given. */
  wt?: string;
}

export interface Launch {
  via: Launcher;
  /** The program that opens it, and its arguments, run without a shell. */
  argv: string[];
}

const set = (v: string | undefined) => typeof v === 'string' && v !== '';

/** The separator a Windows path is written in: `/` only when it has no `\`. */
const sepOf = (p: string) => (p.includes('/') && !p.includes('\\') ? '/' : '\\');

/**
 * The folder where Windows keeps the aliases of the apps it installs from packages, Windows Terminal's
 * `wt.exe` among them: `%LOCALAPPDATA%\Microsoft\WindowsApps`, in the separators the variable is written in.
 * Null when the variable is not set.
 */
export function windowsAppsDir(localAppData: string | undefined): string | null {
  if (!set(localAppData)) return null;
  return [localAppData!.replace(/[\\/]+$/, ''), 'Microsoft', 'WindowsApps'].join(sepOf(localAppData!));
}

/**
 * The program to run Windows Terminal by: its alias, by the full path, when the alias folder holds one;
 * `wt.exe` otherwise. Claude Code looks a bare name up itself and refuses what it finds in the alias folder
 * whenever the session's folder contains that folder, as a session opened in the home folder does ("not found
 * or is in an unsafe location (current directory)"; read in 2.1.296's process runner, and met by `/0` in
 * such a session); a full path is run as given. The folder is under the home folder, where the session may
 * write, so only a link is taken: the aliases Windows installs are links, which copying a program there does
 * not make.
 */
export function windowsTerminalProgram(appsDir: string | null, entries: readonly { name: string; isLink: boolean }[]): string {
  if (appsDir === null || !entries.some((e) => e.isLink && e.name.toLowerCase() === 'wt.exe')) return 'wt.exe';
  return `${appsDir}${sepOf(appsDir)}wt.exe`;
}

/** One word for a POSIX shell: in single quotes, a quote inside closed, escaped and reopened. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** An AppleScript string literal. */
export function asQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A PowerShell string literal, single-quoted: nothing inside is expanded. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of `s` as UTF-16LE, the form PowerShell's -EncodedCommand takes: no quoting can go wrong. */
export function encodedCommand(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    bytes.push(u & 0xff, u >> 8);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

/** The shell line a new tab or window of a POSIX terminal types: go to the folder, become the program. */
function shellLine(input: LaunchInput): string {
  return `cd ${shQuote(input.cwd)} && exec ${input.program.map(shQuote).join(' ')}`;
}

/** Windows Terminal reads `;` as the start of its next command, anywhere in its arguments; `\;` is the character. */
const wtArg = (s: string) => s.replace(/;/g, '\\;');

/**
 * How to open `input.program` beside the session, or null when nothing here would show it to the person.
 * Inside tmux a window of the same tmux, the person's view whatever the platform; then the terminal named
 * by the variables it sets for the programs it runs; then, where one exists, the system's own.
 */
export function terminalLaunch(input: LaunchInput): Launch | null {
  const { env, platform, program, cwd, title } = input;
  if (!program.length) return null;
  if (platform !== 'win32' && set(env.TMUX)) return { via: 'tmux', argv: ['tmux', 'new-window', '-n', title, '-c', cwd, shellLine(input)] };
  if (platform === 'win32') {
    if (set(env.WT_SESSION))
      return { via: 'windows-terminal', argv: [input.wt ?? 'wt.exe', '-w', '0', 'new-tab', '--title', wtArg(title), '-d', wtArg(cwd), ...program.map(wtArg)] };
    // Any other console: a window of the system's default terminal, started by PowerShell from an encoded
    // command, so neither cmd's nor the runtime's quoting rules touch the paths.
    const args = program.slice(1).map((a) => psQuote(`"${a}"`));
    const script = `Start-Process -FilePath ${psQuote(program[0]!)}${args.length ? ` -ArgumentList ${args.join(',')}` : ''} -WorkingDirectory ${psQuote(cwd)}`;
    return { via: 'windows-console', argv: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(script)] };
  }
  // A window opened on a screen the person is not looking at helps nobody: over SSH, and inside WSL, whose
  // terminal is a Windows program this side may not be able to reach.
  if (set(env.SSH_CONNECTION) || set(env.SSH_CLIENT) || set(env.SSH_TTY)) return null;
  if (platform === 'darwin') {
    // Both type the line into a shell that may not be ready: the terminal echoes it, then the shell's prompt shows
    // it again (the Mac, 2026-10-15). `clear` wipes the two before the program starts.
    const line = asQuote(`clear && ${shellLine(input)}`);
    if (env.TERM_PROGRAM === 'iTerm.app')
      return {
        via: 'iterm',
        argv: [
          'osascript',
          '-e',
          'tell application "iTerm"',
          '-e',
          'activate',
          '-e',
          'if (count of windows) = 0 then',
          '-e',
          'create window with default profile',
          '-e',
          'else',
          '-e',
          'tell current window to create tab with default profile',
          '-e',
          'end if',
          '-e',
          `tell current session of current window to write text ${line}`,
          '-e',
          'end tell',
        ],
      };
    return { via: 'mac-terminal', argv: ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${line}`, '-e', 'end tell'] };
  }
  if (set(env.WSL_DISTRO_NAME)) return null;
  if (set(env.WEZTERM_PANE)) return { via: 'wezterm', argv: ['wezterm', 'cli', 'spawn', '--cwd', cwd, '--', ...program] };
  if (!set(env.DISPLAY) && !set(env.WAYLAND_DISPLAY)) return null;
  if (set(env.KONSOLE_VERSION)) return { via: 'konsole', argv: ['konsole', '--new-tab', '--workdir', cwd, '-e', ...program] };
  if (set(env.GNOME_TERMINAL_SCREEN) || set(env.GNOME_TERMINAL_SERVICE))
    return { via: 'gnome-terminal', argv: ['gnome-terminal', '--tab', `--working-directory=${cwd}`, '--', ...program] };
  return null;
}

/** The Node.js and the command-line program the installation recorded (install/manifest.json), or null. */
export function centerProgram(manifest: string | null): [string, string] | null {
  try {
    const m = JSON.parse(manifest ?? 'null') as { node?: unknown; cli?: unknown } | null;
    return m && typeof m.node === 'string' && m.node && typeof m.cli === 'string' && m.cli ? [m.node, m.cli] : null;
  } catch {
    return null;
  }
}

/** The program as the person would type it: in PowerShell on Windows, in a POSIX shell elsewhere. */
export function commandLine(program: readonly string[], platform: Platform): string {
  return platform === 'win32' ? `& ${program.map((a) => `"${a}"`).join(' ')}` : program.map(shQuote).join(' ');
}

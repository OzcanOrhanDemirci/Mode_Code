// SPDX-License-Identifier: Apache-2.0
/**
 * Puts a text on the clipboard for the control center, where a task given full autonomy is copied back
 * (Automation › Recent tasks): through the system's own tool, which says whether it took, else through the
 * terminal (OSC 52), which most terminals honour and none confirms. The text goes as UTF-8 throughout, so
 * Turkish letters arrive as typed: on Windows in a file PowerShell reads as UTF-8, not through a console
 * code page.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ClipboardCommand {
  argv: string[];
  /** How the text is handed over: on standard input, or in a file the command reads (its path in argv). */
  input: 'stdin' | 'file';
  env?: Record<string, string>;
}

/** What copying touches outside this process: replaced in tests. */
export interface ClipboardSystem {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Runs a program, `input` on its standard input; true when it ran and ended well. */
  run(argv: string[], input: string, env?: Record<string, string>): boolean;
  /** Writes the text to a new file of its own, and gives its path. */
  temp(text: string): string;
  remove(path: string): void;
  /** Writes to the terminal the control center draws on. */
  write(text: string): void;
}

export type CopyResult = { via: 'system' } | { via: 'terminal' };

const utf16Base64 = (script: string): string => Buffer.from(script, 'utf16le').toString('base64');

/** The system's own ways, in the order tried; `file` is where a command that reads a file finds the text. */
export function clipboardCommands(platform: NodeJS.Platform, env: Record<string, string | undefined>, file: string): ClipboardCommand[] {
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    const script = `Set-Clipboard -Value ([IO.File]::ReadAllText('${file.replace(/'/g, "''")}', [Text.Encoding]::UTF8))`;
    const ps = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return [{ argv: [ps, '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)], input: 'file' }];
  }
  if (platform === 'darwin') return [{ argv: ['pbcopy'], input: 'stdin', env: { LANG: 'en_US.UTF-8' } }];
  const out: ClipboardCommand[] = [];
  if (env.WAYLAND_DISPLAY) out.push({ argv: ['wl-copy'], input: 'stdin' });
  if (env.DISPLAY) out.push({ argv: ['xclip', '-selection', 'clipboard'], input: 'stdin' }, { argv: ['xsel', '--clipboard', '--input'], input: 'stdin' });
  return out;
}

/** The terminal's own way (OSC 52): the text, base64, in one escape sequence. */
export function osc52(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}

export const realClipboard: ClipboardSystem = {
  platform: process.platform,
  env: process.env,
  run(argv, input, env) {
    const r = spawnSync(argv[0]!, argv.slice(1), {
      input,
      env: { ...process.env, ...env },
      windowsHide: true,
      timeout: 15_000,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    return !r.error && r.status === 0;
  },
  temp(text) {
    const path = join(mkdtempSync(join(tmpdir(), 'mode-code-copy-')), 'text.txt');
    writeFileSync(path, text, 'utf8');
    return path;
  },
  remove(path) {
    rmSync(join(path, '..'), { recursive: true, force: true });
  },
  write(text) {
    process.stdout.write(text);
  },
};

/** Copies `text`: the first of the system's ways that takes it, else the terminal's. */
export function copyText(text: string, sys: ClipboardSystem = realClipboard): CopyResult {
  let file: string | null = null;
  try {
    // Windows' way reads the text from a file (see clipboardCommands); the others take it on standard input.
    if (sys.platform === 'win32') file = sys.temp(text);
    for (const cmd of clipboardCommands(sys.platform, sys.env, file ?? '')) {
      if (sys.run(cmd.argv, cmd.input === 'stdin' ? text : '', cmd.env)) return { via: 'system' };
    }
  } catch {
    /* the terminal's way below */
  } finally {
    if (file) sys.remove(file);
  }
  sys.write(osc52(text));
  return { via: 'terminal' };
}

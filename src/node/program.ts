// SPDX-License-Identifier: Apache-2.0
/**
 * The program as the one-line installer put it on this computer (install.sh, install.ps1): the folder it
 * unpacked into, the `mode-code` command it wrote and the PATH entry it added, all listed in the record it
 * left in that folder (install.json). `mode-code uninstall` removes what the record names and nothing else:
 * a command file the installer did not write stays, and so does a PATH entry another program still needs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { APP_ID } from '../core/app.js';
import { pathKey } from '../core/paths.js';
import { readJson, writeAtomic } from './fsx.js';

/** The record's name, in the program folder. */
export const RECEIPT_FILE = 'install.json';
/** In the command file the installer writes: a file with it is the installer's to remove. */
export const COMMAND_MARK = 'Written by the Mode_Code installer';
/** The line the installer writes above the PATH line it adds to a shell startup file. */
export const PATH_MARK = '# Added by the Mode_Code installer';

export interface ProgramReceipt {
  v: 1;
  app: string;
  version: string;
  installedAt: string;
  /** The program folder: app/ (the package), node/ when Node.js was downloaded for the program, the record. */
  home: string;
  /** The command line program, app/dist/cli.mjs. */
  program: string;
  node: string;
  privateNode: boolean;
  /** The `mode-code` command file. */
  command: string;
  /** What the installer added to PATH: a line in a shell startup file, or a folder in the user PATH (Windows). */
  path: { file: string; line: string } | { user: string; key?: string } | null;
  source: string;
  sha256: string | null;
}

export interface ProgramStep {
  what: 'command' | 'path' | 'program';
  ok: boolean;
  /** Left in place on purpose: a command file someone else wrote, a PATH folder other programs use. */
  kept?: boolean;
  /** Done by a helper as soon as this process ends (Windows cannot delete a running program). */
  later?: boolean;
  detail?: string;
}

/** What removing the program touches outside this process: replaced in tests. */
export interface ProgramSystem {
  platform: NodeJS.Platform;
  /** This process: what Windows waits for before it deletes the Node.js running it. */
  pid: number;
  /** Deletes a file or a folder with all it holds; throws when it cannot. */
  remove(path: string): void;
  /** Runs a PowerShell script and waits (Windows: the user PATH lives in the registry). */
  powershell(script: string): { ok: boolean; out: string };
  /** Starts a PowerShell script that outlives this process; false when it could not start. */
  later(script: string): boolean;
}

const same = (a: string, b: string, platform: NodeJS.Platform): boolean =>
  pathKey(resolve(a).replace(/\\/g, '/'), platform) === pathKey(resolve(b).replace(/\\/g, '/'), platform);

/**
 * The installer's record for the program running from `dist` (<home>/app/dist), or null when this program
 * was not put there by the installer (a clone, an npm installation) or the record describes another place.
 */
export function programReceipt(dist: string, platform: NodeJS.Platform = process.platform): ProgramReceipt | null {
  let home = resolve(dist, '..', '..');
  try {
    home = realpathSync(home);
  } catch {
    return null;
  }
  const r = readJson<ProgramReceipt>(join(home, RECEIPT_FILE));
  if (!r || r.v !== 1 || r.app !== APP_ID || typeof r.home !== 'string' || typeof r.command !== 'string') return null;
  let recorded = r.home;
  try {
    recorded = realpathSync(r.home);
  } catch {
    /* compared as written */
  }
  return same(recorded, home, platform) ? r : null;
}

/** A single-quoted PowerShell string. */
const psq = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** The startup file without the installer's two lines (the mark and the PATH line), or null when they are not there. */
export function withoutPathLine(text: string, line: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] !== PATH_MARK || lines[i + 1] !== line) continue;
    // The installer wrote a blank line before the mark; it goes too.
    const from = i > 0 && lines[i - 1] === '' ? i - 1 : i;
    lines.splice(from, i + 2 - from);
    return lines.join(eol);
  }
  return null;
}

/** The user PATH value without `dir` (compared expanded, case and trailing backslash ignored). */
export function removeUserPathScript(dir: string, key = 'Environment'): string {
  return [
    `$dir = ${psq(dir.replace(/[\\/]+$/, ''))}`,
    `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psq(key)}, $true)`,
    `if ($null -eq $key) { exit 0 }`,
    `$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`,
    `$kept = @($raw -split ';' | Where-Object { $_ -and [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ine $dir })`,
    `$next = $kept -join ';'`,
    `if ($next -ne $raw.TrimEnd(';')) { $key.SetValue('Path', $next, [Microsoft.Win32.RegistryValueKind]::ExpandString) }`,
    `$key.Close()`,
    // Tell running programs the environment changed, as the installer did; a key under test is not the real one.
    `if (${psq(key)} -eq 'Environment') { try {`,
    `  Add-Type -Namespace ModeCodeUninstall -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.UIntPtr w, string l, uint f, uint t, out System.UIntPtr r);'`,
    `  $r = [UIntPtr]::Zero; [ModeCodeUninstall.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null`,
    `} catch { } }`,
  ].join('\n');
}

/**
 * Deletes files and folders once process `pid` has ended (a running program cannot be deleted on Windows).
 * A folder marked `ifEmpty` is deleted only when nothing is left in it.
 */
export function removeLaterScript(pid: number, paths: { path: string; ifEmpty?: boolean }[]): string {
  return [
    `try { [Diagnostics.Process]::GetProcessById(${pid}).WaitForExit(60000) | Out-Null } catch { }`,
    `Start-Sleep -Milliseconds 300`,
    ...paths.map(({ path, ifEmpty }) =>
      [
        `$p = ${psq(path)}`,
        `for ($i = 0; $i -lt 20; $i++) {`,
        `  try { if ([IO.Directory]::Exists($p)) { [IO.Directory]::Delete($p, ${ifEmpty ? '$false' : '$true'}) } elseif ([IO.File]::Exists($p)) { [IO.File]::Delete($p) }; break }`,
        ifEmpty ? `  catch { break } }` : `  catch { Start-Sleep -Milliseconds 500 } }`,
      ].join('\n'),
    ),
  ].join('\n');
}

/** PowerShell, by its full path, with no module path a newer PowerShell may have handed down to it. */
function powershellRun(args: string[]): { exe: string; env: NodeJS.ProcessEnv; args: string[] } {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = { ...process.env };
  delete env.PSModulePath;
  return { exe: existsSync(exe) ? exe : 'powershell.exe', env, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args] };
}

const encoded = (script: string): string => Buffer.from(script, 'utf16le').toString('base64');

export const realSystem: ProgramSystem = {
  platform: process.platform,
  pid: process.pid,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  powershell(script) {
    const ps = powershellRun(['-EncodedCommand', encoded(script)]);
    const r = spawnSync(ps.exe, ps.args, { env: ps.env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
  },
  // Started by `Start-Process`, as /00 starts its helper (src/core/close.ts): a process Node.js starts, even
  // detached, ended with this one where a job object holds it (Claude Code's own, measured on Windows 11);
  // one Start-Process starts is outside it.
  later(script) {
    const starter = [
      `$encoded = '${encoded(script)}'`,
      `Start-Process -WindowStyle Hidden -FilePath "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded`,
      `'armed'`,
    ].join('\n');
    const ps = powershellRun(['-EncodedCommand', encoded(starter)]);
    const r = spawnSync(ps.exe, ps.args, { env: ps.env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    return r.status === 0 && /armed/.test(r.stdout ?? '');
  },
};

function isOurCommand(file: string): boolean {
  try {
    // A cmd file is written in the console's code page; the mark is ASCII either way.
    return readFileSync(file, 'latin1').includes(COMMAND_MARK);
  } catch {
    return false;
  }
}

/** Other entries in the command's folder: when there are any, the folder stays on PATH for them. */
function othersIn(dir: string, command: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f !== basename(command));
  } catch {
    return [];
  }
}

/**
 * Removes the command file, the PATH entry and the program folder the record names. The command and the
 * PATH entry go only when they are the installer's and nothing else needs them; on Windows, what the
 * running Node.js holds is deleted by a helper as soon as this process ends.
 */
export function removeProgram(r: ProgramReceipt, sys: ProgramSystem = realSystem): ProgramStep[] {
  const steps: ProgramStep[] = [];
  const win = sys.platform === 'win32';
  const later: { path: string; ifEmpty?: boolean }[] = [];

  // The command file.
  if (!existsSync(r.command)) steps.push({ what: 'command', ok: true });
  else if (!isOurCommand(r.command)) steps.push({ what: 'command', ok: true, kept: true, detail: r.command });
  else {
    try {
      sys.remove(r.command);
      steps.push({ what: 'command', ok: true });
    } catch (err) {
      if (win) {
        later.push({ path: r.command });
        steps.push({ what: 'command', ok: true, later: true });
      } else steps.push({ what: 'command', ok: false, detail: (err as Error).message });
    }
  }

  // The PATH entry, when the installer added one and the folder holds nothing else: a command still there
  // (one the installer did not write, or ours when it could not be removed) keeps it.
  if (r.path) {
    const dir = 'user' in r.path ? r.path.user : dirname(r.command);
    const others = othersIn(dir, r.command);
    if (existsSync(r.command) && !later.some((l) => l.path === r.command)) others.push(basename(r.command));
    if (others.length) steps.push({ what: 'path', ok: true, kept: true, detail: dir });
    else if ('user' in r.path) {
      const res = sys.powershell(removeUserPathScript(r.path.user, r.path.key ?? 'Environment'));
      steps.push({ what: 'path', ok: res.ok, ...(res.ok ? {} : { detail: res.out.slice(0, 300) }) });
    } else {
      try {
        const text = readFileSync(r.path.file, 'utf8');
        const next = withoutPathLine(text, r.path.line);
        if (next !== null) {
          // A startup file the installer made for the PATH line alone (fish's conf.d) goes with it.
          if (next.trim() === '' && basename(r.path.file) === `${APP_ID}.fish`) rmSync(r.path.file, { force: true });
          else writeAtomic(r.path.file, next);
        }
        steps.push({ what: 'path', ok: true, detail: r.path.file });
      } catch (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        steps.push({ what: 'path', ok: missing, ...(missing ? {} : { detail: (err as Error).message }) });
      }
    }
  }

  // The program folder: only what the installer puts there, then the folder itself when that leaves it
  // empty, so a folder chosen with MODE_CODE_INSTALL_DIR that holds other things keeps them.
  const home = r.home;
  const ours = (() => {
    try {
      return readdirSync(home).filter((n) => OWN_ENTRIES.includes(n) || n.startsWith('.staging.'));
    } catch {
      return [];
    }
  })();
  const failed: string[] = [];
  let deferred = false;
  for (const n of ours) {
    const p = join(home, n);
    try {
      sys.remove(p);
    } catch (err) {
      // The Node.js running this process, downloaded for the program: Windows deletes it once it has ended.
      if (win) {
        later.push({ path: p });
        deferred = true;
      } else failed.push(`${p}: ${(err as Error).message}`);
    }
  }
  if (deferred) later.push({ path: home, ifEmpty: true });
  else
    try {
      if (existsSync(home) && readdirSync(home).length === 0) rmdirSync(home);
    } catch {
      /* not empty after all: it keeps what is not the installer's */
    }
  steps.push(failed.length ? { what: 'program', ok: false, detail: failed.join('; ') } : { what: 'program', ok: true, ...(deferred ? { later: true } : {}) });

  if (later.length && !sys.later(removeLaterScript(sys.pid, later)))
    for (const s of steps) if (s.later) Object.assign(s, { ok: false, later: false, detail: later.map((l) => l.path).join(', ') });
  return steps;
}

/** What the installer puts in the program folder; nothing else there is removed. */
const OWN_ENTRIES = ['app', 'node', 'app.old', 'node.old', RECEIPT_FILE, `${RECEIPT_FILE}.new`];

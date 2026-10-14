// SPDX-License-Identifier: Apache-2.0
/**
 * Whether a session's Claude Code is still running. A session that ends marks itself ended; one whose
 * window was shut ends without that, so its own record still reads as working. Its process tells: the
 * safety-net hook records the process it runs under (Claude Code's own, the hook's parent) and its program,
 * and whoever asks later looks that process up. Pure: the command that looks it up, what its answer says,
 * and the verdict; the hook, the plugin and the control center run the command.
 */
import type { Platform } from './paths.js';

/** The process a session runs in, as its hook saw it. */
export interface Host {
  pid: number;
  /** The program's name as the lookup gave it (claude.exe), or null when it could not be read. */
  name: string | null;
}

/** What a lookup found: the process running (with its program's name) or not running. */
export interface HostSeen {
  running: boolean;
  name: string | null;
}

/** The command that looks a process up: tasklist on Windows (by its full path, as no folder is trusted), ps elsewhere. */
export function hostQuery(platform: Platform, pid: number, systemRoot: string | null | undefined): string[] {
  if (platform === 'win32') {
    const root = (systemRoot || 'C:\\Windows').replace(/[\\/]+$/, '');
    return [`${root}\\System32\\tasklist.exe`, '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'];
  }
  return ['ps', '-o', 'comm=', '-p', String(pid)];
}

/**
 * What the lookup's answer says, or null when it cannot tell. tasklist writes one CSV row for the process and
 * a line in the system's language when there is none; ps writes the program and fails when there is none.
 */
export function readHost(platform: Platform, pid: number, exitCode: number, stdout: string): HostSeen | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (platform === 'win32') {
    if (exitCode !== 0 || !lines.length) return null;
    const rows = lines.map((l) => /^"([^"]*)","(\d+)"/.exec(l)).filter((m): m is RegExpExecArray => m !== null);
    const own = rows.find((m) => Number(m[2]) === pid);
    if (own) return { running: true, name: own[1] || null };
    return rows.length ? null : { running: false, name: null };
  }
  if (exitCode === 0 && lines.length) return { running: true, name: lines[0]!.split('/').pop() || null };
  if (exitCode === 1 && !lines.length) return { running: false, name: null };
  return null;
}

/**
 * The process is surely gone: not running, or on Windows (which hands a freed process number out again soon)
 * running another program now. A lookup that could not tell keeps the session counted.
 */
export function hostGone(recorded: Host, seen: HostSeen | null, platform: Platform): boolean {
  if (!seen) return false;
  if (!seen.running) return true;
  return platform === 'win32' && !!recorded.name && !!seen.name && recorded.name.toLowerCase() !== seen.name.toLowerCase();
}

/** A recorded host from a state file, or null. */
export function parseHost(x: unknown): Host | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  return { pid: o.pid, name: typeof o.name === 'string' && o.name ? o.name : null };
}

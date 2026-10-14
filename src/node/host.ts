// SPDX-License-Identifier: Apache-2.0
/**
 * A session's Claude Code process on this computer (core/host.ts), for the hook and the control center: the
 * hook records the process it runs under, and the control center asks whether a session's still runs.
 */
import { spawnSync } from 'node:child_process';
import { hostGone, hostQuery, readHost, type Host, type HostSeen } from '../core/host.js';
import { sessionFile, type Layout } from '../core/layout.js';
import { parseHookState, type HookSessionState } from '../core/session.js';
import { platform } from './env.js';
import { readText } from './fsx.js';

/** Looks a process up; null when the lookup cannot tell. */
export function lookUpHost(pid: number): HostSeen | null {
  try {
    const [cmd, ...args] = hostQuery(platform, pid, process.env.SystemRoot ?? process.env.SYSTEMROOT);
    const r = spawnSync(cmd!, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.error) return null;
    return readHost(platform, pid, r.status ?? -1, r.stdout ?? '');
  } catch {
    return null;
  }
}

/**
 * The hook's state with the process it runs under: Claude Code's own, as the hook is its child (exec form, no
 * shell between). Looked up only when the process changes (a session resumed in a new one).
 */
export function withHost(state: HookSessionState, parent: number = process.ppid): HookSessionState {
  if (!Number.isInteger(parent) || parent <= 0 || state.host?.pid === parent) return state;
  const seen = lookUpHost(parent);
  const host: Host = { pid: parent, name: seen?.running ? seen.name : null };
  return { ...state, host };
}

/** A session whose Claude Code is surely gone (the record of one that never said is kept as working). */
export function sessionGone(l: Layout, sessionId: string): boolean {
  const file = sessionFile(l, sessionId, 'hook');
  const host = file ? parseHookState(readText(file), sessionId).host : null;
  return !!host && hostGone(host, lookUpHost(host.pid), platform);
}

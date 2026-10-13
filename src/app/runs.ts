// SPDX-License-Identifier: Apache-2.0
/**
 * Full-autonomy runs as the command line and the control center see them: the records the plugin wrote,
 * their files, and the start checks that can be measured outside a session (all but the budget, the live
 * probe, the session's permission mode and what else runs in it, which the plugin measures when a run
 * starts). Read only.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from './context.js';
import { runDir } from '../core/layout.js';
import { parseRun, type Run } from '../core/run.js';
import { checkGate, type GateCheck, type GateCheckId, type GateResult } from '../core/run-gate.js';
import type { Platform } from '../core/paths.js';
import { assessQuota } from '../core/quota.js';
import { readText } from '../node/fsx.js';
import { git } from '../node/git.js';
import { readClaudeEnv, type ClaudeEnv } from '../node/claude-env.js';
import { isOurHook, readManifest } from '../node/install.js';

/** Every run on record, the most recently changed first. */
export function loadRuns(ctx: Pick<AppContext, 'layout'>): Run[] {
  let names: string[];
  try {
    names = readdirSync(ctx.layout.runsDir);
  } catch {
    return [];
  }
  const out: Run[] = [];
  for (const n of names) {
    const dir = runDir(ctx.layout, n);
    const r = dir ? parseRun(readText(join(dir, 'run.json'))) : null;
    if (r && r.id === n) out.push(r);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A run by its id or the start of it (unique), or null. */
export function findRun(runs: readonly Run[], idOrPrefix: string): Run | null {
  const exact = runs.find((r) => r.id === idOrPrefix);
  if (exact) return exact;
  const some = runs.filter((r) => r.id.startsWith(idOrPrefix));
  return some.length === 1 ? some[0]! : null;
}

export interface RunFiles {
  /** The record and the copies the plugin keeps, out of Claude's reach. */
  record: string | null;
  plan: string | null;
  report: string | null;
  /** The folder of Claude's drafts (it may have been cleaned with the temporary folder). */
  drafts: string | null;
  notes: string | null;
}

export function runFiles(ctx: Pick<AppContext, 'layout'>, r: Run): RunFiles {
  const dir = runDir(ctx.layout, r.id);
  const has = (p: string | null) => (p && existsSync(p) ? p : null);
  return {
    record: dir ? has(join(dir, 'run.json')) : null,
    plan: dir ? has(join(dir, 'plan.md')) : null,
    report: dir ? has(join(dir, 'report.md')) : null,
    drafts: has(r.workDir),
    notes: has(r.notesPath),
  };
}

/** Runs that ended (or paused) since a moment: what happened while the person was away. */
export function endedSince(runs: readonly Run[], since: number): Run[] {
  return runs.filter((r) => r.status !== 'active' && r.updatedAt > since);
}

/**
 * Claude Code's settings merged the way it merges them for a session in `cwd`: user, then project, then
 * local, then managed; objects merge key by key, lists are joined (a list anywhere counts).
 */
export function mergedSettings(env: Pick<ClaudeEnv, 'settings'>): Record<string, unknown> {
  const order = ['user', 'project', 'local', 'managed'];
  const merge = (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = k in out ? merge(out[k], v) : v;
      return out;
    }
    return b;
  };
  let out: Record<string, unknown> = {};
  for (const scope of order) for (const s of env.settings.filter((x) => x.scope === scope && x.json)) out = merge(out, s.json) as Record<string, unknown>;
  return out;
}

/** The checks a run measures at its start that only a session can (they read as "measured when a run starts"). */
const SESSION_ONLY: readonly GateCheckId[] = ['budget', 'probe', 'permission', 'alone'];

export interface CheckOptions {
  platform?: NodeJS.Platform | Platform;
  env?: NodeJS.ProcessEnv;
  /** Reads a file of /proc (tests hand their own). */
  readProc?: (path: string) => string | null;
  exists?: (path: string) => boolean;
  claude?: Pick<ClaudeEnv, 'settings' | 'hooks'>;
}

/** The start checks measured from the person's terminal in `cwd`. */
export function autonomyCheck(ctx: Pick<AppContext, 'layout' | 'config'>, cwd: string, o: CheckOptions = {}): GateResult {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const readProc = o.readProc ?? readText;
  const exists = o.exists ?? existsSync;
  const plat = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  let wsl: { osrelease: string | null; interop: string | null; mounts: string | null } | null = null;
  if (plat === 'linux') {
    const osrelease = readProc('/proc/sys/kernel/osrelease');
    if (env.WSL_DISTRO_NAME || (osrelease ?? '').toLowerCase().includes('microsoft')) {
      const interopPath = '/proc/sys/fs/binfmt_misc/WSLInterop';
      wsl = { osrelease, interop: exists(interopPath) ? (readProc(interopPath) ?? '') : null, mounts: readProc('/proc/mounts') };
    }
  }
  const claude = o.claude ?? readClaudeEnv(cwd, { version: null });
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  const status = top.ok ? git(top.out, ['status', '--porcelain=v1', '--untracked-files=no'], 5000) : { ok: false, out: '' };
  const fold = (p: string) => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return plat === 'linux' ? s : s.toLowerCase();
  };
  // Ours by the program it runs from this data folder (wherever TERMINAL_CODE_HOME puts it), as the doctor reads it.
  const ours = (event: string) => claude.hooks.some((h) => h.event === event && isOurHook({ command: h.command, args: h.args }, ctx.layout.root));
  const hookInstalled = !!readManifest(ctx.layout) && ours('Stop') && ours('PreToolUse');
  const g = checkGate({
    enabled: ctx.config.autonomy.enabled,
    budget: {
      explicit: false,
      target: null,
      quota: assessQuota(
        null,
        { weeklyTarget: null, fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360 },
        0,
      ),
    },
    platform: plat,
    wsl,
    settings: mergedSettings(claude),
    probe: null,
    permissionMode: null,
    permissionMeasured: false,
    hookRan: hookInstalled,
    modes: ctx.config.modules.modes,
    git: {
      topLevel: top.ok && top.out ? top.out : null,
      cwd,
      tracked: status.ok ? status.out.split('\n').filter(Boolean).length : 0,
      sameFolder: top.ok && fold(top.out) === fold(cwd),
    },
    alone: { flow: false, ownRun: false, elsewhere: false, paused: null },
  });
  // The probe keeps its own note; the rest of what only a session measures (the permission mode is a prompt's) is said once.
  const checks: GateCheck[] = g.checks.map((c) =>
    SESSION_ONLY.includes(c.id) && (c.ok !== null || c.id === 'permission')
      ? { id: c.id, ok: null, key: 'auto.cli.atStart' }
      : c.id === 'hook'
        ? // From the terminal the hook is known to be installed, not to have run in a session.
          { ...c, key: c.ok ? 'auto.cli.hookInstalled' : 'auto.cli.hookMissing' }
        : c,
  );
  return { ok: checks.every((c) => c.ok !== false), checks };
}

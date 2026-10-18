// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers on this machine (docs/sync.md), for the hook and the command line: the shared place
 * through node:fs, the settings in effect with the other computers' changes, one sync (this computer's files
 * written; with GitHub, committed, the others' brought in, sent), and the record each writer keeps. The
 * plugin does the same through Claude Code's own file access and process runner.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { APP_VERSION } from '../core/app.js';
import type { Config } from '../core/config.js';
import { syncRecordFile, type Layout } from '../core/layout.js';
import { syncMemory, type Runner } from '../core/memory-sync.js';
import { scanSecrets } from '../core/secrets/scan.js';
import { joinPath } from '../core/paths.js';
import {
  machineName,
  machinePaths,
  MACHINES_DIR,
  parseMachineInfo,
  remoteKey,
  SYNC_MAX_BYTES,
  syncCommitMessage,
  type FolderFact,
  type Merged,
  type ProjectHint,
} from '../core/sync.js';
import {
  exportMachine,
  mergeFromTexts,
  monthStart,
  newestShared,
  parseSharedRecord,
  syncDue,
  type SharedRecord,
  type SharedTrigger,
  type SyncFs,
} from '../core/sync-export.js';
import { readText, writeAtomic, writeJsonAtomic } from './fsx.js';
import { git } from './git.js';
import { nodeRunner } from './memory.js';

/** The shared place through node:fs. */
export const nodeSyncFs: SyncFs = {
  async read(path) {
    return readText(path);
  },
  async write(path, text) {
    writeAtomic(path, text);
  },
  async list(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true }).map((e) => {
        let mtimeMs = 0;
        if (e.isFile()) {
          try {
            mtimeMs = statSync(join(dir, e.name)).mtimeMs;
          } catch {
            /* gone since the listing */
          }
        }
        return { name: e.name, kind: e.isDirectory() ? ('dir' as const) : e.isFile() ? ('file' as const) : ('other' as const), mtimeMs };
      });
    } catch {
      return [];
    }
  },
};

/** The other computers' ids in the shared place, read now. */
function others(dir: string, self: string): string[] {
  try {
    return readdirSync(join(dir, MACHINES_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== self && /^[a-z0-9][a-z0-9-]{0,47}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * The settings in effect here, read at once (the hook's every call, the command line): this computer's own
 * with the other computers' newer changes, those that lower a protection waiting. Never throws.
 */
export function mergedConfig(local: Config, l: Pick<Layout, 'syncIgnored'>): Merged {
  const s = local.sync;
  if (!s) return { config: local, applied: [], pending: [] };
  try {
    return mergeFromTexts(
      local,
      readText(machinePaths(s.dir, s.machine.id).settings),
      others(s.dir, s.machine.id).map((id) => ({ id, text: readText(machinePaths(s.dir, id).settings) })),
      readText(l.syncIgnored),
    );
  } catch {
    return { config: local, applied: [], pending: [] };
  }
}

/** Every writer's last sync. */
export function sharedRecords(l: Layout): (SharedRecord | null)[] {
  return (['mod', 'hook', 'cli'] as const).map((w) => parseSharedRecord(readText(syncRecordFile(l, w))));
}

/** The newest sync of any writer. */
export function lastShared(l: Layout): SharedRecord | null {
  return newestShared(sharedRecords(l));
}

/** Whether a sync after a turn is due (the last one is `everyMinutes` old). */
export function sharedDue(config: Config, l: Layout, now = Date.now()): boolean {
  return !!config.sync && syncDue(sharedRecords(l), now, config.sync.everyMinutes);
}

/**
 * One sync from this process. `local` is this computer's own settings (config.json as it is). Writes this
 * computer's files; with GitHub, commits them, brings in the others' and sends; removes its own history past
 * the months kept. Its record goes to this writer's file. Never throws; null without a sync.
 */
export async function syncShared(
  local: Config,
  l: Layout,
  opts: { trigger: SharedTrigger; session: string | null; writer: 'hook' | 'cli'; runner?: Runner; now?: number; firstStamp?: (key: string) => number },
): Promise<SharedRecord | null> {
  const s = local.sync;
  if (!s) return null;
  const now = opts.now ?? Date.now();
  const record: SharedRecord = { at: now, trigger: opts.trigger, session: opts.session, written: 0, result: null, error: null };
  try {
    const ex = await exportMachine(nodeSyncFs, {
      dir: s.dir,
      machine: s.machine,
      platform: process.platform,
      app: APP_VERSION,
      now,
      layout: l,
      local,
      keepMonths: s.keepMonths,
      hint: projectHint,
      ...(opts.firstStamp ? { firstStamp: opts.firstStamp } : {}),
    });
    for (const d of ex.stale) rmSync(d, { recursive: true, force: true });
    record.written = ex.written.length;
  } catch (err) {
    record.error = String((err as Error)?.message ?? err)
      .split('\n')[0]!
      .slice(0, 300);
  }
  if (s.place === 'github' && !record.error) {
    record.result = await syncMemory(opts.runner ?? nodeRunner, {
      dir: s.dir,
      remote: true,
      steps: { commit: true, pull: true, push: true },
      message: (counts) => syncCommitMessage(s.machine.name, counts),
      readFile: async (p) => readText(p),
      secrets: (text) => scanSecrets(text).length,
      maxBytes: SYNC_MAX_BYTES,
    });
  }
  try {
    writeJsonAtomic(syncRecordFile(l, opts.writer), record);
  } catch {
    /* the record is for the person's eyes; the sync itself happened */
  }
  return record;
}

/** This computer's history in the shared place past the months kept, removed (the plugin cannot delete). Never throws. */
export function pruneShared(config: Config, now = Date.now()): number {
  const s = config.sync;
  if (!s) return 0;
  let removed = 0;
  const oldest = monthStart(now, s.keepMonths);
  const events = machinePaths(s.dir, s.machine.id).events;
  try {
    for (const m of readdirSync(events, { withFileTypes: true })) {
      const at = /^(\d{4})-(\d{2})$/.exec(m.name);
      if (!m.isDirectory() || !at || Date.UTC(+at[1]!, +at[2]! - 1, 1) >= oldest) continue;
      rmSync(join(events, m.name), { recursive: true, force: true });
      removed++;
    }
  } catch {
    /* nothing there yet */
  }
  return removed;
}

/** This computer's name as its owner knows it, for the sync setup to offer (core/sync machineName). */
export function computerName(): string {
  const scutil = (key: string): string | null =>
    process.platform === 'darwin' ? (spawnSync('scutil', ['--get', key], { encoding: 'utf8', timeout: 5000, windowsHide: true }).stdout ?? null) : null;
  return machineName([scutil('ComputerName'), scutil('LocalHostName'), hostname(), process.env.COMPUTERNAME], process.platform);
}

/** Where a project folder's repository is: its origin's place (no user, no token) and the folder within it. */
export async function projectHint(path: string): Promise<Pick<ProjectHint, 'remote' | 'sub'>> {
  const origin = git(path, ['remote', 'get-url', 'origin']);
  const remote = origin.ok ? remoteKey(origin.out) : null;
  if (!remote) return {};
  const prefix = git(path, ['rev-parse', '--show-prefix']);
  return { remote, sub: prefix.ok ? prefix.out.replace(/\/$/, '') : '' };
}

/** Folders that often hold projects, under the home folder; the others' parent folder names join them. */
const PROJECT_ROOTS = ['', 'dev', 'Developer', 'Projects', 'projects', 'code', 'src', 'repos', 'source/repos', 'Documents/GitHub', 'GitHub', 'git', 'work'];

/**
 * The folders on this computer a project of the others might be in: the folders in the usual places for
 * projects, in the parents of the projects linked here, and in folders named like the others' parents (under the
 * home folder, and at a drive's root on Windows). One level deep; hidden folders and dependencies left out.
 */
export function candidateFolders(config: Config, hints: readonly Record<string, ProjectHint>[], homeDir: string, platform: string, limit = 600): FolderFact[] {
  const parents = new Set(hints.flatMap((h) => Object.values(h).map((x) => x.parent)).filter(Boolean));
  const roots = new Set<string>([
    ...PROJECT_ROOTS.map((r) => (r ? joinPath(homeDir, r) : homeDir)),
    ...config.projects.flatMap((p) => (p.path && p.path.lastIndexOf('/') > 0 ? [p.path.slice(0, p.path.lastIndexOf('/'))] : [])),
    ...[...parents].flatMap((p) => [joinPath(homeDir, p), ...(platform === 'win32' ? [`${homeDir.slice(0, 2)}/${p}`] : [])]),
  ]);
  const out: FolderFact[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = joinPath(root, name);
      const k = platform === 'win32' || platform === 'darwin' ? path.toLowerCase() : path;
      if (seen.has(k) || out.length >= limit) continue;
      seen.add(k);
      const origin = existsSync(join(path, '.git')) ? git(path, ['remote', 'get-url', 'origin']) : null;
      out.push({ path, name, remote: origin?.ok ? remoteKey(origin.out) : null });
    }
  }
  return out;
}

/** The others' project hints, from their machine.json files in the shared place. */
export function othersHints(config: Config): Record<string, ProjectHint>[] {
  const s = config.sync;
  if (!s) return [];
  return others(s.dir, s.machine.id).flatMap((id) => {
    const info = parseMachineInfo(readText(machinePaths(s.dir, id).machine));
    return info ? [info.projects] : [];
  });
}

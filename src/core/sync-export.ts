// SPDX-License-Identifier: Apache-2.0
/**
 * This computer's part of the shared place (docs/sync.md): what it writes into its own folder (its name,
 * its shared settings with their times, its history with secrets masked, summaries of its runs and flows)
 * and how it reads the others' settings back into the settings in effect here. Over an injected file
 * access, so the plugin (`$.fs`) and the hook and the command line (node:fs) do exactly the same.
 */
import type { Config } from './config.js';
import { parseSyncRecord, type SyncResult } from './memory-sync.js';
import type { Layout } from './layout.js';
import { joinPath } from './paths.js';
import { parseFlow } from './flow.js';
import { parseRun } from './run.js';
import {
  flowSummary,
  machinePaths,
  MACHINES_DIR,
  maskedEvents,
  mergeSettings,
  monthKept,
  nextExport,
  parseIgnored,
  parseMachineInfo,
  parseMachineSettings,
  runSummary,
  sharedValues,
  type Merged,
  type MachineSettings,
  type ProjectHint,
} from './sync.js';

/** The file access the sync needs; `list` gives [] for a folder that is not there. */
export interface SyncFs {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(dir: string): Promise<{ name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }[]>;
}

export interface ExportInput {
  /** The shared place on this computer. */
  dir: string;
  machine: { id: string; name: string };
  platform: string;
  app: string;
  now: number;
  layout: Pick<Layout, 'eventsDir' | 'runsDir' | 'flowsDir'>;
  /** This computer's own settings (config.json as it is, without the others' changes). */
  local: Config;
  keepMonths: number;
  /** For a computer's first settings file: each key's time (docs/sync.md, joining). */
  firstStamp?: (key: string) => number;
  /** Where a project folder's repository is (node/sync projectHint); without it, projects are named by folder only. */
  hint?: (path: string) => Promise<Pick<ProjectHint, 'remote' | 'sub'>>;
}

export interface ExportResult {
  /** Files written now, in the shared place. */
  written: string[];
  /** This computer's month folders past `keepMonths`: to be removed by a process that can delete. */
  stale: string[];
}

/** Writes a file only when its text is not already that; the path joins `written` when it was. */
async function put(fs: SyncFs, path: string, text: string, written: string[]): Promise<void> {
  if ((await fs.read(path)) === text) return;
  await fs.write(path, text);
  written.push(path);
}

/** This computer's files in the shared place, brought up to date. Writes only its own folder. */
export async function exportMachine(fs: SyncFs, input: ExportInput): Promise<ExportResult> {
  const p = machinePaths(input.dir, input.machine.id);
  const written: string[] = [];

  // Who it is: kept as it was unless its name, system or version changed (no commit for nothing). Where it keeps
  // its projects, for the others to find theirs; a project's repository is asked again only when its folder moved
  // or none was found.
  const info = parseMachineInfo(await fs.read(p.machine));
  const since = info?.since || input.now;
  const projects: Record<string, ProjectHint> = {};
  for (const proj of input.local.projects) {
    if (!proj.path) continue;
    const parts = proj.path.split('/').filter(Boolean);
    const folder = parts[parts.length - 1] ?? '';
    const parent = parts.length > 1 ? parts[parts.length - 2]! : '';
    const was = info?.projects[proj.id];
    const repo = was?.remote && was.folder === folder && was.parent === parent ? was : input.hint ? await input.hint(proj.path) : {};
    projects[proj.id] = { folder, parent, ...(repo.remote ? { remote: repo.remote, sub: repo.sub ?? '' } : {}) };
  }
  await put(
    fs,
    p.machine,
    JSON.stringify({ v: 1, id: input.machine.id, name: input.machine.name, platform: input.platform, app: input.app, since, projects }, null, 2) + '\n',
    written,
  );

  // Its shared settings, each with the time it changed here.
  const prev = parseMachineSettings(await fs.read(p.settings));
  const next = nextExport(prev, sharedValues(input.local), input.machine.id, input.now, input.firstStamp);
  await put(fs, p.settings, JSON.stringify(next, null, 2) + '\n', written);

  // Its history: the months still kept, each file copied with secrets masked when it changed since the copy.
  const stale: string[] = [];
  for (const m of await fs.list(p.events)) if (m.kind === 'dir' && !monthKept(m.name, input.now, input.keepMonths)) stale.push(joinPath(p.events, m.name));
  for (const month of await fs.list(input.layout.eventsDir)) {
    // A name that is not a month is not one of the months kept; listing what is not a folder gives nothing.
    if (!monthKept(month.name, input.now, input.keepMonths)) continue;
    const from = joinPath(input.layout.eventsDir, month.name);
    const to = joinPath(p.events, month.name);
    const copies = new Map((await fs.list(to)).map((e) => [e.name, e.mtimeMs]));
    for (const f of await fs.list(from)) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue;
      const copied = copies.get(f.name);
      if (copied !== undefined && copied >= f.mtimeMs) continue;
      const text = await fs.read(joinPath(from, f.name));
      if (text !== null) await put(fs, joinPath(to, f.name), maskedEvents(text), written);
    }
  }

  // Its runs and flows, as the others see them: those that changed within the months kept.
  const oldest = monthStart(input.now, input.keepMonths);
  for (const [base, out, read] of [
    [input.layout.runsDir, p.runs, async (d: string) => summaryOfRun(await fs.read(joinPath(d, 'run.json')))],
    [input.layout.flowsDir, p.flows, async (d: string) => summaryOfFlow(await fs.read(joinPath(d, 'flow.json')))],
  ] as const) {
    for (const e of await fs.list(base)) {
      if (e.kind !== 'dir' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(e.name)) continue;
      const s = await read(joinPath(base, e.name));
      if (s && s.updatedAt >= oldest) await put(fs, joinPath(out, `${e.name}.json`), JSON.stringify(s, null, 2) + '\n', written);
    }
  }
  return { written, stale };
}

function summaryOfRun(text: string | null) {
  const r = parseRun(text);
  return r ? runSummary(r) : null;
}

function summaryOfFlow(text: string | null) {
  const f = parseFlow(text);
  return f ? flowSummary(f) : null;
}

/** The start of the oldest month kept, in milliseconds. */
export function monthStart(now: number, keepMonths: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (keepMonths - 1), 1);
}

/** The other computers' ids in the shared place. */
export async function otherMachines(fs: SyncFs, dir: string, self: string): Promise<string[]> {
  return (await fs.list(joinPath(dir, MACHINES_DIR)))
    .filter((e) => e.kind === 'dir' && e.name !== self && /^[a-z0-9][a-z0-9-]{0,47}$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** The settings in effect from the files' texts: this computer's file, the others' by id, the person's decisions. */
export function mergeFromTexts(local: Config, own: string | null, others: readonly { id: string; text: string | null }[], ignored: string | null): Merged {
  const files: MachineSettings[] = [];
  for (const o of others) {
    const m = parseMachineSettings(o.text);
    // A file that names another computer than its folder is not taken (copied by hand, or not one).
    if (m && m.machine === o.id) files.push(m);
  }
  return mergeSettings(local, parseMachineSettings(own), files, parseIgnored(ignored));
}

/**
 * The settings in effect here: this computer's own with the other computers' newer changes (core/sync.ts
 * mergeSettings), read from the shared place. Without a sync, or when it cannot be read, its own.
 */
export async function settingsInEffect(fs: SyncFs, local: Config, ignoredFile: string): Promise<Merged> {
  const s = local.sync;
  if (!s) return { config: local, applied: [], pending: [] };
  try {
    const others = [];
    for (const id of await otherMachines(fs, s.dir, s.machine.id)) others.push({ id, text: await fs.read(machinePaths(s.dir, id).settings) });
    return mergeFromTexts(local, await fs.read(machinePaths(s.dir, s.machine.id).settings), others, await fs.read(ignoredFile));
  } catch {
    return { config: local, applied: [], pending: [] };
  }
}

// ── the record of a sync ────────────────────────────────────────────────────────────────────────

export type SharedTrigger = 'start' | 'turn' | 'end' | 'manual' | 'setup';

/** A writer's last sync across computers (layout.syncRecordFile). */
export interface SharedRecord {
  at: number;
  trigger: SharedTrigger;
  session: string | null;
  /** Files of this computer's written into the shared place. */
  written: number;
  /** The git steps, for a GitHub place; null for a folder another service keeps in sync. */
  result: SyncResult | null;
  /** What went wrong outside git (the shared place could not be written). */
  error: string | null;
}

const TRIGGERS: readonly SharedTrigger[] = ['start', 'turn', 'end', 'manual', 'setup'];

export function parseSharedRecord(text: string | null): SharedRecord | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (typeof o.at !== 'number') return null;
    const result = o.result === null || o.result === undefined ? null : parseSyncRecord(JSON.stringify({ at: o.at, result: o.result }))?.result;
    if (result === undefined) return null;
    return {
      at: o.at,
      trigger: TRIGGERS.includes(o.trigger as SharedTrigger) ? (o.trigger as SharedTrigger) : 'manual',
      session: typeof o.session === 'string' ? o.session : null,
      written: typeof o.written === 'number' ? o.written : 0,
      result,
      error: typeof o.error === 'string' ? o.error : null,
    };
  } catch {
    return null;
  }
}

/** The newest of the writers' records. */
export function newestShared(records: readonly (SharedRecord | null)[]): SharedRecord | null {
  return records.reduce<SharedRecord | null>((a, b) => (b && (!a || b.at > a.at) ? b : a), null);
}

/** After a turn, a sync is due when the last one (any writer's) is `everyMinutes` old or more, or there was none. */
export function syncDue(records: readonly (SharedRecord | null)[], now: number, everyMinutes: number): boolean {
  const last = newestShared(records);
  return !last || now - last.at >= everyMinutes * 60_000;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers (docs/sync.md): what of terminal-code's settings and history the computers share,
 * how their settings meet, and what counts as lowering a protection, which never applies without the
 * person. Pure: the shared place's layout, the settings each computer sends with the time each changed,
 * the merge that every computer comes to the same value from, and the summaries of history it reads.
 *
 * Each computer writes only into its own folder of the shared place (machines/<id>/), so neither git nor a
 * sync service ever has to choose between two computers' changes to one file.
 */
import { APP_NAME } from './app.js';
import { normalizeConfig, type Config, type ProjectEntry } from './config.js';
import { RULES } from './belt/rules.js';
import { VERDICT_ORDER, type RuleId, type Verdict } from './belt/types.js';
import { joinPath } from './paths.js';
import { maskSecrets } from './secrets/scan.js';
import { truncate } from './text.js';

export const MACHINES_DIR = 'machines';

/** Where a computer's files are in the shared place. */
export function machinePaths(dir: string, id: string): { root: string; machine: string; settings: string; events: string; runs: string; flows: string } {
  const root = joinPath(dir, MACHINES_DIR, id);
  return {
    root,
    machine: joinPath(root, 'machine.json'),
    settings: joinPath(root, 'settings.json'),
    events: joinPath(root, 'events'),
    runs: joinPath(root, 'runs'),
    flows: joinPath(root, 'flows'),
  };
}

/** A computer's folder name: its name in lower-case letters and digits, and four random hex digits. */
export function machineId(name: string, random: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const tail = random
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 4)
    .padEnd(4, '0');
  return `${slug || 'computer'}-${tail}`;
}

/** The README of the shared place, for whoever opens it (on GitHub too). */
export function syncReadme(): string {
  return [
    `# ${APP_NAME} sync`,
    '',
    `This folder is the shared copy of ${APP_NAME}'s settings and history between your computers (docs/sync.md).`,
    '',
    `\`${MACHINES_DIR}/<computer>/\` is each computer's own: its settings with the time each changed, its history (the belt's and the keywords' events, summaries of runs and flows). Each computer writes only its own folder. \`handoffs/\` holds handoff notes, when your memory does not keep them.`,
    '',
    'Change settings in terminal-code, not here: each computer writes its own file from its settings, over any edit made to it.',
    '',
  ].join('\n');
}

/** The commit message of a sync: which computer, and what changed in the shared place. */
export function syncCommitMessage(name: string, counts: { added: number; changed: number; removed: number }): string {
  const parts = [
    counts.added ? `${counts.added} added` : '',
    counts.changed ? `${counts.changed} changed` : '',
    counts.removed ? `${counts.removed} removed` : '',
  ].filter(Boolean);
  return `sync: ${name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/** The history files a sync may send: larger than a memory note, still bounded. */
export const SYNC_MAX_BYTES = 8_000_000;

// ── settings ─────────────────────────────────────────────────────────────────────────────────────

/** Settings that are each computer's own: where things are on it, full autonomy switched on, the sync itself. */
export const LOCAL_KEYS: readonly string[] = ['version', 'memory.dirs', 'memory.store', 'modes.workDir', 'autonomy.enabled', 'sync', 'projects'];

/** Settings shared as one value, though they are objects: two computers changing parts of one keep the newer whole. */
const ATOMIC_KEYS = new Set(['belt.verdicts', 'keywords.extra']);

const PROJECT = 'projects.';

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** JSON with object keys in order, so equal values compare equal whatever order they were written in. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  return v === undefined ? 'null' : JSON.stringify(v);
}

function same(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** A project as the computers share it: its names and definition of done, never its folder. */
function sharedProject(p: ProjectEntry): Obj {
  return p.verify?.length ? { names: p.names, verify: p.verify } : { names: p.names };
}

/** The shared settings of a config, one value per key (`projects.<id>` for each project). */
export function sharedValues(c: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (v: unknown, path: string) => {
    if (path && LOCAL_KEYS.includes(path)) return;
    if (isObj(v) && !ATOMIC_KEYS.has(path)) {
      for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k);
      return;
    }
    out[path] = structuredClone(v);
  };
  walk(c, '');
  for (const p of c.projects) out[`${PROJECT}${p.id}`] = sharedProject(p);
  return out;
}

/** One shared setting as a computer sent it: its value (or that it was removed), and when it changed there. */
export interface SharedEntry {
  value?: unknown;
  removed?: true;
  at: number;
}

/** A computer's shared settings file (machines/<id>/settings.json). */
export interface MachineSettings {
  v: 1;
  machine: string;
  entries: Record<string, SharedEntry>;
}

/**
 * The settings this computer sends next: each key with the time it last changed here. A key that differs
 * from the last file is stamped now; one gone is kept as removed. With no file yet, `firstStamp` gives each
 * key its time (the setup: the defaults 0, so a computer joining never overrides what the others chose).
 */
export function nextExport(
  prev: MachineSettings | null,
  values: Record<string, unknown>,
  machine: string,
  now: number,
  firstStamp: (key: string) => number = () => 0,
): MachineSettings {
  const entries: Record<string, SharedEntry> = {};
  for (const [k, v] of Object.entries(values)) {
    const p = prev?.entries[k];
    if (!prev) entries[k] = { value: v, at: firstStamp(k) };
    else if (p && !p.removed && same(p.value, v)) entries[k] = p;
    else entries[k] = { value: v, at: now };
  }
  for (const [k, p] of Object.entries(prev?.entries ?? {})) if (!(k in values)) entries[k] = p.removed ? p : { removed: true, at: now };
  return { v: 1, machine, entries };
}

/** A computer's settings file read back; null when it is not one. Entries of the wrong shape are left out. */
export function parseMachineSettings(text: string | null): MachineSettings | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Obj;
    if (o.v !== 1 || typeof o.machine !== 'string' || !isObj(o.entries)) return null;
    const entries: Record<string, SharedEntry> = {};
    for (const [k, e] of Object.entries(o.entries)) {
      if (!isObj(e) || typeof e.at !== 'number') continue;
      if (e.removed === true) entries[k] = { removed: true, at: e.at };
      else if ('value' in e) entries[k] = { value: e.value, at: e.at };
    }
    return { v: 1, machine: o.machine, entries };
  } catch {
    return null;
  }
}

/** A setting from another computer that lowers a protection here: it waits for the person. */
export interface Pending {
  key: string;
  machine: string;
  at: number;
  /** This computer's value, and the other's (undefined: removed there). */
  current: unknown;
  incoming: unknown;
}

export interface Merged {
  /** The settings in effect here. */
  config: Config;
  /** Settings taken from other computers. */
  applied: { key: string; machine: string; at: number }[];
  pending: Pending[];
}

/**
 * The settings in effect on this computer: its own, with every newer change another computer sent, except
 * those that lower a protection (pending until the person approves; or ignored, until that computer changes
 * the setting again). A change made here and not sent yet always wins. Every computer comes to the same
 * value for a setting: the newest change, equal times going to the computer whose id sorts first.
 */
export function mergeSettings(
  local: Config,
  own: MachineSettings | null,
  others: readonly MachineSettings[],
  ignored: Readonly<Record<string, number>> = {},
): Merged {
  const mine = sharedValues(local);
  const keys = new Set([...Object.keys(mine), ...others.flatMap((m) => Object.keys(m.entries))]);
  const changes: Record<string, unknown> = {};
  const applied: Merged['applied'] = [];
  const pending: Pending[] = [];
  for (const key of [...keys].sort()) {
    if (!isSharedKey(key)) continue;
    const here = mine[key];
    const sent = own?.entries[key];
    // What this computer last sent, if it is still what it has: its time counts; otherwise its change is newer than any.
    const sentSame = sent ? (sent.removed ? here === undefined : here !== undefined && same(sent.value, here)) : false;
    const ownAt = sentSame ? sent!.at : here === undefined && !sent ? -1 : Infinity;
    // Equal times go to the id that sorts first, here as on every other computer; a time of 0 is "never changed" and claims nothing.
    const beats = (e: SharedEntry, machine: string) => e.at > ownAt || (e.at === ownAt && e.at > 0 && own !== null && machine < own.machine);
    let best: { e: SharedEntry; machine: string } | null = null;
    for (const m of others) {
      // A file with this computer's own id is not another computer's.
      if (own && m.machine === own.machine) continue;
      const e = m.entries[key];
      if (e && beats(e, m.machine) && (!best || e.at > best.e.at || (e.at === best.e.at && m.machine < best.machine))) best = { e, machine: m.machine };
    }
    if (!best) continue;
    const incoming = best.e.removed ? undefined : best.e.value;
    if (same(incoming, here) && (incoming === undefined) === (here === undefined)) continue;
    if (!acceptable(local, key, incoming)) continue;
    if (lowersProtection(key, here, incoming)) {
      if ((ignored[key] ?? -1) >= best.e.at) continue;
      pending.push({ key, machine: best.machine, at: best.e.at, current: here, incoming });
      continue;
    }
    changes[key] = incoming;
    applied.push({ key, machine: best.machine, at: best.e.at });
  }
  return { config: applyShared(local, changes), applied, pending };
}

let sharedKeys: Set<string> | null = null;

/** Keys the computers share: the settings this version knows, never this computer's own (a file written by hand may hold anything). */
function isSharedKey(key: string): boolean {
  if (key.startsWith(PROJECT)) return /^[a-z0-9][a-z0-9-]{0,47}$/.test(key.slice(PROJECT.length));
  sharedKeys ??= new Set(Object.keys(sharedValues(normalizeConfig({}).config)));
  return sharedKeys.has(key);
}

/**
 * An incoming value the settings would take as it is: read back through them, it must come out the same.
 * Anything they would correct, drop or refuse (a locked rule softened, a number out of range) is not taken.
 */
function acceptable(local: Config, key: string, value: unknown): boolean {
  if (key.startsWith(PROJECT)) {
    if (value === undefined) return true;
    const r = normalizeConfig({ projects: [{ ...(isObj(value) ? value : {}), id: key.slice(PROJECT.length) }] });
    return r.config.projects.length === 1 && same(sharedProject(r.config.projects[0]!), value);
  }
  if (value === undefined) return false;
  return same(sharedValues(normalizeConfig(setPath(structuredClone(local) as unknown as Obj, key, value)).config)[key], value);
}

function setPath(o: Obj, key: string, value: unknown): Obj {
  const parts = key.split('.');
  let cur = o;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p] as Obj;
  }
  cur[parts[parts.length - 1]!] = value;
  return o;
}

/**
 * Settings with shared values changed (`projects.<id>` undefined removes the project). A project keeps its
 * folder on this computer; one new here has none until the person gives it one.
 */
export function applyShared(c: Config, changes: Readonly<Record<string, unknown>>): Config {
  const keys = Object.keys(changes);
  if (!keys.length) return c;
  let next = structuredClone(c) as unknown as Obj;
  let projects = [...c.projects];
  for (const key of keys) {
    const v = changes[key];
    if (key.startsWith(PROJECT)) {
      const id = key.slice(PROJECT.length);
      const at = projects.findIndex((p) => p.id === id);
      if (v === undefined) projects = projects.filter((p) => p.id !== id);
      else {
        const shared = v as { names: string[]; verify?: string[] };
        const entry: ProjectEntry = { id, names: shared.names, ...(at >= 0 && projects[at]!.path ? { path: projects[at]!.path } : {}) };
        if (shared.verify?.length) entry.verify = shared.verify;
        if (at >= 0) projects[at] = entry;
        else projects.push(entry);
      }
    } else next = setPath(next, key, v);
  }
  next.projects = projects;
  return normalizeConfig(next).config;
}

/** One setting where this computer differs from what the other computers hold (the newest change of each). */
export interface Difference {
  key: string;
  here: unknown;
  /** Undefined: removed there. */
  theirs: unknown;
  machine: string;
  at: number;
}

/**
 * Where this computer's settings differ from the other computers', for a computer joining (docs/sync.md):
 * each setting some other computer changed (a time above 0), its newest value against this one's.
 */
export function differences(local: Config, others: readonly MachineSettings[]): Difference[] {
  const mine = sharedValues(local);
  const best = new Map<string, { e: SharedEntry; machine: string }>();
  for (const m of others)
    for (const [key, e] of Object.entries(m.entries)) {
      const b = best.get(key);
      if (e.at > 0 && isSharedKey(key) && (!b || e.at > b.e.at || (e.at === b.e.at && m.machine < b.machine))) best.set(key, { e, machine: m.machine });
    }
  const out: Difference[] = [];
  for (const [key, { e, machine }] of [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const theirs = e.removed ? undefined : e.value;
    if (same(theirs, mine[key]) && (theirs === undefined) === (mine[key] === undefined)) continue;
    if (!acceptable(local, key, theirs)) continue;
    out.push({ key, here: mine[key], theirs, machine, at: e.at });
  }
  return out;
}

/** The keys whose value differs from a fresh installation's: what a computer setting up first has chosen. */
export function changedFromDefaults(c: Config): Set<string> {
  const mine = sharedValues(c);
  const defaults = sharedValues(normalizeConfig({}).config);
  return new Set(Object.keys(mine).filter((k) => !(k in defaults) || !same(mine[k], defaults[k])));
}

// ── lowering a protection ───────────────────────────────────────────────────────────────────────

const LOWER_IF_UP = new Set([
  'quota.fiveHourWrapUp',
  'quota.fiveHourStop',
  'quota.defaultWeeklyTarget',
  'quota.defaultWeeklyWrapUp',
  'quota.staleMinutes',
  'autonomy.maxHours',
  'autonomy.stallMinutes',
]);
const PROTECTIVE_MODULES = new Set(['modules.quota', 'modules.secrets', 'modules.modes']);
const SHRINKING_LISTS = new Set(['belt.protectedBranches', 'belt.prOnlyRepos', 'belt.singleBranchRepos']);

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Obj => (isObj(v) ? v : {});

/** Whether a change from `from` to `to` (undefined: removed) lowers a protection here (docs/sync.md). */
export function lowersProtection(key: string, from: unknown, to: unknown): boolean {
  if (key === 'belt.disabled') return list(to).some((id) => !list(from).includes(id));
  if (key === 'belt.verdicts') {
    const a = record(from);
    const b = record(to);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((id) => {
      const rule = RULES[id as RuleId];
      if (!rule) return false;
      const was = VERDICT_ORDER[(a[id] as Verdict) ?? rule.verdict] ?? VERDICT_ORDER[rule.verdict];
      const now = VERDICT_ORDER[(b[id] as Verdict) ?? rule.verdict] ?? VERDICT_ORDER[rule.verdict];
      return now < was;
    });
  }
  if (SHRINKING_LISTS.has(key)) return list(from).some((x) => !list(to).includes(x));
  if (key === 'belt.packs.dockerVolumes' || PROTECTIVE_MODULES.has(key)) return from === true && to !== true;
  if (LOWER_IF_UP.has(key)) return typeof to === 'number' && typeof from === 'number' ? to > from : to !== from;
  if (key === 'quota.autoResume') return from !== true && to === true;
  if (key === 'autonomy.reviewModel') return !same(from, to);
  if (key === 'keywords.extra') {
    const phrases = (v: unknown) =>
      new Set(
        Object.entries(record(v)).flatMap(([lang, t]) =>
          Object.entries(record(t)).flatMap(([kind, ps]) => list(ps).map((p) => `${lang}\u0000${kind}\u0000${String(p)}`)),
        ),
      );
    const before = phrases(from);
    return [...phrases(to)].some((p) => !before.has(p));
  }
  if (key.startsWith(PROJECT)) {
    const verify = list(record(from).verify);
    if (!verify.length) return false;
    if (to === undefined) return true;
    const next = list(record(to).verify);
    return verify.some((v) => !next.includes(v));
  }
  return false;
}

// ── history ─────────────────────────────────────────────────────────────────────────────────────

/** A month folder's name (yyyy-mm) as a count of months, or null. */
export function monthIndex(name: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(name);
  if (!m) return null;
  const month = parseInt(m[2]!, 10);
  return month >= 1 && month <= 12 ? parseInt(m[1]!, 10) * 12 + month - 1 : null;
}

/** Whether a month folder is still kept: the current month and the `keepMonths - 1` before it. */
export function monthKept(name: string, now: number, keepMonths: number): boolean {
  const i = monthIndex(name);
  if (i === null) return false;
  const d = new Date(now);
  return d.getUTCFullYear() * 12 + d.getUTCMonth() - i < keepMonths;
}

/** An events file as another computer reads it: each line with its secrets masked (a line that is not JSON is left out). */
export function maskedEvents(text: string): string {
  const lines = text.split('\n').filter((l) => {
    if (!l.trim()) return false;
    try {
      JSON.parse(l);
      return true;
    } catch {
      return false;
    }
  });
  return lines.length ? lines.map((l) => maskSecrets(l)).join('\n') + '\n' : '';
}

/** A run as the other computers see it. */
export interface RunSummary {
  id: string;
  task: string;
  project: string | null;
  folder: string;
  status: 'active' | 'paused' | 'done' | 'stuck' | 'canceled';
  phase: string;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  milestones: number;
  deferred: number;
}

/** A flow as the other computers see it. */
export interface FlowSummary {
  id: string;
  task: string;
  project: string | null;
  status: 'active' | 'waiting' | 'paused' | 'done' | 'canceled';
  step: string | null;
  updatedAt: number;
}

const basename = (p: string) =>
  p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';
const summaryText = (s: string) => maskSecrets(truncate(s.split('\n')[0] ?? '', 200));

export function runSummary(r: {
  id: string;
  task: string;
  project: string | null;
  cwd: string;
  status: RunSummary['status'];
  phase: string;
  pause: { reason: string } | null;
  createdAt: number;
  updatedAt: number;
  milestones: unknown[];
  deferred: unknown[];
}): RunSummary {
  return {
    id: r.id,
    task: summaryText(r.task),
    project: r.project,
    folder: basename(r.cwd),
    status: r.status,
    phase: r.phase,
    reason: r.pause?.reason ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    milestones: r.milestones.length,
    deferred: r.deferred.length,
  };
}

export function flowSummary(f: {
  id: string;
  task: string;
  project: string | null;
  status: FlowSummary['status'];
  current: number;
  steps: { kind: string }[];
  updatedAt: number;
}): FlowSummary {
  return {
    id: f.id,
    task: summaryText(f.task),
    project: f.project,
    status: f.status,
    step: f.steps[f.current]?.kind ?? null,
    updatedAt: f.updatedAt,
  };
}

const RUN_STATUSES = new Set(['active', 'paused', 'done', 'stuck', 'canceled']);
const FLOW_STATUSES = new Set(['active', 'waiting', 'paused', 'done', 'canceled']);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export function parseRunSummary(text: string | null): RunSummary | null {
  try {
    const o = JSON.parse(text ?? '') as Obj;
    if (typeof o.id !== 'string' || !RUN_STATUSES.has(o.status as string)) return null;
    return {
      id: str(o.id, 80),
      task: str(o.task),
      project: typeof o.project === 'string' ? str(o.project, 60) : null,
      folder: str(o.folder, 120),
      status: o.status as RunSummary['status'],
      phase: str(o.phase, 20),
      reason: typeof o.reason === 'string' ? str(o.reason, 20) : null,
      createdAt: num(o.createdAt),
      updatedAt: num(o.updatedAt),
      milestones: num(o.milestones),
      deferred: num(o.deferred),
    };
  } catch {
    return null;
  }
}

export function parseFlowSummary(text: string | null): FlowSummary | null {
  try {
    const o = JSON.parse(text ?? '') as Obj;
    if (typeof o.id !== 'string' || !FLOW_STATUSES.has(o.status as string)) return null;
    return {
      id: str(o.id, 80),
      task: str(o.task),
      project: typeof o.project === 'string' ? str(o.project, 60) : null,
      status: o.status as FlowSummary['status'],
      step: typeof o.step === 'string' ? str(o.step, 20) : null,
      updatedAt: num(o.updatedAt),
    };
  } catch {
    return null;
  }
}

/** A computer as the others show it (machines/<id>/machine.json). */
export interface MachineInfo {
  id: string;
  name: string;
  platform: string;
  app: string;
  /** When it was set up for sync. */
  since: number;
}

export function parseMachineInfo(text: string | null): MachineInfo | null {
  try {
    const o = JSON.parse(text ?? '') as Obj;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
    return { id: str(o.id, 60), name: str(o.name, 60), platform: str(o.platform, 20), app: str(o.app, 40), since: num(o.since) };
  } catch {
    return null;
  }
}

/** The person's decisions to keep this computer's value (state/sync-ignored.json): key → the other computer's change time. */
export function parseIgnored(text: string | null): Record<string, number> {
  try {
    const o = JSON.parse(text ?? '') as Obj;
    if (!isObj(o)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store as the command line and the control center see it (docs/memory.md): where it lives and
 * whether Claude Code uses it, its last sync and its local state, the handoff notes of a project, and the facts of
 * the morning report.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import type { MemoryStore } from '../core/config.js';
import { nextOf, parseHandoff, type Handoff } from '../core/handoff.js';
import { memorySyncFile } from '../core/layout.js';
import { handoffRoot } from '../core/memory.js';
import { newestRecord, parseSyncRecord, type SyncRecord } from '../core/memory-sync.js';
import { parseActivity, type MorningFacts } from '../core/morning.js';
import { pathKey } from '../core/paths.js';
import { newerThan } from '../core/update.js';
import { APP_VERSION } from '../core/app.js';
import type { AppContext } from './context.js';
import { loadEvents, openIndex } from './data.js';
import { loadFlows } from './flows.js';
import { elsewhereFacts } from './sync.js';
import { claudeDir, platform, toolPath } from '../node/env.js';
import { readText } from '../node/fsx.js';
import { repoStatus } from '../node/git.js';
import { handoffList, newestHandoffAt, projectKeyAt } from '../node/handoffs.js';
import { readMemorySetting } from '../node/memory-store.js';
import { readUpdateState } from '../node/update.js';

export interface MemoryView {
  store: MemoryStore | null;
  /** Claude Code's autoMemoryDirectory now; null when it keeps one memory per project. */
  setting: string | null;
  /** Claude Code writes its memory into the store's folder. */
  inUse: boolean;
  last: SyncRecord | null;
  /** The folder's git state, read without the network. */
  local: { isRepo: boolean; dirty: number; ahead: number | null } | null;
  /** The project key of the folder asked about, and its newest handoff note. */
  project: string;
  handoff: { path: string; note: Handoff } | null;
}

/** The project key of a folder (node/handoffs.ts). */
export function projectKeyFor(ctx: Pick<AppContext, 'config'>, cwd: string): string {
  return projectKeyAt(ctx.config, cwd);
}

/** The handoff notes kept for a project, oldest first. */
export function handoffsOf(ctx: Pick<AppContext, 'config' | 'layout'>, project: string): { name: string; path: string }[] {
  return handoffList(ctx.config, ctx.layout, project);
}

/** The newest handoff note of a project, read back. */
export function newestHandoff(ctx: Pick<AppContext, 'config' | 'layout'>, project: string): { path: string; note: Handoff; text: string } | null {
  return newestHandoffAt(ctx.config, ctx.layout, project);
}

/** Every project's handoff notes written since a moment. */
export function handoffsSince(ctx: Pick<AppContext, 'config' | 'layout'>, since: number): { project: string; at: number }[] {
  const root = handoffRoot(ctx.config, ctx.layout.handoffsDir);
  const out: { project: string; at: number }[] = [];
  let projects: string[] = [];
  try {
    projects = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  for (const p of projects)
    for (const h of handoffsOf(ctx, p)) {
      const at = Date.parse(
        `${h.name.slice(0, 4)}-${h.name.slice(4, 6)}-${h.name.slice(6, 8)}T${h.name.slice(9, 11)}:${h.name.slice(11, 13)}:${h.name.slice(13, 15)}Z`,
      );
      if (at >= since) out.push({ project: p, at });
    }
  return out.sort((a, b) => a.at - b.at);
}

export function lastSync(ctx: Pick<AppContext, 'layout'>): SyncRecord | null {
  return newestRecord((['mod', 'hook', 'cli'] as const).map((w) => parseSyncRecord(readText(memorySyncFile(ctx.layout, w)))));
}

/** Where the memory stands, for `mode-code memory` and Memory and projects. */
export function memoryView(ctx: AppContext, cwd = ctx.cwd): MemoryView {
  const store = ctx.config.memory.store;
  const setting = readMemorySetting(claudeDir());
  const project = projectKeyFor(ctx, cwd);
  const h = newestHandoff(ctx, project);
  let local: MemoryView['local'] = null;
  if (store && existsSync(store.dir)) {
    const st = repoStatus(store.dir);
    local = { isRepo: st.isRepo, dirty: st.dirty, ahead: st.ahead };
  }
  return {
    store,
    setting,
    inUse: !!store && !!setting && pathKey(toolPath(setting), platform) === pathKey(toolPath(store.dir), platform),
    last: lastSync(ctx),
    local,
    project,
    handoff: h ? { path: h.path, note: h.note } : null,
  };
}

/** The window the morning report covers: the last gap the plugin saw, else the last `hours`. */
export function morningWindow(ctx: Pick<AppContext, 'layout'>, now: number, hours = 24): { since: number; until: number } {
  const a = parseActivity(readText(ctx.layout.activity));
  return a.away && now - a.away.to < 24 * 3_600_000 ? { since: a.away.from, until: now } : { since: now - hours * 3_600_000, until: now };
}

/** The facts of the morning report for a window. */
export function morningFacts(ctx: AppContext, since: number, until: number, opts: { index?: boolean } = {}): MorningFacts {
  const flows = loadFlows(ctx).filter((f) => f.status === 'waiting');
  const events = loadEvents(ctx, Math.max(1, Math.ceil((until - since) / 86_400_000) + 1), until).filter((e) => e.at >= since && e.at <= until);
  const belt = events.filter((e) => e.kind === 'belt');
  const readings = events.filter((e) => e.kind === 'reading' && typeof e.week === 'number').sort((a, b) => a.at - b.at);
  const sessions = new Map<string, number>();
  if (opts.index !== false) {
    try {
      const idx = openIndex(ctx);
      for (const s of idx.sessions({ since, limit: 500 })) if (s.cwd) sessions.set(basename(s.cwd), (sessions.get(basename(s.cwd)) ?? 0) + 1);
      idx.close();
    } catch {
      /* no index yet: the sessions line is left out */
    }
  }
  const store = ctx.config.memory.store;
  const last = lastSync(ctx);
  let memory: MorningFacts['memory'] = null;
  if (store) {
    const st = existsSync(store.dir) ? repoStatus(store.dir) : null;
    const problem = last && last.at >= since ? last.result : null;
    memory = {
      place: store.place,
      ahead: st?.ahead ?? null,
      conflicts: problem?.conflicts ?? [],
      held: problem?.held.map((h) => h.path) ?? [],
      error: problem && (['offline', 'auth', 'failed'].includes(problem.push) || problem.pull === 'diverged') ? problem.detail || problem.push : null,
    };
  }
  return {
    since,
    now: until,
    flows: flows.map((f) => ({ id: f.id, title: f.task.split('\n')[0] ?? f.id })),
    sessions: [...sessions.entries()].map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count),
    handoffs: handoffsSince(ctx, since),
    belt: {
      blocked: belt.filter((e) => e.verdict === 'deny' && !e.left).length,
      asked: belt.filter((e) => e.verdict === 'ask').length,
      // Left to the person in full autonomy: by the belt, and by Claude Code's own question.
      left: belt.filter((e) => e.left).length + events.filter((e) => e.kind === 'permission' && e.answer === 'left').length,
    },
    quota: readings.length ? { weekFrom: readings[0]!.week ?? null, weekTo: readings[readings.length - 1]!.week ?? null } : null,
    memory,
    elsewhere: elsewhereFacts(ctx, since, until),
    syncPending: ctx.pending?.length ?? 0,
    update: newerThan(APP_VERSION, readUpdateState(ctx.layout)?.latest ?? null),
  };
}

export interface HandoffItem {
  project: string;
  path: string;
  at: number;
  trigger: string;
  machine: string;
  next: string;
}

/** Every project's handoff notes, newest first, read back (at most `limit`). */
export function allHandoffs(ctx: Pick<AppContext, 'config' | 'layout' | 'lang'>, limit = 100): HandoffItem[] {
  const root = handoffRoot(ctx.config, ctx.layout.handoffsDir);
  let projects: string[] = [];
  try {
    projects = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const all = projects.flatMap((p) => handoffsOf(ctx, p).map((h) => ({ project: p, ...h })));
  all.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const out: HandoffItem[] = [];
  for (const h of all.slice(0, limit)) {
    const text = readText(h.path);
    const note = text ? parseHandoff(text) : null;
    if (note) out.push({ project: h.project, path: h.path, at: note.at, trigger: note.trigger, machine: note.machine, next: nextOf(note, 240, ctx.lang) });
  }
  return out;
}

/** The morning report of the last long gap while it is recent (12 hours after it ended); null otherwise. */
export function recentMorning(ctx: AppContext, now: number, opts: { index?: boolean } = {}): { since: number; facts: MorningFacts } | null {
  const a = parseActivity(readText(ctx.layout.activity));
  if (!a.away || now - a.away.to > 12 * 3_600_000) return null;
  return { since: a.away.from, facts: morningFacts(ctx, a.away.from, now, opts) };
}

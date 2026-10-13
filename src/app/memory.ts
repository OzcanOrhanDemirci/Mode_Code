// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store as the command line and the control center see it (docs/memory.md): where it lives and
 * whether Claude Code uses it, its last sync and its local state, the handoff notes of a project, the notes
 * from full-autonomy runs and the person's decisions on them, and the facts of the morning report.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MemoryStore } from '../core/config.js';
import type { Handoff } from '../core/handoff.js';
import { memorySyncFile } from '../core/layout.js';
import { handoffRoot } from '../core/memory.js';
import { newestRecord, parseSyncRecord, type SyncRecord } from '../core/memory-sync.js';
import { parseActivity, parseNoteDecisions, pendingNotes, type MorningFacts, type NoteDecisions } from '../core/morning.js';
import { pathKey } from '../core/paths.js';
import type { AppContext } from './context.js';
import { loadEvents, openIndex } from './data.js';
import { loadFlows } from './flows.js';
import { loadRuns } from './runs.js';
import { claudeDir, platform, toolPath } from '../node/env.js';
import { readText, writeJsonAtomic } from '../node/fsx.js';
import { repoStatus } from '../node/git.js';
import { handoffList, newestHandoffAt, projectKeyAt } from '../node/handoffs.js';
import { readMemorySetting } from '../node/memory-store.js';

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
  pendingNotes: number;
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
  const root = handoffRoot(ctx.config.memory.store?.dir ?? null, ctx.layout.handoffsDir);
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

export function noteDecisions(ctx: Pick<AppContext, 'layout'>): NoteDecisions {
  return parseNoteDecisions(readText(ctx.layout.notes));
}

/** Runs whose notes wait for the person, with the notes' path. */
export function pendingNoteRuns(ctx: Pick<AppContext, 'layout'>): { id: string; task: string; path: string }[] {
  const runs = loadRuns(ctx);
  const ids = new Set(
    pendingNotes(
      runs.map((r) => ({ id: r.id, open: r.status === 'active' || r.status === 'paused', hasNotes: existsSync(r.notesPath) })),
      noteDecisions(ctx),
    ),
  );
  return runs.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, task: r.task, path: r.notesPath }));
}

/** Records the person's decision on a run's notes (the command line is this file's only writer). */
export function decideNotes(ctx: Pick<AppContext, 'layout'>, id: string, decision: 'approved' | 'discarded', now = Date.now()): void {
  const d = noteDecisions(ctx);
  writeJsonAtomic(ctx.layout.notes, { ...d, [id]: { decision, at: now, delivered: null } });
}

export function lastSync(ctx: Pick<AppContext, 'layout'>): SyncRecord | null {
  return newestRecord((['mod', 'hook', 'cli'] as const).map((w) => parseSyncRecord(readText(memorySyncFile(ctx.layout, w)))));
}

/** Where the memory stands, for `terminal-code memory` and Settings › Memory. */
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
    pendingNotes: pendingNoteRuns(ctx).length,
  };
}

/** The window the morning report covers: the last gap the plugin saw, else the last `hours`. */
export function morningWindow(ctx: Pick<AppContext, 'layout'>, now: number, hours = 24): { since: number; until: number } {
  const a = parseActivity(readText(ctx.layout.activity));
  return a.away && now - a.away.to < 24 * 3_600_000 ? { since: a.away.from, until: now } : { since: now - hours * 3_600_000, until: now };
}

/** The facts of the morning report for a window. */
export function morningFacts(ctx: AppContext, since: number, until: number, opts: { index?: boolean } = {}): MorningFacts {
  const runs = loadRuns(ctx).filter((r) => r.updatedAt >= since);
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
      error: problem && ['offline', 'auth', 'failed'].includes(problem.push) ? problem.detail || problem.push : null,
    };
  }
  return {
    since,
    now: until,
    runs: runs
      .filter((r) => r.status !== 'active')
      .map((r) => ({
        id: r.id,
        task: r.task || r.id,
        status: r.status,
        reason: r.pause?.reason ?? null,
        report: existsSync(join(ctx.layout.runsDir, r.id, 'report.md')) ? join(ctx.layout.runsDir, r.id, 'report.md').replace(/\\/g, '/') : null,
        deferred: r.deferred.length,
      })),
    flows: flows.map((f) => ({ id: f.id, title: f.task.split('\n')[0] ?? f.id })),
    sessions: [...sessions.entries()].map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count),
    handoffs: handoffsSince(ctx, since),
    belt: { blocked: belt.filter((e) => e.verdict === 'deny').length, asked: belt.filter((e) => e.verdict === 'ask').length },
    quota: readings.length ? { weekFrom: readings[0]!.week ?? null, weekTo: readings[readings.length - 1]!.week ?? null } : null,
    memory,
    notes: pendingNoteRuns(ctx).length,
  };
}

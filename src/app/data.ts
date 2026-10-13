// SPDX-License-Identifier: Apache-2.0
/**
 * Read models shared by the command line and the control center: quota, belt and keyword events, the
 * session index, secret scans. Each loader is safe to call repeatedly and never throws for missing data.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assessQuota, type QuotaAssessment, type QuotaReading } from '../core/quota.js';
import { budgetOf } from '../core/settings-view.js';
import { parseModState, type ModSessionState } from '../core/session.js';
import { scanSecrets, type SecretMatch } from '../core/secrets/scan.js';
import { readJson, readText } from '../node/fsx.js';
import { claudeDir } from '../node/env.js';
import { SessionIndex } from '../node/index-db.js';
import type { AppContext } from './context.js';

export interface QuotaView {
  reading: QuotaReading | null;
  assessment: QuotaAssessment;
  /** The session state whose weekly target applies (the most recent session with one), if any. */
  target: { value: number; source: string | null; session: string } | null;
}

export function loadQuota(ctx: AppContext, now = Date.now()): QuotaView {
  const reading = readJson<QuotaReading>(ctx.layout.quota);
  const valid = reading && Array.isArray(reading.windows) && typeof reading.measuredAt === 'number' ? reading : null;
  const recent = recentModStates(ctx, 1, now - 7 * 86400_000).find((s) => s.weeklyTarget !== null) ?? null;
  const budget = budgetOf(ctx.config, recent);
  return {
    reading: valid,
    assessment: assessQuota(valid, budget, now),
    target: recent && recent.weeklyTarget !== null ? { value: recent.weeklyTarget, source: recent.weeklyTargetSource, session: recent.sessionId } : null,
  };
}

/** Mod session states, newest first. */
export function recentModStates(ctx: AppContext, limit = 50, since = 0): ModSessionState[] {
  let names: string[];
  try {
    names = readdirSync(ctx.layout.sessionsDir).filter((n) => n.endsWith('.mod.json'));
  } catch {
    return [];
  }
  const withTime = names
    .map((n) => {
      const p = join(ctx.layout.sessionsDir, n);
      try {
        return { p, t: statSync(p).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { p: string; t: number } => x !== null && x.t >= since)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  return withTime.map((x) => parseModState(readText(x.p))).filter((s): s is ModSessionState => s !== null);
}

export interface ToolEvent {
  v: number;
  at: number;
  kind: 'belt' | 'keyword' | 'quota' | 'resume' | 'chat' | string;
  source: 'mod' | 'hook' | string;
  session: string;
  tool?: string;
  verdict?: 'deny' | 'ask' | 'warn' | string;
  answer?: string;
  rules?: string[];
  reasons?: string[];
  keyword?: string;
  project?: string | null;
  level?: string;
  /** Mode refusals ("mode" events): the mode and what was refused. */
  mode?: string;
  what?: string;
  /** Flow events: what happened, to which flow, its step and status after. */
  action?: string;
  flow?: string;
  step?: string | null;
  status?: string;
  /** Full-autonomy events ("run"): the run, and why it paused or what waited for the person. */
  run?: string;
  reason?: string;
  defer?: string;
  /** Quota readings ("reading" events). */
  five?: number | null;
  week?: number | null;
  fiveResetsAt?: number | null;
  weekResetsAt?: number | null;
}

/** Events of the last `days` days, newest first. */
export function loadEvents(ctx: AppContext, days = 30, now = Date.now()): ToolEvent[] {
  const since = now - days * 86400_000;
  const out: ToolEvent[] = [];
  let months: string[];
  try {
    months = readdirSync(ctx.layout.eventsDir).filter((m) => /^\d{4}-\d{2}$/.test(m));
  } catch {
    return [];
  }
  const oldest = new Date(since);
  const oldestMonth = `${oldest.getUTCFullYear()}-${String(oldest.getUTCMonth() + 1).padStart(2, '0')}`;
  for (const m of months.filter((x) => x >= oldestMonth)) {
    let files: string[];
    try {
      files = readdirSync(join(ctx.layout.eventsDir, m)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const session = f.replace(/\.(?:mod|hook|cli)\.jsonl$/, '');
      for (const line of (readText(join(ctx.layout.eventsDir, m, f)) ?? '').split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as ToolEvent;
          if (typeof e.at === 'number' && e.at >= since) out.push({ ...e, session: e.session ?? session });
        } catch {
          /* a torn line is skipped */
        }
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Opens the session index and brings it up to date (incremental: fast after the first run). */
export function openIndex(ctx: AppContext, opts: { update?: boolean; onProgress?: (done: number, total: number) => void } = {}): SessionIndex {
  const idx = new SessionIndex(ctx.layout.index);
  if (opts.update !== false) idx.update(join(claudeDir(), 'projects'), opts.onProgress ? (p) => opts.onProgress!(p.done, p.files) : undefined);
  return idx;
}

export interface SecretFinding extends SecretMatch {
  path: string;
  line: number;
}

/** Scans files and folders (recursively, text files up to 2 MB, skipping .git and node_modules) for secrets. */
export function scanPaths(paths: readonly string[], limitFiles = 5000): { findings: SecretFinding[]; files: number; skipped: number } {
  const findings: SecretFinding[] = [];
  let files = 0;
  let skipped = 0;
  const visit = (p: string, depth: number) => {
    if (files >= limitFiles || depth > 12) return;
    let st: import('node:fs').Stats;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      let names: string[];
      try {
        names = readdirSync(p);
      } catch {
        return;
      }
      for (const n of names) if (n !== '.git' && n !== 'node_modules') visit(join(p, n), depth + 1);
      return;
    }
    if (!st.isFile()) return;
    if (st.size > 2 * 1024 * 1024) {
      skipped++;
      return;
    }
    const text = readText(p);
    if (text === null || text.includes('\u0000')) {
      skipped++;
      return;
    }
    files++;
    for (const m of scanSecrets(text)) findings.push({ ...m, path: p, line: text.slice(0, m.start).split('\n').length });
  };
  for (const p of paths) visit(p, 0);
  return { findings, files, skipped };
}

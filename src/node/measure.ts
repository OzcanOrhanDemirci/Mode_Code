// SPDX-License-Identifier: Apache-2.0
/**
 * Quota per task, on this computer (`mode-code measure`, docs/testing.md): the Claude Code sessions of the last days
 * cut at their commits and pushes, each piece priced and weighed (core/measure.ts), with how the work went and what a
 * weekly point took by Mode_Code's readings. It reads the transcripts and the event log and writes nothing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  boundariesOf,
  callsOf,
  commandDirs,
  commitsOf,
  commitsOfTask,
  costOf,
  fixedAfter,
  fixedAnywhere,
  jsonLines,
  LOG_FORMAT,
  modelName,
  readingsOf,
  resetSaving,
  resetsOf,
  resultsOf,
  serversUsed,
  tasksOf,
  unitsPerPoint,
  usesOf,
  windowOf,
  type Commit,
  type Task,
} from '../core/measure.js';
import { pathKey, resolvePath, type Platform } from '../core/paths.js';
import { git } from './git.js';

/** The .jsonl files under a folder changed since `since`, at any depth (subagents keep their own). */
export function jsonlFiles(dir: string, since: number): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) out.push(...jsonlFiles(p, since));
      else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since) out.push(p);
    } catch {
      /* a file gone while the folder was read */
    }
  }
  return out;
}

export interface MeasureReport {
  days: number;
  calls: number;
  readings: number;
  /** How many units a weekly point took, when the readings tell. */
  point: { units: number; points: number; perPoint: number } | null;
  tasks: Task[];
  /** Units by model, and of them the subagents'. */
  models: { model: string; units: number; subagents: number }[];
  /** Tool output by tool, in characters, largest first. */
  output: { tool: string; chars: number }[];
  /** The MCP servers configured and not called in these days. */
  unusedServers: string[];
  /**
   * The resets at a task boundary in these days (docs/quota.md): how many, the median context read again before the
   * new conversation's first change, and the units they saved, an estimate (null where none was measured).
   */
  resets: { count: number; reread: number | null; saved: number | null };
  /**
   * How the committed work held: the closed tasks whose commit was found, those fixed or taken back by a later commit
   * within 48 hours and within 14 days (of those whose window has passed), and the units per task that held (closed, no
   * fix within 48 hours), all units over those.
   */
  held: { judged48: number; fixed48: number; judged14: number; fixed14: number; succeeded: number; perSuccess: number | null };
}

const HOUR = 3_600_000;

/** The middle value; null for none. */
function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The repositories' history, read once each: `git log` of every local branch from `since` on (a task's own commits may
 * live on one squashed into another since), through git as Mode_Code runs it (nothing the repository's settings name
 * runs). A folder's repository is its top folder; one that holds a memory folder is left out (`exclude`).
 */
function historyReader(since: number, exclude: readonly string[]): (dir: string) => { top: string; commits: Commit[] } | null {
  const tops = new Map<string, string | null>();
  const logs = new Map<string, Commit[]>();
  const key = (p: string) => pathKey(resolvePath(p, { platform: process.platform as Platform, home: homedir(), cwd: p }), process.platform as Platform);
  return (dir) => {
    if (!tops.has(dir)) {
      const top = git(dir, ['rev-parse', '--show-toplevel']);
      const found = top.ok && top.out ? top.out : null;
      tops.set(dir, found && !exclude.some((m) => key(m) === key(found) || key(m).startsWith(`${key(found)}/`)) ? found : null);
    }
    const top = tops.get(dir);
    if (!top) return null;
    if (!logs.has(top)) {
      const r = git(top, ['log', '--branches', `--since=${new Date(since).toISOString()}`, '--no-merges', LOG_FORMAT, '--name-only'], 15_000);
      logs.set(top, r.ok ? commitsOf(r.out) : []);
    }
    return { top, commits: logs.get(top)! };
  };
}

/** Measures the last `days` days. `servers` are the MCP servers configured (claude-env), to name the ones not used. */
export function measure(o: {
  claudeDir: string;
  dataDir: string;
  days: number;
  project?: string | null;
  now?: number;
  servers?: readonly string[];
  /** Read the repositories' history for how the committed work held (default); false leaves it unjudged. */
  git?: boolean;
  /** Memory folders: a repository that holds one is no project's, and its commits are not judged. */
  exclude?: readonly string[];
}): MeasureReport {
  const since = (o.now ?? Date.now()) - o.days * 86_400_000;
  const calls = [];
  const boundaries = [];
  const uses = [];
  const results = [];
  // In name order, so a call copied into another file (a forked session) is always the same one's.
  for (const f of jsonlFiles(join(o.claudeDir, 'projects'), since).sort()) {
    let text: string;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = jsonLines(text);
    calls.push(...callsOf(lines));
    boundaries.push(...boundariesOf(lines));
    uses.push(...usesOf(lines));
    results.push(...resultsOf(lines));
  }
  const events = jsonlFiles(join(o.dataDir, 'events'), since).flatMap((f) => {
    try {
      return jsonLines(readFileSync(f, 'utf8'));
    } catch {
      return [];
    }
  });
  const { calls: unique, readings } = windowOf(calls, readingsOf(events), since);
  const project = o.project?.toLowerCase() ?? null;
  const kept = project ? unique.filter((c) => c.cwd.toLowerCase().includes(project)) : unique;
  const tasks = tasksOf(kept, boundaries, uses, results);
  // A reset's conversation begins with the task it started: what it read again goes on that task.
  const resets = resetsOf(events).filter((r) => r.at >= since && kept.some((c) => c.session === r.session));
  for (const r of resets) {
    const t = tasks.find((x) => x.session === r.session);
    if (t) t.traces.reset = { before: r.before, ready: r.ready };
  }
  const savings = resets.map((r) => resetSaving(r, kept)).filter((x): x is number => x !== null);
  // How the committed work held: a later fix or revert of what each closed task committed.
  const now = o.now ?? Date.now();
  const history = o.git === false ? () => null : historyReader(since, o.exclude ?? []);
  const env = (cwd: string) => ({ platform: process.platform as Platform, home: homedir(), cwd: cwd || homedir() });
  for (const [i, t] of tasks.entries()) {
    if (t.endedBy === 'open' || !t.traces.committed.length) continue;
    const next = tasks.slice(i + 1).find((x) => x.session === t.session);
    // Where it committed: the folders its commands name (`git -C`, `cd`), else its own.
    const dirs = [...new Set(t.traces.committed.flatMap((c) => commandDirs(c)).map((d) => resolvePath(d, env(t.cwd))))];
    const repos = new Map<string, Commit[]>();
    for (const d of dirs.length ? dirs : [t.cwd]) {
      const h = d ? history(d) : null;
      if (h) repos.set(h.top, h.commits);
    }
    const answers = (windowMs: number) =>
      [...repos.values()].flatMap((commits) => {
        const own = commitsOfTask({ from: t.from, to: t.to, committed: t.traces.committed }, commits, next ? next.from : Infinity);
        return own.length ? [fixedAfter(own, commits, windowMs, now)] : [];
      });
    t.traces.fixed = { in48h: fixedAnywhere(answers(48 * HOUR)), in14d: fixedAnywhere(answers(14 * 24 * HOUR)) };
  }
  const judged48 = tasks.filter((t) => t.traces.fixed.in48h !== null);
  const judged14 = tasks.filter((t) => t.traces.fixed.in14d !== null);
  const succeeded = tasks.filter((t) => t.endedBy !== 'open' && t.traces.fixed.in48h !== true).length;
  const allUnits = tasks.reduce((n, t) => n + t.units, 0);
  const models = new Map<string, { units: number; subagents: number }>();
  for (const c of kept) {
    const u = costOf(c)?.units ?? 0;
    const m = models.get(modelName(c.model)) ?? { units: 0, subagents: 0 };
    m.units += u;
    if (c.sidechain) m.subagents += u;
    models.set(modelName(c.model), m);
  }
  const output = new Map<string, number>();
  for (const t of tasks) for (const [tool, chars] of Object.entries(t.traces.output)) output.set(tool, (output.get(tool) ?? 0) + chars);
  const used = serversUsed(uses);
  return {
    days: o.days,
    calls: kept.length,
    readings: readings.length,
    point: unitsPerPoint(readings, unique),
    tasks,
    models: [...models].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.units - a.units),
    output: [...output].map(([tool, chars]) => ({ tool, chars })).sort((a, b) => b.chars - a.chars),
    // Claude Code writes a server's name into its tools' names with other characters as `_`.
    unusedServers: [...new Set(o.servers ?? [])].filter((s) => !Object.hasOwn(used, s.replace(/[^A-Za-z0-9_-]/g, '_'))).sort(),
    resets: {
      count: resets.length,
      reread: median(resets.map((r) => r.ready).filter((x): x is number => x !== null)),
      saved: savings.length ? savings.reduce((n, x) => n + x, 0) : null,
    },
    held: {
      judged48: judged48.length,
      fixed48: judged48.filter((t) => t.traces.fixed.in48h).length,
      judged14: judged14.length,
      fixed14: judged14.filter((t) => t.traces.fixed.in14d).length,
      succeeded,
      perSuccess: succeeded ? allUnits / succeeded : null,
    },
  };
}

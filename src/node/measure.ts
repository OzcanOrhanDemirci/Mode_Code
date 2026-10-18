// SPDX-License-Identifier: Apache-2.0
/**
 * Quota per task, on this computer (`mode-code measure`, docs/testing.md): the Claude Code sessions of the last days
 * cut at their commits and pushes, each piece priced and weighed (core/measure.ts), with how the work went and what a
 * weekly point took by Mode_Code's readings. It reads the transcripts and the event log and writes nothing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  boundariesOf,
  callsOf,
  costOf,
  jsonLines,
  modelName,
  readingsOf,
  resultsOf,
  serversUsed,
  tasksOf,
  unitsPerPoint,
  usesOf,
  windowOf,
  type Task,
} from '../core/measure.js';

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
}

/** Measures the last `days` days. `servers` are the MCP servers configured (claude-env), to name the ones not used. */
export function measure(o: {
  claudeDir: string;
  dataDir: string;
  days: number;
  project?: string | null;
  now?: number;
  servers?: readonly string[];
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
  const all = readingsOf(
    jsonlFiles(join(o.dataDir, 'events'), since).flatMap((f) => {
      try {
        return jsonLines(readFileSync(f, 'utf8'));
      } catch {
        return [];
      }
    }),
  );
  const { calls: unique, readings } = windowOf(calls, all, since);
  const project = o.project?.toLowerCase() ?? null;
  const kept = project ? unique.filter((c) => c.cwd.toLowerCase().includes(project)) : unique;
  const tasks = tasksOf(kept, boundaries, uses, results);
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
  };
}

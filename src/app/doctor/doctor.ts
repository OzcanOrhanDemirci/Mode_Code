// SPDX-License-Identifier: Apache-2.0
/**
 * The maintenance check from end to end: measure, check, plan the repairs, make them, measure and check
 * again. A repair counts as done only when the checks that asked for it pass on the second measurement.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '../context.js';
import { parseConfig } from '../../core/config.js';
import { readJson, readText, writeJsonAtomic } from '../../node/fsx.js';
import { existsSync } from 'node:fs';
import type { Layout } from '../../core/layout.js';
import { realClaude } from '../../node/claude-env.js';
import { claudeDir as claudeDirOf, home, managedSettingsFiles, platform, toolPath } from '../../node/env.js';
import { distDir, stableNodePath, underAgent } from '../../node/install.js';
import { gatherFacts, type DoctorEnv, type Measure } from './facts.js';
import { runChecks, tally, type Tally } from './checks.js';
import { REPAIRS, type RepairOutcome } from './repairs.js';
import type { CheckResult, Facts, RepairId } from './types.js';

export interface DoctorRun {
  facts: Facts;
  results: CheckResult[];
  tally: Tally;
  ms: number;
}

/** The doctor's view of this process: the person's data folder, Claude Code folder and the real `claude`. */
export function doctorEnvFor(ctx: AppContext, opts: { quick?: boolean; env?: NodeJS.ProcessEnv } = {}): DoctorEnv {
  const env = opts.env ?? process.env;
  const cdir = claudeDirOf(env);
  return {
    layout: ctx.layout,
    claudeDir: cdir,
    globalConfig: env.CLAUDE_CONFIG_DIR ? `${cdir}/.claude.json` : toolPath(join(homedir(), '.claude.json')),
    managedSettings: managedSettingsFiles(),
    cwd: ctx.cwd,
    home: home(),
    env,
    platform,
    config: ctx.config,
    problems: ctx.problems,
    lang: ctx.lang,
    claude: realClaude,
    distDir: distDir(),
    ...(opts.quick ? { quick: true } : {}),
  };
}

export async function examine(d: DoctorEnv, measure?: Partial<Record<Measure, boolean>>): Promise<DoctorRun> {
  const started = Date.now();
  const facts = await gatherFacts(measure ? { ...d, measure: { ...d.measure, ...measure } } : d);
  const results = runChecks(facts);
  return { facts, results, tally: tally(results), ms: Date.now() - started };
}

/** What the control center shows of the last check: when, the counts, and what failed. */
export interface DoctorSummary {
  v: 1;
  at: number;
  quick: boolean;
  tally: Tally;
  problems: { id: string; status: 'warn' | 'fail'; protection: boolean; summary: CheckResult['summary']; repair: RepairId | null }[];
}

export function summarize(run: DoctorRun, quick: boolean): DoctorSummary {
  return {
    v: 1,
    at: run.facts.measuredAt,
    quick,
    tally: run.tally,
    problems: run.results
      .filter((r): r is CheckResult & { status: 'warn' | 'fail' } => r.status === 'warn' || r.status === 'fail')
      .map((r) => ({ id: r.id, status: r.status, protection: r.protection, summary: r.summary, repair: r.repair ?? null })),
  };
}

/** Keeps the last check's summary in the data folder (the doctor is its only writer). Never throws. */
export function saveSummary(d: DoctorEnv, run: DoctorRun): void {
  try {
    if (existsSync(d.layout.root)) writeJsonAtomic(join(d.layout.stateDir, 'doctor.json'), summarize(run, !!d.quick));
  } catch {
    /* the check itself already printed its result */
  }
}

export function loadSummary(l: Layout): DoctorSummary | null {
  const s = readJson<DoctorSummary>(join(l.stateDir, 'doctor.json'));
  return s && s.v === 1 && typeof s.at === 'number' && s.tally ? s : null;
}

/** The order repairs run in: folders before files, files before the settings that point at them. */
const ORDER: RepairId[] = [
  'create-data-folders',
  'tighten-permissions',
  'restore-hook-program',
  'repoint-node',
  'restore-hooks',
  'remove-duplicate-hooks',
  'restore-plugin-files',
  'reinstall-plugin',
  'enable-plugin',
  'rebuild-index',
  'remove-stale-temp',
  'prune-session-state',
  'remove-bad-quota',
  'rewrite-config',
];

export interface PlannedRepair {
  id: RepairId;
  /** The checks that asked for it. */
  checks: string[];
  personOnly: boolean;
  /** Refused here: an agent runs the doctor and the repair is the person's to make. */
  refused: boolean;
}

/** The repairs the results ask for, once each, in a safe order. Optional ones (for "info" results) only on request. */
export function planRepairs(results: readonly CheckResult[], opts: { agent: boolean; optional?: boolean }): PlannedRepair[] {
  const wanted = new Map<RepairId, string[]>();
  for (const r of results) {
    if (!r.repair) continue;
    if (r.status === 'fail' || r.status === 'warn' || (opts.optional && r.status === 'info')) wanted.set(r.repair, [...(wanted.get(r.repair) ?? []), r.id]);
  }
  // Repointing the hooks rewrites them too: one rewrite is enough.
  if (wanted.has('repoint-node')) {
    for (const x of ['restore-hooks', 'remove-duplicate-hooks'] as const) {
      const c = wanted.get(x);
      if (c) wanted.set('repoint-node', [...wanted.get('repoint-node')!, ...c]);
      wanted.delete(x);
    }
  }
  if (wanted.has('restore-hooks') && wanted.has('remove-duplicate-hooks')) {
    wanted.set('restore-hooks', [...wanted.get('restore-hooks')!, ...wanted.get('remove-duplicate-hooks')!]);
    wanted.delete('remove-duplicate-hooks');
  }
  return ORDER.filter((id) => wanted.has(id)).map((id) => {
    const personOnly = REPAIRS[id].personOnly;
    return { id, checks: wanted.get(id)!, personOnly, refused: personOnly && opts.agent };
  });
}

export interface RepairReport {
  outcomes: (RepairOutcome & { verified: boolean; refused: boolean })[];
  after: DoctorRun;
}

/** Makes the planned repairs, measures again, and marks each repair verified when its checks now pass. */
export async function repair(
  d: DoctorEnv,
  before: DoctorRun,
  plans: readonly PlannedRepair[],
  opts: { now?: number; node?: string } = {},
): Promise<RepairReport> {
  const env = {
    layout: d.layout,
    claudeDir: d.claudeDir,
    distDir: d.distDir,
    node: opts.node ?? stableNodePath(),
    runner: d.claude,
    // The valid parts of the settings as they are on disk now (a settings file with problems is rewritten from them).
    config: parseConfig(readText(d.layout.config)).config,
    now: opts.now ?? Date.now(),
  };
  const done: (RepairOutcome & { refused: boolean })[] = [];
  for (const p of plans) {
    if (p.refused) {
      done.push({ id: p.id, ok: false, detail: 'refused: an agent runs the doctor', refused: true });
      continue;
    }
    try {
      done.push({ ...REPAIRS[p.id].run(env, before.facts), refused: false });
    } catch (err) {
      done.push({ id: p.id, ok: false, detail: (err as Error)?.message ?? String(err), refused: false });
    }
  }
  const after = await examine(d);
  const passing = new Set(after.results.filter((r) => r.status === 'ok' || r.status === 'skip' || (r.status === 'info' && !r.repair)).map((r) => r.id));
  const outcomes = done.map((o) => {
    const checks = plans.find((p) => p.id === o.id)?.checks ?? [];
    return { ...o, verified: o.ok && checks.every((c) => passing.has(c)) };
  });
  return { outcomes, after };
}

/** True when the doctor runs inside an agent's shell (its repairs then exclude the person's own settings). */
export function agentRunning(d: DoctorEnv): boolean {
  return underAgent(d.env);
}

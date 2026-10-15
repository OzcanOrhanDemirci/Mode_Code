// SPDX-License-Identifier: Apache-2.0
/**
 * Whether a session working on a full-autonomy run may stop now. Claude Code asks the safety-net hook at
 * every Stop; while the run is not done the answer is no, with what is still missing, unless code measures a
 * reason to let it end: the run is over or paused, the budget is reached, the time limit is up, or nothing
 * has changed through three attempts to stop. Pure: the hook supplies the facts and keeps the counter.
 */
import { lastProgressAt, limitTime, nextStep, recordKey, type Run } from './run.js';

/**
 * What changed, in one short string: the commit, the work tree (`git status --porcelain`, untracked files
 * included: a new file is progress too) and the run's record. FNV-1a over the status keeps it short.
 */
export function fingerprintOf(head: string | null, status: string, r: Run): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < status.length; i++) {
    h ^= status.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${head ?? '-'}:${status.length}:${h.toString(16)}:${recordKey(r)}`;
}

/** Attempts to stop in a row with nothing changed, after which the run counts as stalled. */
export const STALL_STOPS = 3;

export interface StopFacts {
  now: number;
  /** What changed since the last attempt: the commit, the work tree, the run's record (see run.recordKey). */
  fingerprint: string;
  /** The quota guard's level for the run's budget. */
  quotaLevel: 'ok' | 'wrapUp' | 'stop';
  /** Background work Claude Code is waiting for (it wakes the session itself). */
  background: number;
  /** The settings: running hours and minutes without a milestone. */
  maxHours: number;
  stallMinutes: number;
}

/** The hook's memory between attempts, in its own state file. */
export interface StopMemory {
  runId: string | null;
  fingerprint: string | null;
  /** Attempts in a row with the same fingerprint, this one included. */
  streak: number;
}

export type StopAllow = 'none' | 'over' | 'paused' | 'budget' | 'waiting' | 'timeout' | 'stalled' | 'noProgress';

export type Missing = { kind: 'plan' } | { kind: 'step'; n: number; of: number; title: string } | { kind: 'finish' };

export type StopDecision = { allow: true; why: StopAllow; memory: StopMemory } | { allow: false; missing: Missing; streak: number; memory: StopMemory };

/** What a run still needs before it is done. */
export function missingOf(r: Run): Missing {
  if (!r.plan || r.phase === 'plan') return { kind: 'plan' };
  const next = nextStep(r);
  if (next) return { kind: 'step', n: next.n, of: r.plan.steps.length, title: next.title };
  return { kind: 'finish' };
}

export function stopDecision(run: Run | null, f: StopFacts, mem: StopMemory): StopDecision {
  const fresh: StopMemory = { runId: run?.id ?? null, fingerprint: null, streak: 0 };
  if (!run) return { allow: true, why: 'none', memory: fresh };
  if (run.status === 'done' || run.status === 'stuck' || run.status === 'canceled') return { allow: true, why: 'over', memory: fresh };
  if (run.status === 'paused') return { allow: true, why: 'paused', memory: fresh };
  if (f.quotaLevel !== 'ok') return { allow: true, why: 'budget', memory: fresh };
  if (f.background > 0) return { allow: true, why: 'waiting', memory: fresh };
  if (limitTime(run, f.now) >= f.maxHours * 3_600_000) return { allow: true, why: 'timeout', memory: fresh };
  // Twice the stall time without a milestone: the first span warns (the plugin says so on tool calls), the second ends it.
  if (f.now - lastProgressAt(run) >= 2 * f.stallMinutes * 60_000) return { allow: true, why: 'stalled', memory: fresh };
  const same = mem.runId === run.id && mem.fingerprint === f.fingerprint;
  const streak = same ? mem.streak + 1 : 1;
  const memory: StopMemory = { runId: run.id, fingerprint: f.fingerprint, streak };
  if (streak >= STALL_STOPS) return { allow: true, why: 'noProgress', memory: { ...memory, streak: 0 } };
  return { allow: false, missing: missingOf(run), streak, memory };
}

/** The pause reason a stop that code let through leaves on the run (none for a run that is over or already paused). */
export function pauseFor(why: StopAllow): 'stalled' | 'timeout' | 'quota' | null {
  if (why === 'stalled' || why === 'noProgress') return 'stalled';
  if (why === 'timeout') return 'timeout';
  if (why === 'budget') return 'quota';
  return null;
}

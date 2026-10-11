// SPDX-License-Identifier: Apache-2.0
/**
 * Subscription quota: readings and budget decisions. Pure.
 *
 * Readings come from Claude Code itself: the in-process mod reads `$.session.usage().rateLimits`, and the
 * status line receives `rate_limits` on stdin; both are turned into the same QuotaReading here. Rules:
 *  · weekly budget: an explicit target from "kota N" (accepted N-1…N+1: wrap up at N-1, stop at N+1) or
 *    the default 99 (wrap up at 97, stop at 99);
 *  · 5-hour window: wrap up at 95, stop at 99;
 *  · a reading older than `staleMinutes` never blocks anything; it is reported as stale instead, because
 *    a guard acting on numbers it cannot trust would be worse than no guard.
 */

export interface QuotaWindow {
  /** five_hour, seven_day, or another window Claude Code reports. */
  kind: string;
  /** 0-100, one decimal at most. */
  used: number;
  /** When the window resets, epoch milliseconds, or null when unknown. */
  resetsAt: number | null;
}

export interface QuotaReading {
  windows: QuotaWindow[];
  /** When the numbers were measured, epoch milliseconds. */
  measuredAt: number;
  source: 'mod' | 'statusline' | 'file';
}

export interface QuotaBudget {
  /** Explicit weekly target set by "kota N" / "kota +N", or null for the default. */
  weeklyTarget: number | null;
  weeklyTargetSource?: string;
  fiveHourWrapUp: number;
  fiveHourStop: number;
  defaultWeeklyTarget: number;
  defaultWeeklyWrapUp: number;
  staleMinutes: number;
}

export const DEFAULT_BUDGET: QuotaBudget = {
  weeklyTarget: null,
  fiveHourWrapUp: 95,
  fiveHourStop: 99,
  defaultWeeklyTarget: 99,
  defaultWeeklyWrapUp: 97,
  staleMinutes: 360,
};

export type QuotaLevel = 'ok' | 'wrapUp' | 'stop';

export interface QuotaReason {
  window: 'five_hour' | 'seven_day';
  used: number;
  /** The limit that was reached. */
  at: number;
  level: Exclude<QuotaLevel, 'ok'>;
}

export interface QuotaAssessment {
  /** False when there is no reading, or the reading is too old to act on. */
  usable: boolean;
  stale: boolean;
  level: QuotaLevel;
  reasons: QuotaReason[];
  /** When the binding window resets, so work can resume; null when unknown or not limited. */
  resumeAt: number | null;
  five: QuotaWindow | null;
  week: QuotaWindow | null;
  target: { value: number; explicit: boolean; source?: string };
  ageMinutes: number | null;
}

/** Reads the mod's `rateLimits` (resetsAt as ISO 8601). */
export function fromModRateLimits(list: readonly { kind: string; percentUsed: number; resetsAt?: string }[], now: number): QuotaReading {
  return {
    windows: list.map((w) => ({ kind: w.kind, used: w.percentUsed, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null })),
    measuredAt: now,
    source: 'mod',
  };
}

/** Reads the status line's `rate_limits` ({ five_hour: { used_percentage, resets_at (unix seconds) } }). */
export function fromStatusLine(rl: unknown, measuredAt: number): QuotaReading | null {
  if (!rl || typeof rl !== 'object') return null;
  const windows: QuotaWindow[] = [];
  for (const [kind, v] of Object.entries(rl as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const used = (v as Record<string, unknown>).used_percentage;
    const resets = (v as Record<string, unknown>).resets_at;
    if (typeof used !== 'number') continue;
    windows.push({ kind, used, resetsAt: typeof resets === 'number' ? resets * 1000 : null });
  }
  return windows.length ? { windows, measuredAt, source: 'statusline' } : null;
}

function windowNow(r: QuotaReading, kind: string, now: number): QuotaWindow | null {
  const w = r.windows.find((x) => x.kind === kind);
  if (!w) return null;
  // A window whose reset time has passed is empty again until a new measurement arrives.
  if (w.resetsAt !== null && w.resetsAt <= now) return { kind, used: 0, resetsAt: null };
  return w;
}

export function assessQuota(reading: QuotaReading | null, budget: QuotaBudget, now: number): QuotaAssessment {
  const explicit = budget.weeklyTarget !== null;
  const target = {
    value: budget.weeklyTarget ?? budget.defaultWeeklyTarget,
    explicit,
    ...(budget.weeklyTargetSource ? { source: budget.weeklyTargetSource } : {}),
  };
  const base: QuotaAssessment = { usable: false, stale: false, level: 'ok', reasons: [], resumeAt: null, five: null, week: null, target, ageMinutes: null };
  if (!reading) return base;
  const ageMinutes = (now - reading.measuredAt) / 60000;
  const five = windowNow(reading, 'five_hour', now);
  const week = windowNow(reading, 'seven_day', now);
  const stale = ageMinutes > budget.staleMinutes;
  const a: QuotaAssessment = { ...base, usable: !stale, stale, five, week, ageMinutes };
  if (stale) return a;

  const consider = (w: QuotaWindow | null, name: 'five_hour' | 'seven_day', wrapAt: number, stopAt: number) => {
    if (!w) return;
    const used = Math.round(w.used);
    if (used >= stopAt) a.reasons.push({ window: name, used, at: stopAt, level: 'stop' });
    else if (used >= wrapAt) a.reasons.push({ window: name, used, at: wrapAt, level: 'wrapUp' });
    else return;
    if (w.resetsAt !== null && (a.resumeAt === null || w.resetsAt > a.resumeAt)) a.resumeAt = w.resetsAt;
  };
  consider(five, 'five_hour', budget.fiveHourWrapUp, budget.fiveHourStop);
  if (explicit) consider(week, 'seven_day', target.value - 1, target.value + 1);
  else consider(week, 'seven_day', budget.defaultWeeklyWrapUp, budget.defaultWeeklyTarget);
  a.level = a.reasons.some((r) => r.level === 'stop') ? 'stop' : a.reasons.length ? 'wrapUp' : 'ok';
  return a;
}

/** Resolves "kota N" / "kota +N" against the current weekly reading. Returns null when +N has no reading. */
export function weeklyTargetFrom(kw: { n: number; plus: boolean }, reading: QuotaReading | null, now: number): number | null {
  if (!kw.plus) return kw.n;
  if (!reading) return null;
  const w = windowNow(reading, 'seven_day', now);
  return w ? Math.round(w.used) + kw.n : null;
}

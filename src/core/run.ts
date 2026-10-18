// SPDX-License-Identifier: Apache-2.0
/**
 * Full autonomy: a run takes one task to its end with nobody at the keyboard (see docs/autonomy.md).
 * Pure: the record, its parsing, and every transition. The plugin owns the record file (one writer) and
 * supplies the facts the transitions need (the checked plan, the commit and review of a milestone, the
 * results of the finish); the safety-net hook only reads it.
 *
 * What the shape guarantees: a run is done only through a finish whose facts all passed; milestones are
 * accepted in the plan's order, each on a commit of its own, never after a failed review; the plan's
 * verification commands are only ever added to; a terminal run never changes again.
 */
import { fold, truncate } from './text.js';

export type RunPhase = 'plan' | 'work' | 'finish';
export type RunStatus = 'active' | 'paused' | 'done' | 'stuck' | 'canceled';
/** Why a run paused: the person, the quota, the session's end, no measurable progress, the time limit, a failed start check. */
export type PauseReason = 'person' | 'wrapUp' | 'quota' | 'session' | 'stalled' | 'timeout' | 'disabled' | 'gate';
export type ReviewVerdict = 'pass' | 'concerns' | 'fail' | 'unavailable';

export interface Review {
  verdict: ReviewVerdict;
  findings: string[];
  /** The model that reviewed, or null when no review could run. */
  model: string | null;
  at: number;
  /** Code's own signals shown to the reviewer: test files deleted, skip markers added. */
  signals: { deletedTests: number; skipMarkers: number };
}

export interface Milestone {
  /** The plan step it completes (from 1). */
  n: number;
  at: number;
  /** The commit it stands on, and the git reference that keeps it. */
  commit: string;
  ref: string;
  /** Commits since the previous milestone (or the start). */
  commits: number;
  review: Review;
  /** What Claude said about the step, kept as its handoff note. */
  note: string;
}

export interface RunStep {
  n: number;
  title: string;
  acceptance: string;
}

export interface RunPlan {
  steps: RunStep[];
  /** Every verification command, in order: the plan's and the person's (`projects[].verify`). */
  verification: string[];
  /** The person's own commands for the project; a plan can never drop them. */
  required: string[];
  acceptedAt: number;
  revisions: number;
}

/** The classes of steps that wait for the person (docs/autonomy.md, "What waits for you"). */
export type DeferKind = 'belt' | 'push' | 'merge' | 'release' | 'repo' | 'publish' | 'outward' | 'mcp' | 'permission' | 'question' | 'model';

export interface Deferred {
  at: number;
  kind: DeferKind;
  /** The tool and the exact command or input, secrets masked by the caller. */
  tool: string;
  what: string;
  /** Why it waits, in English (the report words it in the person's language by kind). */
  reason: string;
  /** How many times the same step was attempted. */
  count: number;
}

export type BlockerKind = 'decision' | 'access' | 'tool' | 'external' | 'other';

export interface Blocker {
  at: number;
  kind: BlockerKind;
  text: string;
}

export interface FinishFacts {
  at: number;
  verification: { command: string; ok: boolean; seconds: number }[];
  review: Review;
}

export interface RunEvent {
  at: number;
  event: 'start' | 'plan' | 'revise' | 'milestone' | 'refused' | 'blocker' | 'deferred' | 'finish' | 'stuck' | 'pause' | 'resume' | 'cancel' | 'extend';
  detail?: string;
}

export interface Run {
  v: 1;
  id: string;
  /** What the person asked for, in their words: restated to Claude at every milestone. */
  task: string;
  project: string | null;
  /** The project: the top of the git work tree the run works in, resolved. */
  cwd: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  /** When the plugin last saw the run working (a heartbeat, at most once a minute). */
  aliveAt: number;
  status: RunStatus;
  phase: RunPhase;
  pause: { reason: PauseReason; at: number; detail: string } | null;
  /** The weekly quota target the run works within (absolute), and how the person gave it ("+10", "60"). */
  budget: { weeklyTarget: number; source: string };
  /**
   * The commit the run started from, the branch it was on, and the untracked files that were already there
   * (the person's own: a milestone asks only about files the run left untracked).
   */
  start: { commit: string; branch: string | null; ref: string; untracked: string[] };
  /** Where Claude writes its drafts: the plan, the report, the notes. */
  workDir: string;
  planPath: string;
  reportPath: string;
  notesPath: string;
  plan: RunPlan | null;
  milestones: Milestone[];
  deferred: Deferred[];
  blockers: Blocker[];
  finish: FinishFacts | null;
  /** Running time so far, in milliseconds, and since when the run is running again (null while paused or over). */
  activeMs: number;
  runningSince: number | null;
  /**
   * The running time at which the current time limit began: 0, or where the run stood when it was resumed after
   * its time ran out (resuming gives a fresh limit; the running time itself goes on counting).
   */
  limitFrom: number;
  history: RunEvent[];
}

export type RunError =
  'terminal' | 'paused' | 'phase' | 'order' | 'review-failed' | 'no-blocker' | 'not-paused' | 'verification-dropped' | 'steps-dropped' | 'unfinished';

export type RunResult = { ok: true; run: Run } | { ok: false; error: RunError; run: Run; detail?: string };

const HISTORY_CAP = 300;
const DEFERRED_CAP = 200;
const BLOCKER_CAP = 100;

export function isTerminal(r: Run): boolean {
  return r.status === 'done' || r.status === 'stuck' || r.status === 'canceled';
}

export function isLive(r: Run): boolean {
  return r.status === 'active';
}

/** `<yyyymmdd>-<hhmm>-<words of the task>`: sortable, readable, safe as a file name and a git reference. */
export function runId(task: string, now: number, taken: ReadonlySet<string>): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  let words = '';
  for (const w of fold(task)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)) {
    const next = words ? `${words}-${w}` : w.slice(0, 40);
    if (next.length > 40) break;
    words = next;
  }
  const base = `${stamp}-${words || 'run'}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** The git reference that keeps a run's point n (0 is where it started). */
export function rollbackRef(id: string, n: number): string {
  return `refs/mode-code/runs/${id}/${n}`;
}

export interface StartRunInput {
  id: string;
  task: string;
  project: string | null;
  cwd: string;
  sessionId: string;
  workDir: string;
  budget: { weeklyTarget: number; source: string };
  start: { commit: string; branch: string | null; untracked?: readonly string[] };
  now: number;
}

/** Untracked files the run added since its start: they belong in a commit, or in .gitignore, before a milestone. */
export function newUntracked(r: Run, untracked: readonly string[]): string[] {
  const before = new Set(r.start.untracked);
  return untracked.filter((f) => !before.has(f));
}

export function startRun(i: StartRunInput): Run {
  const dir = `${i.workDir.replace(/\/+$/, '')}/${i.id}`;
  return {
    v: 1,
    id: i.id,
    task: truncate(i.task.trim(), 4000),
    project: i.project,
    cwd: i.cwd,
    sessionId: i.sessionId,
    createdAt: i.now,
    updatedAt: i.now,
    aliveAt: i.now,
    status: 'active',
    phase: 'plan',
    pause: null,
    budget: { ...i.budget },
    start: { commit: i.start.commit, branch: i.start.branch, ref: rollbackRef(i.id, 0), untracked: [...(i.start.untracked ?? [])].slice(0, 1000) },
    workDir: dir,
    planPath: `${dir}/plan.md`,
    reportPath: `${dir}/report.md`,
    notesPath: `${dir}/notes.md`,
    plan: null,
    milestones: [],
    deferred: [],
    blockers: [],
    finish: null,
    activeMs: 0,
    limitFrom: 0,
    runningSince: i.now,
    history: [{ at: i.now, event: 'start' }],
  };
}

function log(r: Run, e: RunEvent): Run {
  return { ...r, updatedAt: e.at, history: [...r.history, e].slice(-HISTORY_CAP) };
}

function fail(r: Run, error: RunError, detail?: string): RunResult {
  return detail === undefined ? { ok: false, error, run: r } : { ok: false, error, run: r, detail };
}

/** Why a model-driven change cannot happen now, or null. */
function blockedFor(r: Run): RunError | null {
  if (isTerminal(r)) return 'terminal';
  if (r.status === 'paused') return 'paused';
  return null;
}

/** The next plan step without a milestone (from 1), or null when every step has one (or there is no plan). */
export function nextStep(r: Run): RunStep | null {
  if (!r.plan) return null;
  const done = new Set(r.milestones.map((m) => m.n));
  return r.plan.steps.find((s) => !done.has(s.n)) ?? null;
}

/** Steps with a milestone, and how many the plan has. */
export function progress(r: Run): { done: number; of: number } {
  return { done: r.milestones.length, of: r.plan?.steps.length ?? 0 };
}

/** The time of the last thing that counts as progress: the start, the plan, a milestone, or running again after a pause. */
export function lastProgressAt(r: Run): number {
  return Math.max(r.createdAt, r.plan?.acceptedAt ?? 0, ...r.milestones.map((m) => m.at), r.runningSince ?? 0);
}

/** Running time in milliseconds, paused time left out. */
export function activeTime(r: Run, now: number): number {
  return r.activeMs + (r.runningSince !== null ? Math.max(0, now - r.runningSince) : 0);
}

/** The running time the time limit counts: since the run started, or since it was resumed after its time ran out. */
export function limitTime(r: Run, now: number): number {
  return activeTime(r, now) - r.limitFrom;
}

/**
 * The time limit against the setting (A10 of 1.2.0, `autonomy.atTimeLimit`): under it; past it with a milestone
 * within the stall time and the setting `continue`, a fresh limit and the run goes on; otherwise it pauses. The
 * person's word (2026-10-18): full autonomy is for when they do not have to do anything.
 */
export function atLimit(r: Run, now: number, o: { maxHours: number; stallMinutes: number; atTimeLimit: 'continue' | 'pause' }): 'under' | 'extend' | 'pause' {
  if (limitTime(r, now) < o.maxHours * 3_600_000) return 'under';
  return o.atTimeLimit === 'continue' && now - lastProgressAt(r) < o.stallMinutes * 60_000 ? 'extend' : 'pause';
}

/** A fresh time limit from now, recorded; the running time goes on counting. */
export function extendLimit(r: Run, now: number): Run {
  return log({ ...r, limitFrom: activeTime(r, now) }, { at: now, event: 'extend' });
}

/**
 * The plan is accepted (or revised). The person's commands always stay in the verification; a revision
 * may not drop a verification command, nor drop steps that already have a milestone.
 */
export function acceptPlan(r: Run, plan: { steps: readonly RunStep[]; verification: readonly string[] }, required: readonly string[], now: number): RunResult {
  const b = blockedFor(r);
  if (b) return fail(r, b);
  if (r.phase === 'finish') return fail(r, 'phase');
  // The person's commands are kept from the first plan on, whatever a later call passes.
  const person = [...new Set([...(r.plan?.required ?? []), ...required])];
  const verification = [...new Set([...plan.verification, ...person])];
  if (r.plan) {
    const dropped = r.plan.verification.filter((c) => !verification.includes(c));
    if (dropped.length) return fail(r, 'verification-dropped', dropped.join('\n'));
    const done = Math.max(0, ...r.milestones.map((m) => m.n));
    if (plan.steps.length < done) return fail(r, 'steps-dropped', String(done));
  }
  const steps = plan.steps.map((s) => ({ n: s.n, title: truncate(s.title, 200), acceptance: truncate(s.acceptance, 600) }));
  const revision = r.plan !== null;
  const next: Run = {
    ...r,
    phase: 'work',
    plan: {
      steps,
      verification,
      required: person,
      acceptedAt: now,
      revisions: (r.plan?.revisions ?? -1) + 1,
    },
  };
  return { ok: true, run: log(next, { at: now, event: revision ? 'revise' : 'plan', detail: `${steps.length} steps, ${verification.length} commands` }) };
}

/** A milestone for the next step, once its commit and its review are known. A failed review refuses it. */
export function acceptMilestone(r: Run, m: Milestone, now: number): RunResult {
  const b = blockedFor(r);
  if (b) return fail(r, b);
  if (r.phase !== 'work' || !r.plan) return fail(r, 'phase');
  const next = nextStep(r);
  if (!next || next.n !== m.n) return fail(r, 'order', String(next?.n ?? ''));
  if (m.review.verdict === 'fail') return fail(r, 'review-failed');
  const milestones = [...r.milestones, { ...m, note: truncate(m.note, 2000), review: { ...m.review, findings: m.review.findings.slice(0, 30) } }];
  return { ok: true, run: log({ ...r, milestones }, { at: now, event: 'milestone', detail: `${m.n} ${m.commit.slice(0, 12)} ${m.review.verdict}` }) };
}

/** Records a refused step (a milestone without a commit, a plan that failed its check) without changing the run. */
export function noteRefusal(r: Run, detail: string, now: number): Run {
  return log(r, { at: now, event: 'refused', detail: truncate(detail, 500) });
}

export function addBlocker(r: Run, kind: BlockerKind, text: string, now: number): RunResult {
  const b = blockedFor(r);
  if (b) return fail(r, b);
  const blockers = [...r.blockers, { at: now, kind, text: truncate(text.trim(), 2000) }].slice(-BLOCKER_CAP);
  return { ok: true, run: log({ ...r, blockers }, { at: now, event: 'blocker', detail: kind }) };
}

/**
 * A step that waits for the person. The same step attempted again is counted, not listed twice. Recorded in
 * any state but a terminal one: what was refused while pausing still belongs in the report.
 */
export function addDeferred(r: Run, d: Omit<Deferred, 'count' | 'at'>, now: number): RunResult {
  if (isTerminal(r)) return fail(r, 'terminal');
  const what = truncate(d.what.trim(), 1000);
  const same = r.deferred.findIndex((x) => x.kind === d.kind && x.tool === d.tool && x.what === what);
  const deferred =
    same === -1
      ? [...r.deferred, { ...d, what, reason: truncate(d.reason, 500), at: now, count: 1 }].slice(-DEFERRED_CAP)
      : r.deferred.map((x, i) => (i === same ? { ...x, count: x.count + 1, at: now } : x));
  return { ok: true, run: same === -1 ? log({ ...r, deferred }, { at: now, event: 'deferred', detail: d.kind }) : { ...r, deferred, updatedAt: now } };
}

function stopClock(r: Run, now: number): Run {
  return { ...r, activeMs: activeTime(r, now), runningSince: null };
}

/** Done: every step has its milestone and every fact of the finish passed. Anything else is refused. */
export function finishRun(r: Run, facts: FinishFacts, reportOk: boolean, now: number): RunResult {
  const b = blockedFor(r);
  if (b) return fail(r, b);
  if (r.phase !== 'work' || !r.plan) return fail(r, 'phase');
  if (nextStep(r) !== null) return fail(r, 'unfinished', String(nextStep(r)!.n));
  if (!facts.verification.length || facts.verification.some((v) => !v.ok)) return fail(r, 'unfinished', 'verification');
  if (facts.review.verdict === 'fail') return fail(r, 'review-failed');
  if (!reportOk) return fail(r, 'unfinished', 'report');
  const done: Run = { ...stopClock(r, now), status: 'done', phase: 'finish', finish: facts, pause: null };
  return { ok: true, run: log(done, { at: now, event: 'finish' }) };
}

/** Stuck: every path is blocked. Needs at least one recorded blocker and the report. */
export function markStuck(r: Run, reportOk: boolean, now: number): RunResult {
  const b = blockedFor(r);
  if (b) return fail(r, b);
  if (!r.blockers.length) return fail(r, 'no-blocker');
  if (!reportOk) return fail(r, 'unfinished', 'report');
  return { ok: true, run: log({ ...stopClock(r, now), status: 'stuck', pause: null }, { at: now, event: 'stuck' }) };
}

export function pauseRun(r: Run, reason: PauseReason, now: number, detail = ''): RunResult {
  if (isTerminal(r)) return fail(r, 'terminal');
  if (r.status === 'paused') return { ok: true, run: r };
  const paused: Run = { ...stopClock(r, now), status: 'paused', pause: { reason, at: now, detail: truncate(detail, 300) } };
  return { ok: true, run: log(paused, { at: now, event: 'pause', detail: reason }) };
}

/** Resumes a paused run in this session, at its phase. A run that still runs elsewhere is the caller's to check. */
export function resumeRun(r: Run, sessionId: string, now: number): RunResult {
  if (isTerminal(r)) return fail(r, 'terminal');
  if (r.status !== 'paused') return fail(r, 'not-paused');
  const limitFrom = r.pause?.reason === 'timeout' ? r.activeMs : r.limitFrom;
  return { ok: true, run: log({ ...r, status: 'active', pause: null, sessionId, runningSince: now, aliveAt: now, limitFrom }, { at: now, event: 'resume' }) };
}

export function cancelRun(r: Run, now: number): RunResult {
  if (isTerminal(r)) return fail(r, 'terminal');
  return { ok: true, run: log({ ...stopClock(r, now), status: 'canceled', pause: null }, { at: now, event: 'cancel' }) };
}

/** The run was seen working; written at most once a minute so the record does not churn. */
export function heartbeat(r: Run, now: number): Run | null {
  return now - r.aliveAt >= 60_000 ? { ...r, aliveAt: now } : null;
}

/**
 * What changes when the run changes: its history, plan, milestones, deferred steps and blockers. The
 * heartbeat is left out, so reading files does not count as progress.
 */
export function recordKey(r: Run): string {
  return [r.status, r.phase, r.history.length, r.milestones.length, r.deferred.length, r.blockers.length, r.plan?.revisions ?? -1].join(':');
}

// ── parsing ───────────────────────────────────────────────────────────────────────────────────────────

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const STATUSES = new Set<RunStatus>(['active', 'paused', 'done', 'stuck', 'canceled']);
const PHASES = new Set<RunPhase>(['plan', 'work', 'finish']);
const REASONS = new Set<PauseReason>(['person', 'wrapUp', 'quota', 'session', 'stalled', 'timeout', 'disabled', 'gate']);
const VERDICTS = new Set<ReviewVerdict>(['pass', 'concerns', 'fail', 'unavailable']);
const DEFER_KINDS = new Set<DeferKind>(['belt', 'push', 'merge', 'release', 'repo', 'publish', 'outward', 'mcp', 'permission', 'question', 'model']);
const BLOCKER_KINDS = new Set<BlockerKind>(['decision', 'access', 'tool', 'external', 'other']);

const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d);
const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

function parseReview(x: unknown): Review {
  const o = isObj(x) ? x : {};
  const s = isObj(o.signals) ? o.signals : {};
  return {
    verdict: VERDICTS.has(o.verdict as ReviewVerdict) ? (o.verdict as ReviewVerdict) : 'unavailable',
    findings: strs(o.findings),
    model: typeof o.model === 'string' ? o.model : null,
    at: num(o.at),
    signals: { deletedTests: num(s.deletedTests), skipMarkers: num(s.skipMarkers) },
  };
}

/** Reads a run record; null when it is missing, torn or of another shape. Never throws. */
export function parseRun(text: string | null): Run | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(o) || o.v !== 1 || typeof o.id !== 'string' || !STATUSES.has(o.status as RunStatus) || !PHASES.has(o.phase as RunPhase)) return null;
  if (!isObj(o.budget) || !isObj(o.start)) return null;
  const plan = isObj(o.plan)
    ? {
        steps: (Array.isArray(o.plan.steps) ? o.plan.steps : [])
          .filter(isObj)
          .map((s) => ({ n: num(s.n), title: str(s.title), acceptance: str(s.acceptance) }))
          .filter((s) => s.n > 0),
        verification: strs(o.plan.verification),
        required: strs(o.plan.required),
        acceptedAt: num(o.plan.acceptedAt),
        revisions: num(o.plan.revisions),
      }
    : null;
  const pause =
    isObj(o.pause) && REASONS.has(o.pause.reason as PauseReason)
      ? { reason: o.pause.reason as PauseReason, at: num(o.pause.at), detail: str(o.pause.detail) }
      : null;
  const finish = isObj(o.finish)
    ? {
        at: num(o.finish.at),
        verification: (Array.isArray(o.finish.verification) ? o.finish.verification : [])
          .filter(isObj)
          .map((v) => ({ command: str(v.command), ok: v.ok === true, seconds: num(v.seconds) })),
        review: parseReview(o.finish.review),
      }
    : null;
  return {
    v: 1,
    id: o.id,
    task: str(o.task),
    project: typeof o.project === 'string' ? o.project : null,
    cwd: str(o.cwd),
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : null,
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
    aliveAt: num(o.aliveAt),
    status: o.status as RunStatus,
    phase: o.phase as RunPhase,
    pause,
    budget: { weeklyTarget: num(o.budget.weeklyTarget, 0), source: str(o.budget.source) },
    start: {
      commit: str(o.start.commit),
      branch: typeof o.start.branch === 'string' ? o.start.branch : null,
      ref: str(o.start.ref),
      untracked: strs(o.start.untracked),
    },
    workDir: str(o.workDir),
    planPath: str(o.planPath),
    reportPath: str(o.reportPath),
    notesPath: str(o.notesPath),
    plan,
    milestones: (Array.isArray(o.milestones) ? o.milestones : []).filter(isObj).map((m) => ({
      n: num(m.n),
      at: num(m.at),
      commit: str(m.commit),
      ref: str(m.ref),
      commits: num(m.commits),
      review: parseReview(m.review),
      note: str(m.note),
    })),
    deferred: (Array.isArray(o.deferred) ? o.deferred : [])
      .filter(isObj)
      .filter((d) => DEFER_KINDS.has(d.kind as DeferKind))
      .map((d) => ({
        at: num(d.at),
        kind: d.kind as DeferKind,
        tool: str(d.tool),
        what: str(d.what),
        reason: str(d.reason),
        count: Math.max(1, num(d.count, 1)),
      })),
    blockers: (Array.isArray(o.blockers) ? o.blockers : [])
      .filter(isObj)
      .map((b) => ({ at: num(b.at), kind: BLOCKER_KINDS.has(b.kind as BlockerKind) ? (b.kind as BlockerKind) : 'other', text: str(b.text) })),
    finish,
    activeMs: num(o.activeMs),
    limitFrom: Math.min(num(o.limitFrom), num(o.activeMs)),
    runningSince: typeof o.runningSince === 'number' && Number.isFinite(o.runningSince) ? o.runningSince : null,
    history: (Array.isArray(o.history) ? o.history : []).filter((e): e is RunEvent => isObj(e) && typeof e.at === 'number' && typeof e.event === 'string'),
  };
}

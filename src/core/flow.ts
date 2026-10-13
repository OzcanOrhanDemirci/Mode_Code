// SPDX-License-Identifier: Apache-2.0
/**
 * Mode flows: steps that run in order (research ▶ plan → approval → code), none skipped, each finished only
 * when its definition of done is met. Pure: the record, its parsing, and every transition. The plugin owns
 * the record file (one writer) and supplies the checks' facts (files, the person's answer, test results).
 *
 * Who may cause what is part of the shape: the model completes research, plan and code steps (after the
 * checks); only the person approves, asks for a revision, pauses, resumes or cancels.
 */
import type { WorkMode } from './modes.js';
import type { FlowVariant } from './keywords.js';
import { fold, truncate } from './text.js';

export type FlowStepKind = 'research' | 'plan' | 'approve' | 'code';
export type FlowStatus = 'active' | 'waiting' | 'paused' | 'done' | 'canceled';
export type StartableFlow = Exclude<FlowVariant, 'cancel'>;
/** How the person approved a plan. */
export type ApprovalVia = 'dialog' | 'plan-mode' | 'keyword';

export const FLOW_STEPS: Record<StartableFlow, readonly FlowStepKind[]> = {
  full: ['research', 'plan', 'approve', 'code'],
  plan: ['plan', 'approve', 'code'],
  research: ['research'],
  researchPlan: ['research', 'plan'],
};

/** What a step's check found, set when the step is done; the interface words it in each language. */
export type FlowEvidence =
  | { kind: 'research'; findings: number; sources: number }
  | { kind: 'plan'; steps: number; commands: number }
  | { kind: 'approve'; via: ApprovalVia }
  | { kind: 'code'; commands: number; seconds: number };

export interface FlowStep {
  kind: FlowStepKind;
  status: 'pending' | 'active' | 'done';
  startedAt: number | null;
  doneAt: number | null;
  evidence: FlowEvidence | null;
}

export interface FlowEvent {
  at: number;
  event: 'start' | 'done' | 'approve' | 'revise' | 'pause' | 'resume' | 'cancel' | 'refused';
  step?: FlowStepKind;
  detail?: string;
}

export interface Flow {
  v: 1;
  id: string;
  variant: StartableFlow;
  /** What the person asked for, in their words (may be empty: the task under discussion). */
  task: string;
  project: string | null;
  /** The folder the flow works in, resolved. */
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: FlowStatus;
  /** Index of the current step; steps.length once done. */
  current: number;
  steps: FlowStep[];
  /** The session working on it now, or the last one. */
  sessionId: string | null;
  /** Where Claude writes the drafts (the report, the plan). */
  workDir: string;
  reportPath: string;
  planPath: string;
  approval: { at: number; via: ApprovalVia } | null;
  /** The verification commands of the approved plan, run by the code step's check. */
  verification: string[];
  history: FlowEvent[];
}

export type FlowError = 'terminal' | 'paused' | 'not-current' | 'person-only' | 'not-waiting' | 'not-paused';

export type FlowResult = { ok: true; flow: Flow } | { ok: false; error: FlowError; flow: Flow };

const HISTORY_CAP = 200;

/** The mode a step works in: the approval waits in plan, where only the plan may still change. */
export function stepMode(kind: FlowStepKind): WorkMode {
  return kind === 'research' ? 'research' : kind === 'code' ? 'code' : 'plan';
}

export function currentStep(f: Flow): FlowStep | null {
  return f.steps[f.current] ?? null;
}

/** A flow that still runs: its current step sets the session's mode. */
export function isRunning(f: Flow): boolean {
  return f.status === 'active' || f.status === 'waiting';
}

export function isOpen(f: Flow): boolean {
  return f.status !== 'done' && f.status !== 'canceled';
}

/** `<yyyymmdd>-<hhmm>-<words of the task>`: sortable, readable, safe as a file name. */
export function flowId(task: string, now: number, taken: ReadonlySet<string>): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  let words = '';
  // Whole words only, up to five and 40 characters.
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
  const base = `${stamp}-${words || 'flow'}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export interface StartInput {
  id: string;
  variant: StartableFlow;
  task: string;
  project: string | null;
  cwd: string;
  sessionId: string;
  workDir: string;
  now: number;
}

export function startFlow(i: StartInput): Flow {
  const steps: FlowStep[] = FLOW_STEPS[i.variant].map((kind, n) => ({
    kind,
    status: n === 0 ? 'active' : 'pending',
    startedAt: n === 0 ? i.now : null,
    doneAt: null,
    evidence: null,
  }));
  const dir = `${i.workDir.replace(/\/+$/, '')}/${i.id}`;
  return {
    v: 1,
    id: i.id,
    variant: i.variant,
    task: truncate(i.task.trim(), 2000),
    project: i.project,
    cwd: i.cwd,
    createdAt: i.now,
    updatedAt: i.now,
    status: 'active',
    current: 0,
    steps,
    sessionId: i.sessionId,
    workDir: dir,
    reportPath: `${dir}/research.md`,
    planPath: `${dir}/plan.md`,
    approval: null,
    verification: [],
    history: [{ at: i.now, event: 'start', detail: i.variant }],
  };
}

function log(f: Flow, e: FlowEvent): Flow {
  return { ...f, updatedAt: e.at, history: [...f.history, e].slice(-HISTORY_CAP) };
}

/** Moves to the next step after the current one is done. */
function advance(f: Flow, now: number, evidence: FlowEvidence): Flow {
  const steps = f.steps.map((s, i) => (i === f.current ? { ...s, status: 'done' as const, doneAt: now, evidence } : s));
  const next = f.current + 1;
  if (next >= steps.length) return { ...f, steps, current: steps.length, status: 'done' };
  steps[next] = { ...steps[next]!, status: 'active', startedAt: now };
  return { ...f, steps, current: next, status: steps[next]!.kind === 'approve' ? 'waiting' : 'active' };
}

function fail(f: Flow, error: FlowError): FlowResult {
  return { ok: false, error, flow: f };
}

function blocked(f: Flow): FlowError | null {
  if (!isOpen(f)) return 'terminal';
  if (f.status === 'paused') return 'paused';
  return null;
}

/**
 * Finishes the model's current step (research, plan or code) once its check has passed. A step that is not
 * the current one is refused: steps are never skipped, and the approval is never the model's.
 */
export function completeStep(f: Flow, kind: FlowStepKind, evidence: FlowEvidence, now: number): FlowResult {
  const b = blocked(f);
  if (b) return fail(f, b);
  if (kind === 'approve') return fail(f, 'person-only');
  if (currentStep(f)?.kind !== kind || evidence.kind !== kind) return fail(f, 'not-current');
  return { ok: true, flow: log(advance(f, now, evidence), { at: now, event: 'done', step: kind }) };
}

/** The person approved the plan waiting for approval. The verification commands come from the approved plan. */
export function approvePlan(f: Flow, via: ApprovalVia, verification: readonly string[], now: number): FlowResult {
  const b = blocked(f);
  if (b) return fail(f, b);
  if (currentStep(f)?.kind !== 'approve') return fail(f, 'not-waiting');
  const next = advance(f, now, { kind: 'approve', via });
  return {
    ok: true,
    flow: log({ ...next, approval: { at: now, via }, verification: [...verification] }, { at: now, event: 'approve', step: 'approve', detail: via }),
  };
}

/** The person wants the plan changed: back to the plan step, with their words in the record. */
export function revisePlan(f: Flow, note: string, now: number): FlowResult {
  const b = blocked(f);
  if (b) return fail(f, b);
  if (currentStep(f)?.kind !== 'approve') return fail(f, 'not-waiting');
  const plan = f.current - 1;
  const steps = f.steps.map((s, i) =>
    i === plan
      ? { ...s, status: 'active' as const, doneAt: null, evidence: null, startedAt: now }
      : i === f.current
        ? { ...s, status: 'pending' as const, startedAt: null }
        : s,
  );
  return { ok: true, flow: log({ ...f, steps, current: plan, status: 'active' }, { at: now, event: 'revise', step: 'plan', detail: truncate(note, 500) }) };
}

export function pauseFlow(f: Flow, reason: string, now: number): FlowResult {
  if (!isOpen(f)) return fail(f, 'terminal');
  if (f.status === 'paused') return { ok: true, flow: f };
  return { ok: true, flow: log({ ...f, status: 'paused' }, { at: now, event: 'pause', step: currentStep(f)?.kind, detail: reason }) };
}

/** Resumes a paused flow (or takes over a running one whose session ended) in this session, at its step. */
export function resumeFlow(f: Flow, sessionId: string, now: number): FlowResult {
  if (!isOpen(f)) return fail(f, 'terminal');
  const status: FlowStatus = currentStep(f)?.kind === 'approve' ? 'waiting' : 'active';
  return { ok: true, flow: log({ ...f, status, sessionId }, { at: now, event: 'resume', step: currentStep(f)?.kind }) };
}

export function cancelFlow(f: Flow, now: number): FlowResult {
  if (!isOpen(f)) return fail(f, 'terminal');
  return { ok: true, flow: log({ ...f, status: 'canceled' }, { at: now, event: 'cancel', step: currentStep(f)?.kind }) };
}

/** Records a refused step without changing it, so the person can see what was tried. */
export function noteRefusal(f: Flow, kind: FlowStepKind, detail: string, now: number): Flow {
  return log(f, { at: now, event: 'refused', step: kind, detail: truncate(detail, 500) });
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const KINDS = new Set<FlowStepKind>(['research', 'plan', 'approve', 'code']);
const STATUSES = new Set<FlowStatus>(['active', 'waiting', 'paused', 'done', 'canceled']);

/** Reads a flow record; null when it is missing, torn or of another shape. Never throws. */
export function parseFlow(text: string | null): Flow | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(o) || o.v !== 1 || typeof o.id !== 'string' || !Array.isArray(o.steps) || !STATUSES.has(o.status as FlowStatus)) return null;
  const steps = o.steps.filter((s): s is FlowStep => isObj(s) && KINDS.has(s.kind as FlowStepKind));
  if (!steps.length || steps.length !== o.steps.length) return null;
  const current = typeof o.current === 'number' && o.current >= 0 && o.current <= steps.length ? o.current : 0;
  const variant = o.variant === 'plan' || o.variant === 'research' || o.variant === 'researchPlan' ? o.variant : 'full';
  const str = (x: unknown, d = '') => (typeof x === 'string' ? x : d);
  const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    v: 1,
    id: o.id,
    variant,
    task: str(o.task),
    project: typeof o.project === 'string' ? o.project : null,
    cwd: str(o.cwd),
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
    status: o.status as FlowStatus,
    current,
    steps,
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : null,
    workDir: str(o.workDir),
    reportPath: str(o.reportPath),
    planPath: str(o.planPath),
    approval:
      isObj(o.approval) && typeof o.approval.at === 'number' && ['dialog', 'plan-mode', 'keyword'].includes(String(o.approval.via))
        ? { at: o.approval.at, via: o.approval.via as ApprovalVia }
        : null,
    verification: Array.isArray(o.verification) ? o.verification.filter((x): x is string => typeof x === 'string') : [],
    history: Array.isArray(o.history) ? o.history.filter((e): e is FlowEvent => isObj(e) && typeof e.at === 'number' && typeof e.event === 'string') : [],
  };
}

/** "2/4" style progress: the current step's place, counting from 1 (all steps once done). */
export function progress(f: Flow): { at: number; of: number } {
  return { at: Math.min(f.current + 1, f.steps.length), of: f.steps.length };
}

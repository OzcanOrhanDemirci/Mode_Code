// SPDX-License-Identifier: Apache-2.0
/**
 * Parallel agents (docs/agents.md, the person's design of 2026-10-18): how many agents Claude may run, set by the
 * person on the strip, off at every session's start once the setting is on. Off: no agent but the read-only helpers
 * (Explore, Plan), when the setting leaves them free. Free: at most N at once, used as Claude sees fit. Assigned:
 * exactly N for the person's next request, each with the task, kind and model the person gave or left to Claude;
 * the batch closes itself once its agents are done. Ultracode's workflows are Claude Code's own: never touched.
 *
 * What code decides is decided here, at each agent's start (`agent.spawn`): refused, let through, or fitted to its
 * row (the task word for word, the kind, the model). What code cannot decide (how many Claude starts, what it
 * writes for a row left to it) is said to Claude, once, and reminded once. Pure.
 */
import { APP_NAME } from './app.js';

const P = `[${APP_NAME}]`;

export type AgentMode = 'off' | 'free' | 'assigned';
export type AgentKind = 'code' | 'research' | 'plan';

export const AGENT_MODES: readonly AgentMode[] = ['off', 'free', 'assigned'];
export const AGENT_KINDS: readonly AgentKind[] = ['code', 'research', 'plan'];
/** The models a row may name; null is the session's own. */
export const AGENT_MODELS: readonly string[] = ['opus', 'sonnet', 'haiku'];

/** The agent type each kind starts as: a research agent reads (Explore), a planner plans (Plan), the rest works. */
export const KIND_TYPE: Readonly<Record<AgentKind, string>> = { code: 'general-purpose', research: 'Explore', plan: 'Plan' };

/** Claude Code's read-only helpers: they search and plan, and cannot change a file. */
export const HELPERS: ReadonlySet<string> = new Set(['Explore', 'Plan']);

export const MIN_AGENTS = 1;
export const MAX_AGENTS = 999;
/** Above this many the person is told that Claude Code and the quota set the real limit. */
export const MANY_AGENTS = 20;

export interface AgentRow {
  /** The task as the person wrote it; empty: Claude writes it. */
  task: string;
  kind: AgentKind;
  /** opus, sonnet, haiku; null: the session's model. */
  model: string | null;
}

/** One agent started for an assigned batch: its row and the Agent call it came from. */
export interface Started {
  row: number;
  toolUseId: string;
}

export interface AgentsState {
  mode: AgentMode;
  /** Free: at most this many at once. Assigned: exactly this many. */
  n: number;
  /** Assigned: one row per agent. */
  rows: AgentRow[];
  /**
   * An assigned batch once a prompt of the person's took it: when, the agents started for it, and whether a later
   * prompt sealed it (no new agent joins it; it closes when its agents are done).
   */
  batch: { at: number; started: Started[]; sealed: boolean } | null;
  /** What Claude was not told yet, and is with the person's next prompt: they set the mode, or a batch closed itself. */
  untold: false | 'set' | 'done';
  /** Ultracode is on: Claude Code's workflows run the agents, and this mode stands aside until it ends. */
  ultracode: boolean;
}

export const DEFAULT_AGENTS: AgentsState = { mode: 'off', n: 5, rows: [], batch: null, untold: false, ultracode: false };

export interface AgentsSettings {
  /** The mode exists at all: off, this tool never touches an agent. */
  enabled: boolean;
  /** Explore and Plan stay free while the mode is off, and are not counted at most N. */
  helpers: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A count the person gave, kept in range; null when it is no whole number of 1 to 999. */
export function agentCount(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*\d+\s*$/.test(x) ? Number(x) : NaN;
  return Number.isInteger(n) && n >= MIN_AGENTS && n <= MAX_AGENTS ? n : null;
}

/** A row as stored; a broken one falls back to an empty code row. */
export function parseRow(x: unknown): AgentRow {
  if (!isObj(x)) return { task: '', kind: 'code', model: null };
  const kind = AGENT_KINDS.includes(x.kind as AgentKind) ? (x.kind as AgentKind) : 'code';
  const model = typeof x.model === 'string' && AGENT_MODELS.includes(x.model) ? x.model : null;
  return { task: typeof x.task === 'string' ? x.task.slice(0, 4000) : '', kind, model };
}

/** The state as a mod state file holds it; anything broken falls back to the session's default. */
export function parseAgents(x: unknown): AgentsState {
  if (!isObj(x)) return { ...DEFAULT_AGENTS };
  const mode = AGENT_MODES.includes(x.mode as AgentMode) ? (x.mode as AgentMode) : 'off';
  const n = agentCount(x.n) ?? DEFAULT_AGENTS.n;
  const rows = Array.isArray(x.rows) ? x.rows.slice(0, MAX_AGENTS).map(parseRow) : [];
  const b = x.batch;
  const batch =
    isObj(b) && typeof b.at === 'number' && Array.isArray(b.started)
      ? {
          at: b.at,
          started: b.started
            .filter((s): s is Record<string, unknown> => isObj(s) && typeof s.row === 'number' && typeof s.toolUseId === 'string')
            .map((s) => ({ row: s.row as number, toolUseId: s.toolUseId as string })),
          sealed: b.sealed === true,
        }
      : null;
  return { mode, n, rows, batch, untold: x.untold === 'set' || x.untold === 'done' ? x.untold : false, ultracode: x.ultracode === true };
}

/** The rows of an assigned mode of `n` agents: the ones given kept, the rest empty, of a kind the mode allows. */
export function rowsFor(n: number, rows: readonly AgentRow[], writable: boolean): AgentRow[] {
  const kind: AgentKind = writable ? 'code' : 'research';
  return Array.from({ length: n }, (_, i) => {
    const r = rows[i] ?? { task: '', kind, model: null };
    return !writable && r.kind === 'code' ? { ...r, kind: 'research' } : r;
  });
}

/** The person sets a mode: Claude is told with their next prompt; an assigned mode waits for that prompt. */
export function setMode(s: AgentsState, mode: AgentMode, n: number, rows: readonly AgentRow[] = []): AgentsState {
  return { ...s, mode, n, rows: mode === 'assigned' ? [...rows] : [], batch: null, untold: 'set' };
}

/** An agent about to start, as `agent.spawn` hands it over. */
export interface Spawn {
  type: string;
  prompt: string;
  description: string;
  toolUseId: string;
  /** Started by a workflow script (ultracode): Claude Code's own, never touched. */
  workflow: boolean;
  /** Agents running now that count toward N: not the free helpers. */
  running: number;
}

export type SpawnDecision =
  | { kind: 'pass' }
  | { kind: 'deny'; why: 'off' | 'full' | 'done' }
  | { kind: 'assign'; row: number; type: string; prompt: string; model: string | null; description: string };

/** What happens to an agent about to start: let through, refused (and why), or fitted to an assigned row. */
export function decideSpawn(sp: Spawn, s: AgentsState, cfg: AgentsSettings): SpawnDecision {
  if (!cfg.enabled || sp.workflow || s.ultracode) return { kind: 'pass' };
  const helper = cfg.helpers && HELPERS.has(sp.type);
  if (s.mode === 'off') return helper ? { kind: 'pass' } : { kind: 'deny', why: 'off' };
  if (s.mode === 'free') {
    if (helper) return { kind: 'pass' };
    return sp.running >= s.n ? { kind: 'deny', why: 'full' } : { kind: 'pass' };
  }
  // Assigned: only a prompt of the person's opens the batch; a sealed one takes no more.
  if (!s.batch || s.batch.sealed) return helper ? { kind: 'pass' } : { kind: 'deny', why: 'done' };
  const taken = new Set(s.batch.started.map((x) => x.row));
  const free = s.rows.map((_, i) => i).filter((i) => !taken.has(i));
  if (!free.length) return helper ? { kind: 'pass' } : { kind: 'deny', why: 'done' };
  // The row of the agent's own kind first; a helper with none of its kind left is Claude's own search.
  const same = free.find((i) => KIND_TYPE[s.rows[i]!.kind] === sp.type);
  if (same === undefined && helper) return { kind: 'pass' };
  const row = same ?? free[0]!;
  const r = s.rows[row]!;
  const prompt = r.task.trim() ? `${r.task.trim()}\n\n${P} Context the main session added: ${sp.prompt}` : sp.prompt;
  return { kind: 'assign', row, type: KIND_TYPE[r.kind], prompt, model: r.model, description: `[${row + 1}/${s.n}] ${sp.description}` };
}

/** The batch after an agent was fitted to a row. */
export function withStarted(s: AgentsState, row: number, toolUseId: string): AgentsState {
  if (!s.batch) return s;
  return { ...s, batch: { ...s.batch, started: [...s.batch.started, { row, toolUseId }] } };
}

/** A prompt of the person's arrives: an assigned mode takes it as its batch; a batch taken before is sealed. */
export function onPersonPrompt(s: AgentsState, now: number): AgentsState {
  if (s.mode !== 'assigned') return s;
  if (s.batch) return s.batch.sealed ? s : { ...s, batch: { ...s.batch, sealed: true } };
  return { ...s, batch: { at: now, started: [], sealed: false } };
}

/** An agent's status as `$.agent.list()` gives it, with its description (the batch's agents carry "[k/n]"). */
export interface AgentSeen {
  description: string;
  status: string;
}

const DONE = new Set(['completed', 'failed', 'killed']);

/** The batch's agents still at work. */
export function batchRunning(s: AgentsState, seen: readonly AgentSeen[]): number {
  return seen.filter((a) => /^\[\d+\/\d+\] /.test(a.description) && !DONE.has(a.status)).length;
}

/**
 * Whether an assigned batch is over: every row started, or the batch sealed by a later prompt; and none of its agents
 * still at work. Then the mode closes itself (the person, 2026-10-18: "they were told to start; once done, it ends").
 */
export function batchOver(s: AgentsState, seen: readonly AgentSeen[]): boolean {
  if (s.mode !== 'assigned' || !s.batch) return false;
  const all = s.batch.started.length >= s.n || s.batch.sealed;
  return all && batchRunning(s, seen) === 0;
}

/** The agents that count toward N: at work and not a free helper. */
export function countRunning(seen: readonly { type: string; status: string }[], cfg: AgentsSettings): number {
  return seen.filter((a) => (a.status === 'pending' || a.status === 'running' || a.status === 'waiting') && !(cfg.helpers && HELPERS.has(a.type))).length;
}

/** An assigned batch is over: the mode closes itself, and Claude is told with the next prompt. */
export function closeBatch(s: AgentsState): AgentsState {
  return { ...s, mode: 'off', rows: [], batch: null, untold: 'done' };
}

/** Claude's note with the person's next prompt: the mode they set, or that an assigned batch closed itself. */
export function modeNote(s: AgentsState, cfg: AgentsSettings, why: 'set' | 'done' = 'set'): string {
  const helpers = cfg.helpers ? ' The read-only helpers (Explore, Plan) stay yours and do not count.' : '';
  if (s.mode === 'off')
    return why === 'done'
      ? `${P} The assigned agents are done, and parallel agents are off again for this session: start no agent.${helpers}`
      : `${P} The person turned parallel agents off for this session: start no agent.${helpers} Do the work yourself.`;
  if (s.mode === 'free') return `${P} The person turned parallel agents on: use as many as help, at most ${s.n} at once, or none; you are free to.${helpers}`;
  const lines = s.rows.map((r, i) => {
    const model = r.model ? `, model ${r.model}` : '';
    const task = r.task.trim() ? `the person's task, which it gets word for word: ${r.task.trim()}` : 'no task given: write it from the request';
    return `${i + 1}. ${r.kind} (${KIND_TYPE[r.kind]}${model}): ${task}`;
  });
  return [
    `${P} For this request the person wants exactly ${s.n} agent(s), no fewer and no more: start them in this order, in one message where you can.`,
    ...lines,
    'Give an agent whatever an agent can do. Do not work around this.',
  ].join('\n');
}

/** Said once when Claude ends its turn with fewer agents started than the person asked for. */
export function reminderNote(s: AgentsState): string {
  const started = s.batch?.started.length ?? 0;
  const left = s.rows.map((_, i) => i).filter((i) => !s.batch?.started.some((x) => x.row === i));
  return `${P} The person asked for exactly ${s.n} agent(s) for this request; ${started} started. Start the rest now (${left
    .map((i) => `${i + 1}. ${s.rows[i]!.kind}`)
    .join(', ')}), as they asked. Do not work around it. This is said once.`;
}

/** Whether the reminder is due at a stop: an open batch with rows not started, and not reminded yet. */
export function reminderDue(s: AgentsState | null | undefined, remindedAt: number | null): boolean {
  if (!s || s.mode !== 'assigned' || s.ultracode || !s.batch || s.batch.sealed) return false;
  return s.batch.started.length < s.n && remindedAt !== s.batch.at;
}

/** The control's icon on the strip: two cells wide like the modes' icons. */
export const AGENTS_ICON = '👥';

/**
 * The strip's words: "👥 agents", "👥 agents ≤5 · 2", "👥 agents =7 · 3/7", "👥 agents · ultracode"; tight, the icon
 * in the word's place: "👥", "👥≤5·2". Off is the control not lit, as a switch's is. It had a ✕, read as a second
 * close control, and a terminal draws ✕ wider than the one cell it is given: the lit ground cut it in half.
 */
export function stripAgents(s: AgentsState, running: number, word: string, tight: boolean, mark = ''): string {
  const sep = tight ? '' : ' ';
  // `mark`: the opener's `…` on the strip, where a press opens the window (docs/design.md, the look tells the kind).
  const name = tight ? `${AGENTS_ICON}${mark}` : `${AGENTS_ICON} ${word}${mark}`;
  if (s.ultracode) return tight ? `${name}∞` : `${name} · ultracode`;
  if (s.mode === 'off') return name;
  if (s.mode === 'free') return `${name}${sep}≤${s.n}${running ? `${tight ? '·' : ' · '}${running}` : ''}`;
  const started = s.batch?.started.length ?? 0;
  return `${name}${sep}=${s.n}${s.batch ? `${tight ? '·' : ' · '}${started}/${s.n}` : ''}`;
}

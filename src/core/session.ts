// SPDX-License-Identifier: Apache-2.0
/**
 * Per-session runtime state. The mod owns it (`<id>.mod.json`); the safety-net hook reads it and keeps
 * its own small file. Pure: shapes, defaults, parsing and the transitions keywords cause.
 */
import { isModeKeyword, isStyleKeyword, MODE_KEYWORDS, STYLE_KEYWORDS, type KeywordMatch } from './keywords.js';
import { isWorkMode, type WorkMode } from './modes.js';
import { parseHost, type Host } from './host.js';
import { DEFAULT_AGENTS, parseAgents, type AgentsState } from './agents.js';

export type { WorkMode } from './modes.js';

/**
 * How much the model may do before asking: default (Claude Code's own), manual (ask each step), autonomous,
 * full (a full-autonomy run: nothing is asked, what needs the person is deferred; docs/autonomy.md).
 */
export type Interaction = 'default' | 'manual' | 'autonomous' | 'full';

const INTERACTIONS = new Set<Interaction>(['default', 'manual', 'autonomous', 'full']);

export interface Approval {
  /** The tool_use_id the person approved; never reusable for another call. */
  toolUseId: string;
  at: number;
  rules: string[];
}

/**
 * What a session's end note is written from, kept as the session goes: should its window be shut, the
 * session ends without writing it, and the next session writes it from this (docs/memory.md).
 */
export interface SessionWork {
  /** When the session started: its commits are those since. */
  startedAt: number;
  /** When a turn last changed something, and when the session last wrote a note (0: never). */
  changedAt: number;
  handoffAt: number;
  /** The project key its notes go under, once known. */
  project: string | null;
  /** The person's last request, secrets masked. */
  request: string | null;
}

export interface ModSessionState {
  v: 1;
  sessionId: string;
  /** When the mod last confirmed it is running in this session (epoch ms). */
  aliveAt: number;
  /** When the session ended (Claude Code's session end; a /clear too), or null while it is open. */
  endedAt: number | null;
  /** The folder the session works in (resolved), to tell when two sessions work in the same place. */
  cwd?: string;
  modVersion: string;
  /** The session's own mode (see modes.ts); a flow's step and Claude Code's plan mode may stand above it. */
  mode: WorkMode;
  /** A mode the person gave for the current turn only; cleared at their next prompt. */
  turnMode: WorkMode | null;
  /** The flow this session works on, if any (its record is in the data folder's flows). */
  flowId: string | null;
  /** The full-autonomy run this session works on, if any (its record is in the data folder's runs). */
  runId: string | null;
  /** Claude Code's own plan mode as last seen in this session, and the plan file it named. */
  nativePlan: { on: boolean; planFile: string | null; at: number } | null;
  interaction: Interaction;
  /** The way of working a full-autonomy run took over, given back when the run ends (see withRun). */
  interactionBefore: Exclude<Interaction, 'full'> | null;
  /** Project the last keyword named, if any. */
  project: string | null;
  /** Weekly quota target from "kota N" / "kota +N"; null means the default budget. */
  weeklyTarget: number | null;
  weeklyTargetSource: string | null;
  /** Set by "wrap up" or the quota guard; cleared by the next "continue". */
  wrapUp: boolean;
  /** When autonomous work should resume by itself (a quota window resets), or null. */
  resumeAt: number | null;
  /** Calls the person approved after the belt asked. Kept short: the hook only needs the recent ones. */
  approvals: Approval[];
  /** How many times each rule blocked in this session, to stop an agent that keeps trying. */
  blocks: Record<string, number>;
  /** Kept once a turn changed something; null before. */
  work: SessionWork | null;
  /**
   * Bypass, while the person has it on in this session (docs/autonomy.md): since when, until when, and how
   * many calls it let through that the belt would have asked about or blocked. Never carried to another
   * session, and turned on and off only by the person.
   */
  bypass: BypassState | null;
  /**
   * The first outside content the session read (a web page, an issue, a connected service's data, another session's
   * message), and when: from then on what it could be steered to do is asked (src/core/taint.ts). Null until then.
   */
  tainted: { source: string; at: number } | null;
  /** The folder the person froze the edits to (`/dondur`, resolved), or null. */
  frozen: string | null;
  /** Parallel agents in this session (core/agents.ts): off at every session's start. */
  agents: AgentsState;
}

export interface BypassState {
  since: number;
  until: number;
  count: number;
}

/** Bypass is on at `now`: turned on in this session and not past its time. */
export function bypassOn(s: Pick<ModSessionState, 'bypass'> | null | undefined, now: number): boolean {
  return !!s?.bypass && now < s.bypass.until;
}

export interface HookSessionState {
  v: 1;
  sessionId: string;
  /** The hook ran in this session at least once (epoch ms of the last run). */
  lastRunAt: number;
  blocks: Record<string, number>;
  /** Claude Code's permission mode as the hook last received it (`plan`, `default`, …), and when. */
  permissionMode: string | null;
  permissionModeAt: number;
  /**
   * When the hook last received one of the person's prompts (epoch ms; 0 never). Claude Code runs the plugin's
   * prompt hook before this one, so what the hook records for a prompt is there only from its first tool call on.
   */
  promptAt: number;
  /** A full-autonomy run's attempts to stop: what had changed at the last one, and how many in a row did not change it. */
  autoStop: { runId: string | null; fingerprint: string | null; streak: number } | null;
  /** The last stop of a run the hook let through, and why (the plugin pauses the run accordingly). */
  autoAllowed: { runId: string; why: string; at: number } | null;
  /** The process the session runs in (the hook's parent: Claude Code), to tell later whether it still runs. */
  host: Host | null;
  /** The assigned agent batch (its start time) the hook already reminded at a stop: once per batch (core/agents.ts). */
  agentsRemindedAt: number | null;
}

export function newModState(sessionId: string, modVersion: string, now: number): ModSessionState {
  return {
    v: 1,
    sessionId,
    aliveAt: now,
    endedAt: null,
    modVersion,
    mode: 'free',
    turnMode: null,
    flowId: null,
    runId: null,
    nativePlan: null,
    interaction: 'default',
    interactionBefore: null,
    project: null,
    weeklyTarget: null,
    weeklyTargetSource: null,
    wrapUp: false,
    resumeAt: null,
    approvals: [],
    blocks: {},
    work: null,
    bypass: null,
    tainted: null,
    frozen: null,
    agents: { ...DEFAULT_AGENTS },
  };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseBypass(x: unknown): BypassState | null {
  if (!isObj(x) || typeof x.since !== 'number' || typeof x.until !== 'number' || !(x.until > x.since)) return null;
  return { since: x.since, until: x.until, count: typeof x.count === 'number' && x.count >= 0 ? Math.floor(x.count) : 0 };
}

/** Parses a mod state file; null when it is missing, torn or of another shape. */
export function parseModState(text: string | null): ModSessionState | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as unknown;
    if (!isObj(o) || o.v !== 1 || typeof o.sessionId !== 'string' || typeof o.aliveAt !== 'number') return null;
    const s = o as unknown as ModSessionState;
    const plan = s.nativePlan as unknown;
    return {
      ...newModState(s.sessionId, String(s.modVersion ?? ''), s.aliveAt),
      ...s,
      mode: isWorkMode(s.mode) ? s.mode : 'free',
      turnMode: isWorkMode(s.turnMode) ? s.turnMode : null,
      flowId: typeof s.flowId === 'string' ? s.flowId : null,
      runId: typeof s.runId === 'string' ? s.runId : null,
      interaction: INTERACTIONS.has(s.interaction) ? s.interaction : 'default',
      interactionBefore: INTERACTIONS.has(s.interactionBefore as Interaction) && (s.interactionBefore as Interaction) !== 'full' ? s.interactionBefore : null,
      nativePlan:
        isObj(plan) && typeof plan.on === 'boolean' && typeof plan.at === 'number'
          ? { on: plan.on, planFile: typeof plan.planFile === 'string' ? plan.planFile : null, at: plan.at }
          : null,
      approvals: Array.isArray(s.approvals) ? s.approvals.filter((a) => isObj(a) && typeof a.toolUseId === 'string') : [],
      blocks: isObj(s.blocks) ? (s.blocks as Record<string, number>) : {},
      endedAt: typeof s.endedAt === 'number' ? s.endedAt : null,
      work: parseWork(s.work),
      bypass: parseBypass(s.bypass),
      frozen: typeof s.frozen === 'string' && s.frozen ? s.frozen : null,
      agents: parseAgents(s.agents),
      tainted:
        isObj(s.tainted) && typeof s.tainted.source === 'string' && typeof s.tainted.at === 'number'
          ? { source: s.tainted.source.slice(0, 120), at: s.tainted.at }
          : null,
    };
  } catch {
    return null;
  }
}

function parseWork(x: unknown): SessionWork | null {
  if (!isObj(x) || typeof x.startedAt !== 'number' || typeof x.changedAt !== 'number' || typeof x.handoffAt !== 'number') return null;
  return {
    startedAt: x.startedAt,
    changedAt: x.changedAt,
    handoffAt: x.handoffAt,
    project: typeof x.project === 'string' && x.project ? x.project : null,
    request: typeof x.request === 'string' ? x.request : null,
  };
}

export function parseHookState(text: string | null, sessionId: string): HookSessionState {
  const fresh: HookSessionState = {
    v: 1,
    sessionId,
    lastRunAt: 0,
    blocks: {},
    permissionMode: null,
    permissionModeAt: 0,
    promptAt: 0,
    autoStop: null,
    autoAllowed: null,
    host: null,
    agentsRemindedAt: null,
  };
  if (!text) return fresh;
  try {
    const o = JSON.parse(text) as unknown;
    if (!isObj(o) || o.v !== 1 || o.sessionId !== sessionId) return fresh;
    return {
      ...fresh,
      lastRunAt: typeof o.lastRunAt === 'number' ? o.lastRunAt : 0,
      blocks: isObj(o.blocks) ? (o.blocks as Record<string, number>) : {},
      permissionMode: typeof o.permissionMode === 'string' ? o.permissionMode : null,
      permissionModeAt: typeof o.permissionModeAt === 'number' ? o.permissionModeAt : 0,
      promptAt: typeof o.promptAt === 'number' ? o.promptAt : 0,
      autoStop:
        isObj(o.autoStop) && typeof o.autoStop.streak === 'number'
          ? {
              runId: typeof o.autoStop.runId === 'string' ? o.autoStop.runId : null,
              fingerprint: typeof o.autoStop.fingerprint === 'string' ? o.autoStop.fingerprint : null,
              streak: o.autoStop.streak,
            }
          : null,
      autoAllowed:
        isObj(o.autoAllowed) && typeof o.autoAllowed.runId === 'string' && typeof o.autoAllowed.why === 'string' && typeof o.autoAllowed.at === 'number'
          ? { runId: o.autoAllowed.runId, why: o.autoAllowed.why, at: o.autoAllowed.at }
          : null,
      host: parseHost(o.host),
      agentsRemindedAt: typeof o.agentsRemindedAt === 'number' ? o.agentsRemindedAt : null,
    };
  } catch {
    return fresh;
  }
}

/** Approvals older than this are dropped: an approval is for the call in front of the person, now. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function addApproval(s: ModSessionState, a: Approval): ModSessionState {
  const fresh = s.approvals.filter((x) => a.at - x.at < APPROVAL_TTL_MS && x.toolUseId !== a.toolUseId);
  return { ...s, approvals: [...fresh, a].slice(-50) };
}

/** A session counts as working when it was alive this recently. */
export const LIVE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Working now, as its own record tells: alive within the window and not ended. One whose window was shut still
 * reads as working here; its process tells the rest (host.ts).
 */
export function workingNow(s: Pick<ModSessionState, 'aliveAt' | 'endedAt'>, now: number): boolean {
  return s.endedAt === null && now - s.aliveAt < LIVE_WINDOW_MS;
}

/**
 * A session whose note is still to be written by another: it changed something after its last note, its note
 * would still be offered, and it is not this one. Whether it closed (ended a minute ago or more, so its own end
 * is not raced; or its process gone) the caller finds out.
 */
export function noteOwed(s: ModSessionState, self: string, now: number, maxAgeDays: number): boolean {
  return s.sessionId !== self && !!s.work && s.work.changedAt > s.work.handoffAt && now - s.aliveAt <= maxAgeDays * 86_400_000;
}

/** An ended session's own end had its minute: what it did not write by then, it will not. */
export const END_GRACE_MS = 60_000;

/**
 * Other sessions working in the same folder right now: two agents editing one tree is how work gets lost.
 * Folders compare case-insensitively where the file system does (Windows, macOS).
 */
export function sameFolderSessions(
  self: { sessionId: string; cwd?: string },
  others: readonly ModSessionState[],
  now: number,
  caseInsensitive: boolean,
): ModSessionState[] {
  if (!self.cwd) return [];
  const key = (p: string) => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return caseInsensitive ? s.toLowerCase() : s;
  };
  const mine = key(self.cwd);
  return others.filter((o) => o.sessionId !== self.sessionId && o.cwd && key(o.cwd) === mine && workingNow(o, now));
}

export function isApproved(s: ModSessionState | null, toolUseId: string | undefined, now: number): boolean {
  if (!s || !toolUseId) return false;
  return s.approvals.some((a) => a.toolUseId === toolUseId && now - a.at < APPROVAL_TTL_MS);
}

/**
 * The state change a detected keyword causes. Pure; the caller persists it. A mode keyword is the whole
 * message, so it changes the mode for good (while a flow runs, the caller pauses the flow).
 *
 * The mode and the way of working change only where the person names them: a mode or a way of working
 * typed alone, and "manual" in "manual <project> continue". "continue", a budget and "stop" leave both as
 * the strip shows them ("they must not change when I did not write it, or choosing them means nothing",
 * the person, 2026-10-13).
 */
export function applyKeyword(s: ModSessionState, kw: KeywordMatch, weeklyTarget: number | null): ModSessionState {
  if (isModeKeyword(kw.kind)) return { ...s, mode: MODE_KEYWORDS[kw.kind], turnMode: null };
  // The way of working alone: nothing else changes (no project, no resume, the mode stays).
  if (isStyleKeyword(kw.kind)) return { ...s, interaction: STYLE_KEYWORDS[kw.kind], resumeAt: null };
  switch (kw.kind) {
    case 'continue':
    case 'manual': {
      const next: ModSessionState = {
        ...s,
        interaction: kw.kind === 'manual' ? 'manual' : s.interaction,
        turnMode: null,
        wrapUp: false,
        project: kw.project ?? s.project,
      };
      return kw.budget && weeklyTarget !== null ? { ...next, weeklyTarget, weeklyTargetSource: `${kw.budget.plus ? '+' : ''}${kw.budget.n}` } : next;
    }
    case 'fullAuto': {
      // Full autonomy needs an explicit budget; the plugin starts the run only after its checks pass, and
      // only then sets the interaction (see run-gate.ts). Here: the project and the budget the person named.
      // Letting a run go brings back the way of working it took over.
      if (kw.auto === 'cancel') return s.interaction === 'full' ? { ...s, interaction: s.interactionBefore ?? 'default', interactionBefore: null } : s;
      const next: ModSessionState = { ...s, project: kw.project ?? s.project, wrapUp: false, resumeAt: null };
      return kw.budget && weeklyTarget !== null ? { ...next, weeklyTarget, weeklyTargetSource: `${kw.budget.plus ? '+' : ''}${kw.budget.n}` } : next;
    }
    case 'quota':
      return weeklyTarget === null ? s : { ...s, weeklyTarget, weeklyTargetSource: `${kw.plus ? '+' : ''}${kw.n}` };
    case 'wrapUp':
      return { ...s, wrapUp: true, resumeAt: null };
    case 'handoff':
      return { ...s, project: kw.project ?? s.project };
    case 'stop':
      return { ...s, wrapUp: true, resumeAt: null };
    default:
      return s;
  }
}

/**
 * A full-autonomy run takes the session's way of working over while it is open, and gives back the one it
 * took when it ends: the strip shows what the person chose before the run, not a default.
 */
export function withRun(s: ModSessionState, runId: string | null): ModSessionState {
  if (runId) return { ...s, runId, interaction: 'full', interactionBefore: s.interaction === 'full' ? s.interactionBefore : s.interaction };
  return s.interaction === 'full'
    ? { ...s, runId: null, interaction: s.interactionBefore ?? 'default', interactionBefore: null }
    : { ...s, runId: null, interactionBefore: null };
}

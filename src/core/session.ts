// SPDX-License-Identifier: Apache-2.0
/**
 * Per-session runtime state. The mod owns it (`<id>.mod.json`); the safety-net hook reads it and keeps
 * its own small file. Pure: shapes, defaults, parsing and the transitions keywords cause.
 */
import type { KeywordMatch } from './keywords.js';

/** What the session is doing. "free" is the default (no constraint); "chat" forbids project and memory writes. */
export type WorkMode = 'free' | 'chat';

/** How much the model may do before asking: default (Claude Code's own), manual (ask each step), autonomous. */
export type Interaction = 'default' | 'manual' | 'autonomous';

export interface Approval {
  /** The tool_use_id the person approved; never reusable for another call. */
  toolUseId: string;
  at: number;
  rules: string[];
}

export interface ModSessionState {
  v: 1;
  sessionId: string;
  /** When the mod last confirmed it is running in this session (epoch ms). */
  aliveAt: number;
  modVersion: string;
  mode: WorkMode;
  interaction: Interaction;
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
}

export interface HookSessionState {
  v: 1;
  sessionId: string;
  /** The hook ran in this session at least once (epoch ms of the last run). */
  lastRunAt: number;
  blocks: Record<string, number>;
}

export function newModState(sessionId: string, modVersion: string, now: number): ModSessionState {
  return {
    v: 1,
    sessionId,
    aliveAt: now,
    modVersion,
    mode: 'free',
    interaction: 'default',
    project: null,
    weeklyTarget: null,
    weeklyTargetSource: null,
    wrapUp: false,
    resumeAt: null,
    approvals: [],
    blocks: {},
  };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Parses a mod state file; null when it is missing, torn or of another shape. */
export function parseModState(text: string | null): ModSessionState | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as unknown;
    if (!isObj(o) || o.v !== 1 || typeof o.sessionId !== 'string' || typeof o.aliveAt !== 'number') return null;
    const s = o as unknown as ModSessionState;
    return {
      ...newModState(s.sessionId, String(s.modVersion ?? ''), s.aliveAt),
      ...s,
      approvals: Array.isArray(s.approvals) ? s.approvals.filter((a) => isObj(a) && typeof a.toolUseId === 'string') : [],
      blocks: isObj(s.blocks) ? (s.blocks as Record<string, number>) : {},
    };
  } catch {
    return null;
  }
}

export function parseHookState(text: string | null, sessionId: string): HookSessionState {
  const fresh: HookSessionState = { v: 1, sessionId, lastRunAt: 0, blocks: {} };
  if (!text) return fresh;
  try {
    const o = JSON.parse(text) as unknown;
    if (!isObj(o) || o.v !== 1 || o.sessionId !== sessionId) return fresh;
    return { ...fresh, lastRunAt: typeof o.lastRunAt === 'number' ? o.lastRunAt : 0, blocks: isObj(o.blocks) ? (o.blocks as Record<string, number>) : {} };
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

export function isApproved(s: ModSessionState | null, toolUseId: string | undefined, now: number): boolean {
  if (!s || !toolUseId) return false;
  return s.approvals.some((a) => a.toolUseId === toolUseId && now - a.at < APPROVAL_TTL_MS);
}

/** The state change a detected keyword causes. Pure; the caller persists it. */
export function applyKeyword(s: ModSessionState, kw: KeywordMatch, weeklyTarget: number | null): ModSessionState {
  switch (kw.kind) {
    case 'continue':
    case 'manual': {
      const next: ModSessionState = {
        ...s,
        interaction: kw.kind === 'continue' ? 'autonomous' : 'manual',
        mode: 'free',
        wrapUp: false,
        project: kw.project ?? s.project,
      };
      return kw.budget && weeklyTarget !== null ? { ...next, weeklyTarget, weeklyTargetSource: `${kw.budget.plus ? '+' : ''}${kw.budget.n}` } : next;
    }
    case 'chat':
      return { ...s, mode: 'chat' };
    case 'quota':
      return weeklyTarget === null
        ? s
        : { ...s, weeklyTarget, weeklyTargetSource: `${kw.plus ? '+' : ''}${kw.n}`, interaction: kw.standalone ? s.interaction : 'autonomous' };
    case 'wrapUp':
      return { ...s, wrapUp: true, resumeAt: null };
    case 'stop':
      return { ...s, wrapUp: true, interaction: 'default', resumeAt: null };
    default:
      return s;
  }
}

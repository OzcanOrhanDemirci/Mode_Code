// SPDX-License-Identifier: Apache-2.0
/**
 * The control center's Now (docs/design.md, The control center): what the cockpit says inside a session, worked out
 * here for the sessions of this computer from what they keep on disk, so that outside Claude Code too the person sees
 * at a glance what Claude may do, what is at work, what waits for them and where the quota stands. The rows are the
 * cockpit's own (src/core/ux/cockpit.ts): the same facts give the same words. Mo says the one thing that matters most
 * now, and where it leads. Pure.
 */
import type { Config } from '../config.js';
import { styleOf } from '../controls.js';
import { currentStep, isRunning, progress as flowProgress, stepMode, type Flow } from '../flow.js';
import { stepName } from '../guidance.js';
import type { Lang } from '../i18n/index.js';
import type { MoState } from '../mo/art.js';
import { effectiveMode } from '../modes.js';
import type { QuotaAssessment } from '../quota.js';
import { workingNow, type ModSessionState } from '../session.js';
import type { ActivityEvent } from './activity.js';
import type { CockpitFacts, ModeFrom } from './cockpit.js';

/**
 * The cockpit's facts for one session, as its state file and its flow record hold them; null: a new session,
 * as it would start. What only a running session knows (the call at work, its agents, Mo's moment) is left empty: Now
 * says what is at work from the sessions themselves.
 */
export function centerFacts(i: {
  config: Readonly<Config>;
  state: ModSessionState | null;
  flow: Flow | null;
  quota: QuotaAssessment;
  events: readonly ActivityEvent[];
  now: number;
  lang: Lang;
}): CockpitFacts {
  const s = i.state;
  const flow = s && i.flow && i.flow.id === s.flowId ? i.flow : null;
  const step = flow && isRunning(flow) ? currentStep(flow) : null;
  const mode = s
    ? effectiveMode({
        session: s.mode,
        turn: s.turnMode,
        flowStep: step ? stepMode(step.kind) : null,
        nativePlan: s.nativePlan?.on === true,
      })
    : 'free';
  const modeFrom: ModeFrom = !s ? 'session' : s.turnMode ? 'turn' : step ? 'flow' : s.nativePlan?.on ? 'plan' : 'session';
  const fp = flow && (flow.status === 'active' || flow.status === 'waiting' || flow.status === 'paused') ? flowProgress(flow) : null;
  return {
    config: i.config as Config,
    session: s,
    mode,
    modeFrom,
    style: styleOf(s?.interaction ?? 'default'),
    now: i.now,
    beltOff: false,
    quota: i.quota,
    working: false,
    mo: 'idle',
    calls: [],
    agents: [],
    flow:
      flow && fp && i.config.modules.modes
        ? {
            at: `${fp.at}/${fp.of}`,
            step: step ? stepName(step.kind, i.lang) : '',
            state: flow.status === 'paused' ? 'paused' : step?.kind === 'approve' || flow.status === 'waiting' ? 'approval' : 'running',
          }
        : null,
    events: s ? i.events.filter((e) => e.session === s.sessionId) : [],
  };
}

/**
 * The sessions working now, the one in `cwd` first, then the most recently alive; ended ones and those whose Claude Code
 * is gone are not working, however recent their last word.
 */
export function liveSessions(states: readonly ModSessionState[], closed: ReadonlySet<string>, cwd: string, now: number): ModSessionState[] {
  const norm = (p: string | undefined) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const here = norm(cwd);
  return states
    .filter((s) => workingNow(s, now) && !closed.has(s.sessionId))
    .sort((a, b) => Number(norm(b.cwd) === here) - Number(norm(a.cwd) === here) || b.aliveAt - a.aliveAt);
}

/** What Mo says on Now: the one thing that matters most, in words, and the place it leads to (null: nowhere). */
export interface Guide {
  mo: MoState;
  key: 'broken' | 'flow' | 'away' | 'quota' | 'session' | 'calm';
  params: Record<string, string | number>;
  address: string | null;
}

/**
 * Mo's sentence, the most pressing first: protection that does not work, a step that waits for the person (a flow's
 * approval), what happened while they were away, the quota near its limit, a session at work, or calm.
 */
export function guide(f: {
  protectionBroken: boolean;
  flows: readonly Flow[];
  away: number;
  quota: QuotaAssessment;
  live: readonly ModSessionState[];
  folder: (s: ModSessionState) => string;
  flowTitle: (f: Flow) => string;
}): Guide {
  if (f.protectionBroken) return { mo: 'error', key: 'broken', params: {}, address: 'protection/status' };
  const waiting = f.flows.find((x) => x.status === 'waiting');
  if (waiting) return { mo: 'wait', key: 'flow', params: { flow: f.flowTitle(waiting) }, address: `work/flows/${waiting.id}` };
  if (f.away) return { mo: 'wait', key: 'away', params: { n: f.away }, address: 'activity/away' };
  if (f.quota.usable && f.quota.level !== 'ok') return { mo: 'low', key: 'quota', params: {}, address: 'quota/usage' };
  const s = f.live[0];
  if (s) return { mo: 'work', key: 'session', params: { folder: f.folder(s), n: f.live.length }, address: `memory/sessions/${s.sessionId}` };
  return { mo: 'idle', key: 'calm', params: {}, address: null };
}

/** The goals Now offers, each a place: what a person comes to the control center for (docs/design.md, Now). */
export const GOALS = [
  { id: 'task', address: 'work/modes' },
  { id: 'parallel', address: 'work/agents' },
  { id: 'quota', address: 'quota/limits' },
  { id: 'happened', address: 'activity/report' },
  { id: 'why', address: null },
] as const;

export type GoalId = (typeof GOALS)[number]['id'];

// SPDX-License-Identifier: Apache-2.0
/**
 * Which of its states Mo shows: from what the plugin knows of the session (src/mod/register.ts) at a moment.
 * What just happened (a call the belt refused, a turn that ended) shows for a few seconds and then gives way;
 * what lasts (a question to the person, a turn at work) shows while it lasts. Pure: the drawing calls it on
 * every tick with its own clock, so a state that runs out gives way with no event behind it.
 */
import type { MoState } from './art.js';

export type MoFacts = {
  /** A model turn of the main conversation runs. */
  working: boolean;
  /** The main conversation's tool calls running now; the Agent calls among them are counted in `agents`. */
  tools: number;
  agents: number;
  /** Questions to the person open now: the belt's, AskUserQuestion, the approval of a plan. */
  asking: number;
  /** A flow or a full-autonomy run waits for the person's decision. */
  waiting: boolean;
  /** A full-autonomy run is active. */
  auto: boolean;
  /** The quota has reached its wrap-up level. */
  low: boolean;
  /** When the belt or a guard last refused a call, a turn last failed, ended, or was stopped (ms; null: never). */
  blockAt: number | null;
  errorAt: number | null;
  doneAt: number | null;
  stoppedAt: number | null;
};

export const NO_FACTS: Readonly<MoFacts> = Object.freeze({
  working: false,
  tools: 0,
  agents: 0,
  asking: 0,
  waiting: false,
  auto: false,
  low: false,
  blockAt: null,
  errorAt: null,
  doneAt: null,
  stoppedAt: null,
});

/** How long what just happened stays in view, in ms. */
export const SHOW_FOR = { block: 4000, error: 5000, done: 4000, stopped: 6000 } as const;

const within = (at: number | null, now: number, ms: number): boolean => at !== null && now >= at && now - at < ms;

/**
 * The state at `now`. In order: a refusal, a failure, a question to the person, the turn at work (a full-autonomy
 * run, an agent, a tool, or thinking), a turn just stopped or done, a run between turns, a low quota, rest.
 */
export function moState(f: MoFacts, now: number): MoState {
  if (within(f.blockAt, now, SHOW_FOR.block)) return 'block';
  if (within(f.errorAt, now, SHOW_FOR.error)) return 'error';
  if (f.asking > 0 || f.waiting) return 'wait';
  if (f.working) return f.auto ? 'auto' : f.agents > 0 ? 'agent' : f.tools > 0 ? 'work' : 'think';
  if (within(f.stoppedAt, now, SHOW_FOR.stopped)) return 'stopped';
  if (within(f.doneAt, now, SHOW_FOR.done)) return 'done';
  if (f.auto) return 'auto';
  if (f.low) return 'low';
  return 'idle';
}

/**
 * Mo in the control center, which sees no turn: protection that needs a look, a full-autonomy run, a quota
 * near its limit, or rest.
 */
export function centerState(f: { protectionBroken: boolean; runActive: boolean; quotaLow: boolean }): 'error' | 'auto' | 'low' | 'idle' {
  if (f.protectionBroken) return 'error';
  if (f.runActive) return 'auto';
  if (f.quotaLow) return 'low';
  return 'idle';
}

/**
 * The moment each state is drawn at when Mo does not move (accessibility's reduced motion): one that reads
 * whole, its entrance over, the eyes open.
 */
export const STILL_AT: Readonly<Record<MoState, number>> = Object.freeze({
  idle: 1,
  think: 0.5,
  work: 0.25,
  agent: 0.3,
  wait: 0.5,
  done: 1.2,
  block: 1.2,
  error: 0.9,
  stopped: 0.5,
  auto: 0.5,
  low: 0.4,
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the strip above the prompt: a surface module Claude Code draws on its own clock, beside the plugin's
 * hooks. The hooks hand it what they know (ModeCodeMo, and whether a turn runs); on every tick it works out
 * the state (src/core/mo/state.ts), so what just happened gives way by itself, and draws that state's frame
 * (src/core/mo/marks.ts) in half blocks. Nothing here reaches outside: no `$`, no files, no network.
 *
 * Mo moves only while Claude works and while something that just happened shows. At rest (nothing at work,
 * a question waiting for the person, a low quota) it is drawn still and not drawn again until something
 * changes: every frame Claude Code draws hides and shows the terminal's cursor, so a Mo breathing at rest made
 * the cursor flicker under the person's typing, seven times a second (measured in a pseudo console).
 */
import type { ClientModule, ClientSurface, RenderElement } from 'claude-code';
import type { ModeCodeMo } from './contract.js';
import type { MoState } from '../core/mo/art.js';
import { mark1, mark2 } from '../core/mo/marks.js';
import { moState, STILL_AT } from '../core/mo/state.js';
import { runsOf } from '../core/mo/cells.js';

export type MoStripProps = ModeCodeMo & { working: boolean; rows: 1 | 2 };

/**
 * The instance's own clock, kept in one object the ticks count on without a redraw: the ticks, the tick the
 * hooks' last word came at, the state drawn and the tick it began at, and the props last drawn.
 */
type Clock = { tick: number; at: number; base: number; state: MoState; since: number; p: MoStripProps };
type Local = { clock: Clock };

/** One frame every TICK ms while Mo moves. */
const TICK = 125;

/** States in which Mo stands still: nothing is at work and nothing has just happened. */
const RESTING: ReadonlySet<MoState> = new Set<MoState>(['idle', 'wait', 'low']);

/** Whether `state` moves: never with less motion asked for; at rest, or a run between its turns, still. */
export function moves(state: MoState, p: Pick<MoStripProps, 'still' | 'working'>): boolean {
  if (p.still) return false;
  if (RESTING.has(state)) return false;
  return state !== 'auto' || p.working;
}

/** The state at the clock's tick, the hooks' last word counted from where it came. */
function stateAt(c: Clock): MoState {
  return moState(c.p, c.p.at + (c.tick - c.base) * TICK);
}

const MoStrip: ClientModule<MoStripProps, Local> = (p: MoStripProps, s: ClientSurface<Local>) => {
  const { Box, Text } = s.elements;
  let clock = s.state?.clock;
  if (!clock) {
    clock = { tick: 0, at: p.at, base: 0, state: 'idle', since: 0, p };
    s.setState({ clock });
    const c = clock;
    // Each tick counts; it asks for a frame only when Mo moves or its state changes.
    s.every(TICK, () => {
      c.tick++;
      const next = stateAt(c);
      if (next !== c.state || moves(next, c.p)) s.setState({ clock: c });
    });
  }
  clock.p = p;
  // The hooks wrote again: their clock reads `at` now, and the ticks count on from here.
  if (p.at !== clock.at) {
    clock.at = p.at;
    clock.base = clock.tick;
  }
  const state = stateAt(clock);
  if (state !== clock.state) {
    clock.state = state;
    clock.since = clock.tick;
  }
  const t = moves(state, p) ? ((clock.tick - clock.since) * TICK) / 1000 : STILL_AT[state];
  const picture = p.rows === 2 ? mark2(state, t, p.backdrop, true) : mark1(state, t, p.backdrop);
  // A hair of room above Mo: the line over the strip (Claude Code's spinner, a tip) does not touch it.
  const tree = h(
    Box,
    { flexDirection: 'column' },
    ...runsOf(picture, true).map((row, y) =>
      h(
        Box,
        { key: `mo-${y}`, flexDirection: 'row' },
        ...row.map((r, i) => h(Text, { key: `mo-${y}-${i}`, ...(r.fg ? { color: r.fg } : {}), ...(r.bg ? { backgroundColor: r.bg } : {}) }, r.text)),
      ),
    ),
  );
  return tree as RenderElement;
};

export default MoStrip;

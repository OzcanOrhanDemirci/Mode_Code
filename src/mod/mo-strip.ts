// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the strip above the prompt: a surface module Claude Code draws on its own clock, beside the plugin's
 * hooks. The hooks hand it what they know (ModeCodeMo, and whether a turn runs); on every tick it works out
 * the state (src/core/mo/state.ts), so what just happened gives way by itself, and draws that state's frame
 * (src/core/mo/marks.ts) in half blocks. Nothing here reaches outside: no `$`, no files, no network.
 */
import type { ClientModule, ClientSurface, RenderElement } from 'claude-code';
import type { ModeCodeMo } from './contract.js';
import type { MoState } from '../core/mo/art.js';
import { mark1, mark2 } from '../core/mo/marks.js';
import { moState, STILL_AT } from '../core/mo/state.js';
import { runsOf } from '../core/mo/cells.js';

export type MoStripProps = ModeCodeMo & { working: boolean; rows: 1 | 2 };

/** The instance's own clock: ticks counted, the tick the hooks' last word came at, and when the state began. */
type Local = { tick: number; at: number; base: number; state: MoState; since: number };

/** One frame every TICK ms while Mo moves; when it stands still, a slower tick only lets what happened give way. */
const TICK = 125;
const STILL_TICK = 500;

const MoStrip: ClientModule<MoStripProps, Local> = (p: MoStripProps, s: ClientSurface<Local>) => {
  const { Box, Text } = s.elements;
  const step = p.still ? STILL_TICK : TICK;
  let local = s.state;
  if (!local) {
    local = { tick: 0, at: p.at, base: 0, state: 'idle', since: 0 };
    s.every(step, () => {
      const cur = s.state;
      if (cur) s.setState({ ...cur, tick: cur.tick + 1 });
    });
  }
  let next = local;
  // The hooks wrote again: their clock reads `at` now, and the ticks count on from here.
  if (p.at !== next.at) next = { ...next, at: p.at, base: next.tick };
  const now = p.at + (next.tick - next.base) * step;
  const state = moState(p, now);
  if (state !== next.state) next = { ...next, state, since: next.tick };
  if (next !== s.state) s.setState(next);
  const t = p.still ? STILL_AT[state] : ((next.tick - next.since) * step) / 1000;
  const picture = p.rows === 2 ? mark2(state, t, p.backdrop) : mark1(state, t, p.backdrop);
  const tree = h(
    Box,
    { flexDirection: 'column' },
    ...runsOf(picture).map((row, y) =>
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

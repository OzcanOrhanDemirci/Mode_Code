// SPDX-License-Identifier: Apache-2.0
/**
 * A call's running time in the cockpit ("12 s", "1 min 04 s"): a surface module Claude Code draws on its own clock,
 * as Mo is (src/mod/mo-strip.ts), so the time counts on with no hook call. The hooks hand it when the call started
 * and their clock's reading as they wrote; it counts its own ticks from there. Nothing here reaches outside: no `$`,
 * no files.
 */
import type { ClientModule, ClientSurface, RenderElement } from 'claude-code';
import { elapsedText } from '../core/ux/elapsed.js';

export type CockpitClockProps = {
  /** When the call started, and the hooks' clock when they wrote: the seconds already gone. */
  since: number;
  at: number;
  lang: 'en' | 'tr';
  /** Less motion asked for: drawn once, not counted on. */
  still: boolean;
};

/** The ticks counted, and the hooks' `at` they count from. */
type Local = { tick: number; at: number; base: number };

const TICK = 1000;

const CockpitClock: ClientModule<CockpitClockProps, Local> = (p: CockpitClockProps, s: ClientSurface<Local>) => {
  const { Text } = s.elements;
  let local = s.state;
  if (!local) {
    local = { tick: 0, at: p.at, base: 0 };
    s.setState(local);
    const l = local;
    if (!p.still)
      s.every(TICK, () => {
        l.tick++;
        s.setState(l);
      });
  }
  // The hooks wrote again: their clock reads `at` now, and the ticks count on from here.
  if (p.at !== local.at) {
    local.at = p.at;
    local.base = local.tick;
  }
  const ms = p.at - p.since + (local.tick - local.base) * TICK;
  return h(Text, { dimColor: true }, elapsedText(ms, p.lang)) as RenderElement;
};

export default CockpitClock;

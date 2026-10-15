// SPDX-License-Identifier: Apache-2.0
/**
 * The breathing control on the strip above the prompt: the mode a running flow's step works in, while the
 * flow itself is the one lit (docs/modes.md, "Flows"). A surface module Claude Code draws on its own clock,
 * as Mo is (src/mod/mo-strip.ts), so the breath costs no hook calls; a press goes to the plugin's hooks as a
 * message and does what a press on any other control does. Nothing here reaches outside: no `$`, no files.
 */
import type { ClientModule, ClientSurface, RenderElement } from 'claude-code';

export type PulseProps = { id: string; label: string };

/** Breaths counted on the instance's own clock. */
type Local = { tick: number };

/** One breath in four steps, each this long: lit, bright, faint, bright. */
const STEP = 450;
const PHASES = ['lit', 'bright', 'faint', 'bright'] as const;

const StripPulse: ClientModule<PulseProps, Local> = (p: PulseProps, s: ClientSurface<Local>) => {
  const { Text } = s.elements;
  if (!s.state) {
    s.setState({ tick: 0 });
    s.every(STEP, () => {
      const cur = s.state;
      if (cur) s.setState({ tick: cur.tick + 1 });
    });
  }
  // Pressed with the main button: the same press as a button's, through the hooks (where `$` is).
  s.onPointer((e) => {
    if (e.type === 'up' && e.button === 'left') s.post({ press: p.id });
  });
  const phase = PHASES[(s.state?.tick ?? 0) % PHASES.length]!;
  const tree = h(Text, { bold: phase !== 'faint', inverse: phase === 'lit', dimColor: phase === 'faint' }, p.label);
  return tree as RenderElement;
};

export default StripPulse;

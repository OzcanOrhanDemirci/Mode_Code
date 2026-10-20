// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the control center: the small Mo beside the line it says on Now (src/tui/screens/now.tsx), which says in
 * words what it shows (color never carries meaning alone). Still where motion is reduced or the clock is fixed (tests,
 * the README's pictures); left out in plain text, since it is drawn in colored half blocks.
 */
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { frame, type MoState } from '../core/mo/art.js';
import { mark2 } from '../core/mo/marks.js';
import { runsOf } from '../core/mo/cells.js';
import { STILL_AT } from '../core/mo/state.js';

const TICK = 125;

/** The picture alone, moving on its own clock unless `still`. */
export function MoPicture({ state, size, still }: { state: MoState; size: 'full' | 'small'; still: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (still) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK);
    return () => clearInterval(id);
  }, [still, state]);
  // A moving Mo starts a second in, its entrance over; a still one at the moment that reads whole.
  const t = still ? STILL_AT[state] : 1 + (tick * TICK) / 1000;
  const picture = size === 'full' ? frame(state, t) : mark2(state, t);
  // Below the boots the whole body keeps room for the jets of a full-autonomy run; no other state uses it.
  const rows = runsOf(picture).slice(0, size === 'full' && state !== 'auto' ? -2 : undefined);
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((row, y) => (
        <Text key={y}>
          {row.map((r, i) => (
            <Text key={i} {...(r.fg ? { color: r.fg } : {})} {...(r.bg ? { backgroundColor: r.bg } : {})}>
              {r.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

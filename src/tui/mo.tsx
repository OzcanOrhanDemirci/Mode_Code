// SPDX-License-Identifier: Apache-2.0
/**
 * Mo in the control center: it greets beside the home screen's list, its whole body where there is room and
 * a small Mo where there is not, with a line that says in words what it shows (color never carries meaning
 * alone). Still where motion is reduced or the clock is fixed (tests, the README's pictures); left out in
 * plain text, since it is drawn in colored half blocks.
 */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ART_W, frame, type MoState } from '../core/mo/art.js';
import { MARK_W, mark2 } from '../core/mo/marks.js';
import { runsOf } from '../core/mo/cells.js';
import { centerState, STILL_AT } from '../core/mo/state.js';
import type { MessageKey } from '../core/i18n/index.js';
import type { DataSource } from './store.js';
import { Muted } from './ui.js';

const TICK = 125;
/** Rows the whole body takes (two pixels a row), and the small Mo. */
const FULL_ROWS = 17;
const SMALL_ROWS = 2;

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

/** Mo and its line, sized to the room; nothing where there is too little, or in plain text. */
export function MoGreeting({
  data,
  width,
  height,
  plain,
  still,
  t,
}: {
  data: DataSource;
  width: number;
  height: number;
  plain: boolean;
  still: boolean;
  t: (k: MessageKey) => string;
}) {
  if (plain || !data.config().modules.mascot) return null;
  const size = width >= ART_W && height >= FULL_ROWS + 1 ? 'full' : width >= MARK_W && height >= SMALL_ROWS + 1 ? 'small' : null;
  if (!size) return null;
  const belt = data.health().features.find((f) => f.id === 'belt');
  const state = centerState({
    protectionBroken: belt?.state === 'red',
    runActive: data.runs().some((r) => r.status === 'active'),
    quotaLow: data.quota().assessment.level !== 'ok',
  });
  return (
    <Box flexDirection="column" flexShrink={0}>
      <MoPicture state={state} size={size} still={still} />
      <Muted>{t(`mo.center.${state}` as MessageKey)}</Muted>
    </Box>
  );
}

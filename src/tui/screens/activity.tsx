// SPDX-License-Identifier: Apache-2.0
/**
 * Home › Activity (docs/design.md, No invisible work): what Mode_Code did in the background, as lines from
 * src/core/ux/activity.ts: what waits for you first, then the newest; each with why, and Enter or a click goes where
 * that is changed. The routine work (a quota reading, the notes sent with a prompt) shows on a key.
 */
import { useState } from 'react';
import { Box } from 'ink';
import { ago } from '../../core/format.js';
import { activityLines, type ActivityEvent, type ActivityLine } from '../../core/ux/activity.js';
import { mark, MEANING_MARK } from '../../core/ux/tokens.js';
import type { ScreenProps } from '../nav.js';
import { Empty, ListView, useEnv, useHints, useScreenKeys, useT } from '../ui.js';

const STATE = { done: 'ok', waiting: 'gray', blocked: 'red', note: 'off' } as const;

export function Activity({ width, height, open }: ScreenProps) {
  const { data, lang, now, theme, go } = useEnv();
  const t = useT();
  const [quiet, setQuiet] = useState(false);
  const [sel, setSel] = useState(0);
  const lines: ActivityLine[] = activityLines(data.events(14) as unknown as ActivityEvent[], lang, now, { quiet });
  const at = Math.min(sel, Math.max(0, lines.length - 1));
  const follow = (i: number) => {
    const l = lines[i];
    if (l?.address) go(l.address);
  };
  useScreenKeys((input, key) => {
    if (input === 'a') {
      setQuiet((q) => !q);
      return true;
    }
    if (!lines.length) return false;
    if (key.upArrow || input === 'k') setSel(Math.max(0, at - 1));
    else if (key.downArrow || input === 'j') setSel(Math.min(lines.length - 1, at + 1));
    else if (key.return || key.rightArrow) follow(at);
    else return false;
    return true;
  }, open);
  useHints(
    [
      ...(lines[at]?.address ? [{ key: 'Enter', label: t('act.key.go'), run: () => follow(at) }] : []),
      { key: 'a', label: t(quiet ? 'act.key.quietOff' : 'act.key.quiet'), run: () => setQuiet((q) => !q) },
    ],
    open,
  );
  if (!lines.length) return <Empty>{t('act.none')}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      <ListView
        items={lines.map((l, i) => ({
          key: `${l.at}-${i}`,
          label: `${mark(MEANING_MARK[l.meaning], theme.plain)} ${l.text}`,
          right: ago(l.at, now, lang),
          state: STATE[l.cls],
          dim: l.cls === 'note',
        }))}
        selected={at}
        height={Math.max(3, height - 1)}
        width={width}
        focused={open}
        onPress={(i) => {
          setSel(i);
          if (open) follow(i);
        }}
        onMove={open ? (d) => setSel((s) => Math.max(0, Math.min(lines.length - 1, s + d))) : undefined}
        describe={(i) => (lines[i]?.why ? `${lines[i]!.text} (${lines[i]!.why})` : (lines[i]?.text ?? null))}
      />
    </Box>
  );
}

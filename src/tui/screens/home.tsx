// SPDX-License-Identifier: Apache-2.0
/** What Now and Activity share: the sessions working in one folder, what happened while you were away, an event's title. */
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ToolEvent } from '../../app/data.js';
import { workingNow, type ModSessionState } from '../../core/session.js';
import type { ScreenProps } from '../nav.js';
import { EmptyState, Muted, useEnv, useT } from '../ui.js';

/** Folders where more than one session is working right now. */
export function sameFolderGroups(states: readonly ModSessionState[], now: number): { folder: string; count: number }[] {
  const groups = new Map<string, { folder: string; count: number }>();
  for (const s of states) {
    if (!s.cwd || !workingNow(s, now)) continue;
    const key = s.cwd.replace(/\\/g, '/').toLowerCase();
    const g = groups.get(key) ?? { folder: s.cwd, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count > 1);
}

/** Events worth the person's attention: blocks, questions, quota stops and resumes. */
export function inboxEvents(events: ToolEvent[], lastSeen: number | null): ToolEvent[] {
  return events.filter(
    (e) =>
      (lastSeen === null || e.at > lastSeen) &&
      ((e.kind === 'belt' && (e.verdict === 'deny' || e.verdict === 'ask')) ||
        e.kind === 'quota' ||
        e.kind === 'resume' ||
        // A flow that now waits for the person, or has ended.
        (e.kind === 'flow' && (e.status === 'waiting' || e.status === 'done') && (e.action === 'done' || e.action === 'resume')) ||
        // A step full autonomy left to the person while they were away.
        (e.kind === 'permission' && e.answer === 'left') ||
        (e.kind === 'belt' && e.left === true)),
  );
}

export function Inbox({ width, open }: ScreenProps) {
  const { data, theme, lang, now } = useEnv();
  const t = useT();
  const lastSeen = data.lastSeen();
  const list = inboxEvents(data.events(14), lastSeen);
  useEffect(() => {
    if (open) data.markSeen(now);
  }, [open]);
  if (!list.length)
    return <EmptyState text={lastSeen ? t('inbox.emptySince', { when: ago(lastSeen, now, lang) }) : t('inbox.empty')} to="activity/feed" open={open} />;
  return (
    <Box flexDirection="column" width={width}>
      {lastSeen ? <Muted>{t('inbox.since', { when: ago(lastSeen, now, lang) })}</Muted> : null}
      {list.slice(0, 60).map((e, i) => (
        <Box key={i} flexDirection="column" marginTop={i === 0 ? 1 : 0}>
          <Box>
            <Box width={14} flexShrink={0}>
              <Text color={theme.muted}>{ago(e.at, now, lang)}</Text>
            </Box>
            <Text color={e.verdict === 'deny' || e.level === 'stop' ? theme.bad : theme.warn}>{eventTitle(e, t)}</Text>
          </Box>
          {e.reasons?.[0] ? (
            <Box marginLeft={14}>
              <Muted wrap="truncate-end">{e.reasons[0]}</Muted>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export function eventTitle(e: ToolEvent, t: (k: MessageKey, p?: Record<string, string | number>) => string): string {
  if (e.kind === 'belt' && e.left) return t('event.left', { tool: e.tool ?? '?' });
  if (e.kind === 'belt') return t(e.verdict === 'ask' ? (e.answer === 'allow' ? 'event.allowed' : 'event.asked') : 'event.blocked', { tool: e.tool ?? '?' });
  if (e.kind === 'permission' && e.answer === 'left') return t('event.left', { tool: e.tool ?? '?' });
  if (e.kind === 'quota') return t(e.level === 'stop' ? 'event.quotaStop' : 'event.quotaWrapUp');
  if (e.kind === 'resume') return t('event.resume');
  if (e.kind === 'chat') return t('event.chat', { tool: e.tool ?? '?' });
  if (e.kind === 'keyword') return t('event.keyword', { keyword: e.keyword ?? '?' });
  if (e.kind === 'mode') return t('event.mode', { mode: t(`mode.name.${e.mode ?? 'chat'}` as MessageKey), tool: e.tool ?? '?' });
  if (e.kind === 'modeDisagree') return t('event.modeDisagree');
  if (e.kind === 'flow') {
    if (e.status === 'waiting') return t('event.flow.waiting', { flow: e.flow ?? '?' });
    if (e.status === 'done') return t('event.flow.complete', { flow: e.flow ?? '?' });
    return t(`event.flow.${e.action ?? 'start'}` as MessageKey, { flow: e.flow ?? '?' });
  }
  return e.kind;
}

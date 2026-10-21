// SPDX-License-Identifier: Apache-2.0
/** What Now and Activity share: the sessions working in one folder, what happened while you were away, an event's title. */
import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { RULES } from '../../core/belt/rules.js';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ToolEvent } from '../../app/data.js';
import { workingNow, type ModSessionState } from '../../core/session.js';
import type { ScreenProps } from '../nav.js';
import { EmptyState, Muted, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
import { Pressable } from '../press.js';

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
  const { data, lang, now } = useEnv();
  const t = useT();
  // When it was last looked at, as the page opened: opening it marks it seen, and what is shown stays while it is open.
  const [lastSeen] = useState(() => data.lastSeen());
  const list = inboxEvents(data.events(14), lastSeen);
  useEffect(() => {
    if (open) data.markSeen(now);
  }, [open]);
  if (!list.length)
    return <EmptyState text={lastSeen ? t('inbox.emptySince', { when: ago(lastSeen, now, lang) }) : t('inbox.empty')} to="activity/feed" open={open} />;
  return (
    <Box flexDirection="column" width={width}>
      {lastSeen ? <Muted>{t('inbox.since', { when: ago(lastSeen, now, lang) })}</Muted> : null}
      <Box marginTop={lastSeen ? 1 : 0} flexDirection="column">
        <EventRows events={list.slice(0, 60)} open={open} />
      </Box>
    </Box>
  );
}

/** A rule's name as the control center gives it; an id no rule has (an older record's) as it was written. */
export function ruleNames(ids: readonly string[] | undefined, t: (k: MessageKey) => string): string {
  return (ids ?? []).map((id) => (Object.hasOwn(RULES, id) ? t(`rulename.${id}` as MessageKey) : id)).join(', ');
}

/**
 * Events of the safety belt and the quota, newest first, each with its first reason: ↑↓ (or the pointer) select one,
 * Enter (or a click) opens the rule that decided it, as the Activity feed's rows lead where a thing is changed.
 */
export function EventRows({ events, open }: { events: readonly ToolEvent[]; open: boolean }) {
  const { theme, lang, now, go } = useEnv();
  const t = useT();
  // The selected row held in a ref as well: keys that arrive together (typed fast, pasted) each move from the last.
  const selRef = useRef(0);
  const [, redraw] = useState(0);
  const select = (i: number) => {
    selRef.current = Math.max(0, Math.min(events.length - 1, i));
    redraw((n) => n + 1);
  };
  const at = Math.min(selRef.current, Math.max(0, events.length - 1));
  const ruleOf = (i: number) => events[i]?.rules?.find((id) => Object.hasOwn(RULES, id));
  const follow = (i: number) => {
    const rule = ruleOf(i);
    if (rule) go(`protection/rules/${rule}`);
  };
  useScreenKeys((input, key) => {
    if (!events.length) return false;
    if (key.upArrow || input === 'k') select(selRef.current - 1);
    else if (key.downArrow || input === 'j') select(selRef.current + 1);
    else if (key.return || key.rightArrow) follow(Math.min(selRef.current, events.length - 1));
    else return false;
    return true;
  }, open);
  useHints(ruleOf(at) ? [{ key: 'Enter', label: t('events.key.rule'), run: () => follow(at) }] : [], open);
  return (
    <Box flexDirection="column">
      {events.map((e, i) => {
        const selected = open && i === at;
        const names = ruleNames(e.rules, t);
        return (
          <Pressable
            key={i}
            flexDirection="column"
            keep={selected}
            onPress={() => {
              select(i);
              if (open) follow(i);
            }}
            describe={names || undefined}
          >
            <Box>
              <Box width={14} flexShrink={0}>
                <Text color={theme.muted} inverse={selected}>{`${selected ? theme.sym.cursor : ' '} ${ago(e.at, now, lang)}`}</Text>
              </Box>
              <Text color={e.verdict === 'deny' || e.level === 'stop' ? theme.bad : e.verdict === 'ask' ? theme.warn : undefined} wrap="truncate-end">
                {eventTitle(e, t)}
                {names ? <Text color={theme.muted}>{` · ${names}${ruleOf(i) ? ` ${theme.sym.more}` : ''}`}</Text> : null}
              </Text>
            </Box>
            {e.reasons?.[0] ? (
              <Box marginLeft={14}>
                <Muted wrap="truncate-end">{e.reasons[0]}</Muted>
              </Box>
            ) : null}
          </Pressable>
        );
      })}
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

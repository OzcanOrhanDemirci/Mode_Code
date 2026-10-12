// SPDX-License-Identifier: Apache-2.0
/** Home: what is happening now. Protection, quota, today, running sessions, and what happened while you were away. */
import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { ago, compact, percent, until, shortPath } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { healthCounts } from '../../app/health.js';
import type { ToolEvent } from '../../app/data.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Gauge, Muted, Note, Row, Section, StateMark, useEnv, useT } from '../ui.js';
import { LinkList, type Link } from '../widgets.js';

export function Overview({ width, height, open }: ScreenProps) {
  const { data, theme, lang, now } = useEnv();
  const t = useT();
  const h = data.health();
  const q = data.quota();
  const c = healthCounts(h);
  const belt = h.features.find((f) => f.id === 'belt')!;
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const todayEvents = data.events(1).filter((e) => e.at >= day.getTime());
  const blocked = todayEvents.filter((e) => e.kind === 'belt' && e.verdict === 'deny').length;
  const asked = todayEvents.filter((e) => e.kind === 'belt' && e.verdict === 'ask').length;
  const totals = data.totalsSince(day.getTime());
  const live = data.sessions({ limit: 50 }).filter((s) => now - s.lastTs < 15 * 60_000);
  const unseen = inboxEvents(data.events(14), data.lastSeen());
  const gw = Math.max(10, Math.min(30, width - 34));
  const links: Link[] = live.map((s) => ({
    key: s.id,
    label: `${s.title ?? s.firstPrompt ?? s.id.slice(0, 8)}`,
    right: `${shortPath(s.cwd, homedir(), 24)} · ${ago(s.lastTs, now, lang)}`,
    address: `sessions/${s.id}`,
  }));
  return (
    <Box flexDirection="column" width={width}>
      <Section title={t('home.protection')}>
        {belt.state === 'absent' ? (
          <Note kind="warn">{t('home.notInstalled')}</Note>
        ) : (
          <Box>
            <Text>{theme.sym.shield} </Text>
            <StateMark state={belt.state} />
            <Text color={theme.muted}>
              {' · '}
              {c.red ? t('home.redCount', { n: c.red }) : c.gray ? t('home.grayCount', { n: c.gray }) : t('home.allWorking')}
            </Text>
          </Box>
        )}
        {belt.reason && belt.state !== 'absent' ? (
          <Note kind={belt.state === 'red' ? 'bad' : 'warn'}>{t(belt.reason.key as MessageKey, belt.reason.params)}</Note>
        ) : null}
      </Section>
      <Section title={t('home.quota')}>
        {q.reading ? (
          <>
            {q.assessment.five ? (
              <Gauge
                label={t('cli.quota.five')}
                pct={q.assessment.five.used}
                width={gw}
                right={`${percent(q.assessment.five.used, lang)} · ${t('cli.quota.resets', { when: until(q.assessment.five.resetsAt, now, lang) })}`}
              />
            ) : null}
            {q.assessment.week ? (
              <Gauge
                label={t('cli.quota.week')}
                pct={q.assessment.week.used}
                width={gw}
                right={`${percent(q.assessment.week.used, lang)}${q.target ? ' / ' + percent(q.target.value, lang) : ''} · ${t('cli.quota.resets', { when: until(q.assessment.week.resetsAt, now, lang) })}`}
              />
            ) : null}
            <Muted>{t('cli.measured', { when: ago(q.reading.measuredAt, now, lang) })}</Muted>
          </>
        ) : (
          <Muted>{t('cli.quota.none')}</Muted>
        )}
      </Section>
      <Section title={t('home.today')}>
        <Row label={t('home.outputTokens')}>{totals ? compact(totals.output, lang) : '?'}</Row>
        <Row label={t('home.blocked')} {...(blocked ? { color: theme.bad } : {})}>
          {String(blocked)}
          {asked ? ` · ${t('home.asked', { n: asked })}` : ''}
        </Row>
        <Row label={t('home.inbox')} {...(unseen.length ? { color: theme.warn } : {})}>
          {unseen.length ? t('home.inboxCount', { n: unseen.length }) : t('home.inboxEmpty')}
        </Row>
      </Section>
      <Section title={t('home.live')}>
        <LinkList items={links} height={Math.max(2, height - 18)} width={width} open={open} emptyText={t('home.noLive')} />
      </Section>
    </Box>
  );
}

/** Events worth the person's attention: blocks, questions, quota stops and resumes. */
export function inboxEvents(events: ToolEvent[], lastSeen: number | null): ToolEvent[] {
  return events.filter(
    (e) =>
      (lastSeen === null || e.at > lastSeen) &&
      ((e.kind === 'belt' && (e.verdict === 'deny' || e.verdict === 'ask')) || e.kind === 'quota' || e.kind === 'resume'),
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
  if (!list.length) return <Empty>{lastSeen ? t('inbox.emptySince', { when: ago(lastSeen, now, lang) }) : t('inbox.empty')}</Empty>;
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
  if (e.kind === 'belt') return t(e.verdict === 'ask' ? (e.answer === 'allow' ? 'event.allowed' : 'event.asked') : 'event.blocked', { tool: e.tool ?? '?' });
  if (e.kind === 'quota') return t(e.level === 'stop' ? 'event.quotaStop' : 'event.quotaWrapUp');
  if (e.kind === 'resume') return t('event.resume');
  if (e.kind === 'chat') return t('event.chat', { tool: e.tool ?? '?' });
  if (e.kind === 'keyword') return t('event.keyword', { keyword: e.keyword ?? '?' });
  return e.kind;
}

// SPDX-License-Identifier: Apache-2.0
/** Home: what is happening now. Protection, quota, today, running sessions, and what happened while you were away. */
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { ago, compact, dateTime, percent, until, shortPath } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { healthCounts } from '../../app/health.js';
import type { ToolEvent } from '../../app/data.js';
import { workingNow, type ModSessionState } from '../../core/session.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Gauge, Muted, Note, Row, Section, StateMark, useEnv, useT } from '../ui.js';
import { LinkList, type Link } from '../widgets.js';
import { flowTitle, statusText } from '../../core/flow-view.js';

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
  // A session that ended, or whose window was shut, is not running, however recent its last line.
  const closed = data.closedSessions();
  const live = data.sessions({ limit: 50 }).filter((s) => now - s.lastTs < 15 * 60_000 && !closed.has(s.id));
  const unseen = inboxEvents(data.events(14), data.lastSeen());
  const gw = Math.max(10, Math.min(30, width - 34));
  // Plans waiting for the person first, then the rest that are still open.
  const openFlows = data
    .flows()
    .filter((f) => f.status !== 'done' && f.status !== 'canceled')
    .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'));
  const flowLinks: Link[] = openFlows.map((f) => ({
    key: f.id,
    label: `${f.status === 'waiting' ? '⏸ ' : ''}${flowTitle(f, 50)}`,
    right: `${statusText(f.status, lang)} · ${ago(f.updatedAt, now, lang)}`,
    address: `projects/flows/${f.id}`,
  }));
  // Full-autonomy runs still open: running first, then paused ones waiting for the person.
  const runLinks: Link[] = data
    .runs()
    .filter((r) => r.status === 'active' || r.status === 'paused')
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
    .map((r) => ({
      key: r.id,
      label: `${r.status === 'paused' ? '⏸ ' : '🤖 '}${(r.task || r.id).split('\n')[0]!.slice(0, 50)}`,
      right: `${t(`auto.status.${r.status}` as MessageKey)} · ${ago(r.updatedAt, now, lang)}`,
      address: `automation/runs/${r.id}`,
    }));
  const links: Link[] = live.map((s) => ({
    key: s.id,
    label: `${s.title ?? s.firstPrompt ?? s.id.slice(0, 8)}`,
    right: `${shortPath(s.cwd, homedir(), 24)} · ${ago(s.lastTs, now, lang)}`,
    address: `sessions/${s.id}`,
  }));
  // After a long gap: what happened while the person was away (the morning report, docs/memory.md).
  const morning = data.morning();
  return (
    <Box flexDirection="column" width={width}>
      {morning && morning.lines.length ? (
        <Section title={t('morning.title', { since: dateTime(morning.since, lang) })}>
          {morning.lines.slice(0, 8).map((l, i) => (
            <Row key={i} label={l.label}>
              {l.text}
            </Row>
          ))}
        </Section>
      ) : null}
      <Section title={t('home.protection')}>
        {belt.state === 'absent' ? (
          <Note kind="warn">{t('home.notInstalled')}</Note>
        ) : (
          <Box>
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
      {openFlows.length ? (
        <Section title={t('home.flows')}>
          <LinkList items={flowLinks} height={Math.min(4, flowLinks.length)} width={width} open={false} />
        </Section>
      ) : null}
      {runLinks.length ? (
        <Section title={t('home.runs')}>
          <LinkList items={runLinks} height={Math.min(3, runLinks.length)} width={width} open={false} />
        </Section>
      ) : null}
      <Section title={t('home.live')}>
        {sameFolderGroups(
          data.modStates().filter((s) => !closed.has(s.sessionId)),
          now,
        ).map((g) => (
          <Note key={g.folder} kind="warn">
            {t('home.conflict', { n: g.count, folder: shortPath(g.folder, homedir(), Math.max(20, width - 40)) })}
          </Note>
        ))}
        <LinkList items={links} height={Math.max(2, height - 18)} width={width} open={open} emptyText={t('home.noLive')} />
      </Section>
    </Box>
  );
}

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
        // A full-autonomy run that ended or paused while the person was away.
        (e.kind === 'run' && (e.action === 'finish' || e.action === 'stuck' || e.action === 'pause' || e.action === 'cancel'))),
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
  if (e.kind === 'mode') return t('event.mode', { mode: t(`mode.name.${e.mode ?? 'chat'}` as MessageKey), tool: e.tool ?? '?' });
  if (e.kind === 'modeDisagree') return t('event.modeDisagree');
  if (e.kind === 'run') {
    if (e.action === 'pause') return t('event.run.pause', { run: e.run ?? '?', reason: t(`auto.pause.${e.reason ?? 'person'}` as MessageKey) });
    return t(`event.run.${e.action === 'finish' || e.action === 'stuck' || e.action === 'cancel' ? e.action : 'start'}` as MessageKey, { run: e.run ?? '?' });
  }
  if (e.kind === 'flow') {
    if (e.status === 'waiting') return t('event.flow.waiting', { flow: e.flow ?? '?' });
    if (e.status === 'done') return t('event.flow.complete', { flow: e.flow ?? '?' });
    return t(`event.flow.${e.action ?? 'start'}` as MessageKey, { flow: e.flow ?? '?' });
  }
  return e.kind;
}

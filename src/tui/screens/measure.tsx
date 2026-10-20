// SPDX-License-Identifier: Apache-2.0
/** Measurement: quota, tokens, tools. Every number says where it comes from and how old it is. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { ago, compact, dateTime, integer, percent, shortPath, sparkline, until } from '../../core/format.js';
import { cacheHitRate } from '../../node/index-db.js';
import { bucketize, type ReadingPoint } from '../../core/history.js';
import { reportLines } from '../../app/report.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Gauge, Muted, Note, Row, Section, Table, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
import { LinkList, type Link } from '../widgets.js';

export function Quota({ width }: ScreenProps) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const q = data.quota();
  if (!q.reading) return <Empty>{t('cli.quota.none')}</Empty>;
  const gw = Math.max(10, Math.min(40, width - 30));
  const a = q.assessment;
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        {q.reading.windows.map((w) => (
          <Box key={w.kind} flexDirection="column" marginBottom={1}>
            <Gauge
              label={w.kind === 'five_hour' ? t('cli.quota.five') : w.kind === 'seven_day' ? t('cli.quota.week') : w.kind}
              pct={w.used}
              width={gw}
              right={percent(w.used, lang)}
            />
            {w.resetsAt ? (
              <Box marginLeft={14}>
                <Muted>{t('quota.resetsAt', { at: dateTime(w.resetsAt, lang), when: until(w.resetsAt, now, lang) })}</Muted>
              </Box>
            ) : null}
          </Box>
        ))}
      </Section>
      <QuotaHistory width={width} />
      <Section title={t('quota.budget')}>
        <Row label={t('quota.weeklyBudget')}>
          {a.target.explicit ? t('quota.explicit', { n: percent(a.target.value, lang) }) : t('quota.default', { n: percent(a.target.value, lang) })}
        </Row>
        <Row label={t('quota.fiveRule')}>{t('quota.fiveRuleText', { wrap: data.config().quota.fiveHourWrapUp, stop: data.config().quota.fiveHourStop })}</Row>
        <Row label={t('quota.state')} color={a.level === 'stop' ? theme.bad : a.level === 'wrapUp' ? theme.warn : theme.ok}>
          {t(a.level === 'stop' ? 'cli.quota.levelStop' : a.level === 'wrapUp' ? 'cli.quota.levelWrapUp' : 'quota.levelOk')}
        </Row>
        <Row label={t('quota.measured')}>{ago(q.reading.measuredAt, now, lang) + (a.stale ? ' · ' + t('cli.quota.stale') : '')}</Row>
      </Section>
      <Note>{t('quota.explain')}</Note>
    </Box>
  );
}

/** What happened in the last day or week, in a few lines; p switches the period. */
export function ReportScreen({ width, open }: ScreenProps) {
  const { data, lang } = useEnv();
  const t = useT();
  const [days, setDays] = useState(1);
  useScreenKeys((input) => {
    if (input === 'p') {
      setDays((d) => (d === 1 ? 7 : 1));
      return true;
    }
    return false;
  }, open);
  useHints([{ key: 'p', label: t('keys.days'), run: () => setDays((d) => (d === 1 ? 7 : 1)) }], open);
  const lines = reportLines(data.report(days), lang, homedir());
  const w = Math.min(18, Math.max(...lines.map((l) => l.label.length)) + 2);
  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text bold>{days === 1 ? t('report.titleDay') : t('report.title', { n: days })}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {lines.map((l) => (
          <Row key={l.label} label={l.label} width={w}>
            {l.text}
          </Row>
        ))}
      </Box>
    </Box>
  );
}

/** How the windows moved: the weekly window over seven days, the 5-hour window over the last day. */
function QuotaHistory({ width }: { width: number }) {
  const { data, now, theme } = useEnv();
  const t = useT();
  const points: ReadingPoint[] = data
    .events(8)
    .filter((e) => e.kind === 'reading')
    .map((e) => ({ at: e.at, five: e.five ?? null, week: e.week ?? null, fiveResetsAt: e.fiveResetsAt ?? null, weekResetsAt: e.weekResetsAt ?? null }));
  if (points.length < 2) return null;
  const n = Math.max(12, Math.min(56, width - 22));
  const draw = (vals: (number | null)[]) => vals.map((v) => (v === null ? ' ' : sparkline([v, 100], theme.plain)[0])).join('');
  const week = bucketize(points, 'week', now - 7 * 86400_000, now, n);
  const five = bucketize(points, 'five', now - 86400_000, now, n);
  return (
    <Section title={t('quota.history')}>
      <Box>
        <Box width={18} flexShrink={0}>
          <Text color={theme.muted}>{t('quota.historyWeek')}</Text>
        </Box>
        <Text color={theme.accent}>{draw(week)}</Text>
      </Box>
      <Box>
        <Box width={18} flexShrink={0}>
          <Text color={theme.muted}>{t('quota.historyFive')}</Text>
        </Box>
        <Text color={theme.accent}>{draw(five)}</Text>
      </Box>
      <Muted>{t('quota.historyNote')}</Muted>
    </Section>
  );
}

const PERIODS = [1, 7, 30, 90] as const;

export function Tokens({ width, open }: ScreenProps) {
  const { data, lang, theme } = useEnv();
  const t = useT();
  const [pi, setPi] = useState(1);
  const days = PERIODS[pi]!;
  useScreenKeys((input) => {
    if (input === 'p') {
      setPi((i) => (i + 1) % PERIODS.length);
      return true;
    }
    return false;
  }, open);
  useHints([{ key: 'p', label: t('keys.days'), run: () => setPi((i) => (i + 1) % PERIODS.length) }], open);
  const total = data.totals(days);
  if (!total) return <Empty>{t('tokens.noIndex')}</Empty>;
  const byDay = data.breakdown('day', Math.max(days, 14)).slice().reverse();
  const models = data.breakdown('model', days);
  const hit = cacheHitRate(total);
  const all = total.input + total.cacheWrite + total.cacheRead + total.output;
  const half = Math.max(30, Math.floor((width - 2) / 2));
  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text bold>{t('tokens.period', { n: days })}</Text>
      </Box>
      <Box marginTop={1} flexDirection={width >= 70 ? 'row' : 'column'}>
        <Box flexDirection="column" width={half}>
          <Row label={t('tokens.output')}>{compact(total.output, lang)}</Row>
          <Row label={t('tokens.thinking')}>{compact(total.thinking, lang)}</Row>
          <Row label={t('tokens.input')}>{compact(total.input, lang)}</Row>
          <Row label={t('tokens.cacheWrite')}>{compact(total.cacheWrite, lang)}</Row>
          <Row label={t('tokens.cacheRead')}>{compact(total.cacheRead, lang)}</Row>
        </Box>
        <Box flexDirection="column" width={half}>
          <Row label={t('tokens.all')}>{compact(all, lang)}</Row>
          <Row label={t('tokens.cacheHit')}>{hit === null ? '?' : percent(hit * 100, lang, 1)}</Row>
          <Row label={t('tokens.agents')}>{all ? `${compact(total.agentTokens, lang)} (${percent((total.agentTokens / all) * 100, lang)})` : '0'}</Row>
          <Row label={t('tokens.messages')}>{integer(total.messages, lang)}</Row>
        </Box>
      </Box>
      <Section title={t('tokens.daily')}>
        <Text color={theme.accent}>
          {sparkline(
            byDay.map((d) => d.output),
            theme.plain,
          )}
        </Text>
        <Muted>{byDay.length ? `${byDay[0]!.key} … ${byDay[byDay.length - 1]!.key} · ${t('tokens.dailyNote')}` : ''}</Muted>
      </Section>
      <Section title={t('tokens.byModel')}>
        <Table
          widths={[28, 12, 17, 10]}
          right={[1, 2, 3]}
          rows={[
            [t('tokens.model'), t('tokens.output'), t('tokens.cacheRead'), t('tokens.messages')],
            ...models.slice(0, 6).map((m) => [m.key, compact(m.output, lang), compact(m.cacheRead, lang), integer(m.messages, lang)]),
          ]}
        />
      </Section>
      <Muted>{t('tokens.note')}</Muted>
    </Box>
  );
}

export function Tools({ width }: ScreenProps) {
  const { data, lang, theme } = useEnv();
  const t = useT();
  const list = data.tools({ days: 30 });
  if (!list.length) return <Empty>{t('tokens.noIndex')}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      <Table
        widths={[24, 10, 10, 12, 12]}
        right={[1, 2, 3, 4]}
        rows={[
          [t('tools.tool'), t('tools.calls'), t('tools.errors'), t('tools.rate'), t('tools.byAgents')],
          ...list.map((x) => [
            x.name,
            integer(x.calls, lang),
            integer(x.errors, lang),
            percent(x.calls ? (x.errors / x.calls) * 100 : 0, lang, 1),
            integer(x.byAgents, lang),
          ]),
        ]}
      />
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="wrap">
          {t('tools.note')}
        </Text>
      </Box>
    </Box>
  );
}

export function Folders({ width, height, open }: ScreenProps) {
  const { data, lang, now } = useEnv();
  const t = useT();
  const list = data.folders(30);
  const links: Link[] = list.map((f) => ({
    key: f.cwd,
    label: shortPath(f.cwd, homedir(), Math.max(20, width - 34)),
    right: `${compact(f.tokens, lang)} · ${t('folders.sessions', { n: f.sessions })} · ${ago(f.lastTs, now, lang)}`,
    address: `memory/projects/${encodeURIComponent(f.cwd)}`,
  }));
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('folders.intro')}</Muted>
      <Box marginTop={1}>
        <LinkList items={links} height={Math.max(3, height - 4)} width={width} open={open} emptyText={t('tokens.noIndex')} />
      </Box>
    </Box>
  );
}

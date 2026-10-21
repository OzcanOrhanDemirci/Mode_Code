// SPDX-License-Identifier: Apache-2.0
/**
 * Now, the control center's first screen (docs/design.md, The control center): Mo says the one thing that matters
 * most and leads there; then what Claude may do in the session at work (the cockpit's own lines, src/core/ux/now.ts),
 * what is at work, what waits for the person, the quota, and the goals people come here for. Every line says itself:
 * pointed at or reached by the keys, its card takes the line under Mo; a press opens its reasons or its place.
 */
import { useState, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { ago, compact, dateTime, shortPath } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { flowTitle } from '../../core/flow-view.js';
import type { ActivityEvent } from '../../core/ux/activity.js';
import { actRows, canNow, quotaView, type CanRow, type CockpitAct } from '../../core/ux/cockpit.js';
import { fitText, markOf, meter } from '../../core/ux/kit.js';
import { centerFacts, GOALS, guide, liveSessions, type GoalId } from '../../core/ux/now.js';
import { wrapText } from '../../core/ux/text.js';
import { mark, type MarkName, type Meaning } from '../../core/ux/tokens.js';
import { textWidth } from '../../node/width.js';
import { MoPicture } from '../mo.js';
import { MARK_W } from '../../core/mo/marks.js';
import type { ScreenProps } from '../nav.js';
import { Pressable, underlined } from '../press.js';
import { Row, useEnv, useHints, useKit, useScreenKeys, useT } from '../ui.js';
import { healthCounts } from '../../app/health.js';
import { sameFolderGroups, inboxEvents } from './home.js';

/** The page each control of the strip is set up on, for a line of "Claude right now" whose change is the strip's. */
const CONTROL_PAGE: Readonly<Record<string, string>> = {
  ajan: 'work/agents',
  parallel: 'work/agents',
  'tam-otonom': 'work/modes',
  'full-auto': 'work/modes',
  '9': 'work/modes',
  kota: 'quota/limits',
  quota: 'quota/limits',
};

/** Something on Now that the keys reach and a click presses: its card, and what a press does. */
interface Item {
  id: string;
  card: string;
  press(): void;
}

export function Now({ width, open }: ScreenProps) {
  const { data, lang, now, theme, go, place: placeName, still } = useEnv();
  const t = useT();
  const kit = useKit();
  const [focus, setFocus] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [allWhy, setAllWhy] = useState(false);
  const [pick, setPick] = useState(0);
  const config = data.config();
  const q = data.quota();
  const folder = (cwd: string | undefined) => (cwd ? shortPath(cwd, homedir(), 28) : '?');

  // ── the facts ──
  const live = liveSessions(data.modStates(), data.closedSessions(), data.cwd, now);
  const session = live.length ? live[Math.min(pick, live.length - 1)]! : null;
  const flows = data.flows();
  const events = data.events(1) as unknown as ActivityEvent[];
  const facts = centerFacts({
    config,
    state: session,
    flow: session?.flowId ? (flows.find((f) => f.id === session.flowId) ?? null) : null,
    quota: q.assessment,
    events,
    now,
    lang,
  });
  const can = canNow(facts, lang);
  const quota = quotaView(facts, lang);
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const today = data.events(1).filter((e) => e.at >= day.getTime() && e.kind === 'belt');
  const blocked = today.filter((e) => e.verdict === 'deny').length;
  const asked = today.filter((e) => e.verdict === 'ask').length;
  const totals = data.totalsSince(day.getTime());
  // What happened today, in every session: what waits for the person first.
  const act = actRows({ ...facts, events: events.filter((e) => e.at >= day.getTime()) }, lang);
  const health = data.health();
  const belt = health.features.find((f) => f.id === 'belt');
  const counts = healthCounts(health);
  const g = guide({
    protectionBroken: belt?.state === 'red',
    flows,
    away: inboxEvents(data.events(14), data.lastSeen()).length,
    quota: q.assessment,
    live,
    folder: (s) => folder(s.cwd),
    flowTitle: (f) => flowTitle(f, 40),
  });

  // ── what the keys reach, in the order they are drawn ──
  const items: Item[] = [];
  const two = width >= 96;
  const gap = 3;
  const colW = two ? Math.floor((width - gap) / 2) : width;
  const muted = theme.muted ? { color: theme.muted } : {};

  /**
   * A line the keys and the pointer reach: focused, it is drawn inverse and its card says itself under Mo; pointed
   * at, it is underlined and the bar says it.
   */
  const line = (id: string, card: string, press: () => void, o: { lead: ReactNode; text: string; trailing?: string; w: number }) => {
    items.push({ id, card, press });
    const focused = open && focus === id;
    const tail = o.trailing ?? '';
    const room = Math.max(4, o.w - 2 - (tail ? textWidth(tail) + 1 : 0));
    return (
      <Pressable
        key={id}
        width={o.w}
        keep={focused}
        onPress={() => {
          setFocus(id);
          press();
        }}
        describe={card}
      >
        {(hovered) => (
          <>
            <Box flexShrink={0}>{o.lead}</Box>
            <Text inverse={focused} underline={hovered} wrap="truncate-end">
              {` ${fitText(kit, o.text, room)}`}
            </Text>
            <Box flexGrow={1} />
            {tail ? <Text {...muted}>{` ${tail}`}</Text> : null}
          </>
        )}
      </Pressable>
    );
  };
  const title = (text: string, meaning?: Meaning) => (
    <Text bold {...(meaning && kit.color(meaning) ? { color: kit.color(meaning)! } : { color: theme.accent })} wrap="truncate-end">
      {text}
    </Text>
  );
  const prose = (text: string, w: number, meaning?: Meaning, key = 'p') =>
    wrapText(text, Math.max(8, w), textWidth).map((l, i) => (
      <Text key={`${key}-${i}`} {...(meaning && kit.color(meaning) ? { color: kit.color(meaning)! } : muted)}>
        {l}
      </Text>
    ));
  const markNode = (m: MarkName, meaning: Meaning) => <Text>{markOf(kit, m, meaning)}</Text>;

  // ── Claude right now ──
  /**
   * What changes a line, from here: a page of the control center; a control of the strip is its session's alone, so
   * it is said, with the page its permission lives on.
   */
  const actOf = (a: CockpitAct): { strip: string | null; label: string; address: string | null } =>
    a.kind === 'center'
      ? { strip: null, label: a.label, address: a.address }
      : a.kind === 'control'
        ? { strip: t('now.strip', { cmd: `/${a.name}` }), label: '', address: CONTROL_PAGE[a.name] ?? null }
        : { strip: null, label: a.label, address: null };
  const canBlock = (w: number) => {
    const out: ReactNode[] = [];
    const head = session ? t('now.can.in', { folder: folder(session.cwd), when: ago(session.aliveAt, now, lang) }) : t('now.can.new');
    out.push(
      <Box key="can-title" width={w}>
        <Box flexShrink={0}>{title(t('ck.can.title'))}</Box>
        <Text {...muted} wrap="truncate-end">{` · ${head}`}</Text>
      </Box>,
    );
    // Protection that does not work comes first: what the lines below promise holds only while it does.
    if (belt && belt.state !== 'ok' && belt.state !== 'off') {
      const bad = belt.state === 'red';
      const text =
        belt.state === 'absent'
          ? t('home.notInstalled')
          : `${t('home.protection')}: ${t(`health.state.${belt.state}` as MessageKey)}${counts.red > 1 ? ` · ${t('home.redCount', { n: counts.red })}` : ''}`;
      const why = belt.reason ? t(belt.reason.key as MessageKey, belt.reason.params) : text;
      out.push(
        line('protection', `${why} ${t('now.goCard', { place: placeName('protection/status') })}`, () => go('protection/status'), {
          lead: markNode(bad ? 'bad' : 'look', bad ? 'bad' : 'ask'),
          text,
          trailing: mark('more', theme.plain),
          w,
        }),
      );
    }
    if (live.length > 1) {
      const i = Math.min(pick, live.length - 1);
      out.push(
        line('session', t('now.session.card', { i: i + 1, n: live.length }), () => setPick((p) => (p + 1) % live.length), {
          lead: <Text color={theme.accent}>{mark('back', theme.plain)}</Text>,
          text: t('now.session.pick', { i: i + 1, n: live.length }),
          trailing: mark('more', theme.plain),
          w,
        }),
      );
    }
    for (const r of can) {
      const id = `can-${r.id}`;
      out.push(
        line(id, r.card, () => setWhyOpen((o) => (o === r.id ? null : r.id)), {
          lead: markNode(r.mark, r.meaning),
          text: r.text,
          trailing: r.locked ? mark('lock', theme.plain) : mark('more', theme.plain),
          w,
        }),
      );
      if (allWhy || whyOpen === r.id) out.push(...reasons(r, w));
    }
    return out;
  };
  const reasons = (r: CanRow, w: number): ReactNode[] => {
    const body = [`${r.why.title}: ${r.why.now}.`, ...r.why.because];
    const out: ReactNode[] = [
      <Box key={`why-${r.id}`} flexDirection="column" marginLeft={2} width={w - 2}>
        {body.flatMap((s, j) => prose(s, w - 2, undefined, `b${j}`))}
      </Box>,
    ];
    if (r.act) {
      const a = actOf(r.act);
      if (a.strip)
        out.push(
          <Box key={`why-${r.id}-strip`} marginLeft={2} width={w - 2} flexDirection="column">
            {prose(a.strip, w - 2)}
          </Box>,
        );
      if (a.address) {
        const address = a.address;
        out.push(
          <Box key={`why-${r.id}-go`} marginLeft={2} width={w - 2}>
            {line(`why-${r.id}-go`, t('now.goCard', { place: placeName(address) }), () => go(address), {
              lead: <Text color={theme.accent}>{mark('more', theme.plain)}</Text>,
              text: `${a.label || placeName(address)}${mark('opener', theme.plain)}`,
              w: w - 2,
            })}
          </Box>,
        );
      }
    }
    return out;
  };

  // ── at work ──
  const workBlock = (w: number) => {
    const out: ReactNode[] = [
      <Box key="work-title" width={w}>
        {title(t('now.work.title'))}
      </Box>,
    ];
    for (const g of sameFolderGroups(live, now))
      out.push(
        <Box key={`same-${g.folder}`} width={w} flexDirection="column">
          {prose(`${mark('look', theme.plain)} ${t('home.conflict', { n: g.count, folder: folder(g.folder) })}`, w, 'ask')}
        </Box>,
      );
    for (const s of live) {
      const row = data.session(s.sessionId);
      const what = row?.title ?? row?.firstPrompt ?? s.sessionId.slice(0, 8);
      out.push(
        line(`live-${s.sessionId}`, t('now.work.sessionCard', { folder: folder(s.cwd) }), () => go(`memory/sessions/${s.sessionId}`), {
          lead: markNode('on', 'on'),
          text: `${folder(s.cwd)} · ${what}`,
          trailing: ago(s.aliveAt, now, lang),
          w,
        }),
      );
    }
    const openFlows = flows
      .filter((f) => f.status !== 'done' && f.status !== 'canceled')
      .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'));
    for (const f of openFlows.slice(0, 3))
      out.push(
        line(`flow-${f.id}`, t('now.work.flowCard'), () => go(`work/flows/${f.id}`), {
          lead: markNode(
            f.status === 'waiting' ? 'ask' : f.status === 'paused' ? 'off' : 'on',
            f.status === 'waiting' ? 'ask' : f.status === 'paused' ? 'off' : 'on',
          ),
          text: `${t('page.flows')}: ${flowTitle(f, 48)}`,
          trailing: ago(f.updatedAt, now, lang),
          w,
        }),
      );
    if (out.length === 1)
      out.push(
        <Box key="work-none" flexDirection="column" width={w}>
          {prose(t('now.work.none'), w)}
        </Box>,
      );
    return out;
  };

  // ── waiting for you, and today ──
  const actBlock = (w: number) => {
    const out: ReactNode[] = [
      <Box key="act-title" width={w}>
        {act.waiting ? title(t('ck.act.waiting', { n: act.waiting }), 'ask') : title(t('now.act.today'))}
      </Box>,
      // The day in numbers: what Claude wrote, and what the belt stopped or asked about.
      <Box key="act-day" width={w}>
        <Text {...muted} wrap="truncate-end">
          {[
            `${t('home.outputTokens')} ${totals ? compact(totals.output, lang) : '?'}`,
            `${t('home.blocked')} ${blocked}`,
            ...(asked ? [t('home.asked', { n: asked })] : []),
          ].join(' · ')}
        </Text>
      </Box>,
    ];
    for (const r of act.rows.slice(0, 4)) {
      const address = r.address;
      out.push(
        line(r.id, r.card, () => (address ? go(address) : go('activity/feed')), {
          lead: (
            <>
              <Text {...muted}>{`${r.time} `}</Text>
              {markNode(r.mark, r.meaning)}
            </>
          ),
          text: r.text,
          trailing: address ? mark('more', theme.plain) : '',
          w,
        }),
      );
    }
    if (!act.rows.length)
      out.push(
        <Box key="act-none" flexDirection="column" width={w}>
          {prose(t('now.act.none'), w)}
        </Box>,
      );
    out.push(
      line('all-activity', t('now.act.allCard'), () => go('activity/feed'), {
        lead: <Text color={theme.accent}>{mark('more', theme.plain)}</Text>,
        text: `${t('ck.act.all')}${mark('opener', theme.plain)}`,
        w,
      }),
    );
    return out;
  };

  // ── the quota ──
  const quotaBlock = (w: number) => {
    const resetW = Math.max(0, ...quota.meters.map((m) => textWidth(m.resets)));
    const meterW = Math.max(6, w - 8 - 6 - (resetW ? resetW + 1 : 0));
    const out: ReactNode[] = [
      <Box key="q-title" width={w}>
        {title(t('ck.quota.title'))}
      </Box>,
    ];
    for (const m of quota.meters) {
      items.push({ id: `quota-${m.id}`, card: m.card, press: () => go('quota/usage') });
      const focused = open && focus === `quota-${m.id}`;
      out.push(
        <Pressable
          key={`quota-${m.id}`}
          width={w}
          keep={focused}
          onPress={() => {
            setFocus(`quota-${m.id}`);
            go('quota/usage');
          }}
          describe={m.card}
        >
          {(hovered) => (
            <>
              <Text inverse={focused} underline={hovered}>
                {focused ? mark('focus', theme.plain) : ' '}
              </Text>
              <Box flexGrow={1} flexShrink={1}>
                {underlined(meter(kit, { label: m.label, labelWidth: 8, pct: m.pct, width: meterW, value: m.value, threshold: m.threshold }), hovered)}
              </Box>
              {m.resets ? <Text {...muted}>{` ${m.resets}`}</Text> : null}
            </>
          )}
        </Pressable>,
      );
    }
    if (quota.note)
      out.push(
        <Box key="q-note" flexDirection="column" width={w}>
          {prose(quota.note, w)}
        </Box>,
      );
    out.push(
      line('budget', t('now.budgetCard'), () => go('quota/limits'), {
        lead: <Text color={theme.accent}>{mark('more', theme.plain)}</Text>,
        text: `${quota.budget} · ${t('page.limits')}${mark('opener', theme.plain)}`,
        w,
      }),
    );
    return out;
  };

  // ── what people come here for: a row of openers under Mo, wrapping where the screen is narrow ──
  const goalRow = () => {
    const press = (id: GoalId, address: string | null) => () => {
      if (address) go(address);
      else setAllWhy((x) => !x);
    };
    return (
      <Box key="goals" width={width} flexDirection="row" flexWrap="wrap" marginTop={1}>
        {GOALS.map((goal) => {
          const id = `goal-${goal.id}`;
          const card = t(`now.goal.${goal.id}.card` as MessageKey);
          items.push({ id, card, press: press(goal.id, goal.address) });
          const focused = open && focus === id;
          const label =
            goal.id === 'why' && allWhy
              ? t('now.goal.why.hide')
              : `${t(`now.goal.${goal.id}` as MessageKey)}${goal.address ? mark('opener', theme.plain) : ''}`;
          return (
            <Pressable
              key={id}
              marginRight={2}
              keep={focused}
              onPress={() => {
                setFocus(id);
                press(goal.id, goal.address)();
              }}
              describe={card}
            >
              {(hovered) => (
                <Text color={theme.accent} inverse={focused} underline={hovered} bold>
                  {`${mark('more', theme.plain)} ${label}`}
                </Text>
              )}
            </Pressable>
          );
        })}
      </Box>
    );
  };

  // ── the keys: ↑↓ move among what can be pressed, Enter or Space presses, s shows the next session ──
  const move = (d: number) => {
    if (!items.length) return;
    const i = items.findIndex((x) => x.id === focus);
    const next = i < 0 ? (d > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + d));
    setFocus(items[next]!.id);
  };
  const press = () => {
    const it = items.find((x) => x.id === focus) ?? items[0];
    if (!it) return;
    setFocus(it.id);
    it.press();
  };
  useScreenKeys((input, key) => {
    if (key.upArrow || input === 'k' || (key.tab && key.shift)) move(-1);
    else if (key.downArrow || input === 'j' || key.tab) move(1);
    else if (key.return || input === ' ') press();
    else if (input === 's' && live.length > 1) setPick((p) => (p + 1) % live.length);
    else if (input === 'w') setAllWhy((x) => !x);
    else return false;
    return true;
  }, open);
  useHints(
    [
      { key: '↑↓', label: t('keys.move') },
      { key: 'Enter', label: t('now.key.press'), run: press },
      { key: 'w', label: t(allWhy ? 'now.key.whyHide' : 'now.key.why'), run: () => setAllWhy((x) => !x) },
      ...(live.length > 1 ? [{ key: 's', label: t('now.key.session'), run: () => setPick((p) => (p + 1) % live.length) }] : []),
    ],
    open,
  );

  // ── laid out: Mo and its line, then one column, or two side by side where there is room ──
  // Mo's line goes first in the keys' order, as it is drawn first; the rest follow as they are drawn.
  const moLine = g.address
    ? (() => {
        const address = g.address;
        const it: Item = { id: 'mo', card: t('now.mo.card', { place: placeName(address) }), press: () => go(address) };
        items.push(it);
        return it;
      })()
    : null;
  const goals = goalRow();
  // After a long gap, what happened while the person was away comes first (the morning report, docs/memory.md).
  const report = data.morning();
  const morning =
    report && report.lines.length ? (
      <Box key="morning" flexDirection="column" width={width} marginTop={1}>
        {title(t('morning.title', { since: dateTime(report.since, lang) }))}
        {report.lines.slice(0, 8).map((l, i) => (
          <Row key={i} label={l.label} width={Math.min(24, Math.max(...report.lines.map((x) => textWidth(x.label))) + 2)}>
            {l.text}
          </Row>
        ))}
      </Box>
    ) : null;
  const left = [...canBlock(colW), <Box key="gap1" height={1} />, ...workBlock(colW)];
  const right = [...actBlock(colW), <Box key="gap2" height={1} />, ...quotaBlock(colW)];
  // The line under Mo: what Mo says, or the card of what the keys rest on (the pointer's goes to the bar).
  const focusedCard = open && focus && focus !== 'mo' ? (items.find((x) => x.id === focus)?.card ?? null) : null;
  const moSays = t(`now.mo.${g.key}${g.key === 'session' && Number(g.params.n) > 1 ? '.many' : ''}` as MessageKey, g.params);
  const withMo = !theme.plain && !theme.noColor && config.modules.mascot && width >= MARK_W + 24;
  const sayW = width - (withMo ? MARK_W + 1 : 0);
  // Mo is two rows tall, its line three on a narrow screen; the height holds as the focus moves (a long card is cut
  // there, and said whole in the bar as the pointer rests on it).
  const sayRows = sayW >= 80 ? 2 : 3;
  const wrapped = wrapText(focusedCard ?? moSays, Math.max(8, sayW - 2), textWidth);
  const sayLines =
    wrapped.length > sayRows ? [...wrapped.slice(0, sayRows - 1), fitText(kit, wrapped.slice(sayRows - 1).join(' '), Math.max(8, sayW - 2))] : wrapped;
  const head = (
    <Box width={width} height={sayRows} flexShrink={0}>
      {withMo ? <MoPicture state={g.mo} size="small" still={still} /> : null}
      {withMo ? <Box width={1} /> : null}
      {moLine ? (
        <Pressable onPress={moLine.press} describe={moLine.card} keep={open && focus === 'mo'} flexDirection="column" width={sayW}>
          {(hovered) =>
            sayLines.map((l, i) => (
              <Text key={i} inverse={open && focus === 'mo'} underline={hovered} wrap="truncate-end">
                {l}
                {i === sayLines.length - 1 && !focusedCard ? <Text color={theme.accent}>{` ${mark('more', theme.plain)}`}</Text> : null}
              </Text>
            ))
          }
        </Pressable>
      ) : (
        <Box flexDirection="column" width={sayW}>
          {sayLines.map((l, i) => (
            <Text key={i} wrap="truncate-end">
              {l}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
  return (
    // Nothing in it shrinks: beside a list the pane cuts what does not fit (squeezed, Ink draws rows over each other).
    <Box flexDirection="column" width={width} flexShrink={0}>
      {head}
      {goals}
      {morning}
      {two ? (
        <Box marginTop={1} width={width}>
          <Box flexDirection="column" width={colW} flexShrink={0}>
            {left}
          </Box>
          <Box width={gap} flexShrink={0} />
          <Box flexDirection="column" width={colW} flexShrink={0}>
            {right}
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column" width={width}>
          {left}
          <Box height={1} />
          {right}
        </Box>
      )}
    </Box>
  );
}

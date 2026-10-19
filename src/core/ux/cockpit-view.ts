// SPDX-License-Identifier: Apache-2.0
/**
 * The cockpit drawn with the kit (src/core/ux/kit.ts): the data src/core/ux/cockpit.ts worked out, laid on the grid of
 * docs/design.md in one column beside the conversation, or in two or three side by side above the prompt. Every row
 * says itself to the pointer and to the keyboard: each pressable and each line of information carries a scope, and
 * its card is returned beside the drawing, for the host to show in the line the cockpit opens with. Pure: the host
 * makes the elements, the plugin gives what a press does.
 */
import { tIn, type MessageKey } from '../i18n/index.js';
import type { SettingPath } from './catalog.js';
import type { ActRow, CanRow, CockpitAct, CockpitData, NowRow, QuickRow } from './cockpit.js';
import { allowWarning } from './cockpit.js';
import { action, empty, fitText, markOf, meter, notice, opener, type Child, type KitHost } from './kit.js';
import { wrapText } from './text.js';
import { mark, type Meaning } from './tokens.js';

/** What the person has opened or started in the cockpit: kept by the plugin across redraws. */
export interface CockpitUi {
  /** The line of "Claude right now" opened to its reasons. */
  open: string | null;
  /** A permission waiting for its warning to be confirmed. */
  confirm: SettingPath | null;
  /** The last change made here, in words, while it can be taken back. */
  changed: string | null;
}

/** What each press does, given by the plugin; `elapsed` draws a call's running time where the surface can. */
export interface CockpitActs<N> {
  toggle(id: string): void;
  act(a: CockpitAct): void;
  allow(path: SettingPath): void;
  cancel(): void;
  undo(): void;
  view(agent: string): void;
  stop(agent: string): void;
  open(address: string): void;
  activity(): void;
  center(): void;
  elapsed?(since: number, at: number): N | null;
}

/** The columns the cockpit is laid in at a width: one beside the conversation, more above the prompt. */
export function cockpitColumns(width: number): 1 | 2 | 3 {
  return width >= 132 ? 3 : width >= 84 ? 2 : 1;
}

/** The space between two columns. */
const GAP = 3;

/**
 * The cockpit's body at `width`, and the card of every element that has one, by its scope (the pressable's id, or the
 * line's): what the line the cockpit opens with says while the pointer or the keyboard rests there.
 */
export function cockpitBody<N>(
  h: KitHost<N>,
  d: CockpitData,
  ui: CockpitUi,
  act: CockpitActs<N>,
  o: { width: number },
): { body: N; cards: Record<string, string> } {
  const cards: Record<string, string> = {};
  const lang = d.lang;
  const t = (k: string, p?: Record<string, string | number>) => tIn(lang, k as MessageKey, p);
  const cols = cockpitColumns(o.width);
  const cw = Math.max(24, Math.floor((o.width - GAP * (cols - 1)) / cols));
  const color = (m: Meaning) => (h.color(m) ? { color: h.color(m)! } : {});
  const muted = color('off');

  /** A pressable that says itself: its card under its scope. */
  const press = (id: string, describe: string, onPress: () => void, ...children: Child<N>[]) => {
    cards[id] = describe;
    return h.press({ id, scope: id, describe, onPress }, ...children);
  };
  /** A line of information that says itself to the pointer. */
  const info = (id: string, describe: string, ...children: Child<N>[]) => {
    cards[id] = describe;
    return h.box({ flexDirection: 'row', scope: id, width: cw }, ...children);
  };
  const title = (text: string, meaning?: Meaning) => h.text({ bold: true, ...(meaning ? color(meaning) : {}) }, text);
  /** A line on the grid: what it says, fitted, and what ends it flush right. */
  const line = (lead: N, trailing: string | N | null) =>
    h.box(
      { flexDirection: 'row', width: cw },
      h.box({ flexGrow: 1, flexShrink: 1 }, lead),
      trailing ? h.box({ flexShrink: 0, marginLeft: 1 }, typeof trailing === 'string' ? h.text(muted, trailing) : trailing) : null,
    );
  const fit = (s: string, room: number) => fitText(h, s, Math.max(4, room));
  const prose = (s: string, width: number, meaning?: Meaning) => wrapText(s, width, h.measure).map((l) => h.text(meaning ? color(meaning) : muted, l));
  const section = (...children: Child<N>[]) => h.box({ flexDirection: 'column', marginTop: 1, width: cw }, ...children);

  // ── Claude right now ──
  const canRow = (r: CanRow): N[] => {
    const id = `can-${r.id}`;
    const tail = r.locked ? mark('lock', h.plain) : mark('more', h.plain);
    const room = cw - 3 - h.measure(tail);
    const out: N[] = [
      line(
        press(id, r.card, () => act.toggle(r.id), markOf(h, r.mark, r.meaning), h.text({}, ` ${fit(r.text, room)}`)),
        tail,
      ),
    ];
    if (ui.open === r.id) {
      const body = [`${r.why.title}: ${r.why.now}.`, ...r.why.because];
      out.push(
        h.box(
          { flexDirection: 'column', marginLeft: 2, width: cw - 2 },
          ...body.flatMap((s) => prose(s, cw - 2)),
          r.act ? h.box({ marginTop: 0 }, actButton(`${id}-act`, r.act)) : null,
        ),
      );
    }
    return out;
  };
  /** A press that runs an action: an opener when it opens a window or a page, an action when it acts. */
  const actButton = (id: string, a: CockpitAct): N => {
    cards[id] = a.card;
    const p = { id, scope: id, describe: a.card, label: a.label, onPress: () => act.act(a) };
    return a.opens ? opener(h, p) : action(h, p);
  };
  const can = section(title(t('ck.can.title')), ...d.can.flatMap(canRow));

  // ── at work now ──
  const nowRow = (r: NowRow): N => {
    if (r.agent) {
      const agent = r.agent;
      const buttons = h.box(
        { flexDirection: 'row', flexShrink: 0 },
        action(h, { id: `view-${agent}`, scope: `view-${agent}`, label: t('ck.now.view'), describe: t('ck.now.viewCard'), onPress: () => act.view(agent) }),
        h.text({}, ' '),
        action(h, { id: `stop-${agent}`, scope: `stop-${agent}`, label: t('ck.now.stop'), describe: t('ck.now.stopCard'), onPress: () => act.stop(agent) }),
      );
      cards[`view-${agent}`] = t('ck.now.viewCard');
      cards[`stop-${agent}`] = t('ck.now.stopCard');
      const room = cw - 3 - h.measure(`[ ${t('ck.now.view')} ] [ ${t('ck.now.stop')} ]`) - 1;
      return info(
        r.id,
        r.card,
        h.box({ flexGrow: 1, flexShrink: 1 }, h.box({ flexDirection: 'row' }, markOf(h, r.mark, r.meaning), h.text({}, ` ${fit(r.text, room)}`))),
        buttons,
      );
    }
    const clock = r.since !== null && act.elapsed ? act.elapsed(r.since, d.at) : null;
    const room = cw - 3 - (clock ? 8 : 0);
    return info(
      r.id,
      r.card,
      h.box({ flexGrow: 1, flexShrink: 1 }, h.box({ flexDirection: 'row' }, markOf(h, r.mark, r.meaning), h.text({}, ` ${fit(r.text, room)}`))),
      clock ? h.box({ flexShrink: 0, marginLeft: 1 }, clock) : null,
    );
  };
  const now = section(title(t('ck.now.title')), ...d.now.map(nowRow));

  // ── what waits for you, and what happened ──
  const actRow = (r: ActRow): N => {
    const tail = r.address ? mark('more', h.plain) : '';
    const room = cw - h.measure(r.time) - 3 - (tail ? 2 : 0);
    const lead = [h.text(muted, `${r.time} `), markOf(h, r.mark, r.meaning), h.text({}, ` ${fit(r.text, room)}`)];
    const address = r.address;
    return address
      ? line(
          press(r.id, r.card, () => act.open(address), ...lead),
          tail,
        )
      : info(r.id, r.card, ...lead);
  };
  const activity = section(
    d.waiting > 0 ? title(t('ck.act.waiting', { n: d.waiting }), 'ask') : title(t('ck.act.title')),
    ...(d.activity.length ? d.activity.map(actRow) : [empty(h, { text: t('ck.act.empty'), width: cw })]),
    // The whole of it, in the control center, once there is anything: the cockpit shows the newest few.
    d.activity.length
      ? h.box(
          { marginTop: 0 },
          (() => {
            cards['all-activity'] = t('ck.act.allCard');
            return opener(h, {
              id: 'all-activity',
              scope: 'all-activity',
              describe: t('ck.act.allCard'),
              label: t('ck.act.all', { n: d.activityTotal }),
              onPress: () => act.activity(),
            });
          })(),
        )
      : null,
  );

  // ── the quota: the meters' values and their times end in one column (docs/design.md, Grid) ──
  const resetW = Math.max(0, ...d.quota.meters.map((m) => h.measure(m.resets)));
  const meterW = Math.max(6, cw - 8 - 5 - (resetW ? resetW + 1 : 0));
  const quota = section(
    title(t('ck.quota.title')),
    ...d.quota.meters.map((m) =>
      info(
        `quota-${m.id}`,
        m.card,
        h.box({ flexGrow: 1, flexShrink: 1 }, meter(h, { label: m.label, labelWidth: 8, pct: m.pct, width: meterW, value: m.value, threshold: m.threshold })),
        m.resets ? h.box({ flexShrink: 0, marginLeft: 1 }, h.text(muted, m.resets)) : null,
      ),
    ),
    ...(d.quota.note ? prose(d.quota.note, cw) : []),
    line(
      h.text(muted, fit(d.quota.budget, cw - h.measure(t('ck.quota.set')) - 3)),
      (() => {
        cards['budget'] = t('ck.quota.setCard');
        return opener(h, {
          id: 'budget',
          scope: 'budget',
          describe: t('ck.quota.setCard'),
          label: t('ck.quota.set'),
          onPress: () =>
            act.act({ kind: 'control', name: lang === 'tr' ? 'kota' : 'quota', label: t('ck.quota.set'), card: t('ck.quota.setCard'), opens: true }),
        });
      })(),
    ),
  );

  // ── quick settings: the controls of the session, both doors in one row ──
  const lw = Math.min(16, Math.max(...d.quick.map((q) => h.measure(q.label))) + 2);
  const quickRow = (q: QuickRow): N[] => {
    const id = `quick-${q.id}`;
    const allowed = !q.gate || q.gate.allowed;
    const label = fit(q.label, lw - 1);
    const pad = ' '.repeat(Math.max(1, lw - h.measure(label)));
    const value = fit(q.value, cw - lw - 4);
    const out: N[] = [
      line(
        press(
          id,
          q.card,
          () => act.act(q.press),
          h.text({}, `${label}${pad}`),
          markOf(h, q.on ? 'on' : 'off', q.on ? q.meaning : 'off'),
          h.text(allowed ? { bold: q.on } : muted, ` ${value}`),
        ),
        // Pressed, a window opens or the permission's warning shows: nothing changes yet (docs/design.md, Opener).
        q.press.opens ? mark('opener', h.plain) : null,
      ),
    ];
    if (q.gate && ui.confirm === q.gate.path) {
      const path = q.gate.path;
      cards[`${id}-yes`] = allowWarning(path, lang);
      cards[`${id}-no`] = t('ck.quick.cancelCard');
      out.push(
        h.box(
          { flexDirection: 'column', marginLeft: 2, width: cw - 2 },
          ...prose(`${mark('look', h.plain)} ${allowWarning(path, lang)}`, cw - 2, 'ask'),
          h.box(
            { flexDirection: 'row' },
            action(h, {
              id: `${id}-yes`,
              scope: `${id}-yes`,
              label: t('ck.quick.allowYes'),
              primary: true,
              describe: allowWarning(path, lang),
              onPress: () => act.allow(path),
            }),
            h.text({}, '  '),
            action(h, { id: `${id}-no`, scope: `${id}-no`, label: t('ck.quick.allowNo'), describe: t('ck.quick.cancelCard'), onPress: () => act.cancel() }),
          ),
        ),
      );
    }
    return out;
  };
  cards['center'] = t('ck.centerCard');
  const quick = section(
    title(t('ck.quick.title')),
    ...d.quick.flatMap(quickRow),
    h.box({ marginTop: 1 }, opener(h, { id: 'center', scope: 'center', describe: t('ck.centerCard'), label: t('ck.center'), onPress: () => act.center() })),
  );

  const changed = ui.changed
    ? (() => {
        cards['undo'] = t('ck.undoCard');
        return h.box(
          { width: o.width, marginTop: 1 },
          notice(h, {
            meaning: 'on',
            text: ui.changed,
            undo: { id: 'undo', scope: 'undo', label: t('ck.undo'), describe: t('ck.undoCard'), onPress: () => act.undo() },
          }),
        );
      })()
    : null;
  const column = (...sections: N[]) => h.box({ flexDirection: 'column', width: cw, flexShrink: 0 }, ...sections);
  const gap = () => h.box({ width: GAP, flexShrink: 0 });
  const laid =
    cols === 1
      ? column(can, now, activity, quota, quick)
      : cols === 2
        ? // Above the prompt few rows show: what Claude may do, what runs and the quota come first.
          h.box({ flexDirection: 'row' }, column(can, quick), gap(), column(now, quota, activity))
        : h.box({ flexDirection: 'row' }, column(can), gap(), column(now, activity), gap(), column(quota, quick));
  return { body: h.box({ flexDirection: 'column', width: o.width }, changed, laid), cards };
}

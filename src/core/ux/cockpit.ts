// SPDX-License-Identifier: Apache-2.0
/**
 * The cockpit (docs/design.md, The cockpit): the panel beside Claude Code's conversation that says, at a glance and in
 * words, what Claude may do now, what is at work, what waits for you, where the quota stands, and the controls whose
 * permission lives in the settings, both doors in one row. Everything it shows is worked out here by code from the
 * settings and the session, never guessed (rule 7): the reasons are the why engine's (src/core/ux/why.ts). The plugin
 * gathers the facts and publishes the result (src/mod/register.ts); the kit draws it (src/core/ux/cockpit-view.ts).
 * Pure: facts in, plain data out, so it can be kept in Claude Code's session state and drawn by any host.
 */
import type { Config } from '../config.js';
import type { Style } from '../controls.js';
import { effectiveAct, levelOf } from '../belt/rules.js';
import { tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { activityLines, type ActivityEvent } from './activity.js';
import { clock, dayClock, duration, percent, until } from '../format.js';
import type { MoState } from '../mo/art.js';
import { isRestricted, MODE_ICON, type WorkMode } from '../modes.js';
import { baseName } from '../paths.js';
import type { QuotaAssessment, QuotaWindow } from '../quota.js';
import { maskSecrets } from '../secrets/scan.js';
import type { ModSessionState } from '../session.js';
import { beltConfigOf } from '../settings-view.js';
import { confirmText, controlText, effectOf, nameOf, placeOf, SETTINGS, type ControlId, type SettingPath } from './catalog.js';
import { MEANING_MARK, type MarkName, type Meaning } from './tokens.js';
import { why, whyRule, type WhyAnswer, type WhyFacts } from './why.js';

/** The pane the cockpit is drawn in (`$.ui.open({ id })`). */
export const COCKPIT_PANE = 'cockpit';

/**
 * The columns the cockpit asks for beside a fullscreen conversation, and the rows above the prompt: few enough that
 * the strip keeps its rows under it (measured in Claude Code 2.1.303: 16 asked squeezed the strip to one row).
 */
export const COCKPIT_COLUMNS = 50;
export const COCKPIT_ROWS = 10;

/** Where the mode in force comes from: the session's own, a mode for this turn, a flow's step, Claude Code's plan mode. */
export type ModeFrom = 'session' | 'turn' | 'flow' | 'plan';

/** What the cockpit is worked out from. */
export interface CockpitFacts {
  /** The settings in effect. */
  config: Readonly<Config>;
  session: Pick<ModSessionState, 'mode' | 'interaction' | 'tainted' | 'frozen' | 'agents' | 'weeklyTarget' | 'wrapUp' | 'resumeAt'> | null;
  /** The mode in force now, and where it comes from. */
  mode: WorkMode;
  modeFrom: ModeFrom;
  style: Style;
  now: number;
  quota: QuotaAssessment;
  /** A model turn of the main conversation runs. */
  working: boolean;
  /** What Mo shows now (src/core/mo/state.ts). */
  mo: MoState;
  /** The main conversation's calls at work, oldest first. */
  calls: readonly { tool: string; what: string; at: number }[];
  /** The session's agents at work, as Claude Code lists them. */
  agents: readonly { id: string; label: string }[];
  /** The flow: its place ("2/4"), its step's name, and whether it waits for the person or is paused. */
  flow: { at: string; step: string; state: 'running' | 'approval' | 'paused' } | null;
  /** This session's events, as the activity reads them. */
  events: readonly ActivityEvent[];
}

/**
 * Something a press in the cockpit does, its words, and its card (what the press does, said before it does). `opens`:
 * a window or a page opens and nothing changes until you act there (drawn as an opener, `Label…`).
 */
export type CockpitAct = { label: string; card: string; opens: boolean } &
  /** A control of the strip, by its command's name: the same press as on the strip. */
  (
    | { kind: 'control'; name: string }
    /** A page of the control center, opened beside the session. */
    | { kind: 'center'; address: string }
    /** A permission in the settings turned on, after its warning: the first of a control's two doors. */
    | { kind: 'allow'; path: SettingPath }
  );

/** One line of "Claude right now": a mark, what Claude may do in words, the reasons behind it, and what changes it. */
export interface CanRow {
  id: 'write' | 'risky' | 'delete' | 'self' | 'style' | 'agents' | 'taint' | 'quota';
  mark: MarkName;
  meaning: Meaning;
  text: string;
  /** Locked: no setting changes it. */
  locked: boolean;
  /** The reasons (the why engine's answer), each one a sentence. */
  why: { title: string; now: string; because: string[] };
  /** The pointer's card: the reasons in one line. */
  card: string;
  act: CockpitAct | null;
}

/** One line of what is at work. `since` gives a call's running time, counted on the surface's own clock. */
export interface NowRow {
  id: string;
  mark: MarkName;
  meaning: Meaning;
  text: string;
  since: number | null;
  card: string;
  /** An agent at work: its conversation can be opened, and it can be stopped. */
  agent?: string;
}

/** One line of the session's activity. */
export interface ActRow {
  id: string;
  time: string;
  mark: MarkName;
  meaning: Meaning;
  text: string;
  card: string;
  /** The control center's page where its rule or setting is changed; null: a line to read, not to press. */
  address: string | null;
}

/** A meter of the quota: one of its two periods. */
export interface QuotaMeter {
  id: 'five' | 'week';
  label: string;
  pct: number;
  value: string;
  /** Where the work wraps up or stops: the threshold drawn on the track. */
  threshold: number | null;
  /** When the period starts over: "17:20". */
  resets: string;
  card: string;
}

export interface QuotaView {
  meters: QuotaMeter[];
  /** The weekly budget in words. */
  budget: string;
  /** Why there is no meter, or the reading's age: null when the meters say it all. */
  note: string | null;
}

/** A control of the session whose permission is a setting: both doors in one row. */
export interface QuickRow {
  id: 'agents' | 'freeze';
  label: string;
  /** How it is now, in words: on, off, a number, or not allowed yet. */
  value: string;
  on: boolean;
  meaning: Meaning;
  /** The permission it needs, and whether it is given. */
  gate: { path: SettingPath; allowed: boolean } | null;
  press: CockpitAct;
  card: string;
}

/** What the cockpit shows: plain data, kept in Claude Code's session state for the drawing to read. */
export interface CockpitData {
  lang: Lang;
  /** The plugin's clock when this was worked out: a call's running time counts on from here. */
  at: number;
  can: CanRow[];
  now: NowRow[];
  /** Lines of the activity that wait for the person. */
  waiting: number;
  activity: ActRow[];
  /** Lines in all, the quiet ones left out: more than shown means "All activity…" has more. */
  activityTotal: number;
  quota: QuotaView;
  quick: QuickRow[];
}

/** How many lines of the activity the cockpit shows. */
export const ACTIVITY_SHOWN = 5;

const t = (lang: Lang, key: string, p?: Record<string, string | number>) => tIn(lang, key as MessageKey, p);

/** The cockpit's facts, as the why engine reads them. */
function whyFacts(f: CockpitFacts): WhyFacts {
  return { config: f.config, session: f.session, now: f.now };
}

/**
 * A why answer as a row's reasons, and as its card: "Mode: 📐 plan. You chose it on the strip." What the row adds
 * (what changes it, what still holds) follows the chain.
 */
function reasons(a: WhyAnswer, lang: Lang, extra: readonly string[] = []): { why: CanRow['why']; card: string } {
  const because = [...a.because.map((r) => sentence(r.text, lang)), ...extra];
  return {
    why: { title: a.title, now: a.now, because },
    card: [`${a.title}: ${a.now}.`, ...because].join(' ').replace(/\.\./g, '.') + ` ${t(lang, 'ck.can.pressMore')}`,
  };
}

/** A fragment as a sentence: its first letter up, a full stop at its end. */
export function sentence(s: string, lang: Lang): string {
  const x = s.trim();
  if (!x) return x;
  const first = x[0]!.toLocaleUpperCase(lang);
  const body = first + x.slice(1);
  return /[.!?…]$/.test(body) ? body : `${body}.`;
}

function modeLabel(m: WorkMode, lang: Lang): string {
  return `${MODE_ICON[m] ? `${MODE_ICON[m]} ` : ''}${t(lang, `mode.name.${m}`)}`;
}

/** A press that does what a control of the strip does. */
function control(name: string, label: string, card: string, opens: boolean): CockpitAct {
  return { kind: 'control', name, label, card, opens };
}

/**
 * "Claude right now": what Claude may do in this session, each line worked out from the mode in force, the way of
 * working, the safety belt's rules, a freeze, the agents, outside content read, and the quota. A line names
 * what Claude does, never the mechanism; its reasons are the chain of settings and choices behind it.
 */
export function canNow(f: CockpitFacts, lang: Lang): CanRow[] {
  const wf = whyFacts(f);
  const rows: CanRow[] = [];
  const add = (r: Omit<CanRow, 'why' | 'card' | 'locked'> & { locked?: boolean }, a: WhyAnswer, extra: readonly string[] = []) =>
    rows.push({ ...r, locked: r.locked ?? false, ...reasons(a, lang, extra) });
  const modes = f.config.modules.modes;
  const restricted = modes && isRestricted(f.mode);
  // The mode in force, and why: the session's own as the why engine says it, or what stands above it (a mode for this
  // message, a flow's step, a run still planning, Claude Code's plan mode), said by its source.
  const sessionMode = why('mode', wf, lang);
  const mode: WhyAnswer = !modes
    ? sessionMode
    : {
        ...sessionMode,
        now: modeLabel(f.mode, lang),
        because: f.modeFrom === 'session' ? sessionMode.because : [{ text: t(lang, `ck.r.mode.${f.modeFrom}`, { mode: modeLabel(f.mode, lang) }) }],
      };

  // What it may change.
  const frozen = f.session?.frozen ?? null;
  if (restricted) add({ id: 'write', mark: 'bad', meaning: 'bad', text: t(lang, `ck.can.write.${f.mode}`), act: null }, mode, [t(lang, 'ck.r.pickMode')]);
  else if (frozen)
    add(
      {
        id: 'write',
        mark: 'ok',
        meaning: 'on',
        text: t(lang, 'ck.can.write.frozen', { folder: baseName(frozen) }),
        act: control(lang === 'tr' ? 'dondur' : 'freeze', t(lang, 'ck.act.unfreeze'), t(lang, 'ux.ctl.freeze.pressOn'), false),
      },
      why('freeze', wf, lang),
    );
  else add({ id: 'write', mark: 'ok', meaning: 'on', text: t(lang, 'ck.can.write.yes'), act: null }, mode, [t(lang, 'ck.r.beltWatches')]);

  // Risky steps: the safety belt asks, or in full autonomy leaves them to you.
  const level = levelOf(f.style);
  if (restricted) add({ id: 'risky', mark: 'bad', meaning: 'bad', text: t(lang, 'ck.can.risky.mode'), act: null }, mode);
  else if (level === 'full') add({ id: 'risky', mark: 'none', meaning: 'off', text: t(lang, 'ck.can.risky.full'), act: null }, why('style', wf, lang));
  else add({ id: 'risky', mark: 'ask', meaning: 'ask', text: t(lang, 'ck.can.risky.ask'), act: null }, why('belt', wf, lang));

  // Deleting outside the project: one rule of the belt, the question a person asks first (docs/design.md, test 10).
  const delId = 'fs.delete-outside-project';
  const act = effectiveAct(delId, level, beltConfigOf(f.config as Config));
  const rule: CockpitAct = {
    kind: 'center',
    address: `protection/rules/${delId}`,
    label: t(lang, 'ck.act.rule'),
    card: t(lang, 'ck.act.ruleCard'),
    opens: true,
  };
  if (restricted) add({ id: 'delete', mark: 'bad', meaning: 'bad', text: t(lang, 'ck.can.delete.no'), act: null }, mode);
  else if (act === 'self' && level === 'full')
    add({ id: 'delete', mark: 'none', meaning: 'off', text: t(lang, 'ck.can.delete.left'), act: rule }, whyRule(delId, wf, lang));
  else if (act === 'self' || act === 'stop')
    add({ id: 'delete', mark: 'bad', meaning: 'bad', text: t(lang, 'ck.can.delete.no'), act: rule }, whyRule(delId, wf, lang));
  else if (act === 'ask') add({ id: 'delete', mark: 'ask', meaning: 'ask', text: t(lang, 'ck.can.delete.ask'), act: rule }, whyRule(delId, wf, lang));
  // Off, or a note only: it deletes without asking; a protection lowered by the person needs a look.
  else
    add(
      { id: 'delete', mark: 'look', meaning: 'ask', text: t(lang, act === 'note' ? 'ck.can.delete.warn' : 'ck.can.delete.yes'), act: rule },
      whyRule(delId, wf, lang),
    );

  // The protection protects itself: locked rules no setting lifts.
  rows.push({
    id: 'self',
    mark: 'bad',
    meaning: 'bad',
    text: t(lang, 'ck.can.self'),
    locked: true,
    why: { title: t(lang, 'ck.self.title'), now: t(lang, 'ck.self.now'), because: [t(lang, 'ck.r.locked')] },
    card: `${t(lang, 'ck.self.title')}: ${t(lang, 'ck.self.now')}. ${t(lang, 'ck.r.locked')}`,
    act: null,
  });

  // The way of working: one step and wait, on without asking, or on without asking anything.
  const styleMark: Record<Style, MarkName> = { manual: 'none', autonomous: 'ok', full: 'ok' };
  add(
    { id: 'style', mark: styleMark[f.style], meaning: f.style === 'manual' ? 'off' : 'on', text: t(lang, `ck.can.style.${f.style}`), act: null },
    why('style', wf, lang),
    [t(lang, 'ck.r.pickStyle')],
  );

  // Helper agents.
  const a = f.session?.agents;
  const agentsAct = control(lang === 'tr' ? 'ajan' : 'parallel', t(lang, 'ck.act.agents'), controlText('agents', 'press', lang), true);
  if (!f.config.agents.enabled) add({ id: 'agents', mark: 'ok', meaning: 'on', text: t(lang, 'ck.can.agents.claude'), act: null }, why('agents', wf, lang));
  else if (a?.ultracode)
    add({ id: 'agents', mark: 'ok', meaning: 'agents', text: t(lang, 'ck.can.agents.ultracode'), act: null }, why('agents', wf, lang), [
      t(lang, 'ck.r.ultracode'),
    ]);
  else if (!a || a.mode === 'off')
    add(
      { id: 'agents', mark: 'bad', meaning: 'off', text: t(lang, f.config.agents.helpers ? 'ck.can.agents.offHelpers' : 'ck.can.agents.off'), act: agentsAct },
      why('agents', wf, lang),
    );
  else
    add(
      {
        id: 'agents',
        mark: 'ok',
        meaning: 'agents',
        text: t(lang, a.mode === 'free' ? 'ck.can.agents.free' : 'ck.can.agents.assigned', { n: a.n }),
        act: agentsAct,
      },
      why('agents', wf, lang),
    );

  // Outside content read: what an instruction hidden in it would ask for is asked from then on.
  if (f.session?.tainted)
    add({ id: 'taint', mark: 'ask', meaning: 'ask', text: t(lang, 'ck.can.taint'), act: null }, why('taint', wf, lang), [t(lang, 'ck.r.taintClean')]);

  // The quota: near its limit the work wraps up; at it, the work stops until the period starts over.
  if (f.config.modules.quota && f.quota.usable && f.quota.level !== 'ok') {
    const stop = f.quota.level === 'stop';
    add(
      {
        id: 'quota',
        mark: stop ? 'bad' : 'danger',
        meaning: stop ? 'bad' : 'ask',
        text:
          stop && f.quota.resumeAt !== null
            ? t(lang, 'ck.can.quota.stop', { at: clock(f.quota.resumeAt, lang) })
            : t(lang, stop ? 'ck.can.quota.stopNoTime' : 'ck.can.quota.wrapUp'),
        act: control(lang === 'tr' ? 'kota' : 'quota', t(lang, 'ck.act.budget'), controlText('quota', 'press', lang), true),
      },
      why('quota', wf, lang),
    );
  }
  return rows;
}

/** A call in a few words for the line of what is at work: the command, the file, the pattern; secrets masked. */
export function callLine(tool: string, input: Readonly<Record<string, unknown>>, max = 80): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const firstLine = (x: string) =>
    x
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? '';
  const file = s('file_path') || s('notebook_path') || s('path');
  const what =
    firstLine(s('command')) ||
    (file ? (file.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? file) : '') ||
    s('pattern') ||
    s('url') ||
    s('query') ||
    s('description') ||
    s('skill');
  const masked = maskSecrets(what).replace(/\s+/g, ' ').trim();
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}

/** What is at work: Claude's state in words, the call running (its time counts on the surface), the agents, a flow, a run. */
export function nowRows(f: CockpitFacts, lang: Lang): NowRow[] {
  const rows: NowRow[] = [];
  const call = f.calls.at(-1);
  const state = f.mo;
  const marks: Record<MoState, [MarkName, Meaning]> = {
    idle: ['off', 'off'],
    think: ['on', 'on'],
    work: ['on', 'on'],
    agent: ['agents', 'agents'],
    wait: ['ask', 'ask'],
    done: ['ok', 'on'],
    block: ['bad', 'bad'],
    error: ['bad', 'bad'],
    stopped: ['off', 'off'],
    auto: ['action', 'on'],
    low: ['danger', 'ask'],
  };
  const [mark, meaning] = marks[state];
  // A call at work is said by itself, whatever Mo shows beside it: what runs, and since when.
  if (call) {
    const more = f.calls.length > 1 ? ` ${t(lang, 'ck.now.more', { n: f.calls.length - 1 })}` : '';
    rows.push({
      id: 'call',
      mark: 'on',
      meaning: 'on',
      text: `${call.tool}${call.what ? ` · ${call.what}` : ''}${more}`,
      since: call.at,
      card: t(lang, 'ck.now.callCard', { tool: call.tool, at: clock(call.at, lang) }),
    });
  } else rows.push({ id: 'state', mark, meaning, text: t(lang, `ck.now.${state}`), since: null, card: t(lang, `ck.now.card.${state}`) });
  for (const a of f.agents)
    rows.push({ id: `agent-${a.id}`, mark: 'agents', meaning: 'agents', text: a.label, since: null, card: t(lang, 'ck.now.agentCard'), agent: a.id });
  if (f.flow) {
    const key = f.flow.state === 'approval' ? 'ck.now.flowApproval' : f.flow.state === 'paused' ? 'ck.now.flowPaused' : 'ck.now.flow';
    rows.push({
      id: 'flow',
      mark: f.flow.state === 'approval' ? 'ask' : f.flow.state === 'paused' ? 'off' : 'on',
      meaning: f.flow.state === 'approval' ? 'ask' : f.flow.state === 'paused' ? 'off' : 'on',
      text: t(lang, key, { at: f.flow.at, step: f.flow.step }),
      since: null,
      card: t(lang, 'ck.now.flowCard'),
    });
  }
  return rows;
}

/** The session's activity: what waits for you first, then the newest; each line with why, and where it is changed. */
export function actRows(f: CockpitFacts, lang: Lang): { rows: ActRow[]; waiting: number; total: number } {
  const lines = activityLines(f.events, lang, f.now);
  const rows = lines.slice(0, ACTIVITY_SHOWN).map((l, i) => {
    const card = [l.why ? sentence(t(lang, 'ck.act.why', { why: l.why }), lang) : t(lang, 'ck.act.noWhy'), l.address ? t(lang, 'ck.act.goes') : '']
      .filter(Boolean)
      .join(' ');
    return { id: `act-${i}`, time: clock(l.at, lang), mark: MEANING_MARK[l.meaning], meaning: l.meaning, text: l.text, card, address: l.address };
  });
  return { rows, waiting: lines.filter((l) => l.cls === 'waiting').length, total: lines.length };
}

/** The quota's two periods as meters, each with where the work wraps up, and the weekly budget in words. */
export function quotaView(f: CockpitFacts, lang: Lang): QuotaView {
  const q = f.quota;
  const target = f.session?.weeklyTarget ?? null;
  const budget =
    target !== null
      ? t(lang, 'ck.quota.budget', { target: percent(target, lang) })
      : t(lang, 'ck.quota.noBudget', { limit: percent(f.config.quota.defaultWeeklyTarget, lang) });
  if (!q.five && !q.week) return { meters: [], budget, note: t(lang, 'ck.quota.none') };
  const meter = (w: QuotaWindow | null, id: 'five' | 'week', threshold: number): QuotaMeter | null => {
    if (!w) return null;
    const resets = w.resetsAt === null ? '' : id === 'five' ? clock(w.resetsAt, lang) : dayClock(w.resetsAt, lang);
    const left = w.resetsAt !== null ? until(w.resetsAt, f.now, lang) : '?';
    return {
      id,
      label: t(lang, `ck.quota.${id}`),
      pct: w.used,
      value: percent(Math.round(w.used), lang),
      threshold: f.config.modules.quota ? threshold : null,
      resets,
      card: t(lang, `ck.quota.${id}Card`, {
        used: percent(Math.round(w.used), lang),
        resets: resets || '?',
        left,
        at: percent(threshold, lang),
      }),
    };
  };
  const weekAt = target ?? f.config.quota.defaultWeeklyTarget;
  const meters = [meter(q.five, 'five', f.config.quota.fiveHourWrapUp), meter(q.week, 'week', weekAt)].filter((m): m is QuotaMeter => m !== null);
  const note = q.stale && q.ageMinutes !== null ? t(lang, 'ck.quota.stale', { age: duration(q.ageMinutes * 60_000, lang) }) : null;
  return { meters, budget, note };
}

/** A control's permission once given: where it is, and where it is taken back. Not given, the row's value says so. */
function gateCard(path: SettingPath, allowed: boolean, lang: Lang): string | null {
  return allowed ? t(lang, 'ck.quick.allowed', { name: nameOf(path, lang), place: placeOf(SETTINGS[path as keyof typeof SETTINGS].page, lang) }) : null;
}

/** A control's card: what it is, how it is now, what a press does, how it is taken back, and its permission. */
function quickCard(id: ControlId, now: string, press: string, lang: Lang, gate: string | null): string {
  return [controlText(id, 'what', lang), `${t(lang, 'ck.quick.now')}: ${now}.`, `${t(lang, 'ck.quick.press')}: ${press}`, gate ?? '']
    .map((s) => s.trim())
    .filter(Boolean)
    .map((x) => sentence(x, lang))
    .join(' ');
}

/**
 * The controls of the session whose permission is a setting (docs/design.md: no hidden second door): the agents,
 * and the freeze. Not allowed yet, the row says so and a press asks to allow it, with the
 * setting's own warning; allowed, a press is the strip's.
 */
export function quickRows(f: CockpitFacts, lang: Lang): QuickRow[] {
  const s = f.session;
  const rows: QuickRow[] = [];
  const allow = (path: SettingPath): CockpitAct => ({ kind: 'allow', path, label: t(lang, 'ck.act.allow'), card: allowWarning(path, lang), opens: true });

  // Parallel agents.
  {
    const allowed = f.config.agents.enabled;
    const a = s?.agents;
    const on = allowed && !!a && (a.mode !== 'off' || a.ultracode);
    const value = !allowed
      ? t(lang, 'ck.quick.agentsClaude')
      : a?.ultracode
        ? t(lang, 'ck.quick.agentsUltracode')
        : a && a.mode !== 'off'
          ? t(lang, a.mode === 'free' ? 'ck.quick.agentsFree' : 'ck.quick.agentsAssigned', { n: a.n })
          : t(lang, 'ck.quick.agentsNone');
    rows.push({
      id: 'agents',
      label: t(lang, 'ck.quick.agents'),
      value,
      on,
      meaning: on ? 'agents' : 'off',
      gate: { path: 'agents.enabled', allowed },
      press: allowed
        ? control(lang === 'tr' ? 'ajan' : 'parallel', t(lang, 'ck.quick.agents'), controlText('agents', 'press', lang), true)
        : allow('agents.enabled'),
      card: quickCard(
        'agents',
        value,
        allowed ? controlText('agents', 'press', lang) : allowText('agents.enabled', lang),
        lang,
        gateCard('agents.enabled', allowed, lang),
      ),
    });
  }

  // The freeze: no permission; it takes this folder, and ends with a press.
  {
    const frozen = s?.frozen ?? null;
    const value = frozen ? t(lang, 'ck.quick.frozen', { folder: baseName(frozen) }) : t(lang, 'ck.quick.off');
    rows.push({
      id: 'freeze',
      label: t(lang, 'ck.quick.freeze'),
      value,
      on: !!frozen,
      meaning: frozen ? 'on' : 'off',
      gate: null,
      press: control(
        lang === 'tr' ? 'dondur' : 'freeze',
        t(lang, 'ck.quick.freeze'),
        frozen ? t(lang, 'ux.ctl.freeze.pressOn') : t(lang, 'ck.quick.freezePress'),
        false,
      ),
      card: quickCard('freeze', value, frozen ? t(lang, 'ux.ctl.freeze.pressOn') : t(lang, 'ck.quick.freezePress'), lang, null),
    });
  }
  return rows;
}

/** What a press on a control not allowed yet does: its warning, before anything changes. */
function allowText(path: SettingPath, lang: Lang): string {
  return t(lang, 'ck.quick.allowPress', { name: nameOf(path, lang) });
}

/** The permissions the cockpit offers to allow, by the words of their warnings. */
const ALLOW_WORDS: Readonly<Record<string, string>> = { 'agents.enabled': 'agents' };

/**
 * The warning shown before a permission is turned on: what allowing it means, said for a press (the control center's
 * own warning asks for a second Enter). Another setting gets its catalog's warning and effect.
 */
export function allowWarning(path: SettingPath, lang: Lang): string {
  const own = ALLOW_WORDS[path];
  return own ? t(lang, `ck.allow.${own}`) : [confirmText(path, true, lang), effectOf(path, true, lang)].filter(Boolean).join(' ');
}

/** Everything the cockpit shows, worked out once from the facts. */
export function cockpitData(f: CockpitFacts, lang: Lang): CockpitData {
  const act = actRows(f, lang);
  return {
    lang,
    at: f.now,
    can: canNow(f, lang),
    now: nowRows(f, lang),
    waiting: act.waiting,
    activity: act.rows,
    activityTotal: act.total,
    quota: quotaView(f, lang),
    quick: quickRows(f, lang),
  };
}

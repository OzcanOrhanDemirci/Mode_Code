// SPDX-License-Identifier: Apache-2.0
/**
 * The controls of a session: its mode and its way of working, the heart of the tool, always in view on the
 * strip above the prompt and changed in three ways that do the same thing: a slash command (`/3`), a press
 * on the strip, or a keyword typed as the whole message ("plan"). Commands that need a value (`/devam`,
 * `/kota`, `/6`, `/tam-otonom`) ask for it when it is not given and apply it at once when it is. `/00` closes the
 * session cleanly (src/core/close.ts). Pure: the plugin (src/mod/register.ts) asks, draws and applies.
 */
import type { KeywordMatch, KeywordKind, FlowVariant } from './keywords.js';
import type { Interaction, ModSessionState } from './session.js';
import { MODE_ICON, type WorkMode } from './modes.js';
import { baseName, pathKey, type Platform } from './paths.js';
import { fold } from './text.js';
import { AGENTS_ICON, stripAgents, type AgentsState } from './agents.js';
import { tIn, type Lang, type MessageKey } from './i18n/index.js';
import { mark } from './ux/tokens.js';

export type Style = 'manual' | 'autonomous' | 'full';
export type StartableVariant = Exclude<FlowVariant, 'cancel'>;

export type ControlAction =
  | { kind: 'mode'; mode: WorkMode }
  | { kind: 'style'; style: 'manual' | 'autonomous' }
  | { kind: 'fullAuto' }
  | { kind: 'flow' }
  | { kind: 'cockpit' }
  | { kind: 'continue' }
  | { kind: 'quota' }
  | { kind: 'close' }
  | { kind: 'freeze' }
  | { kind: 'agents' }
  | { kind: 'why' };

/** Every slash command, by name: a number for everything on the strip, a word for those that take a value and for closing. */
export const COMMANDS: readonly { name: string; action: ControlAction }[] = [
  { name: '1', action: { kind: 'mode', mode: 'chat' } },
  { name: '2', action: { kind: 'mode', mode: 'research' } },
  { name: '3', action: { kind: 'mode', mode: 'plan' } },
  { name: '4', action: { kind: 'mode', mode: 'code' } },
  { name: '5', action: { kind: 'mode', mode: 'free' } },
  { name: '6', action: { kind: 'flow' } },
  { name: '7', action: { kind: 'style', style: 'manual' } },
  { name: '8', action: { kind: 'style', style: 'autonomous' } },
  { name: '0', action: { kind: 'cockpit' } },
  { name: '00', action: { kind: 'close' } },
  { name: 'devam', action: { kind: 'continue' } },
  { name: 'continue', action: { kind: 'continue' } },
  { name: 'kota', action: { kind: 'quota' } },
  { name: 'quota', action: { kind: 'quota' } },
  { name: 'akis', action: { kind: 'flow' } },
  { name: 'flow', action: { kind: 'flow' } },
  // Full autonomy has no number: a special way of working, shown only once turned on (Automation).
  { name: 'tam-otonom', action: { kind: 'fullAuto' } },
  { name: 'full-auto', action: { kind: 'fullAuto' } },
  // Freezing the edits to one folder takes a folder, so a word: on the strip only while it holds.
  { name: 'dondur', action: { kind: 'freeze' } },
  { name: 'freeze', action: { kind: 'freeze' } },
  // Parallel agents (core/agents.ts): on the strip once turned on (Automation), set by the person alone. Not /agents:
  // that is Claude Code's own command for agent definitions.
  { name: 'ajan', action: { kind: 'agents' } },
  { name: 'parallel', action: { kind: 'agents' } },
  // Why something is as it is (src/core/ux/why.ts): shows, changes nothing.
  { name: 'neden', action: { kind: 'why' } },
  { name: 'why', action: { kind: 'why' } },
  { name: 'kapat', action: { kind: 'close' } },
  { name: 'close', action: { kind: 'close' } },
];

/** The number of the command that does `action` on the strip. */
export function digitOf(action: ControlAction): string {
  return COMMANDS.find((c) => /^\d+$/.test(c.name) && JSON.stringify(c.action) === JSON.stringify(action))!.name;
}

/** The command that does `action`: its number, or for one without (full autonomy) its word in `lang`. */
export function commandOf(action: ControlAction, lang: Lang): string {
  if (action.kind === 'fullAuto') return lang === 'tr' ? 'tam-otonom' : 'full-auto';
  if (action.kind === 'freeze') return lang === 'tr' ? 'dondur' : 'freeze';
  if (action.kind === 'agents') return lang === 'tr' ? 'ajan' : 'parallel';
  if (action.kind === 'why') return lang === 'tr' ? 'neden' : 'why';
  return digitOf(action);
}

export function commandNamed(name: string): ControlAction | null {
  return COMMANDS.find((c) => c.name === name)?.action ?? null;
}

const MODE_KIND: Record<WorkMode, KeywordKind> = { chat: 'chat', research: 'research', plan: 'plan', code: 'code', free: 'free' };

/**
 * The keyword a mode or style command stands for, so it goes through the same path a typed keyword does:
 * the same state change, the same note for the model, the same event.
 */
export function actionKeyword(action: Extract<ControlAction, { kind: 'mode' | 'style' }>, lang: Lang, via: 'command' | 'strip'): KeywordMatch {
  const kind: KeywordKind = action.kind === 'mode' ? MODE_KIND[action.mode] : action.style === 'manual' ? 'manualStyle' : 'autonomous';
  const name = action.kind === 'mode' ? tIn(lang, `mode.name.${action.mode}` as MessageKey) : tIn(lang, `kw.kind.${kind}` as MessageKey);
  return { kind, lang, text: via === 'command' ? `/${digitOf(action)}` : name, standalone: true, via };
}

/** The way of working a session shows: the default reads as manual (Claude does what it is asked and stops). */
export function styleOf(interaction: Interaction, runAttached: boolean): Style {
  if (runAttached || interaction === 'full') return 'full';
  return interaction === 'autonomous' ? 'autonomous' : 'manual';
}

// ── values ──

export interface Budget {
  n: number;
  plus: boolean;
}

/** "29", "+5", "kota 29", "quota +5": a weekly budget, or null. */
export function parseBudget(text: string): Budget | null {
  const m = /^(?:(?:kota|quota)\s*)?(\+?)\s*(\d{1,3})\s*%?$/i.exec(fold(text).trim());
  if (!m) return null;
  const n = parseInt(m[2]!, 10);
  return n >= 0 && n <= 100 ? { n, plus: m[1] === '+' } : null;
}

/**
 * Why a weekly budget cannot be set now, as its message and values; null when it can. Points above now need a
 * reading of the week, and a number the week has already passed would stop the work at once.
 */
export function budgetProblem(budget: Budget | null, week: number | null): { key: MessageKey; params?: Record<string, number> } | null {
  if (!budget) return { key: 'ctl.quota.bad' };
  if (budget.plus && week === null) return { key: 'ctl.quota.noReading' };
  if (!budget.plus && week !== null && week >= budget.n) return { key: 'ctl.quota.past', params: { week, target: budget.n } };
  return null;
}

/** A budget at either end of the arguments ("kota +10 <task>", "<task> kota +10"), and the rest. */
export function splitBudget(args: string): { budget: Budget | null; rest: string } {
  const text = args.trim();
  const head = /^(kota|quota)\s*(\+?\d{1,3})\s*%?(?:\s+|$)/i.exec(text);
  if (head) return { budget: parseBudget(head[2]!), rest: text.slice(head[0].length).trim() };
  const tail = /(?:^|\s+)(kota|quota)\s*(\+?\d{1,3})\s*%?$/i.exec(text);
  if (tail) return { budget: parseBudget(tail[2]!), rest: text.slice(0, tail.index).trim() };
  return { budget: null, rest: text };
}

// ── what to continue ──

export interface ContinueChoice {
  /** 1-based, as the list shows it and `/devam <n>` takes it. */
  n: number;
  label: string;
  /** The folder, when known (a registered project may have none). */
  folder: string | null;
  /** The registered project's id; null for a folder that is not registered. */
  project: string | null;
  /** When work last happened there (epoch ms), 0 when unknown. */
  at: number;
}

/**
 * Everything the person may want to continue: the registered projects first, then every folder Claude Code
 * was used in, newest first, each folder once ("so that nobody fails to find theirs", the person, 2026-10-13).
 */
export function continueChoices(input: {
  projects: readonly { id: string; names: readonly string[]; path?: string | null }[];
  folders: readonly { path: string; at: number }[];
  platform: Platform;
}): ContinueChoice[] {
  const key = (p: string) => pathKey(p, input.platform);
  const at = new Map<string, number>();
  for (const f of input.folders) at.set(key(f.path), Math.max(at.get(key(f.path)) ?? 0, f.at));
  const registered = input.projects.map((p) => ({
    label: p.names[0] ?? p.id,
    folder: p.path ?? null,
    project: p.id,
    at: p.path ? (at.get(key(p.path)) ?? 0) : 0,
  }));
  const taken = new Set(registered.flatMap((r) => (r.folder ? [key(r.folder)] : [])));
  const seen = new Set<string>();
  const folders = [...input.folders]
    .sort((a, b) => b.at - a.at)
    .filter((f) => {
      const k = key(f.path);
      if (taken.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((f) => ({ label: baseName(f.path) || f.path, folder: f.path, project: null, at: at.get(key(f.path)) ?? f.at }));
  return [...registered.sort((a, b) => b.at - a.at || a.label.localeCompare(b.label, 'en')), ...folders].map((c, i) => ({ ...c, n: i + 1 }));
}

/**
 * The choice `text` names: its number, a project's name or id, or a folder's name or path; a name that
 * starts several is ambiguous. `matches` lists what fits when there is not exactly one.
 */
export function pickChoice(
  choices: readonly ContinueChoice[],
  text: string,
  names: (c: ContinueChoice) => readonly string[] = (c) => [c.label],
): { choice: ContinueChoice | null; matches: ContinueChoice[] } {
  const t = fold(text).trim();
  if (!t) return { choice: null, matches: [] };
  if (/^\d+$/.test(t)) {
    const c = choices.find((x) => x.n === parseInt(t, 10)) ?? null;
    return { choice: c, matches: c ? [c] : [] };
  }
  const exact = choices.filter((c) => [...names(c), c.project ?? '', c.folder ?? ''].some((n) => n && fold(n) === t));
  if (exact.length === 1) return { choice: exact[0]!, matches: exact };
  const folderEnd = (c: ContinueChoice) => (c.folder ? fold(baseName(c.folder)) : '');
  const prefix = choices.filter((c) => [...names(c), folderEnd(c)].some((n) => n && fold(n).startsWith(t)));
  if (prefix.length === 1) return { choice: prefix[0]!, matches: prefix };
  return { choice: null, matches: exact.length ? exact : prefix };
}

// ── flows ──

export const FLOW_PRESETS: readonly StartableVariant[] = ['full', 'plan', 'research', 'researchPlan'];

/** The words that start a flow of `variant` at the end of a message, as the person would type them. */
export function flowPhrase(variant: StartableVariant, lang: Lang): string {
  const words = {
    tr: { full: 'akış', plan: 'akış plan', research: 'akış araştırma', researchPlan: 'akış araştırma plan' },
    en: { full: 'flow', plan: 'flow plan', research: 'flow research', researchPlan: 'flow research plan' },
  } as const;
  return words[lang][variant];
}

/** A flow preset on one line: "🔍 research ▶ 📐 plan → ⏸ approval → 🔨 code". */
export function flowPresetLine(variant: StartableVariant, lang: Lang): string {
  const step = (k: string) => tIn(lang, `flow.step.name.${k}` as MessageKey);
  switch (variant) {
    case 'full':
      return `${step('research')} ▶ ${step('plan')} → ${step('approve')} → ${step('code')}`;
    case 'plan':
      return `${step('plan')} → ${step('approve')} → ${step('code')}`;
    case 'research':
      return tIn(lang, 'ctl.flow.researchOnly', { research: step('research') });
    case 'researchPlan':
      return tIn(lang, 'ctl.flow.noCode', { steps: `${step('research')} ▶ ${step('plan')}` });
  }
}

/** The words that start a full-autonomy run with `budget`, at the end of a task. */
export function fullAutoPhrase(budget: Budget, lang: Lang): string {
  return `${lang === 'tr' ? 'tam otonom kota' : 'full auto quota'} ${budget.plus ? '+' : ''}${budget.n}`;
}

/** The words that continue `project` (a registered one's name) with an optional budget. */
export function continuePhrase(name: string | null, budget: Budget | null, lang: Lang): string {
  const word = lang === 'tr' ? 'devam' : 'continue';
  const quota = budget ? ` ${lang === 'tr' ? 'kota' : 'quota'} ${budget.plus ? '+' : ''}${budget.n}` : '';
  return `${name ? `${name} ` : ''}${word}${quota}`;
}

// ── the strip ──

export interface StripItem {
  /** The command's name, the press's address. */
  id: string;
  label: string;
  active: boolean;
  /** Breathing: the mode a running flow's step works in (the flow itself is the one lit). */
  pulse?: boolean;
}

/**
 * A group of controls: the mode with the flow and the way of working, each titled; and the cockpit with
 * closing, which belong to no way of working: untitled, at the row's far end, as a window's own buttons.
 */
export interface StripSegment {
  title: string;
  items: StripItem[];
  /** Drawn at the far end of its row, the room before it left empty (at least a segment's gap). */
  end?: boolean;
}

/** One row of the strip: its segments side by side. */
export type StripRow = StripSegment[];

/**
 * A flow on the strip. running: a step works, in its mode · approval: the plan waits for the person ·
 * paused: the person chose another mode, and pressing the flow goes on from here · armed: chosen, the next
 * message is its task.
 */
export interface FlowView {
  /** Its place, "2/4". */
  at: string;
  state: 'running' | 'approval' | 'paused' | 'armed';
}

export interface StripView {
  /** The mode in effect: a running flow's step's mode while it works. */
  mode: WorkMode;
  style: Style;
  flow: FlowView | null;
  /** Full autonomy is turned on (Automation), or a run is attached: only then is it on the strip. */
  fullAutoShown: boolean;
  /** The folder the edits are frozen to (`/dondur`), as the strip names it; null or absent while they are not. */
  frozen?: string | null;
  /** Parallel agents: on the strip once turned on (Automation); the session's mode, and how many run now. */
  agents?: { shown: boolean; state: AgentsState; running: number };
  /** The cockpit is open (src/core/ux/cockpit.ts): beside the conversation, or above the prompt. */
  cockpit?: boolean;
}

/**
 * The marks that tell a control's kind on the strip (docs/design.md, the look tells the kind): a switch says
 * whether it is on, `● ` or `○ `; an opener ends in `…`, a window opens and nothing changes until you act there.
 */
const OPENER = mark('opener', false);
const switchMark = (on: boolean) => mark(on ? 'on' : 'off', false);

const MODES: readonly WorkMode[] = ['chat', 'research', 'plan', 'code', 'free'];
const STYLES: readonly ('manual' | 'autonomous')[] = ['manual', 'autonomous'];
const STYLE_DIGIT: Record<'manual' | 'autonomous', string> = { manual: '7', autonomous: '8' };

/** The flow while it is on: lit itself, the modes not (its step's breathes). */
function flowOn(v: StripView): boolean {
  return v.flow !== null && v.flow.state !== 'paused';
}

/**
 * The flow's words: "flow", "flow 2/4", "flow · approve?", "flow ⏸ 2/4", and armed "flow ✎" (the next message is
 * its task). On the strip a flow that is off ends in the opener's `…`: a press asks which flow, and starts none.
 */
function flowText(f: FlowView | null, lang: Lang, tight: boolean, strip = false): string {
  const word = tight ? '⇢' : tIn(lang, 'ctl.strip.flow');
  const sep = tight ? '' : ' ';
  if (!f) return strip ? `${word}${OPENER}` : word;
  switch (f.state) {
    case 'running':
      return `${word}${sep}${f.at}`;
    case 'approval':
      return tight ? `${word}✓?` : tIn(lang, 'ctl.strip.flowApproval');
    case 'paused':
      return `${word}${sep}⏸${sep}${f.at}`;
    case 'armed':
      return `${word}${sep}✎`;
  }
}

/** Columns a text takes in the terminal: pictographs take two. */
export function cells(text: string): number {
  let n = 0;
  for (const ch of text) n += /\p{Extended_Pictographic}/u.test(ch) ? 2 : ch === '️' ? 0 : 1;
  return n;
}

/** Columns a row takes as the strip draws it: each segment's title and items one space apart, segments two. */
export function rowCells(row: StripRow): number {
  return row.reduce((n, s, i) => n + (i ? 2 : 0) + cells(s.title) + s.items.reduce((m, it, j) => m + (s.title || j ? 1 : 0) + cells(it.label), 0), 0);
}

function modeLabel(m: WorkMode, lang: Lang): string {
  return `${MODE_ICON[m] ? `${MODE_ICON[m]} ` : ''}${tIn(lang, `mode.name.${m}` as MessageKey)}`;
}

/**
 * The strip's rows for `columns`: one row when it fits, else the mode on one and the way of working on the
 * next, else numbers and icons only. The cockpit and closing end the last row, apart from the way of working.
 * Every layout carries every control, the number of each in its label.
 */
export function stripRows(v: StripView, lang: Lang, columns: number): StripRow[] {
  const on = flowOn(v);
  const flowDigit = digitOf({ kind: 'flow' });
  const segments = (tight: boolean): [StripSegment, StripSegment, StripSegment] => [
    {
      title: tight ? '' : tIn(lang, 'ctl.strip.mode'),
      items: [
        ...MODES.map((m) => {
          const d = digitOf({ kind: 'mode', mode: m });
          return {
            id: d,
            label: tight ? `${d}${MODE_ICON[m] || tIn(lang, 'ctl.strip.freeShort')}` : `${d} ${modeLabel(m, lang)}`,
            // While a flow is on it is the one lit; the mode its working step is in breathes.
            active: !on && v.mode === m,
            ...(v.flow?.state === 'running' && v.mode === m ? { pulse: true } : {}),
          };
        }),
        { id: flowDigit, label: `${flowDigit}${tight ? '' : ' '}${flowText(v.flow, lang, tight, true)}`, active: on },
      ],
    },
    {
      title: tight ? '' : tIn(lang, 'ctl.strip.style'),
      items: [
        ...STYLES.map((s) => ({
          id: STYLE_DIGIT[s],
          label: `${STYLE_DIGIT[s]}${tight ? tIn(lang, `ctl.style.short.${s}` as MessageKey) : ` ${tIn(lang, `ctl.style.${s}` as MessageKey)}`}`,
          active: v.style === s,
        })),
        ...(v.fullAutoShown || v.style === 'full'
          ? [
              {
                id: commandOf({ kind: 'fullAuto' }, lang),
                // Off, it opens the start window; with a run attached, a press ends the run.
                label: `${tIn(lang, tight ? 'ctl.style.short.full' : 'ctl.style.full')}${v.style === 'full' ? '' : OPENER}`,
                active: v.style === 'full',
              },
            ]
          : []),
        ...(v.frozen
          ? [{ id: commandOf({ kind: 'freeze' }, lang), label: tight ? `❄${switchMark(true)}` : `❄ ${v.frozen} ${switchMark(true)}`, active: true }]
          : []),
        ...(v.agents?.shown
          ? [
              {
                id: commandOf({ kind: 'agents' }, lang),
                label: stripAgents(v.agents.state, v.agents.running, tIn(lang, 'ctl.strip.agents'), tight, OPENER),
                // Lit while agents may run: the person sees at a glance which way it is.
                active: v.agents.state.mode !== 'off' || v.agents.state.ultracode,
              },
            ]
          : []),
      ],
    },
    {
      title: '',
      end: true,
      items: [
        // The cockpit, a switch: shown or not, and a press flips it (the person, 2026-10-18: "≡ kokpit").
        { id: '0', label: tight ? `0≡${switchMark(!!v.cockpit)}` : `0 ≡ ${tIn(lang, 'ctl.strip.cockpit')} ${switchMark(!!v.cockpit)}`, active: !!v.cockpit },
        { id: '00', label: tight ? '00✕' : `00 ✕ ${tIn(lang, 'ctl.strip.close')}`, active: false },
      ],
    },
  ];
  const [mode, style, app] = segments(false);
  if (rowCells([mode, style, app]) <= columns) return [[mode, style, app]];
  if (Math.max(rowCells([mode]), rowCells([style, app])) <= columns) return [[mode], [style, app]];
  const [m, s, a] = segments(true);
  return rowCells([m, s, a]) <= columns ? [[m, s, a]] : [[m], [s, a]];
}

/** The session's controls in one line: "📐 plan · otonom", with the flow when one runs. */
export function controlsLine(v: StripView, lang: Lang): string {
  const style = tIn(lang, `ctl.style.${v.style}` as MessageKey);
  const flow = v.flow ? ` · ${flowText(v.flow, lang, false)}` : '';
  const a = v.agents;
  // Nothing is lit in a line of text: off is said in words.
  const agents = !a?.shown
    ? ''
    : a.state.mode === 'off' && !a.state.ultracode
      ? ` · ${AGENTS_ICON} ${tIn(lang, 'ctl.line.agentsOff')}`
      : ` · ${stripAgents(a.state, a.running, tIn(lang, 'ctl.strip.agents'), false)}`;
  return `${modeLabel(v.mode, lang)} · ${style}${flow}${v.frozen ? ` · ❄ ${v.frozen}` : ''}${agents}`;
}

/**
 * The menu `/0` prints, in markdown (a command's output row is drawn as markdown): where the session stands,
 * then every command, the ones in effect in bold.
 */
export function menuText(v: StripView, lang: Lang, quota: string, update: string | null = null): string {
  const mark = (on: boolean, text: string) => (on ? `**${text}**` : text);
  const lit = flowOn(v);
  const modes = [
    ...MODES.map((m) => mark(!lit && v.mode === m, `/${digitOf({ kind: 'mode', mode: m })} ${modeLabel(m, lang)}`)),
    mark(lit, `/${digitOf({ kind: 'flow' })} ${flowText(v.flow, lang, false)}`),
  ].join(' · ');
  const styles = [
    ...STYLES.map((s) => mark(v.style === s, `/${STYLE_DIGIT[s]} ${tIn(lang, `ctl.style.${s}` as MessageKey)}`)),
    ...(v.fullAutoShown || v.style === 'full' ? [mark(v.style === 'full', `/${commandOf({ kind: 'fullAuto' }, lang)}`)] : []),
    ...(v.agents?.shown ? [mark(v.agents.state.mode !== 'off', `/${commandOf({ kind: 'agents' }, lang)}`)] : []),
  ].join(' · ');
  const other = ['/devam', '/kota', `/0 ${tIn(lang, 'ctl.strip.cockpit')}`, `/00 ${tIn(lang, 'ctl.strip.close')}`].join(' · ');
  return [
    tIn(lang, 'ctl.menu.now', { controls: controlsLine(v, lang), quota }),
    ...(update ? ['', tIn(lang, 'ctl.menu.update', { newer: update })] : []),
    '',
    `- ${tIn(lang, 'ctl.strip.mode')}: ${modes}`,
    `- ${tIn(lang, 'ctl.strip.style')}: ${styles}`,
    `- ${tIn(lang, 'ctl.menu.other')}: ${other}`,
    '',
    tIn(lang, 'ctl.menu.hint'),
  ].join('\n');
}

/** One row of the list `/devam` prints: its number, and the rest. */
export const CHOICE_LINE = /^(\d+)\. (.+)$/;

/** The list `/devam` prints, a numbered markdown list as `/devam <n>` takes it. */
export function choicesText(choices: readonly ContinueChoice[], lang: Lang, shorten: (path: string) => string, ago: (at: number) => string): string {
  const lines = choices.map((c) => {
    const where = c.folder ? ` · ${shorten(c.folder)}` : '';
    const when = c.at ? ` · ${ago(c.at)}` : '';
    return `${c.n}. ${c.label}${c.project ? ' ★' : ''}${where}${when}`;
  });
  return [tIn(lang, 'ctl.continue.title', { n: choices.length }), '', ...lines, '', tIn(lang, 'ctl.continue.hint')].join('\n');
}

// ── the last choice in a folder ──

/**
 * The mode and way of working the person last used in `cwd`, from the other sessions' records, newest
 * first; null when no session worked there. A full-autonomy run is never taken over: it starts only when
 * asked for, so its way of working comes back as the one before the run (autonomous when that is unknown).
 */
export function lastChoice(
  states: readonly (Pick<ModSessionState, 'sessionId' | 'cwd' | 'mode' | 'interaction' | 'aliveAt'> & Partial<Pick<ModSessionState, 'interactionBefore'>>)[],
  cwd: string,
  platform: Platform,
  self: string,
): { mode: WorkMode; interaction: 'default' | 'manual' | 'autonomous' } | null {
  const here = pathKey(cwd, platform);
  const last = states.filter((s) => s.sessionId !== self && s.cwd && pathKey(s.cwd, platform) === here).sort((a, b) => b.aliveAt - a.aliveAt)[0];
  if (!last) return null;
  // A run never comes back by itself: its session is taken up as it was before the run (autonomous if unknown).
  return { mode: last.mode, interaction: last.interaction === 'full' ? (last.interactionBefore ?? 'autonomous') : last.interaction };
}

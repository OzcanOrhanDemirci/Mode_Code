// SPDX-License-Identifier: Apache-2.0
/**
 * Keywords: short phrases a person types to steer a session ("terminal devam", "kota 40", "dur").
 *
 * Rules (from the working rules the tool was designed around):
 *  · a keyword counts only when it is the whole message or ends it; inside a sentence it is just a word;
 *  · "stop" and "wrap up" count only as the whole message, so they never fire by accident; so do the words
 *    that switch the mode or the way of working ("plan", "otonom"): they are everyday words, and "Bu bir
 *    plan." must not switch modes (decided with the person, 2026-10-13). Keywords that carry a task with
 *    them ("… devam", "… kota 40", "… akış", "… tam otonom kota +10") still end a longer message;
 *  · matching ignores case, diacritics and keyboard variants (ı/i, İ, ş/s …), and a project name that is
 *    one typo away is offered as a suggestion, never silently taken.
 */
import { editDistance, fold } from './text.js';
import type { Lang } from './i18n/index.js';

export type KeywordKind =
  | 'continue'
  | 'manual'
  | 'manualStyle'
  | 'autonomous'
  | 'chat'
  | 'quota'
  | 'wrapUp'
  | 'stop'
  | 'status'
  | 'help'
  | 'research'
  | 'plan'
  | 'code'
  | 'free'
  | 'flow'
  | 'approve'
  | 'fullAuto'
  | 'handoff';

/**
 * The phrase lists of a language: one per keyword kind, and the word that cancels a flow ("flow cancel").
 * Working manually alone ("manuel") is the manual list's word on its own: it has no list of its own.
 */
export type KeywordTable = Record<KeywordList, string[]>;

/** The lists a keyword table holds. */
export type KeywordList = Exclude<KeywordKind, 'manualStyle'> | 'cancel';

/** Every list a keyword table holds, in the order settings show them. */
export const KEYWORD_LISTS: readonly KeywordList[] = [
  'continue',
  'manual',
  'autonomous',
  'chat',
  'quota',
  'wrapUp',
  'stop',
  'status',
  'help',
  'research',
  'plan',
  'code',
  'free',
  'flow',
  'cancel',
  'approve',
  'fullAuto',
  'handoff',
];

/** The keywords that set a mode, and the mode each sets. */
export const MODE_KEYWORDS = { chat: 'chat', research: 'research', plan: 'plan', code: 'code', free: 'free' } as const;
export type ModeKeyword = keyof typeof MODE_KEYWORDS;

export function isModeKeyword(kind: KeywordKind): kind is ModeKeyword {
  return Object.hasOwn(MODE_KEYWORDS, kind);
}

/** The keywords that set the way of working alone, and the interaction each sets. */
export const STYLE_KEYWORDS = { manualStyle: 'manual', autonomous: 'autonomous' } as const;
export type StyleKeyword = keyof typeof STYLE_KEYWORDS;

export function isStyleKeyword(kind: KeywordKind): kind is StyleKeyword {
  return Object.hasOwn(STYLE_KEYWORDS, kind);
}

/**
 * Which flow a flow keyword starts, or that it cancels the running one: research ▶ plan → approval → code
 * (full), plan → approval → code (plan), research alone (research), research ▶ plan with no code (researchPlan).
 */
export type FlowVariant = 'full' | 'plan' | 'research' | 'researchPlan' | 'cancel';

/** Default phrases per language, already folded. People can extend them in the settings. */
export const DEFAULT_KEYWORDS: Record<Lang, KeywordTable> = {
  tr: {
    continue: ['devam', 'devam et', 'devam edelim'],
    manual: ['manuel'],
    autonomous: ['otonom'],
    chat: ['sohbet'],
    quota: ['kota'],
    wrapUp: ['toparla', 'toparlayalim'],
    stop: ['dur'],
    status: ['durum'],
    help: ['yardim'],
    research: ['arastirma', 'arastir'],
    plan: ['plan', 'planla'],
    code: ['kod', 'kodla'],
    free: ['serbest'],
    flow: ['akis'],
    cancel: ['iptal'],
    approve: ['onay', 'onayla', 'onayliyorum'],
    fullAuto: ['tam otonom'],
    handoff: ['devir', 'devir notu', 'devret'],
  },
  en: {
    continue: ['continue'],
    manual: ['manual'],
    autonomous: ['autonomous', 'auto'],
    chat: ['chat'],
    quota: ['quota'],
    wrapUp: ['wrap up', 'wrap-up'],
    stop: ['stop'],
    status: ['status'],
    help: ['help'],
    research: ['research'],
    plan: ['plan'],
    code: ['code'],
    free: ['free'],
    flow: ['flow'],
    cancel: ['cancel'],
    approve: ['approve', 'approved'],
    fullAuto: ['full auto', 'full autonomy'],
    handoff: ['handoff', 'hand off'],
  },
};

export interface ProjectRef {
  id: string;
  /** Names that address the project in keywords, e.g. ["terminal"] for "terminal devam". */
  names: string[];
}

export interface KeywordMatch {
  kind: KeywordKind;
  lang: Lang;
  /** Matched project id, null when a name was given but not recognised, undefined when none was given. */
  project?: string | null;
  /** The project words as typed (folded). */
  projectText?: string;
  /** For "kota N" / "kota +N". */
  n?: number;
  plus?: boolean;
  /** A weekly budget given together with continue: "terminal devam kota 40". */
  budget?: { n: number; plus: boolean };
  /** A known project one edit away from what was typed. */
  suggestion?: string;
  /** For "flow": which flow starts, or "cancel". */
  flow?: FlowVariant;
  /** For "full auto": a run starts (or resumes), or the run is canceled ("full auto cancel"). */
  auto?: 'start' | 'cancel';
  /** The phrase that matched, folded. */
  text: string;
  /** True when the keyword was the whole message. */
  standalone: boolean;
  /** How the person gave it: typed (the default), a slash command such as "/3", or a press on the mode strip. */
  via?: 'command' | 'strip';
}

/** Words a project may not be named, because they are keywords themselves. */
export function reservedWords(tables: Partial<Record<Lang, KeywordTable>> = DEFAULT_KEYWORDS): Set<string> {
  const out = new Set<string>();
  for (const t of Object.values(tables)) for (const list of Object.values(t)) for (const w of list) out.add(fold(w));
  return out;
}

function listHas(list: readonly string[], text: string): boolean {
  return list.some((x) => fold(x) === text);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The tail of the message that can hold a keyword: the last line, after its last sentence boundary. */
function tail(prompt: string): string {
  // Lines are split before folding: fold() collapses newlines into spaces.
  const lastLine = fold(
    prompt
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '',
  );
  const parts = lastLine.split(/(?<=[.!?;:…])\s+/);
  return (parts.pop() ?? '').replace(/[.!?…]+$/, '').trim();
}

/**
 * The message without the keyword that ends it: the task a flow keyword starts ("Add sign-in. flow" →
 * "Add sign-in."). Empty when the keyword was the whole message.
 */
export function messageWithoutKeyword(prompt: string): string {
  const lines = prompt.replace(/\r/g, '').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last]!.trim()) last--;
  if (last < 0) return '';
  const sentences = lines[last]!.trim().split(/(?<=[.!?;:…])\s+/);
  sentences.pop();
  return [...lines.slice(0, last), sentences.join(' ')].join('\n').trim();
}

function resolveProject(text: string, projects: readonly ProjectRef[]): { project: string | null; suggestion?: string } {
  const t = fold(text);
  for (const p of projects) if (p.names.some((n) => fold(n) === t) || fold(p.id) === t) return { project: p.id };
  let best: { id: string; d: number } | null = null;
  for (const p of projects) {
    for (const n of [...p.names, p.id]) {
      const f = fold(n);
      if (f.length < 4) continue;
      const d = editDistance(t, f, 1);
      if (d <= 1 && (!best || d < best.d)) best = { id: p.id, d };
    }
  }
  return best ? { project: null, suggestion: best.id } : { project: null };
}

export function detectKeyword(
  prompt: string,
  projects: readonly ProjectRef[] = [],
  tables: Partial<Record<Lang, KeywordTable>> = DEFAULT_KEYWORDS,
): KeywordMatch | null {
  if (/^\s*</.test(prompt)) return null; // notifications and system messages are not the person typing
  const whole = fold(prompt.replace(/\n+/g, ' '))
    .replace(/[.!?…]+$/, '')
    .trim();
  const end = tail(prompt);
  if (!end) return null;
  const standalone = end === whole;

  for (const [lang, t] of Object.entries(tables) as [Lang, KeywordTable][]) {
    const alt = (list: string[]) => list.map((x) => escape(fold(x))).join('|');
    const base = { lang, text: end, standalone };

    const quota = new RegExp(`^(?:${alt(t.quota)})\\s*(\\+?)\\s*(\\d{1,3})$`).exec(end);
    if (quota) return { ...base, kind: 'quota', plus: quota[1] === '+', n: parseInt(quota[2]!, 10) };

    // "<project> devam kota 40": continue with a weekly budget in one line.
    const combo = new RegExp(`^(.+?)\\s+(?:${alt(t.quota)})\\s*(\\+?)\\s*(\\d{1,3})$`).exec(end);
    if (combo) {
      const inner = detectKeyword(combo[1]!, projects, { [lang]: t });
      if (inner && (inner.kind === 'continue' || inner.kind === 'manual' || (inner.kind === 'fullAuto' && inner.auto === 'start')))
        return { ...inner, text: end, standalone, budget: { n: parseInt(combo[3]!, 10), plus: combo[2] === '+' } };
      // "… bunu da yap kota 29": a budget for the task in front of it (decided with the person, 2026-10-13).
      return { ...base, text: end.slice(combo[1]!.length).trim(), standalone: false, kind: 'quota', plus: combo[2] === '+', n: parseInt(combo[3]!, 10) };
    }

    if (standalone && new RegExp(`^(?:${alt(t.stop)})$`).test(end)) return { ...base, kind: 'stop' };
    if (standalone && new RegExp(`^(?:${alt(t.wrapUp)})$`).test(end)) return { ...base, kind: 'wrapUp' };
    // An approval counts only as the whole message: it lets code change the project.
    if (standalone && t.approve.length && new RegExp(`^(?:${alt(t.approve)})$`).test(end)) return { ...base, kind: 'approve' };
    if (new RegExp(`^(?:${alt(t.status)})$`).test(end)) return { ...base, kind: 'status' };

    const flow = t.flow.length ? new RegExp(`^(?:${alt(t.flow)})(?:\\s+(.+))?$`).exec(end) : null;
    if (flow) {
      const rest = flow[1];
      const variant: FlowVariant | null =
        rest === undefined
          ? 'full'
          : listHas(t.plan, rest)
            ? 'plan'
            : listHas(t.research, rest)
              ? 'research'
              : listHas(t.cancel, rest)
                ? 'cancel'
                : researchThenPlan(t, rest)
                  ? 'researchPlan'
                  : null;
      if (variant) return { ...base, kind: 'flow', flow: variant };
    }

    // "<project> full auto", "full auto cancel": a full-autonomy run (docs/autonomy.md).
    const auto = t.fullAuto.length ? new RegExp(`^(?:(.{1,40}?)\\s+)?(?:${alt(t.fullAuto)})(?:\\s+(.+))?$`).exec(end) : null;
    if (auto && (auto[2] === undefined || listHas(t.cancel, auto[2]))) {
      const kind = { ...base, kind: 'fullAuto' as const, auto: auto[2] === undefined ? ('start' as const) : ('cancel' as const) };
      if (!auto[1]) return kind;
      const named = named_(auto[1], projects);
      if (named) return { ...kind, projectText: auto[1], ...named };
    }

    // The mode and the way of working: the whole message only.
    if (standalone) {
      for (const kind of Object.keys(MODE_KEYWORDS) as ModeKeyword[])
        if (t[kind].length && new RegExp(`^(?:${alt(t[kind])})$`).test(end)) return { ...base, kind };
      if (t.manual.length && new RegExp(`^(?:${alt(t.manual)})$`).test(end)) return { ...base, kind: 'manualStyle' };
      if (t.autonomous?.length && new RegExp(`^(?:${alt(t.autonomous)})$`).test(end)) return { ...base, kind: 'autonomous' };
    }

    const manual = new RegExp(`^(?:${alt(t.manual)})\\s+(.{1,40}?)\\s+(?:${alt(t.continue)})$`).exec(end);
    if (manual) return { ...base, kind: 'manual', projectText: manual[1]!, ...resolveProject(manual[1]!, projects) };

    const cont = new RegExp(`^(?:(.{1,40}?)\\s+)?(?:${alt(t.continue)})$`).exec(end);
    if (cont) {
      if (!cont[1]) return { ...base, kind: 'continue' };
      const named = named_(cont[1], projects);
      if (named) return { ...base, kind: 'continue', projectText: cont[1], ...named };
    }

    // "<project> handoff": a handoff note now (docs/memory.md).
    const handoff = t.handoff.length ? new RegExp(`^(?:(.{1,40}?)\\s+)?(?:${alt(t.handoff)})$`).exec(end) : null;
    if (handoff) {
      if (!handoff[1]) return { ...base, kind: 'handoff' };
      const named = named_(handoff[1], projects);
      if (named) return { ...base, kind: 'handoff', projectText: handoff[1], ...named };
    }

    const help = new RegExp(`^(?:(.{1,40}?)\\s+)?(?:${alt(t.help)})$`).exec(end);
    if (help) {
      if (!help[1]) return { ...base, kind: 'help' };
      const named = named_(help[1], projects);
      if (named) return { ...base, kind: 'help', projectText: help[1], ...named };
    }
  }
  return null;
}

/** "araştırma plan", "research plan": the flow that researches, plans, and stops before any code. */
function researchThenPlan(t: KeywordTable, rest: string): boolean {
  const words = rest.split(' ');
  for (let i = 1; i < words.length; i++) if (listHas(t.research, words.slice(0, i).join(' ')) && listHas(t.plan, words.slice(i).join(' '))) return true;
  return false;
}

/**
 * Words before "devam" name a project only when they are a known project, one typo from one, or a single
 * word (a project the person has not registered yet). "bu işe devam" is a sentence, not a project.
 */
function named_(text: string, projects: readonly ProjectRef[]): { project: string | null; suggestion?: string } | null {
  const r = resolveProject(text, projects);
  if (r.project || r.suggestion) return r;
  return text.split(' ').length === 1 ? r : null;
}

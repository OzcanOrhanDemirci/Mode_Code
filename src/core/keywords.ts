// SPDX-License-Identifier: Apache-2.0
/**
 * Keywords: short phrases a person types to steer a session ("terminal devam", "kota 40", "dur").
 *
 * Rules (from the working rules the tool was designed around):
 *  · a keyword counts only when it is the whole message or ends it; inside a sentence it is just a word;
 *  · "stop" and "wrap up" count only as the whole message, so they never fire by accident;
 *  · matching ignores case, diacritics and keyboard variants (ı/i, İ, ş/s …), and a project name that is
 *    one typo away is offered as a suggestion, never silently taken.
 */
import { editDistance, fold } from './text.js';
import type { Lang } from './i18n/index.js';

export type KeywordKind = 'continue' | 'manual' | 'chat' | 'quota' | 'wrapUp' | 'stop' | 'status' | 'help';

export interface KeywordTable {
  continue: string[];
  manual: string[];
  chat: string[];
  quota: string[];
  wrapUp: string[];
  stop: string[];
  status: string[];
  help: string[];
}

/** Default phrases per language, already folded. People can extend them in the settings. */
export const DEFAULT_KEYWORDS: Record<Lang, KeywordTable> = {
  tr: {
    continue: ['devam', 'devam et', 'devam edelim'],
    manual: ['manuel'],
    chat: ['sohbet'],
    quota: ['kota'],
    wrapUp: ['toparla', 'toparlayalim'],
    stop: ['dur'],
    status: ['durum'],
    help: ['yardim'],
  },
  en: {
    continue: ['continue'],
    manual: ['manual'],
    chat: ['chat'],
    quota: ['quota'],
    wrapUp: ['wrap up', 'wrap-up'],
    stop: ['stop'],
    status: ['status'],
    help: ['help'],
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
  /** The phrase that matched, folded. */
  text: string;
  /** True when the keyword was the whole message. */
  standalone: boolean;
}

/** Words a project may not be named, because they are keywords themselves. */
export function reservedWords(tables: Partial<Record<Lang, KeywordTable>> = DEFAULT_KEYWORDS): Set<string> {
  const out = new Set<string>();
  for (const t of Object.values(tables)) for (const list of Object.values(t)) for (const w of list) out.add(fold(w));
  return out;
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
      if (inner && (inner.kind === 'continue' || inner.kind === 'manual'))
        return { ...inner, text: end, standalone, budget: { n: parseInt(combo[3]!, 10), plus: combo[2] === '+' } };
    }

    if (standalone && new RegExp(`^(?:${alt(t.stop)})$`).test(end)) return { ...base, kind: 'stop' };
    if (standalone && new RegExp(`^(?:${alt(t.wrapUp)})$`).test(end)) return { ...base, kind: 'wrapUp' };
    if (new RegExp(`^(?:${alt(t.status)})$`).test(end)) return { ...base, kind: 'status' };
    if (new RegExp(`^(?:${alt(t.chat)})$`).test(end)) return { ...base, kind: 'chat' };

    const manual = new RegExp(`^(?:${alt(t.manual)})\\s+(.{1,40}?)\\s+(?:${alt(t.continue)})$`).exec(end);
    if (manual) return { ...base, kind: 'manual', projectText: manual[1]!, ...resolveProject(manual[1]!, projects) };

    const cont = new RegExp(`^(?:(.{1,40}?)\\s+)?(?:${alt(t.continue)})$`).exec(end);
    if (cont) {
      if (!cont[1]) return { ...base, kind: 'continue' };
      const named = named_(cont[1], projects);
      if (named) return { ...base, kind: 'continue', projectText: cont[1], ...named };
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

/**
 * Words before "devam" name a project only when they are a known project, one typo from one, or a single
 * word (a project the person has not registered yet). "testlere devam" is a sentence, not a project.
 */
function named_(text: string, projects: readonly ProjectRef[]): { project: string | null; suggestion?: string } | null {
  const r = resolveProject(text, projects);
  if (r.project || r.suggestion) return r;
  return text.split(' ').length === 1 ? r : null;
}

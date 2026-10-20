// SPDX-License-Identifier: Apache-2.0
/**
 * The morning report (docs/memory.md): what happened while the person was away, from facts the caller
 * measured. Pure: lines in the person's language, and one summary line.
 */
import { CLI_NAME } from './app.js';
import { tIn, type Lang } from './i18n/index.js';
import type { MemoryPlace } from './config.js';
import { percent } from './format.js';

export interface MorningFacts {
  since: number;
  now: number;
  /** Flows waiting for the person's approval. */
  flows: { id: string; title: string }[];
  /** Sessions since, by project or folder. */
  sessions: { project: string; count: number }[];
  /** Handoff notes written since. */
  handoffs: { project: string; at: number }[];
  /** What the safety belt blocked, asked about, and left to the person in full autonomy. */
  belt: { blocked: number; asked: number; left: number } | null;
  quota: { weekFrom: number | null; weekTo: number | null } | null;
  /** The memory store's state; null when there is none. */
  memory: { place: MemoryPlace; ahead: number | null; conflicts: string[]; held: string[]; error: string | null } | null;
  /** What the other computers did (docs/sync.md): only those with something to say. */
  elsewhere?: { machine: string; flows: number; sessions: number; blocked: number }[];
  /** Settings from other computers waiting for the person. */
  syncPending?: number;
  /** A newer release the last update check found (core/update.ts). */
  update?: string | null;
}

/** The person was away long enough for a morning report: a gap of at least `afterHours` since the last prompt. */
export function awayLong(lastPromptAt: number | null, now: number, afterHours: number): boolean {
  return lastPromptAt !== null && now - lastPromptAt >= afterHours * 3_600_000;
}

/** The report's lines, label and text, in the person's language; only what has something to say. */
export function morningLines(f: MorningFacts, lang: Lang): { label: string; text: string }[] {
  const L = (k: Parameters<typeof tIn>[1], p?: Record<string, string | number>) => tIn(lang, k, p);
  const out: { label: string; text: string }[] = [];
  for (const fl of f.flows) out.push({ label: L('morning.flows'), text: L('morning.flowWaits', { title: fl.title.slice(0, 80) }) });
  if (f.belt?.left) out.push({ label: L('morning.left'), text: L('morning.leftText', { n: f.belt.left }) });
  const m = f.memory;
  if (m) {
    if (m.conflicts.length) out.push({ label: L('morning.memory'), text: L('morning.memory.conflict', { files: m.conflicts.slice(0, 5).join(', ') }) });
    if (m.held.length) out.push({ label: L('morning.memory'), text: L('morning.memory.held', { files: m.held.slice(0, 5).join(', ') }) });
    if (m.ahead && m.place !== 'local') out.push({ label: L('morning.memory'), text: L('morning.memory.ahead', { n: m.ahead }) });
    if (m.error) out.push({ label: L('morning.memory'), text: L('morning.memory.error', { detail: m.error }) });
  }
  if (f.sessions.length) {
    const n = f.sessions.reduce((a, s) => a + s.count, 0);
    out.push({
      label: L('morning.sessions'),
      text: `${L('morning.sessionsText', { n })} · ${f.sessions
        .slice(0, 5)
        .map((s) => `${s.project} (${s.count})`)
        .join(' · ')}`,
    });
  }
  if (f.handoffs.length) {
    const by = new Map<string, number>();
    for (const h of f.handoffs) by.set(h.project, (by.get(h.project) ?? 0) + 1);
    out.push({
      label: L('morning.handoffs'),
      text: [...by.entries()]
        .slice(0, 6)
        .map(([p, n]) => `${p} (${n})`)
        .join(' · '),
    });
  }
  if (f.belt && (f.belt.blocked || f.belt.asked))
    out.push({ label: L('morning.belt'), text: L('morning.beltText', { blocked: f.belt.blocked, asked: f.belt.asked }) });
  for (const e of f.elsewhere ?? []) {
    const parts = [
      e.sessions ? L('morning.elsewhere.sessions', { n: e.sessions }) : '',
      e.flows ? L('morning.elsewhere.flows', { n: e.flows }) : '',
      e.blocked ? L('morning.elsewhere.blocked', { n: e.blocked }) : '',
    ].filter(Boolean);
    out.push({ label: L('morning.elsewhere'), text: `${e.machine}: ${parts.join(' · ')}` });
  }
  if (f.syncPending) out.push({ label: L('morning.sync'), text: L('morning.syncPending', { n: f.syncPending }) });
  if (f.update) out.push({ label: L('morning.update'), text: L('morning.updateText', { newer: f.update }) });
  if (f.quota && f.quota.weekTo !== null)
    out.push({ label: L('morning.quota'), text: L('morning.quotaText', { from: percent(f.quota.weekFrom, lang), to: percent(f.quota.weekTo, lang) }) });
  return out;
}

/** One line for the first prompt after a while away; null when nothing needs the person. */
export function morningSummary(f: MorningFacts, lang: Lang): string | null {
  const L = (k: Parameters<typeof tIn>[1], p?: Record<string, string | number>) => tIn(lang, k, p);
  const parts: string[] = [];
  if (f.belt?.left) parts.push(L('morning.sum.left', { n: f.belt.left }));
  if (f.flows.length) parts.push(L('morning.sum.flows', { n: f.flows.length }));
  const m = f.memory;
  if (m && (m.conflicts.length || m.held.length || m.error)) parts.push(L('morning.sum.memory'));
  else if (m && m.ahead && m.place !== 'local') parts.push(L('morning.sum.ahead', { n: m.ahead }));
  if (f.handoffs.length) parts.push(L('morning.sum.handoffs', { n: f.handoffs.length }));
  const news = (f.elsewhere ?? []).filter((e) => e.flows);
  if (news.length) parts.push(L('morning.sum.elsewhere', { names: news.map((e) => e.machine).join(', ') }));
  if (f.syncPending) parts.push(L('morning.sum.pending', { n: f.syncPending }));
  if (f.update) parts.push(L('morning.sum.update', { newer: f.update }));
  return parts.length ? L('morning.sum', { what: parts.join(' · '), cmd: `${CLI_NAME} morning` }) : null;
}

/**
 * When the person last typed (state/activity.json, written by the plugin), and the last gap long enough for
 * a morning report: from the prompt before it to the prompt after it.
 */
export interface Activity {
  lastPromptAt: number | null;
  away: { from: number; to: number } | null;
}

export function parseActivity(text: string | null): Activity {
  const none: Activity = { lastPromptAt: null, away: null };
  if (!text) return none;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const away = o.away as Record<string, unknown> | null | undefined;
    return {
      lastPromptAt: typeof o.lastPromptAt === 'number' ? o.lastPromptAt : null,
      away: away && typeof away.from === 'number' && typeof away.to === 'number' && away.from <= away.to ? { from: away.from, to: away.to } : null,
    };
  } catch {
    return none;
  }
}

/** The activity after a prompt at `now`: a gap of at least `afterHours` becomes the new away window. */
export function nextActivity(a: Activity, now: number, afterHours: number): Activity {
  return { lastPromptAt: now, away: awayLong(a.lastPromptAt, now, afterHours) ? { from: a.lastPromptAt!, to: now } : a.away };
}

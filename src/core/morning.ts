// SPDX-License-Identifier: Apache-2.0
/**
 * The morning report (docs/memory.md): what happened while the person was away, from facts the caller
 * measured; and the notes full-autonomy runs left for the memory, which wait for the person's approval.
 * Pure: lines in the person's language, one summary line, and the decisions on notes.
 */
import { APP_NAME } from './app.js';
import { tIn, type Lang } from './i18n/index.js';
import type { MemoryPlace } from './config.js';
import { percent } from './format.js';

export interface MorningRun {
  id: string;
  task: string;
  status: 'active' | 'paused' | 'done' | 'stuck' | 'canceled';
  /** Why a paused run paused, in the person's words. */
  reason: string | null;
  report: string | null;
  deferred: number;
}

export interface MorningFacts {
  since: number;
  now: number;
  /** Runs that ended, paused or got stuck since. */
  runs: MorningRun[];
  /** Flows waiting for the person's approval. */
  flows: { id: string; title: string }[];
  /** Sessions since, by project or folder. */
  sessions: { project: string; count: number }[];
  /** Handoff notes written since. */
  handoffs: { project: string; at: number }[];
  belt: { blocked: number; asked: number } | null;
  quota: { weekFrom: number | null; weekTo: number | null } | null;
  /** The memory store's state; null when there is none. */
  memory: { place: MemoryPlace; ahead: number | null; conflicts: string[]; held: string[]; error: string | null } | null;
  /** Notes from full-autonomy runs waiting for approval. */
  notes: number;
}

/** The person was away long enough for a morning report: a gap of at least `afterHours` since the last prompt. */
export function awayLong(lastPromptAt: number | null, now: number, afterHours: number): boolean {
  return lastPromptAt !== null && now - lastPromptAt >= afterHours * 3_600_000;
}

/** The report's lines, label and text, in the person's language; only what has something to say. */
export function morningLines(f: MorningFacts, lang: Lang): { label: string; text: string }[] {
  const L = (k: Parameters<typeof tIn>[1], p?: Record<string, string | number>) => tIn(lang, k, p);
  const out: { label: string; text: string }[] = [];
  for (const r of f.runs) {
    const state =
      r.status === 'paused' && r.reason ? L('morning.run.pausedFor', { reason: r.reason }) : L(`morning.run.${r.status}` as Parameters<typeof tIn>[1]);
    out.push({
      label: L('morning.runs'),
      text: `${r.task.split('\n')[0]!.slice(0, 80)} · ${state}${r.deferred ? ` · ${L('morning.run.deferred', { n: r.deferred })}` : ''}${r.report ? ` · ${r.report}` : ''}`,
    });
  }
  for (const fl of f.flows) out.push({ label: L('morning.flows'), text: L('morning.flowWaits', { title: fl.title.slice(0, 80) }) });
  if (f.notes) out.push({ label: L('morning.notes'), text: L('morning.notesWait', { n: f.notes }) });
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
  if (f.quota && f.quota.weekTo !== null)
    out.push({ label: L('morning.quota'), text: L('morning.quotaText', { from: percent(f.quota.weekFrom, lang), to: percent(f.quota.weekTo, lang) }) });
  return out;
}

/** One line for the first prompt after a while away; null when nothing needs the person. */
export function morningSummary(f: MorningFacts, lang: Lang): string | null {
  const L = (k: Parameters<typeof tIn>[1], p?: Record<string, string | number>) => tIn(lang, k, p);
  const parts: string[] = [];
  const ended = f.runs.filter((r) => r.status === 'done').length;
  const waiting = f.runs.filter((r) => r.status === 'paused' || r.status === 'stuck').length;
  if (ended) parts.push(L('morning.sum.ended', { n: ended }));
  if (waiting) parts.push(L('morning.sum.waiting', { n: waiting }));
  if (f.flows.length) parts.push(L('morning.sum.flows', { n: f.flows.length }));
  if (f.notes) parts.push(L('morning.sum.notes', { n: f.notes }));
  const m = f.memory;
  if (m && (m.conflicts.length || m.held.length || m.error)) parts.push(L('morning.sum.memory'));
  else if (m && m.ahead && m.place !== 'local') parts.push(L('morning.sum.ahead', { n: m.ahead }));
  if (f.handoffs.length) parts.push(L('morning.sum.handoffs', { n: f.handoffs.length }));
  return parts.length ? L('morning.sum', { what: parts.join(' · '), cmd: `${APP_NAME} morning` }) : null;
}

// ── notes from full-autonomy runs ─────────────────────────────────────────────────────────────────

export interface NoteDecision {
  decision: 'approved' | 'discarded';
  at: number;
  /** When an approved note was handed to a session to merge; null until then. */
  delivered: number | null;
}

export type NoteDecisions = Record<string, NoteDecision>;

/** The decisions file, read; anything malformed is left out. */
export function parseNoteDecisions(text: string | null): NoteDecisions {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: NoteDecisions = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const d = v as Record<string, unknown>;
      if ((d.decision === 'approved' || d.decision === 'discarded') && typeof d.at === 'number')
        out[id] = { decision: d.decision, at: d.at, delivered: typeof d.delivered === 'number' ? d.delivered : null };
    }
    return out;
  } catch {
    return {};
  }
}

/** Runs whose notes wait for the person: the run is not going on, it left notes, and nobody decided on them. */
export function pendingNotes(runs: readonly { id: string; open: boolean; hasNotes: boolean }[], d: NoteDecisions): string[] {
  return runs.filter((r) => !r.open && r.hasNotes && !Object.hasOwn(d, r.id)).map((r) => r.id);
}

/** Approved notes not yet handed to a session. */
export function toDeliver(d: NoteDecisions): string[] {
  return Object.entries(d)
    .filter(([, v]) => v.decision === 'approved' && v.delivered === null)
    .map(([id]) => id);
}

/** Told to Claude on a session's first prompt when the person approved notes: merge them by the memory's own rules. */
export function notesContext(items: readonly { id: string; path: string }[]): string {
  return `[${APP_NAME}] The person approved notes that full-autonomy runs left for the memory: ${items.map((i) => `${i.path} (run ${i.id})`).join('; ')}. Read them and merge what is still true into the memory by its own rules (the index, one note per file), then say so in one line.`;
}

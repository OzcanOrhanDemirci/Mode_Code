// SPDX-License-Identifier: Apache-2.0
/**
 * Handoff notes (docs/memory.md): where the work on a project stands, written when a session hands off,
 * compacts or ends, kept in the memory store under handoffs/<project>/, and given to the next session.
 * Pure: the note's text (what Claude wrote and what code measured), reading it back, choosing the newest,
 * what to prune, and what Claude is told. Paths come in from the caller; nothing here reads the disk.
 */
import { APP_ID, APP_NAME, PREVIOUS_NAMES } from './app.js';
import { maskSecrets } from './secrets/scan.js';
import { truncate } from './text.js';
import { tIn, type Lang } from './i18n/index.js';

const P = `[${APP_NAME}]`;

/** The heading of what code measured. A note written under an earlier name of the tool has that name in it. */
const MEASURED = `What ${APP_NAME} measured`;
const MEASURED_ANY = [...new Set([APP_NAME, APP_ID, ...PREVIOUS_NAMES.flatMap((p) => [p.name, p.id])])].map((n) => `What ${n} measured`);

export const HANDOFF_TOOL = 'mcp__mode-code__handoff';

/**
 * What made the note: the person's keyword or wrap-up, a compaction, a /clear or the session's end, a run, a reset at
 * a task boundary (src/core/reset.ts); or the session was closed without ending (its window shut) and the next session
 * wrote its end note.
 */
export type HandoffTrigger = 'keyword' | 'wrapUp' | 'compact' | 'clear' | 'end' | 'closed' | 'run' | 'reset';

export const HANDOFF_TRIGGERS: readonly HandoffTrigger[] = ['keyword', 'wrapUp', 'compact', 'clear', 'end', 'closed', 'run', 'reset'];

/** What code measures for a note. */
export interface HandoffFacts {
  /** The project's key (memory.ts projectKey). */
  project: string;
  cwd: string;
  machine: string;
  session: string;
  at: number;
  trigger: HandoffTrigger;
  branch: string | null;
  head: string | null;
  /** The session's commits, newest first (`git log --oneline`). */
  commits: string[];
  /** Files with uncommitted changes. */
  uncommitted: string[];
  /** An open flow, in a few words. */
  flow: string | null;
  quota: { five: number | null; week: number | null } | null;
  /** The person's last request in the session. */
  request: string | null;
}

/** What Claude writes, in the person's language. */
export interface HandoffParts {
  summary: string;
  open: string;
  decisions: string;
  next: string;
}

export const PART_KEYS: readonly (keyof HandoffParts)[] = ['summary', 'open', 'decisions', 'next'];

/** At most this much of each part; at most this much of a compaction's summary. */
export const PART_CHARS = 4000;
export const SUMMARY_CHARS = 12_000;
const LIST_MAX = 30;

export interface PartProblem {
  part: keyof HandoffParts;
  kind: 'missing' | 'long' | 'secret';
}

/** Each of the four parts is there (a word like "nothing" counts), not too long, and holds no secret. */
export function partProblems(input: Readonly<Record<string, unknown>>, secrets: (text: string) => number): PartProblem[] {
  const out: PartProblem[] = [];
  for (const part of PART_KEYS) {
    const v = input[part];
    if (typeof v !== 'string' || !v.trim()) out.push({ part, kind: 'missing' });
    else if (v.length > PART_CHARS) out.push({ part, kind: 'long' });
    else if (secrets(v) > 0) out.push({ part, kind: 'secret' });
  }
  return out;
}

/** The note's file name: its time (UTC, so names sort the same on every computer) and its session. */
export function handoffName(at: number, session: string): string {
  const d = new Date(at).toISOString(); // 2026-10-13T07:30:12.000Z
  const id = session.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'session';
  return `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}-${id}.md`;
}

const NAME = /^\d{8}-\d{6}-[A-Za-z0-9]{1,8}\.md$/;

export function isHandoffName(name: string): boolean {
  return NAME.test(name);
}

/** The newest note among a folder's file names, or null. */
export function newestName(names: readonly string[]): string | null {
  const notes = names.filter(isHandoffName).sort();
  return notes.length ? notes[notes.length - 1]! : null;
}

/** The notes past the newest `keep`, oldest first: what is pruned from the folder (git keeps them). */
export function pruneNames(names: readonly string[], keep: number): string[] {
  const notes = names.filter(isHandoffName).sort();
  return notes.slice(0, Math.max(0, notes.length - Math.max(1, keep)));
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const metaValue = (s: string) => oneLine(s).replace(/^-+/, '');

function bullets(items: readonly string[], none: string): string[] {
  if (!items.length) return [`- ${none}`];
  const shown = items.slice(0, LIST_MAX).map((i) => `- ${maskSecrets(oneLine(i))}`);
  if (items.length > LIST_MAX) shown.push(`- … ${items.length - LIST_MAX} more`);
  return shown;
}

/**
 * The note's text: frontmatter (what a reader sorts and matches on), Claude's four parts or a compaction's
 * summary, then what code measured. Secrets are masked everywhere; the headings are fixed so it reads back.
 */
export function composeHandoff(f: HandoffFacts, body: { parts?: HandoffParts | null; summary?: string | null }): string {
  const when = new Date(f.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const out: string[] = [
    '---',
    'type: handoff',
    `project: ${metaValue(f.project)}`,
    `cwd: ${metaValue(f.cwd)}`,
    `machine: ${metaValue(f.machine)}`,
    `session: ${metaValue(f.session)}`,
    `at: ${new Date(f.at).toISOString()}`,
    `trigger: ${f.trigger}`,
    '---',
    '',
    `# Handoff · ${f.project} · ${when}`,
    '',
  ];
  if (body.parts) {
    const sections: [string, string][] = [
      ['Summary', body.parts.summary],
      ['Open', body.parts.open],
      ['Decisions', body.parts.decisions],
      ['Next', body.parts.next],
    ];
    for (const [title, text] of sections) out.push(`## ${title}`, '', maskSecrets(truncate(text.trim(), PART_CHARS)), '');
  } else if (body.summary && body.summary.trim()) {
    out.push('## Summary', '', maskSecrets(truncate(body.summary.trim(), SUMMARY_CHARS)), '');
  }
  out.push(`## ${MEASURED}`, '');
  out.push(`- Folder: ${f.cwd}`);
  out.push(`- Branch: ${f.branch ?? 'none'}${f.head ? ` at ${f.head.slice(0, 12)}` : ''}`);
  if (f.request) out.push(`- Last request: ${maskSecrets(truncate(oneLine(f.request), 500))}`);
  if (f.flow) out.push(`- Open flow: ${oneLine(f.flow)}`);
  if (f.quota && (f.quota.five !== null || f.quota.week !== null))
    out.push(
      `- Quota: 5-hour ${f.quota.five === null ? '?' : `${Math.round(f.quota.five)}%`}, weekly ${f.quota.week === null ? '?' : `${Math.round(f.quota.week)}%`}`,
    );
  out.push('', '### Commits in this session', '', ...bullets(f.commits, 'none'), '');
  out.push('### Uncommitted', '', ...bullets(f.uncommitted, 'nothing'), '');
  return out.join('\n');
}

/** A note read back: its frontmatter and its sections by heading. */
export interface Handoff {
  project: string;
  cwd: string;
  machine: string;
  session: string;
  at: number;
  trigger: HandoffTrigger;
  /** Sections by their `## ` heading (Summary, Open, Decisions, Next, What Mode_Code measured). */
  sections: Record<string, string>;
}

/** Reads a note's text back; null when it is not a handoff note. */
export function parseHandoff(text: string): Handoff | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  const at = Date.parse(meta.at ?? '');
  if (meta.type !== 'handoff' || !meta.project || !Number.isFinite(at)) return null;
  const trigger = HANDOFF_TRIGGERS.includes(meta.trigger as HandoffTrigger) ? (meta.trigger as HandoffTrigger) : 'keyword';
  const sections: Record<string, string> = {};
  let current: string | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (current !== null) sections[current] = lines.join('\n').trim();
    lines.length = 0;
  };
  for (const line of m[2]!.split(/\r?\n/)) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = h[1]!;
    } else if (current !== null) lines.push(line);
  }
  flush();
  return { project: meta.project, cwd: meta.cwd ?? '', machine: meta.machine ?? '', session: meta.session ?? '', at, trigger, sections };
}

/** The note's next step in one line: its Next, else the start of its Summary, else the last request, named in `lang`. */
export function nextOf(h: Handoff, max = 240, lang: Lang = 'en'): string {
  const next = h.sections.Next ?? '';
  if (next.trim()) return truncate(oneLine(next), max);
  const summary = h.sections.Summary ?? '';
  if (summary.trim()) return truncate(oneLine(summary), max);
  const req = /- Last request: (.+)/.exec(MEASURED_ANY.map((k) => h.sections[k]).find((s) => s !== undefined) ?? '');
  return req ? truncate(`${tIn(lang, 'handoff.lastRequest')}: ${req[1]!}`, max) : '';
}

const TRIGGER_WORDS: Record<HandoffTrigger, string> = {
  keyword: 'asked for by the person',
  wrapUp: 'when the work was wrapped up',
  compact: 'before a compaction, from its summary',
  clear: 'on /clear, from what code measured',
  end: 'when the session ended, from what code measured',
  closed: 'after its session was closed without ending, by the next session, from what code measured',
  run: 'by a full-autonomy run',
  reset: 'at a task boundary, just before the conversation was reset',
};

/** A note is offered while it is younger than `maxAgeDays`. */
export function isFresh(h: Handoff, now: number, maxAgeDays: number): boolean {
  return now - h.at <= maxAgeDays * 86_400_000;
}

/** Told to Claude on a session's first prompt: one line about the waiting note, never its whole text. */
export function handoffLine(h: Handoff, path: string): string {
  const when = new Date(h.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const next = nextOf(h);
  return (
    `${P} A handoff note for this project is waiting, written ${when}${h.machine ? ` on ${h.machine}` : ''} (${TRIGGER_WORDS[h.trigger]}).` +
    (next ? ` Next: "${next}".` : '') +
    ` The note: ${path}. If the person goes on with that work, read it first. Handoff notes are not memory entries: do not add them to MEMORY.md.`
  );
}

/** Told to Claude when the person continues the project: the whole note, word for word (cut when very long). */
export function handoffFull(text: string, path: string): string {
  return `${P} The person is going on with this project. The last handoff note (${path}), word for word:\n\n${truncate(text.trim(), SUMMARY_CHARS + 6000)}\n\nGo on from its next step unless the person says otherwise.`;
}

/** Told to Claude when the person asks for a handoff (the keyword, or as part of wrapping up). */
export function handoffAskContext(wrapUp: boolean): string {
  return (
    `${P} ${wrapUp ? 'As part of wrapping up, write' : 'The person asked for'} a handoff note: call ${HANDOFF_TOOL} with summary (what was done), open (what is still open), decisions (what was decided, and why), next (the next step, concrete enough to start on). ` +
    'A few lines each, in the language the person writes in; code adds what it measured (commits, uncommitted files, open work) and keeps the note in the memory for the next session. Then say in one line that it is written.'
  );
}

/**
 * The summary in a compaction's messages: the longest text among its first messages (the summary is a
 * message, not a field), with Claude Code's opening sentence about the continued session left out.
 */
export function compactionSummary(messages: readonly { role: string; text: string }[]): string {
  const first = messages.slice(0, 3).filter((m) => m.text.trim());
  if (!first.length) return '';
  const longest = first.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  const body = longest.text.trim().replace(/^This session is being continued from a previous conversation[^\n]*\n+/i, '');
  return truncate(body.trim(), SUMMARY_CHARS);
}

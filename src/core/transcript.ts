// SPDX-License-Identifier: Apache-2.0
/**
 * Reading Claude Code's session transcripts (JSON Lines). The format is not documented and changes, so
 * every reader here is defensive: an unknown row is skipped, never fatal, and nothing is assumed beyond
 * `type`, `message.role`, `message.content` blocks, `timestamp` and `isMeta`.
 */
import type { ToolUse } from './footer.js';
import { isFileTool } from './belt/tools.js';

type Row = Record<string, unknown>;

function parse(line: string): Row | null {
  if (!line || line[0] !== '{') return null;
  try {
    const o = JSON.parse(line) as unknown;
    return typeof o === 'object' && o !== null ? (o as Row) : null;
  } catch {
    return null;
  }
}

function content(row: Row): unknown[] | string | null {
  const m = row.message as Row | undefined;
  if (!m || typeof m !== 'object') return null;
  const c = m.content;
  return typeof c === 'string' || Array.isArray(c) ? c : null;
}

/**
 * True for a prompt the person typed: a user row that is not injected (isMeta), not a tool result and
 * not a notification or command wrapper (those start with "<").
 */
export function isHumanPrompt(row: Row): boolean {
  if (row.type !== 'user' || row.isMeta === true || row.isSidechain === true) return false;
  // Newer transcripts stamp where a prompt came from; trust the stamp when it is there.
  const origin = row.origin as Row | undefined;
  if (origin && typeof origin.kind === 'string' && origin.kind !== 'human') return false;
  const c = content(row);
  if (typeof c === 'string') return !c.trimStart().startsWith('<');
  if (!Array.isArray(c)) return false;
  let text = false;
  for (const b of c as Row[]) {
    if (b?.type === 'tool_result') return false;
    if (b?.type === 'text' && typeof b.text === 'string') {
      if (b.text.trimStart().startsWith('<')) return false;
      text = true;
    }
  }
  return text;
}

/** The text of a tool result, whatever its shape (a string or a list of blocks). */
function resultText(b: Row): string {
  const c = b.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return (c as Row[]).map((x) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
  return '';
}

export interface TurnInfo {
  /** When the person's prompt that started this turn was written (epoch ms), or null when not found. */
  startedAt: number | null;
  /** Tool calls of the main conversation since that prompt, in order. */
  uses: ToolUse[];
  /** True when the turn start was found in the lines given. */
  complete: boolean;
}

/** The current turn: everything after the last human prompt. Lines may be the tail of the file. */
export function currentTurn(lines: readonly string[]): TurnInfo {
  let start = -1;
  const rows: (Row | null)[] = lines.map(parse);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && isHumanPrompt(r)) {
      start = i;
      break;
    }
  }
  // Calls that did not run change nothing: a refused call (its error names the safety belt) and a file
  // tool that failed. A failed shell command still counts, because it may have changed things first.
  const didNotRun = new Set<string>();
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.type !== 'user') continue;
    const c = content(r);
    if (!Array.isArray(c)) continue;
    for (const b of c as Row[]) {
      if (b?.type !== 'tool_result' || b.is_error !== true || typeof b.tool_use_id !== 'string') continue;
      didNotRun.add(b.tool_use_id + (resultText(b).includes('🛡') ? '\u0000refused' : '\u0000failed'));
    }
  }
  const uses: ToolUse[] = [];
  const seen = new Set<string>();
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.type !== 'assistant' || r.isSidechain === true) continue;
    const c = content(r);
    if (!Array.isArray(c)) continue;
    for (const b of c as Row[]) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      const id = typeof b.id === 'string' ? b.id : `${i}:${uses.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (didNotRun.has(id + '\u0000refused')) continue;
      if (didNotRun.has(id + '\u0000failed') && isFileTool(b.name)) continue;
      uses.push({ name: b.name, input: (typeof b.input === 'object' && b.input !== null ? b.input : {}) as Record<string, unknown> });
    }
  }
  const ts = start >= 0 ? rows[start]?.timestamp : undefined;
  const startedAt = typeof ts === 'string' ? Date.parse(ts) : null;
  return { startedAt: startedAt !== null && Number.isFinite(startedAt) ? startedAt : null, uses, complete: start >= 0 };
}

/** What a stretch of transcript looks like, for noticing when Claude Code changes its format. */
export interface TranscriptShape {
  lines: number;
  /** Lines that are not a JSON object. */
  unreadable: number;
  /** Rows of the two kinds every reader relies on, and how many of them have the expected shape. */
  user: number;
  assistant: number;
  /** Assistant rows whose `message.content` is a list of blocks, as the readers expect. */
  assistantWithBlocks: number;
  /** Assistant rows that carry `message.usage` (the token figures). */
  assistantWithUsage: number;
  /** Rows that carry a `timestamp` the reader can parse. */
  timestamped: number;
  /** Session ids the rows carry. */
  sessionIds: string[];
  /** Tool calls by name: how many, and whether their input names a command or writes a file. */
  tools: Record<string, { calls: number; runsCommands: boolean; writesFiles: boolean }>;
}

/** Reads the shape of transcript lines: counts only, no text kept. */
export function transcriptShape(lines: readonly string[]): TranscriptShape {
  const s: TranscriptShape = {
    lines: lines.length,
    unreadable: 0,
    user: 0,
    assistant: 0,
    assistantWithBlocks: 0,
    assistantWithUsage: 0,
    timestamped: 0,
    sessionIds: [],
    tools: {},
  };
  const ids = new Set<string>();
  for (const line of lines) {
    const r = parse(line);
    if (!r) {
      s.unreadable++;
      continue;
    }
    if (typeof r.sessionId === 'string') ids.add(r.sessionId);
    if (typeof r.timestamp === 'string' && Number.isFinite(Date.parse(r.timestamp))) s.timestamped++;
    if (r.type === 'user') s.user++;
    if (r.type !== 'assistant') continue;
    s.assistant++;
    const m = r.message as Row | undefined;
    if (m && typeof m === 'object' && typeof m.usage === 'object' && m.usage !== null) s.assistantWithUsage++;
    const c = content(r);
    if (!Array.isArray(c)) continue;
    s.assistantWithBlocks++;
    for (const b of c as Row[]) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      const input = (typeof b.input === 'object' && b.input !== null ? b.input : {}) as Row;
      const t = (s.tools[b.name] ??= { calls: 0, runsCommands: false, writesFiles: false });
      t.calls++;
      if (typeof input.command === 'string' || typeof input.script === 'string') t.runsCommands = true;
      const path = input.file_path ?? input.notebook_path ?? input.path;
      if (typeof path === 'string' && ['content', 'new_string', 'edits', 'new_source', 'patch'].some((k) => k in input)) t.writesFiles = true;
    }
  }
  s.sessionIds = [...ids];
  return s;
}

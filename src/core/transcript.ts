// SPDX-License-Identifier: Apache-2.0
/**
 * Reading Claude Code's session transcripts (JSON Lines). The format is not documented and changes, so
 * every reader here is defensive: an unknown row is skipped, never fatal, and nothing is assumed beyond
 * `type`, `message.role`, `message.content` blocks, `timestamp` and `isMeta`.
 */
import type { ToolUse } from './footer.js';

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
      uses.push({ name: b.name, input: (typeof b.input === 'object' && b.input !== null ? b.input : {}) as Record<string, unknown> });
    }
  }
  const ts = start >= 0 ? rows[start]?.timestamp : undefined;
  const startedAt = typeof ts === 'string' ? Date.parse(ts) : null;
  return { startedAt: startedAt !== null && Number.isFinite(startedAt) ? startedAt : null, uses, complete: start >= 0 };
}

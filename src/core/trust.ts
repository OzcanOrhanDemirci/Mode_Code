// SPDX-License-Identifier: Apache-2.0
/**
 * What runs inside Claude Code besides the model (A3-12 of 1.2.0): plugins, hooks, MCP servers, skills, agents and
 * commands, each by where it comes from, and what is new or gone since the person last looked (state/trust.json).
 * Plugins and their mods run unsandboxed, in Claude Code's own process, and a mod can answer tool calls: what is on
 * this list should be what the person chose. Pure: the command line gathers it (src/cli/commands.ts).
 */

export type TrustKind = 'plugin' | 'hook' | 'mcp' | 'skill' | 'agent' | 'command';

export interface TrustItem {
  kind: TrustKind;
  /** What names it: plugin@marketplace, event · command, the server, the file's name. */
  name: string;
  /** Where it is set: user, project, local, managed. */
  scope: string;
  /** What it is beyond its name: enabled or not, a command line, a server's address. */
  detail: string;
}

/** An item as one line of the snapshot: what tells two looks apart. */
export const trustKey = (i: TrustItem) => `${i.kind}\u0000${i.scope}\u0000${i.name}\u0000${i.detail}`;

/** What was added and what went since the last look (null: none recorded, nothing is new). */
export function trustChanges(now: readonly TrustItem[], before: readonly string[] | null): { added: TrustItem[]; gone: string[] } {
  if (before === null) return { added: [], gone: [] };
  const was = new Set(before);
  const is = new Set(now.map(trustKey));
  return { added: now.filter((i) => !was.has(trustKey(i))), gone: before.filter((k) => !is.has(k)) };
}

export function parseTrustSnapshot(text: string | null): string[] | null {
  try {
    const o = JSON.parse(text ?? '') as { items?: unknown };
    return Array.isArray(o.items) ? o.items.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

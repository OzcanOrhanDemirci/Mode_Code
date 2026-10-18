// SPDX-License-Identifier: Apache-2.0
/**
 * Pinned MCP tool descriptions (A3-4 of 1.2.0): a connected server's tool is described to the model in the server's
 * own words, and a server can change those words after the person trusted it ("rug pull"): new instructions, read as
 * the tool's. The first description seen is kept as a fingerprint (state/mcp-pins.json); a later one that differs is
 * told to the person and the model, once, and becomes the one kept. Pure.
 */
import { sha256Hex } from './sha256.js';

export interface McpPins {
  v: 1;
  tools: Record<string, { hash: string; at: number }>;
}

export function parsePins(text: string | null): McpPins {
  try {
    const o = JSON.parse(text ?? '') as { v?: unknown; tools?: unknown };
    if (o.v !== 1 || typeof o.tools !== 'object' || Array.isArray(o.tools)) return { v: 1, tools: {} };
    // No prototype: a tool named "__proto__" or "constructor" is a name like any other.
    const tools: McpPins['tools'] = Object.create(null) as McpPins['tools'];
    for (const [name, p] of Object.entries((o.tools ?? {}) as Record<string, unknown>)) {
      const x = p as { hash?: unknown; at?: unknown };
      if (x && typeof x.hash === 'string' && /^[0-9a-f]{64}$/.test(x.hash) && typeof x.at === 'number') tools[name] = { hash: x.hash, at: x.at };
    }
    return { v: 1, tools };
  } catch {
    return { v: 1, tools: {} };
  }
}

/**
 * The tools as seen now against the pins: the pins to keep (new tools added, changed ones moved to their new
 * description) and the names whose description changed. A tool not seen now keeps its pin: a server may be off.
 */
export function comparePins(
  pins: McpPins,
  seen: readonly { name: string; description: string }[],
  now: number,
): { pins: McpPins; changed: string[]; added: number } {
  const tools: McpPins['tools'] = Object.assign(Object.create(null) as McpPins['tools'], pins.tools);
  const changed: string[] = [];
  let added = 0;
  for (const t of seen) {
    const hash = sha256Hex(t.description);
    const was = tools[t.name];
    if (!was) added++;
    else if (was.hash !== hash) changed.push(t.name);
    else continue;
    tools[t.name] = { hash, at: now };
  }
  return { pins: { v: 1, tools }, changed, added };
}

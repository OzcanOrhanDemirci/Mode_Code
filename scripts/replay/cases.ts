// SPDX-License-Identifier: Apache-2.0
/**
 * Replaying tool calls through the belt (the core protection's method, step 5): the one case format every
 * set is converted to, the converters from the trajectory formats public sets use, and the summary the
 * runner prints. Pure; scripts/belt-replay.ts reads and writes the files. Nothing of a case's content
 * reaches the summary: totals, labels, verdicts, rules, categories and digests only. The sets themselves
 * live outside this repository (attack sets in a private one); this file holds field mappings, never data.
 */
import { sha256Hex } from '../../src/core/sha256.js';

export type Label = 'attack' | 'benign';
export type ReplayPlatform = 'linux' | 'darwin' | 'win32';

/** One tool call as Claude Code would make it, with where it came from. */
export interface ReplayCase {
  case_id: string;
  source: string;
  version: string;
  license: string;
  label: Label;
  category: string;
  origin: { trajectory: string; step: number };
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
  /** The system the call was made on, when it is not this computer's (a Linux container in a public set). */
  platform?: ReplayPlatform;
  payload_sha256: string;
}

/** What every case of one conversion shares. */
export interface CaseMeta {
  source: string;
  version: string;
  license: string;
  label: Label;
  category: string;
  cwd?: string;
  platform?: ReplayPlatform;
}

type Call = { tool: string; input: Record<string, unknown> };

const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A digest short enough to print and long enough to find the case again in its set. */
export function digest(text: string): string {
  return sha256Hex(text).slice(0, 12);
}

export function makeCase(meta: CaseMeta, trajectory: string, step: number, call: Call, cwd?: string): ReplayCase {
  const where = cwd ?? meta.cwd;
  return {
    case_id: `${meta.source}:${trajectory}:${step}`,
    source: meta.source,
    version: meta.version,
    license: meta.license,
    label: meta.label,
    category: meta.category,
    origin: { trajectory, step },
    tool_name: call.tool,
    tool_input: call.input,
    ...(where ? { cwd: where } : {}),
    ...(meta.platform ? { platform: meta.platform } : {}),
    payload_sha256: sha256Hex(JSON.stringify(call.input)),
  };
}

/** Claude Code's own records (`~/.claude/projects`, CC-Bench): every tool_use block of an assistant record, in order, each once. */
export function fromClaudeCode(records: readonly unknown[], trajectory: string, meta: CaseMeta): ReplayCase[] {
  const out: ReplayCase[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!isRecord(r) || r.type !== 'assistant' || !isRecord(r.message) || !Array.isArray(r.message.content)) continue;
    for (const b of r.message.content as unknown[]) {
      if (!isRecord(b) || b.type !== 'tool_use' || typeof b.name !== 'string' || !isRecord(b.input)) continue;
      const id = str(b.id);
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(makeCase(meta, trajectory, out.length, { tool: b.name, input: b.input }, str(r.cwd) ?? undefined));
    }
  }
  return out;
}

/** The file editor OpenHands and SWE-agent share, as Claude Code's tools; null for what changes nothing (undo). */
function editorCall(args: Record<string, unknown>): Call | null {
  const file_path = str(args.path);
  if (file_path === null) return null;
  switch (args.command) {
    case 'create':
      return { tool: 'Write', input: { file_path, content: str(args.file_text) ?? '' } };
    case 'str_replace':
      return { tool: 'Edit', input: { file_path, old_string: str(args.old_str) ?? '', new_string: str(args.new_str) ?? '' } };
    case 'insert':
      return { tool: 'Edit', input: { file_path, old_string: '', new_string: str(args.new_str) ?? '' } };
    case 'view':
      return { tool: 'Read', input: { file_path } };
    default:
      return null;
  }
}

/** An agent's function call as Claude Code's: the shell, the editor; thinking, finishing and task lists are not calls. */
export function mapCall(name: string, args: Record<string, unknown>): Call | null {
  if (name === 'execute_bash' || name === 'bash') {
    // Input typed into a command still running is not a command of its own.
    if (args.is_input === true || args.is_input === 'true') return null;
    const command = str(args.command);
    return command ? { tool: 'Bash', input: { command } } : null;
  }
  if (name === 'str_replace_editor') return editorCall(args);
  return null;
}

/** OpenHands messages (SWE-rebench-openhands): each assistant message's `tool_calls`, their arguments a JSON string. */
export function fromOpenHands(messages: readonly unknown[], trajectory: string, meta: CaseMeta): ReplayCase[] {
  const out: ReplayCase[] = [];
  for (const m of messages) {
    if (!isRecord(m) || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const c of m.tool_calls as unknown[]) {
      if (!isRecord(c) || !isRecord(c.function) || typeof c.function.name !== 'string') continue;
      let args: unknown = c.function.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          continue;
        }
      }
      if (!isRecord(args)) continue;
      const call = mapCall(c.function.name, args);
      if (call) out.push(makeCase(meta, trajectory, out.length, call));
    }
  }
  return out;
}

const FUNCTION = /<function=([\w.-]+)>([\s\S]*?)<\/function>/g;
const PARAMETER = /<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g;

/** SWE-agent's calls written into the message (SWE-smith): `<function=name><parameter=key>value</parameter></function>`. */
export function fromSweAgentXml(messages: readonly unknown[], trajectory: string, meta: CaseMeta): ReplayCase[] {
  const out: ReplayCase[] = [];
  for (const m of messages) {
    if (!isRecord(m) || m.role !== 'assistant' || typeof m.content !== 'string') continue;
    for (const f of m.content.matchAll(FUNCTION)) {
      const args: Record<string, unknown> = {};
      // A value starts and ends on a line of its own: the line breaks around it are the format's.
      for (const p of f[2]!.matchAll(PARAMETER)) args[p[1]!] = p[2]!.replace(/^\n/, '').replace(/\n$/, '');
      const call = mapCall(f[1]!, args);
      if (call) out.push(makeCase(meta, trajectory, out.length, call));
    }
  }
  return out;
}

/** A case judged: the belt's verdict and the rules behind it. */
export interface Judged {
  c: ReplayCase;
  /** null: not a call the belt judges (a read, a search). */
  verdict: string | null;
  rules: readonly string[];
}

type Counts = Record<string, number>;

export interface SourceSummary {
  /** Calls read, and those the belt judges. */
  calls: number;
  judged: number;
  /** label → verdict → count. */
  verdicts: Record<string, Counts>;
  /** rule → verdict → count. */
  rules: Record<string, Counts>;
  /** category → verdict → count. */
  categories: Record<string, Counts>;
  /** Attack cases the belt let through, as digests of their ids (at most `keep`). */
  missed: string[];
  /** Everyday cases the belt stopped or asked about. */
  stopped: number;
}

const add = (t: Record<string, Counts>, k: string, v: string) => {
  t[k] ??= {};
  t[k][v] = (t[k][v] ?? 0) + 1;
};

/** Totals per source, nothing of any case's content. */
export function summarize(judged: readonly Judged[], keep = 20): Record<string, SourceSummary> {
  const out: Record<string, SourceSummary> = {};
  for (const j of judged) {
    const s = (out[j.c.source] ??= { calls: 0, judged: 0, verdicts: {}, rules: {}, categories: {}, missed: [], stopped: 0 });
    s.calls++;
    if (j.verdict === null) continue;
    s.judged++;
    add(s.verdicts, j.c.label, j.verdict);
    add(s.categories, j.c.category, j.verdict);
    for (const r of new Set(j.rules)) add(s.rules, r, j.verdict);
    if (j.c.label === 'attack' && j.verdict === 'allow' && s.missed.length < keep) s.missed.push(digest(j.c.case_id));
    if (j.c.label === 'benign' && (j.verdict === 'ask' || j.verdict === 'deny')) s.stopped++;
  }
  return out;
}

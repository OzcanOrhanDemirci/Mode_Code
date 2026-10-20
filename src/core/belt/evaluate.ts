// SPDX-License-Identifier: Apache-2.0
/**
 * The belt's single entry point: a tool call in, a decision out. Shared by the in-process mod and the
 * safety-net hook, so both layers decide exactly the same way.
 */
import { tIn } from '../i18n/index.js';
import { visibleText } from '../text.js';
import { checkCommand, checkFileTool, checkOutward } from './check.js';
import { ACT_ORDER, effectiveAct, VERDICT_OF } from './rules.js';
import { isFileTool, isOutwardTool, shellOf } from './tools.js';
import type { BeltContext, BeltDecision, Finding, Verdict } from './types.js';

function str(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

export async function evaluateToolCall(tool: string, input: Readonly<Record<string, unknown>>, ctx: BeltContext): Promise<BeltDecision> {
  let raw: Finding[] = [];
  let issues: string[] = [];
  const shell = shellOf(tool);
  if (shell) {
    const command = str(input.command) ?? '';
    const r = await checkCommand(command, shell, ctx);
    raw = r.findings;
    issues = r.issues;
  } else if (isFileTool(tool)) {
    const path = str(input.file_path) ?? str(input.notebook_path) ?? '';
    if (path) {
      const edits: { oldText: string; newText: string }[] = [];
      if (tool === 'Edit') edits.push({ oldText: str(input.old_string) ?? '', newText: str(input.new_string) ?? '' });
      if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
        for (const e of input.edits as Record<string, unknown>[]) edits.push({ oldText: str(e?.old_string) ?? '', newText: str(e?.new_string) ?? '' });
      }
      const content = tool === 'Write' ? str(input.content) : tool === 'NotebookEdit' ? str(input.new_source) : null;
      raw = await checkFileTool(tool, path, { content, edits }, ctx);
    }
  } else if (isOutwardTool(tool)) {
    raw = checkOutward(tool, input, ctx);
  }
  return decide(raw, issues, ctx);
}

/** The strictest first: a stop before a call left to the person, before a question, before a note. */
const byAct = (a: Finding, b: Finding) => ACT_ORDER[b.act ?? 'pass'] - ACT_ORDER[a.act ?? 'pass'];

/**
 * Applies the catalog at the session's level (Manual when none is given) and the person's configuration to raw
 * findings, dedupes, and picks the verdict.
 */
export function decide(raw: readonly Finding[], issues: readonly string[], ctx: Pick<BeltContext, 'config' | 'level'>): BeltDecision {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const f of raw) {
    const act = effectiveAct(f.rule, ctx.level ?? 'manual', ctx.config);
    if (!act || act === 'pass') continue;
    const key = f.rule + '\u0000' + f.reason;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ ...f, verdict: VERDICT_OF[act], act });
  }
  findings.sort(byAct);
  const verdict: Verdict = findings[0]?.verdict ?? 'allow';
  return { verdict, findings, issues: [...issues] };
}

/** Two decisions about one call as one: the stricter verdict, every finding. */
export function mergeDecisions(a: BeltDecision, b: BeltDecision): BeltDecision {
  const findings = [...a.findings, ...b.findings].sort(byAct);
  return { verdict: findings[0]?.verdict ?? 'allow', findings, issues: [...a.issues, ...b.issues] };
}

/**
 * The text that goes back to Claude Code. For a deny it is also what the person sees in the transcript,
 * so it is written in their language: what was blocked, why, and that it must not be worked around. A call left
 * to the person carries the command exactly as it would run (`command`, a shell command), every character shown;
 * in full autonomy Claude is told to leave it and go on. A call stopped outright is handed to nobody.
 */
export function decisionText(d: BeltDecision, ctx: Pick<BeltContext, 'lang' | 'level'>, opts: { repeatCount?: number; command?: string | null } = {}): string {
  const shown = d.findings.filter((f) => f.verdict === d.verdict);
  const lines = shown.map((f) => `• ${f.reason} [${f.rule}]`);
  const head = tIn(ctx.lang, d.verdict === 'deny' ? 'belt.head.deny' : d.verdict === 'ask' ? 'belt.head.ask' : 'belt.head.warn');
  const stopped = d.verdict === 'deny' && shown.some((f) => f.act === 'stop');
  const tails =
    d.verdict === 'ask'
      ? [tIn(ctx.lang, 'belt.tail.ask')]
      : d.verdict !== 'deny'
        ? []
        : stopped
          ? [tIn(ctx.lang, 'belt.tail.stop')]
          : [
              tIn(ctx.lang, 'belt.tail.deny'),
              opts.command ? tIn(ctx.lang, 'belt.tail.command', { command: visibleText(opts.command) }) : '',
              ctx.level === 'full' ? tIn(ctx.lang, 'belt.tail.full') : '',
            ];
  const repeat = opts.repeatCount && opts.repeatCount > 1 ? tIn(ctx.lang, 'belt.tail.repeat', { n: opts.repeatCount }) : '';
  return [head, ...lines, ...tails, repeat].filter(Boolean).join('\n');
}

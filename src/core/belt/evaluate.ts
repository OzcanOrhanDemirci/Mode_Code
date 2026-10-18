// SPDX-License-Identifier: Apache-2.0
/**
 * The belt's single entry point: a tool call in, a decision out. Shared by the in-process mod and the
 * safety-net hook, so both layers decide exactly the same way.
 */
import { tIn } from '../i18n/index.js';
import { checkCommand, checkFileTool, checkOutward } from './check.js';
import { bypassVerdict, effectiveVerdict, RULES } from './rules.js';
import { isFileTool, isOutwardTool, shellOf } from './tools.js';
import { VERDICT_ORDER, type BeltContext, type BeltDecision, type Finding, type Verdict } from './types.js';

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

/**
 * Applies the catalog, the person's configuration and bypass to raw findings, dedupes, and picks the
 * verdict. What bypass changed is kept in `lifted`, with the verdict it had without bypass.
 */
export function decide(raw: readonly Finding[], issues: readonly string[], ctx: Pick<BeltContext, 'config' | 'bypass'>): BeltDecision {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const lifted: Finding[] = [];
  for (const f of raw) {
    const before = effectiveVerdict(f.rule, ctx.config);
    if (!before || before === 'allow') continue;
    const key = f.rule + '\u0000' + f.reason;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = ctx.bypass ? bypassVerdict(f.rule, before) : before;
    if (v !== before) lifted.push({ ...f, verdict: v, lifted: before });
    if (v === 'allow') continue;
    findings.push({ ...f, verdict: v, ...(v !== before ? { lifted: before } : {}) });
  }
  findings.sort((a, b) => VERDICT_ORDER[b.verdict] - VERDICT_ORDER[a.verdict]);
  const verdict: Verdict = findings[0]?.verdict ?? 'allow';
  return { verdict, findings, issues: [...issues], lifted };
}

/** Two decisions about one call as one: the stricter verdict, every finding, everything bypass changed. */
export function mergeDecisions(a: BeltDecision, b: BeltDecision): BeltDecision {
  const findings = [...a.findings, ...b.findings].sort((x, y) => VERDICT_ORDER[y.verdict] - VERDICT_ORDER[x.verdict]);
  return { verdict: findings[0]?.verdict ?? 'allow', findings, issues: [...a.issues, ...b.issues], lifted: [...a.lifted, ...b.lifted] };
}

/**
 * The text that goes back to Claude Code. For a deny it is also what the person sees in the transcript,
 * so it is written in their language: what was blocked, why, and that it must not be worked around. A
 * block that bypass would turn into a question says so: the way to do it, with the person's approval.
 */
export function decisionText(d: BeltDecision, ctx: Pick<BeltContext, 'lang' | 'bypass'>, opts: { repeatCount?: number } = {}): string {
  const shown = d.findings.filter((f) => f.verdict === d.verdict);
  const lines = shown.map((f) => `• ${f.reason} [${f.rule}]`);
  const head = tIn(ctx.lang, d.verdict === 'deny' ? 'belt.head.deny' : d.verdict === 'ask' ? 'belt.head.ask' : 'belt.head.warn');
  const tail = d.verdict === 'deny' ? tIn(ctx.lang, 'belt.tail.deny') : d.verdict === 'ask' ? tIn(ctx.lang, 'belt.tail.ask') : '';
  const viaBypass = d.verdict === 'deny' && !ctx.bypass && shown.every((f) => RULES[f.rule].bypass === 'ask') ? tIn(ctx.lang, 'belt.tail.bypass') : '';
  const floor = d.verdict === 'ask' && ctx.bypass && shown.some((f) => RULES[f.rule].bypass === 'ask') ? tIn(ctx.lang, 'belt.tail.floor') : '';
  const repeat = opts.repeatCount && opts.repeatCount > 1 ? tIn(ctx.lang, 'belt.tail.repeat', { n: opts.repeatCount }) : '';
  return [head, ...lines, floor, tail, viaBypass, repeat].filter(Boolean).join('\n');
}

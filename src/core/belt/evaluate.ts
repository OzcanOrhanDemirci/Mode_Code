// SPDX-License-Identifier: Apache-2.0
/**
 * The belt's single entry point: a tool call in, a decision out. Shared by the in-process mod and the
 * safety-net hook, so both layers decide exactly the same way.
 */
import { tIn } from '../i18n/index.js';
import { checkCommand, checkFileTool } from './check.js';
import { effectiveVerdict } from './rules.js';
import { VERDICT_ORDER, type BeltContext, type BeltDecision, type Finding, type Verdict } from './types.js';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function str(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

export async function evaluateToolCall(tool: string, input: Readonly<Record<string, unknown>>, ctx: BeltContext): Promise<BeltDecision> {
  let raw: Finding[] = [];
  let issues: string[] = [];
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = str(input.command) ?? '';
    const r = await checkCommand(command, tool === 'PowerShell' ? 'powershell' : 'bash', ctx);
    raw = r.findings;
    issues = r.issues;
  } else if (FILE_TOOLS.has(tool)) {
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
  }
  return decide(raw, issues, ctx);
}

/** Applies the catalog and the person's configuration to raw findings, dedupes, and picks the verdict. */
export function decide(raw: readonly Finding[], issues: readonly string[], ctx: Pick<BeltContext, 'config'>): BeltDecision {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const f of raw) {
    const v = effectiveVerdict(f.rule, ctx.config);
    if (!v || v === 'allow') continue;
    const key = f.rule + '\u0000' + f.reason;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ ...f, verdict: v });
  }
  findings.sort((a, b) => VERDICT_ORDER[b.verdict] - VERDICT_ORDER[a.verdict]);
  const verdict: Verdict = findings[0]?.verdict ?? 'allow';
  return { verdict, findings, issues: [...issues] };
}

/**
 * The text that goes back to Claude Code. For a deny it is also what the person sees in the transcript,
 * so it is written in their language: what was blocked, why, and that it must not be worked around.
 */
export function decisionText(d: BeltDecision, ctx: Pick<BeltContext, 'lang'>, opts: { repeatCount?: number } = {}): string {
  const lines = d.findings.filter((f) => f.verdict === d.verdict).map((f) => `• ${f.reason} [${f.rule}]`);
  const head = tIn(ctx.lang, d.verdict === 'deny' ? 'belt.head.deny' : d.verdict === 'ask' ? 'belt.head.ask' : 'belt.head.warn');
  const tail = d.verdict === 'deny' ? tIn(ctx.lang, 'belt.tail.deny') : d.verdict === 'ask' ? tIn(ctx.lang, 'belt.tail.ask') : '';
  const repeat = opts.repeatCount && opts.repeatCount > 1 ? tIn(ctx.lang, 'belt.tail.repeat', { n: opts.repeatCount }) : '';
  return [head, ...lines, tail, repeat].filter(Boolean).join('\n');
}

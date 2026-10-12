// SPDX-License-Identifier: Apache-2.0
/**
 * The belt replayed over the person's own recent sessions: every shell command and file write Claude Code
 * made, judged as the belt judges it today. Only counts come out (how many calls, how many would have been
 * asked about or blocked, by rule); no command text is kept or shown, and nothing is executed. It answers
 * "how often would this interrupt me?" with the person's own history instead of a promise.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../core/config.js';
import type { Lang } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { evaluateToolCall } from '../core/belt/evaluate.js';
import { isBeltTool } from '../core/belt/tools.js';
import type { BeltContext, Verdict } from '../core/belt/types.js';
import { beltContext } from '../node/context.js';
import { readText } from '../node/fsx.js';

export interface ReplayResult {
  days: number;
  /** Transcript files read. */
  files: number;
  /** Tool calls the belt checks, in the period. */
  calls: number;
  asked: number;
  blocked: number;
  noted: number;
  /** Sessions with at least one question. */
  sessionsAsked: number;
  /** Questions per day over the period. */
  askedPerDay: number;
  byRule: { rule: string; verdict: Verdict; count: number }[];
  ms: number;
}

function transcripts(dir: string, since: number): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 6) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl'))
        try {
          if (statSync(p).mtimeMs >= since) out.push(p);
        } catch {
          /* gone meanwhile */
        }
    }
  };
  walk(dir, 0);
  return out;
}

export async function replay(opts: {
  claudeDir: string;
  config: Config;
  layout: Layout;
  lang: Lang;
  days: number;
  now?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<ReplayResult> {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const since = now - opts.days * 86400_000;
  const files = transcripts(join(opts.claudeDir, 'projects'), since);
  // One context per folder: git is asked about each repository once, not once per call.
  const contexts = new Map<string, BeltContext>();
  const ctxFor = (cwd: string) => {
    let c = contexts.get(cwd);
    if (!c) {
      c = beltContext({ cwd, config: opts.config, layout: opts.layout, lang: opts.lang });
      contexts.set(cwd, c);
    }
    return c;
  };
  const counts = new Map<string, { rule: string; verdict: Verdict; count: number }>();
  let calls = 0;
  let asked = 0;
  let blocked = 0;
  let noted = 0;
  let sessionsAsked = 0;
  for (let i = 0; i < files.length; i++) {
    opts.onProgress?.(i, files.length);
    let fileAsked = false;
    for (const line of (readText(files[i]!) ?? '').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let row: { type?: string; timestamp?: string; cwd?: string; message?: { content?: unknown } };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue;
      const ts = Date.parse(row.timestamp ?? '');
      if (!(ts >= since)) continue;
      for (const b of row.message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (b?.type !== 'tool_use' || !b.name || !isBeltTool(b.name)) continue;
        calls++;
        const d = await evaluateToolCall(b.name, b.input ?? {}, ctxFor(row.cwd ?? opts.claudeDir));
        if (d.verdict === 'allow') continue;
        if (d.verdict === 'ask') {
          asked++;
          fileAsked = true;
        } else if (d.verdict === 'deny') blocked++;
        else noted++;
        for (const f of d.findings.filter((x) => x.verdict === d.verdict)) {
          const key = `${f.verdict} ${f.rule}`;
          const c = counts.get(key) ?? { rule: f.rule, verdict: f.verdict, count: 0 };
          c.count++;
          counts.set(key, c);
        }
      }
    }
    if (fileAsked) sessionsAsked++;
  }
  opts.onProgress?.(files.length, files.length);
  return {
    days: opts.days,
    files: files.length,
    calls,
    asked,
    blocked,
    noted,
    sessionsAsked,
    askedPerDay: Math.round((asked / Math.max(1, opts.days)) * 10) / 10,
    byRule: [...counts.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule, 'en')),
    ms: Date.now() - started,
  };
}

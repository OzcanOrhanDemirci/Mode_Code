// SPDX-License-Identifier: Apache-2.0
/**
 * "What happened": a report for a period (the last day, the last week), built from the session index and
 * the event log. Used by `terminal-code report` and the control center's report screen.
 */
import type { SessionIndex, SessionRow, TokenTotals, ToolStat } from '../node/index-db.js';
import { cacheHitRate } from '../node/index-db.js';
import type { ToolEvent } from './data.js';
import { compact, percent, shortPath } from '../core/format.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';

export interface Report {
  from: number;
  to: number;
  sessions: SessionRow[];
  folders: { cwd: string; sessions: number }[];
  prompts: number;
  totals: TokenTotals;
  cacheHit: number | null;
  tools: ToolStat[];
  blocked: number;
  asked: number;
  allowedAfterAsk: number;
  topRules: { rule: string; count: number }[];
  quota: { weekFrom: number | null; weekTo: number | null; fiveMax: number | null };
  stops: number;
  resumes: number;
  conflicts: number;
}

export function buildReport(idx: SessionIndex | null, events: readonly ToolEvent[], from: number, to: number): Report {
  const inRange = (t: number) => t >= from && t <= to;
  const sessions = idx ? idx.sessions({ since: from, limit: 1000 }).filter((s) => s.lastTs >= from && s.firstTs <= to) : [];
  const folders = new Map<string, number>();
  for (const s of sessions) if (s.cwd) folders.set(s.cwd, (folders.get(s.cwd) ?? 0) + 1);
  const totals: TokenTotals = idx ? idx.totals(from) : { messages: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, agentTokens: 0 };
  const ev = events.filter((e) => inRange(e.at));
  const belt = ev.filter((e) => e.kind === 'belt');
  const rules = new Map<string, number>();
  for (const e of belt) if (e.verdict === 'deny' || e.verdict === 'ask') for (const r of e.rules ?? []) rules.set(r, (rules.get(r) ?? 0) + 1);
  const readings = ev.filter((e) => e.kind === 'reading').sort((a, b) => a.at - b.at);
  const weeks = readings.map((r) => r.week).filter((x): x is number => typeof x === 'number');
  const fives = readings.map((r) => r.five).filter((x): x is number => typeof x === 'number');
  return {
    from,
    to,
    sessions,
    folders: [...folders.entries()].map(([cwd, n]) => ({ cwd, sessions: n })).sort((a, b) => b.sessions - a.sessions),
    prompts: sessions.reduce((n, s) => n + s.prompts, 0),
    totals,
    cacheHit: cacheHitRate(totals),
    tools: idx ? idx.tools({ since: from, limit: 8 }) : [],
    blocked: belt.filter((e) => e.verdict === 'deny').length,
    asked: belt.filter((e) => e.verdict === 'ask').length,
    allowedAfterAsk: belt.filter((e) => e.verdict === 'ask' && e.answer === 'allow').length,
    topRules: [...rules.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    quota: { weekFrom: weeks[0] ?? null, weekTo: weeks[weeks.length - 1] ?? null, fiveMax: fives.length ? Math.max(...fives) : null },
    stops: ev.filter((e) => e.kind === 'quota' && e.level === 'stop').length,
    resumes: ev.filter((e) => e.kind === 'resume').length,
    conflicts: ev.filter((e) => e.kind === 'conflict').length,
  };
}

/** Report lines for a period, in the person's language; shared by the command and the control center. */
export function reportLines(r: Report, lang: Lang, home: string): { label: string; text: string }[] {
  const L = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);
  const all = r.totals.input + r.totals.cacheWrite + r.totals.cacheRead + r.totals.output;
  const out: { label: string; text: string }[] = [
    { label: L('report.sessions'), text: L('report.sessionsText', { n: r.sessions.length, folders: r.folders.length, prompts: r.prompts }) },
    {
      label: L('report.tokens'),
      text: L('report.tokensText', {
        out: compact(r.totals.output, lang),
        hit: r.cacheHit === null ? '?' : percent(r.cacheHit * 100, lang, 1),
        agents: all ? percent((r.totals.agentTokens / all) * 100, lang) : '0',
      }),
    },
    {
      label: L('report.belt'),
      text:
        L('report.beltText', { blocked: r.blocked, asked: r.asked, allowed: r.allowedAfterAsk }) +
        (r.topRules.length ? ' · ' + r.topRules.map((x) => `${x.rule} (${x.count})`).join(', ') : ''),
    },
  ];
  if (r.quota.weekTo !== null)
    out.push({
      label: L('report.quota'),
      text: L('report.quotaText', { from: percent(r.quota.weekFrom, lang), to: percent(r.quota.weekTo, lang), peak: percent(r.quota.fiveMax, lang) }),
    });
  if (r.stops || r.resumes) out.push({ label: L('report.auto'), text: L('report.autoText', { stops: r.stops, resumes: r.resumes }) });
  if (r.conflicts) out.push({ label: L('report.conflicts'), text: L('report.conflictsText', { n: r.conflicts }) });
  if (r.folders.length)
    out.push({
      label: L('report.folders'),
      text: r.folders
        .slice(0, 5)
        .map((f) => `${shortPath(f.cwd, home, 40)} (${f.sessions})`)
        .join(' · '),
    });
  if (r.tools.length)
    out.push({
      label: L('report.tools'),
      text: r.tools
        .slice(0, 6)
        .map((t) => `${t.name} ${t.calls}${t.errors ? ` (${L(t.errors === 1 ? 'report.errors.one' : 'report.errors', { n: t.errors })})` : ''}`)
        .join(' · '),
    });
  return out;
}

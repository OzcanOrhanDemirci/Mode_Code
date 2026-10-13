// SPDX-License-Identifier: Apache-2.0
/**
 * The report of a full-autonomy run: what Claude wrote (its summary and the decisions it took on its own)
 * and what code measured (milestones and their reviews, the ways back to each, the verification, every step
 * that waits for the person, the blockers). Pure: the draft's check, and the facts section in the person's
 * language. The plugin joins them and keeps the result out of Claude's reach.
 */
import { sectionText, type CheckProblem } from './flow-checks.js';
import { tIn, type Lang, type MessageKey } from './i18n/index.js';
import { activeTime, type Run } from './run.js';

const SUMMARY = ['summary', 'ozet', 'what was done', 'yapilanlar'];
const DECISIONS = ['decisions', 'kararlar', 'autonomous decisions', 'otonom kararlar'];
const BLOCKED = ['blocked', 'blockers', 'engeller', 'tikananlar'];

/** Checks the draft Claude wrote: a summary and its decisions; for a stuck run, what blocked it. */
export function checkDraft(markdown: string | null, kind: 'done' | 'stuck', path: string): CheckProblem[] {
  if (markdown === null) return [{ key: 'auto.check.report.missing', params: { path } }];
  const problems: CheckProblem[] = [];
  if (!sectionText(markdown, SUMMARY)) problems.push({ key: 'auto.check.report.noSummary' });
  if (sectionText(markdown, DECISIONS) === null) problems.push({ key: 'auto.check.report.noDecisions' });
  if (kind === 'stuck' && !sectionText(markdown, BLOCKED)) problems.push({ key: 'auto.check.report.noBlocked' });
  return problems;
}

/** The two ways back to a run's point n (0: where it started): a new branch, or the current branch moved. */
export function rollbackCommands(r: Run, n: number): { keep: string; move: string } | null {
  const commit = n === 0 ? r.start.commit : r.milestones.find((m) => m.n === n)?.commit;
  if (!commit) return null;
  const short = commit.slice(0, 12);
  return { keep: `git switch -c back-${r.id}-${n} ${short}`, move: `git reset --hard ${short}` };
}

/** "3 h 12 min", "45 min", "less than a minute". */
export function durationText(ms: number, lang: Lang): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return tIn(lang, 'auto.duration.underMinute');
  const h = Math.floor(min / 60);
  return h ? tIn(lang, 'auto.duration.hours', { h, m: min % 60 }) : tIn(lang, 'auto.duration.minutes', { m: min });
}

export interface ReportExtra {
  now: number;
  /** The notes file exists (memory notes waiting for the person). */
  notes: boolean;
  /** The quota when the report was written. */
  quota: { five: number | null; week: number | null } | null;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

/** What code measured, as a Markdown section in the person's language. */
export function factsSection(r: Run, lang: Lang, x: ReportExtra): string {
  const t = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);
  const status =
    r.status === 'paused' && r.pause
      ? t('auto.report.statusPaused', { reason: t(`auto.pause.${r.pause.reason}` as MessageKey) })
      : t(`auto.status.${r.status}` as MessageKey);
  const out: string[] = [
    `## ${t('auto.report.facts')}`,
    '',
    `- ${t('auto.report.task')}: ${r.task ? `«${r.task}»` : t('auto.report.noTask')}`,
    `- ${t('auto.report.status')}: ${status}`,
    `- ${t('auto.report.time')}: ${durationText(activeTime(r, x.now), lang)}`,
    `- ${t('auto.report.budget', { target: r.budget.weeklyTarget, source: r.budget.source })}${x.quota?.week !== null && x.quota?.week !== undefined ? ` · ${t('auto.report.quotaNow', { week: Math.round(x.quota.week) })}` : ''}`,
    `- ${t('auto.report.folder')}: ${r.cwd}`,
  ];
  const back0 = rollbackCommands(r, 0);
  if (back0) out.push(`- ${t('auto.report.start', { commit: r.start.commit.slice(0, 12), branch: r.start.branch ?? '-' })}: \`${back0.keep}\``);

  out.push('', `### ${t('auto.report.milestones')}`, '');
  if (!r.milestones.length) out.push(t('auto.report.noMilestones'));
  else {
    out.push(
      `| # | ${t('auto.report.col.step')} | ${t('auto.report.col.commit')} | ${t('auto.report.col.review')} | ${t('auto.report.col.back')} |`,
      '|---|---|---|---|---|',
    );
    for (const m of r.milestones) {
      const step = r.plan?.steps.find((s) => s.n === m.n);
      const b = rollbackCommands(r, m.n)!;
      out.push(
        `| ${m.n} | ${cell(step?.title ?? '')} | \`${m.commit.slice(0, 12)}\` (${m.commits}) | ${t(`auto.verdict.${m.review.verdict}` as MessageKey)} | \`${b.keep}\` · \`${b.move}\` |`,
      );
    }
    const found = r.milestones.filter((m) => m.review.findings.length && m.review.verdict !== 'pass');
    if (found.length) {
      out.push('', `${t('auto.report.findings')}:`);
      for (const m of found) for (const f of m.review.findings) out.push(`- ${m.n}: ${f}`);
    }
  }

  out.push('', `### ${t('auto.report.verification')}`, '');
  if (r.finish) {
    for (const v of r.finish.verification) out.push(`- \`${v.command}\` ${v.ok ? '✓' : '✗'} (${v.seconds} s)`);
    out.push(`- ${t('auto.report.finalReview')}: ${t(`auto.verdict.${r.finish.review.verdict}` as MessageKey)}`);
    for (const f of r.finish.review.findings) out.push(`  - ${f}`);
  } else out.push(t('auto.report.notFinished', { n: r.plan?.verification.length ?? 0 }));

  out.push('', `### ${t('auto.report.deferred')}`, '');
  if (!r.deferred.length) out.push(t('auto.report.noDeferred'));
  for (const d of r.deferred)
    out.push(`- **${t(`auto.defer.${d.kind}` as MessageKey)}** · ${d.tool}: \`${cell(d.what)}\` (${d.reason})${d.count > 1 ? ` ×${d.count}` : ''}`);

  out.push('', `### ${t('auto.report.blockers')}`, '');
  if (!r.blockers.length) out.push(t('auto.report.noBlockers'));
  for (const b of r.blockers) out.push(`- **${t(`auto.blocker.${b.kind}` as MessageKey)}**: ${b.text}`);

  if (x.notes) out.push('', `### ${t('auto.report.notes')}`, '', t('auto.report.notesAt', { path: r.notesPath }));
  return out.join('\n');
}

/** The report the person reads: Claude's draft (or a note that there is none), then what code measured. */
export function composeReport(draft: string | null, r: Run, lang: Lang, x: ReportExtra): string {
  const head = draft?.trim() ? draft.trim() : `# ${r.task ? r.task.split('\n')[0]!.slice(0, 120) : r.id}\n\n${tIn(lang, 'auto.report.noDraft')}`;
  return `${head}\n\n${factsSection(r, lang, x)}\n`;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The maintenance check as text: the command line prints it, the tests compare it. Pure; colors come
 * in through a Style so the same lines are produced with and without them.
 */
import { APP_NAME, APP_VERSION, REPO_URL } from '../../core/app.js';
import { tIn, type Lang, type MessageKey } from '../../core/i18n/index.js';
import { dateTime } from '../../core/format.js';
import { problemWords } from '../../core/config-words.js';
import type { Tally } from './checks.js';
import type { RepairReport, PlannedRepair, DoctorRun } from './doctor.js';
import type { SelfCheckReport } from './selfcheck.js';
import { GROUP_ORDER, type CheckResult, type CheckStatus, type Message } from './types.js';

export interface Style {
  ok(s: string): string;
  warn(s: string): string;
  fail(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

export const PLAIN: Style = { ok: (s) => s, warn: (s) => s, fail: (s) => s, dim: (s) => s, bold: (s) => s };

// One mark, one meaning (docs/design.md): the middle dot only joins facts on a line; information is an i.
const MARK: Record<CheckStatus, string> = { ok: '✓', info: 'i', warn: '!', fail: '✗', skip: '-' };

/** Paths in the parameters with the home folder written as ~ (and, for reports, the user name hidden). */
export function maskParams(params: Message['params'], home: string, user?: string): Message['params'] {
  if (!params) return params;
  const h = home.replace(/\\/g, '/');
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    // A time ("@at:<epoch ms>") holds no name and no path: a user called "at" must not turn it into one.
    if (typeof v !== 'string' || /^@at:\d+$/.test(v)) {
      out[k] = v;
      continue;
    }
    let s = v.replace(/\\/g, '/');
    if (h && s.toLowerCase().includes(h.toLowerCase())) s = s.replace(new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~');
    if (user && user.length > 1) s = s.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<user>');
    out[k] = s;
  }
  return out;
}

/**
 * A message in the person's language. A parameter written "@key" is itself a message, translated too; one
 * written "@at:<epoch ms>" is a local date and time, as the person's language writes it, and one written
 * "@problem:<reason>" a refusal of the settings in its words.
 */
export function say(lang: Lang, msg: Message, home: string, user?: string): string {
  const params = maskParams(msg.params, home, user);
  const word = (v: string | number): string | number => {
    if (typeof v !== 'string') return v;
    const at = /^@at:(\d+)$/.exec(v);
    if (at) return Number(at[1]) > 0 ? dateTime(Number(at[1]), lang) : '?';
    // A refusal of the settings ("@problem:<reason>"), said in the person's language (core/config-words.ts).
    if (v.startsWith('@problem:')) return problemWords(v.slice(9), lang);
    return /^@[\w.-]+$/.test(v) ? tIn(lang, v.slice(1) as MessageKey) : v;
  };
  const translated = params ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, word(v)])) : params;
  return tIn(lang, msg.key, translated);
}

function mark(status: CheckStatus, style: Style): string {
  const m = MARK[status];
  return status === 'ok' ? style.ok(m) : status === 'fail' ? style.fail(m) : status === 'warn' ? style.warn(m) : style.dim(m);
}

/** The checks grouped, one line each; details and the repair or hint under warnings and problems. */
export function renderChecks(results: readonly CheckResult[], opts: { lang: Lang; home: string; all?: boolean; style?: Style }): string[] {
  const st = opts.style ?? PLAIN;
  const lines: string[] = [];
  for (const g of GROUP_ORDER) {
    const rows = results.filter((r) => r.group === g && (opts.all || r.status !== 'skip'));
    if (!rows.length) continue;
    lines.push(st.bold(tIn(opts.lang, `doc.group.${g}` as MessageKey)));
    for (const r of rows) {
      const text = say(opts.lang, r.summary, opts.home);
      lines.push(`  ${mark(r.status, st)} ${r.status === 'skip' ? st.dim(text) : text}`);
      const loud = r.status === 'warn' || r.status === 'fail';
      for (const d of (r.details ?? []).slice(0, loud ? 8 : 3)) lines.push(st.dim(`      ${say(opts.lang, d, opts.home)}`));
      if (loud && r.repair) lines.push(st.dim(`      → ${tIn(opts.lang, `doc.repair.${r.repair}` as MessageKey)}`));
      else if (loud && r.hint) lines.push(st.dim(`      → ${say(opts.lang, r.hint, opts.home)}`));
    }
  }
  return lines;
}

export function renderSummary(t: Tally, checks: number, ms: number, lang: Lang, style: Style = PLAIN): string[] {
  const head = tIn(lang, 'doc.summary', { checks, s: (ms / 1000).toFixed(1), ok: t.ok, warn: t.warn, fail: t.fail });
  const lines = [t.fail ? style.fail(head) : t.warn ? style.warn(head) : style.ok(head)];
  if (t.protectionFail) lines.push(style.fail(tIn(lang, 'doc.summary.protection', { n: t.protectionFail })));
  return lines;
}

export function renderPlan(plans: readonly PlannedRepair[], lang: Lang, style: Style = PLAIN): string[] {
  const doable = plans.filter((p) => !p.refused);
  const lines: string[] = [];
  if (doable.length) {
    lines.push(tIn(lang, 'doc.repairs.offer', { n: doable.length }));
    doable.forEach((p, i) => lines.push(`  ${i + 1}. ${tIn(lang, `doc.repair.${p.id}` as MessageKey)}`));
  }
  const refused = plans.filter((p) => p.refused);
  if (refused.length)
    lines.push(style.warn(tIn(lang, 'doc.repairs.refused', { what: refused.map((p) => tIn(lang, `doc.repair.${p.id}` as MessageKey)).join('; ') })));
  return lines;
}

export function renderRepairs(rep: RepairReport, lang: Lang, home: string, style: Style = PLAIN): string[] {
  const lines: string[] = [style.bold(tIn(lang, 'doc.repairs.title'))];
  for (const o of rep.outcomes) {
    if (o.refused) continue;
    const name = tIn(lang, `doc.repair.${o.id}` as MessageKey);
    const state = o.verified
      ? style.ok(`✓ ${tIn(lang, 'doc.repairs.verified')}`)
      : o.ok
        ? style.warn(`! ${tIn(lang, 'doc.repairs.unverified')}`)
        : style.fail(`✗ ${tIn(lang, 'doc.repairs.failed', { detail: maskParams({ d: o.detail }, home)!.d as string })}`);
    lines.push(`  ${name}: ${state}`);
    if (o.backup) lines.push(style.dim(`      ${tIn(lang, 'doc.repairs.backup', { path: maskParams({ p: o.backup }, home)!.p as string })}`));
  }
  const t = rep.after.tally;
  lines.push(tIn(lang, 'doc.repairs.after', { ok: t.ok, warn: t.warn, fail: t.fail }));
  return lines;
}

export function renderSelfCheck(r: SelfCheckReport, lang: Lang, style: Style = PLAIN): string[] {
  const lines = [style.bold(tIn(lang, 'doc.self.title'))];
  if (r.skipped) return [...lines, style.warn(tIn(lang, 'doc.self.skipped', { why: r.skipped }))];
  lines.push(tIn(lang, 'doc.self.intro', { n: r.faults.length }));
  lines.push(
    r.baseline.ok
      ? `  ${style.ok('✓')} ${tIn(lang, 'doc.self.baseline')}`
      : `  ${style.fail('✗')} ${tIn(lang, 'doc.self.baselineBad', { problems: r.baseline.problems.join(', ') })}`,
  );
  for (const f of r.faults) {
    const good = f.detected && f.repaired !== false;
    const parts = [
      f.detected ? tIn(lang, 'doc.self.detected') : style.fail(tIn(lang, 'doc.self.missed')),
      f.repaired === null ? tIn(lang, 'doc.self.personFixes') : f.repaired ? tIn(lang, 'doc.self.repaired') : style.fail(tIn(lang, 'doc.self.notRepaired')),
    ];
    lines.push(`  ${good ? style.ok('✓') : style.fail('✗')} ${tIn(lang, `doc.fault.${f.id}` as MessageKey)} ${style.dim('· ' + parts.join(' · '))}`);
    if (!good) lines.push(style.dim(`      ${f.detail}`));
  }
  const bad = r.faults.filter((f) => !(f.detected && f.repaired !== false)).length + (r.baseline.ok ? 0 : 1);
  lines.push(bad ? style.fail(tIn(lang, 'doc.self.bad', { n: bad })) : style.ok(tIn(lang, 'doc.self.ok', { n: r.faults.length, s: (r.ms / 1000).toFixed(1) })));
  return lines;
}

/** A table cell's text: a backslash and a pipe written as themselves (GitHub's Markdown escapes both). */
const cell = (s: string) => s.replace(/[\\|]/g, '\\$&');

/** A detail naming a command, a server's command line or a permission rule: any of them may hold a secret or a name. */
const unshared = (d: Message) => !!d.params && ['command', 'target', 'rule'].some((k) => k in d.params!);

/**
 * A report to paste into an issue: versions and check results, in English, with the home folder and the
 * user name hidden. No commands, no file contents.
 */
export function renderReport(run: DoctorRun, opts: { home: string; user: string }): string {
  const f = run.facts;
  const lines = [
    `## ${tIn('en', 'doc.report.title')}`,
    '',
    `- ${APP_NAME} ${APP_VERSION} · Node.js ${f.node.version} · ${f.platform} ${f.arch} ${f.osRelease} · Claude Code ${f.claude.version ?? 'not found'}`,
    `- ${run.tally.ok} ok · ${run.tally.info} notes · ${run.tally.warn} warnings · ${run.tally.fail} problems · ${run.tally.skip} skipped`,
    '',
    '| check | status | result |',
    '| --- | --- | --- |',
  ];
  for (const r of run.results) {
    if (r.status === 'skip') continue;
    const text = cell(say('en', r.summary, opts.home, opts.user));
    lines.push(`| ${r.id} | ${r.status} | ${text} |`);
    if (r.status === 'warn' || r.status === 'fail')
      for (const d of (r.details ?? []).filter((x) => !unshared(x)).slice(0, 5)) lines.push(`|  |  | ${cell(say('en', d, opts.home, opts.user))} |`);
  }
  lines.push('', `<!-- ${tIn('en', 'doc.report.intro', { url: `${REPO_URL}/issues/new` })} -->`);
  return lines.join('\n');
}

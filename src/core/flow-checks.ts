// SPDX-License-Identifier: Apache-2.0
/**
 * The definitions of done of a flow's research and plan steps, checked on the Markdown the model wrote.
 * Pure: what needs the disk (do the cited files exist, how long are they) is returned for the caller to
 * measure, and joined back with `sourceProblems`. Problems carry a message key and its parameters, so the
 * person reads them in their language.
 */
import { fold } from './text.js';
import type { MessageKey } from './i18n/index.js';

export interface CheckProblem {
  key: MessageKey;
  params?: Record<string, string | number>;
}

interface Section {
  level: number;
  /** The heading, folded, without numbering or marks: "2. Findings 🔎" → "findings". */
  name: string;
  /** The lines under the heading, up to the next heading of the same or a higher level. */
  lines: string[];
}

interface Heading {
  level: number;
  title: string;
  line: number;
}

/** Headings outside fenced code blocks. */
function headings(lines: readonly string[]): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = /^\s{0,3}(```+|~~~+)/.exec(l);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) out.push({ level: h[1]!.length, title: h[2]!, line: i });
  });
  return out;
}

function nameOf(title: string): string {
  return fold(title)
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sections(lines: readonly string[]): Section[] {
  const hs = headings(lines);
  return hs.map((h, i) => {
    let end = lines.length;
    for (const n of hs.slice(i + 1))
      if (n.level <= h.level) {
        end = n.line;
        break;
      }
    return { level: h.level, name: nameOf(h.title), lines: lines.slice(h.line + 1, end) };
  });
}

function find(secs: readonly Section[], names: readonly string[]): Section | null {
  return secs.find((s) => names.some((n) => s.name === n || s.name.startsWith(`${n} `))) ?? null;
}

interface Item {
  /** The number of an ordered item (`3.` or `3)`), or null for a bullet. */
  n: number | null;
  text: string;
}

/** Top-level list items of a section, each with its continuation lines (nested items included). */
function items(lines: readonly string[]): Item[] {
  const out: Item[] = [];
  let fence = false;
  for (const l of lines) {
    if (/^\s{0,3}(```|~~~)/.test(l)) fence = !fence;
    if (/^\s{0,3}#{1,6}\s/.test(l) && !fence) break;
    const m = /^\s{0,3}(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(l);
    if (m && !fence) out.push({ n: m[2] ? parseInt(m[2], 10) : null, text: m[3]! });
    else if (out.length && l.trim()) out[out.length - 1]!.text += `\n${l.trim()}`;
  }
  return out;
}

const CITE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

function citations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE)) for (const n of m[1]!.split(',')) out.push(parseInt(n.trim(), 10));
  return out;
}

// ── the research report ───────────────────────────────────────────────────────────────────────────────

export type Source = { n: number; kind: 'url'; url: string } | { n: number; kind: 'file'; path: string; line: number | null; lineEnd: number | null };

export interface ReportCheck {
  problems: CheckProblem[];
  findings: number;
  sources: Source[];
}

const FINDINGS = ['findings', 'bulgular', 'key findings', 'results', 'sonuclar'];
const SOURCES = ['sources', 'kaynaklar', 'references', 'kaynakca', 'kaynakca ve notlar'];

function sourceOf(n: number, text: string): Source | null {
  const url = /https?:\/\/[^\s)>\]`"']+/.exec(text);
  if (url) {
    const u = url[0].replace(/[.,;:]+$/, '');
    if (/^https?:\/\/[^/\s]*[A-Za-z0-9]\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(u) || /^https?:\/\/localhost(?:[:/]|$)/.test(u)) return { n, kind: 'url', url: u };
    return null;
  }
  // The path is the first word ("src/a.ts:42: the handler") or, as it may hold spaces, a word in backticks;
  // a source that starts with backticks names its path in them.
  const body = text.replace(/^\[\d{1,3}\]\s*/, '').trim();
  const ticked = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const first = body.startsWith('`') ? [] : [body.split(/\s+/)[0] ?? ''];
  for (const raw of [...first, ...ticked]) {
    const candidate = raw.trim().replace(/[.,;:]+$/, '');
    const m = /^((?:[A-Za-z]:)?[^:*?"<>|`]*(?:[\\/][^:*?"<>|`]*|\.[A-Za-z0-9]{1,8}))(?::(\d+)(?:[-–](\d+))?)?$/.exec(candidate);
    if (m && /[\\/.]/.test(m[1]!) && /[A-Za-z0-9]/.test(m[1]!) && !/\s$/.test(m[1]!))
      return { n, kind: 'file', path: m[1]!, line: m[2] ? parseInt(m[2], 10) : null, lineEnd: m[3] ? parseInt(m[3], 10) : null };
  }
  return null;
}

/** Checks a research report's form: findings that cite sources that exist in the list and can be checked. */
export function checkReport(markdown: string): ReportCheck {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const secs = sections(lines);
  const problems: CheckProblem[] = [];
  const findingsSec = find(secs, FINDINGS);
  const sourcesSec = find(secs, SOURCES);
  if (!findingsSec) problems.push({ key: 'flow.check.report.noFindings' });
  if (!sourcesSec) problems.push({ key: 'flow.check.report.noSources' });
  const findings = findingsSec ? items(findingsSec.lines) : [];
  const sourceItems = sourcesSec ? items(sourcesSec.lines) : [];
  if (findingsSec && !findings.length) problems.push({ key: 'flow.check.report.emptyFindings' });
  if (sourcesSec && !sourceItems.length) problems.push({ key: 'flow.check.report.emptySources' });

  const sources: Source[] = [];
  sourceItems.forEach((it, i) => {
    const lead = /^\[(\d{1,3})\]/.exec(it.text.trim());
    const n = lead ? parseInt(lead[1]!, 10) : (it.n ?? i + 1);
    const s = sourceOf(n, it.text);
    if (s) sources.push(s);
    else problems.push({ key: 'flow.check.report.badSource', params: { n, text: it.text.split('\n')[0]!.slice(0, 80) } });
  });
  const numbers = new Set(
    sourceItems.map((it, i) => (/^\[(\d{1,3})\]/.exec(it.text.trim()) ? parseInt(/^\[(\d{1,3})\]/.exec(it.text.trim())![1]!, 10) : (it.n ?? i + 1))),
  );
  const dangling = new Set<number>();
  findings.forEach((f, i) => {
    const cited = citations(f.text);
    if (!cited.length) problems.push({ key: 'flow.check.report.uncited', params: { n: i + 1, text: f.text.split('\n')[0]!.slice(0, 80) } });
    for (const c of cited) if (!numbers.has(c)) dangling.add(c);
  });
  for (const c of [...dangling].sort((a, b) => a - b)) problems.push({ key: 'flow.check.report.dangling', params: { n: c } });
  return { problems, findings: findings.length, sources };
}

/** What the disk says about the file sources: missing files and cited lines beyond a file's end. */
export function sourceProblems(sources: readonly Source[], lineCount: (path: string) => number | null): CheckProblem[] {
  const out: CheckProblem[] = [];
  for (const s of sources) {
    if (s.kind !== 'file') continue;
    const lines = lineCount(s.path);
    if (lines === null) out.push({ key: 'flow.check.report.fileMissing', params: { n: s.n, path: s.path } });
    else if ((s.line !== null && (s.line < 1 || s.line > lines)) || (s.lineEnd !== null && (s.lineEnd > lines || s.lineEnd < (s.line ?? 1))))
      out.push({ key: 'flow.check.report.lineOutside', params: { n: s.n, path: s.path, line: s.lineEnd ?? s.line ?? 0, lines } });
  }
  return out;
}

// ── the plan ──────────────────────────────────────────────────────────────────────────────────────────

export interface PlanStep {
  n: number;
  title: string;
  acceptance: string | null;
}

export interface PlanCheck {
  problems: CheckProblem[];
  steps: PlanStep[];
  /** The verification commands, in order, without duplicates. */
  verification: string[];
}

const STEPS = ['steps', 'adimlar', 'implementation steps', 'uygulama adimlari', 'plan steps', 'plan adimlari'];
const VERIFY = ['verification', 'dogrulama', 'how to verify', 'tests', 'testler', 'nasil dogrulanir'];
const ACCEPTANCE = /^\s*(?:[-*+]\s+)?[*_]*\s*(?:acceptance(?: criteria)?|kabul(?: olcutu| olcutleri| kriteri| kriterleri)?)\s*[*_]*\s*:\s*[*_]*\s*(.*)$/;

function acceptanceIn(text: string): string | null {
  for (const l of text.split('\n')) {
    const m = ACCEPTANCE.exec(fold(l));
    if (m) {
      // The text after the colon, from the original line (fold changes letters).
      const original = l
        .slice(l.indexOf(':') + 1)
        .replace(/^[\s*_]+/, '')
        .trim();
      return original || null;
    }
  }
  return null;
}

/** Checks a plan's form: numbered steps, each with acceptance criteria, and commands that verify the work. */
export function checkPlan(markdown: string): PlanCheck {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const secs = sections(lines);
  const problems: CheckProblem[] = [];
  const stepsSec = find(secs, STEPS);
  const steps: PlanStep[] = [];
  if (!stepsSec) problems.push({ key: 'flow.check.plan.noSteps' });
  else {
    const hs = headings(stepsSec.lines);
    if (hs.length) {
      const top = Math.min(...hs.map((h) => h.level));
      hs.filter((h) => h.level === top).forEach((h, i, list) => {
        const body = stepsSec.lines.slice(h.line + 1, list[i + 1]?.line ?? stepsSec.lines.length).join('\n');
        const m = /^(?:(?:step|adim)\s+)?(\d{1,3})(?:[.):]|\s|$)/.exec(fold(h.title).trim());
        const title = h.title.trim().replace(/^(?:(?:step|ad[ıi]m)\s+)?\d{1,3}[.):]?\s*/i, '');
        steps.push({ n: m ? parseInt(m[1]!, 10) : NaN, title, acceptance: acceptanceIn(body) });
      });
    } else {
      for (const it of items(stepsSec.lines).filter((x) => x.n !== null)) {
        const [first, ...rest] = it.text.split('\n');
        steps.push({ n: it.n!, title: first!.replace(/[*_]/g, '').trim(), acceptance: acceptanceIn([first, ...rest].join('\n')) });
      }
    }
    if (!steps.length) problems.push({ key: 'flow.check.plan.noSteps' });
    steps.forEach((s, i) => {
      if (s.n !== i + 1) problems.push({ key: 'flow.check.plan.numbering', params: { expected: i + 1, found: Number.isNaN(s.n) ? '?' : s.n } });
      if (!s.acceptance) problems.push({ key: 'flow.check.plan.noAcceptance', params: { n: i + 1, title: s.title.slice(0, 60) } });
    });
  }
  const verifySec = find(secs, VERIFY);
  const verification: string[] = [];
  if (!verifySec) problems.push({ key: 'flow.check.plan.noVerification' });
  else {
    let fence = false;
    for (const l of verifySec.lines) {
      if (/^\s{0,3}(```|~~~)/.test(l)) {
        fence = !fence;
        continue;
      }
      if (fence) {
        const c = l.trim();
        if (c && !c.startsWith('#')) verification.push(c.replace(/^\$\s+/, ''));
        continue;
      }
      for (const m of l.matchAll(/`([^`\n]+)`/g)) verification.push(m[1]!.trim().replace(/^\$\s+/, ''));
    }
    if (!verification.length) problems.push({ key: 'flow.check.plan.noCommands' });
  }
  return { problems, steps, verification: [...new Set(verification.filter(Boolean))] };
}

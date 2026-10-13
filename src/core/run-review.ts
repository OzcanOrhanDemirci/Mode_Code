// SPDX-License-Identifier: Apache-2.0
/**
 * The independent review of a full-autonomy milestone: a separate model call that has none of the
 * session's conversation, only the person's request word for word, the plan, the step and what changed.
 * Pure: the prompt it is sent, the verdict read from its answer, and the signals code finds in a diff
 * itself (deleted test files, added skip markers), which the reviewer is shown and the report lists.
 */
import { truncate } from './text.js';
import type { ReviewVerdict, RunPlan, RunStep } from './run.js';

/** Characters of diff a review is given; the rest is named, not sent. */
export const REVIEW_DIFF_CHARS = 120_000;

/**
 * Files at the top of a project that say how it builds, runs and is tested, in the order they are shown.
 * Measured in the first live run: shown only the diff, the reviewer called an ES module broken for want of
 * a `"type": "module"` that the untouched package.json had.
 */
export const REVIEW_MANIFESTS = [
  'package.json',
  'tsconfig.json',
  'deno.json',
  'pyproject.toml',
  'setup.cfg',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pubspec.yaml',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'Makefile',
] as const;
/** At most this many manifests are shown, each cut at REVIEW_MANIFEST_CHARS. */
export const REVIEW_MANIFEST_COUNT = 6;
export const REVIEW_MANIFEST_CHARS = 4000;
/** At most this many tracked file names are listed; the rest are counted. */
export const REVIEW_FILES = 400;
/** Of each verification command's output, the final review sees the last lines, up to this many characters. */
export const REVIEW_TAIL_LINES = 15;
export const REVIEW_TAIL_CHARS = 1500;

/** The manifests a review is shown: those among the tracked files at the project's top, in REVIEW_MANIFESTS order. */
export function reviewManifests(files: readonly string[]): string[] {
  const top = new Set(files.filter((f) => !f.includes('/')));
  return REVIEW_MANIFESTS.filter((m) => top.has(m)).slice(0, REVIEW_MANIFEST_COUNT);
}

export interface ReviewInput {
  /** The person's request, word for word. */
  task: string;
  plan: RunPlan;
  /** The step this milestone completes, or null for the final review of the whole run. */
  step: RunStep | null;
  /** `git log --oneline` of the commits under review. */
  commits: string;
  /** `git diff --stat` and the diff itself. */
  stat: string;
  diff: string;
  signals: DiffSignals;
  /** Findings of earlier reviews that are still open (the final review checks they were dealt with). */
  earlier: readonly string[];
  /** The project's tracked files at the reviewed commit: what exists beyond the diff. */
  files: readonly string[];
  /** Build and run manifests at the reviewed commit, as they are (see reviewManifests). */
  manifests: readonly { path: string; text: string }[];
  /** The final review: the verification commands code ran just before it, each with its output; null for a milestone. */
  verification: readonly { command: string; ok: boolean; output: string }[] | null;
}

export interface DiffSignals {
  /** Test files the diff deletes. */
  deletedTests: string[];
  /** Added lines that skip or narrow tests (`.skip(`, `.only(`, `xit(`, `@pytest.mark.skip`, …). */
  skipMarkers: number;
}

const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py|rb)$|(?:^|\/)test_[^/]+\.py$|Tests?\.(?:cs|java|kt|swift)$/i;
// Word boundaries only before the alternatives that start with a letter: `@` and `#` are not word characters.
const SKIP =
  /\b(?:(?:it|test|describe|context)\.(?:skip|only|todo)\s*\(|x(?:it|describe|test)\s*\(|t\.Skip(?:Now|f)?\s*\(|pending\s*\()|@pytest\.mark\.(?:skip|xfail)\b|@unittest\.skip|#\[ignore\]|@Disabled\b|@Ignore\b/;

/** What code itself sees in a unified diff: deleted test files, added lines that skip tests. */
export function diffSignals(diff: string): DiffSignals {
  const deletedTests: string[] = [];
  let skipMarkers = 0;
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const head = /^diff --git a\/(.+?) b\//.exec(line);
    if (head) {
      file = head[1]!;
      continue;
    }
    if (line.startsWith('deleted file mode') && file && TEST_FILE.test(file)) deletedTests.push(file);
    else if (line.startsWith('+') && !line.startsWith('+++') && SKIP.test(line)) skipMarkers++;
  }
  return { deletedTests: [...new Set(deletedTests)], skipMarkers };
}

export const REVIEW_SYSTEM = [
  'You are an independent code reviewer for an autonomous coding run. You did not write this change and you have not seen the conversation that produced it.',
  "You are given the person's request word for word, the plan the agent made from it, the step under review with its acceptance criteria, the commits and their diff.",
  "Judge four things: (1) whether the change does what the step and its acceptance criteria say; (2) whether it serves the person's request, not something easier; (3) bugs, regressions, security problems and risky shortcuts; (4) whether tests or checks were weakened (deleted, skipped, loosened) to make the verification pass.",
  'You also get the project as it is at the reviewed commit: its tracked files and its build manifests. What they list exists even when the diff does not touch it; do not report it as missing or unknown.',
  'Code runs the verification commands itself, and the run cannot end unless every one exits with 0: do not ask for their output. At a milestone they have not run yet; at the final review their results are given.',
  'Answer in this exact format and nothing else:',
  'VERDICT: PASS | CONCERNS | FAIL',
  '- one finding per line, most important first (none for a clean PASS)',
  'PASS: the step is done and sound. CONCERNS: the step stands but something should be fixed or checked later. FAIL: the step is not done, does not serve the request, is broken, or weakens tests or checks. Be concrete: name files and lines.',
].join('\n');

/** The prompt of one review. Long diffs are cut at REVIEW_DIFF_CHARS, and the cut is said. */
export function reviewPrompt(i: ReviewInput): string {
  const steps = i.plan.steps.map((s) => `${s.n}. ${s.title} (acceptance: ${s.acceptance})`).join('\n');
  const cut = i.diff.length > REVIEW_DIFF_CHARS;
  const diff = cut
    ? `${i.diff.slice(0, REVIEW_DIFF_CHARS)}\n[… ${i.diff.length - REVIEW_DIFF_CHARS} more characters of diff not shown; the stat above lists every file]`
    : i.diff;
  const signals: string[] = [];
  if (i.signals.deletedTests.length) signals.push(`The diff deletes test files: ${i.signals.deletedTests.join(', ')}.`);
  if (i.signals.skipMarkers) signals.push(`The diff adds ${i.signals.skipMarkers} line(s) that skip or narrow tests.`);
  const listed = i.files.slice(0, REVIEW_FILES);
  const project = i.files.length
    ? [
        '## The project at the reviewed commit',
        `Tracked files (${i.files.length}):`,
        ...listed,
        ...(i.files.length > listed.length ? [`[… ${i.files.length - listed.length} more]`] : []),
        '',
        ...i.manifests.flatMap((m) => [
          `### ${m.path}`,
          '```',
          m.text.length > REVIEW_MANIFEST_CHARS
            ? `${m.text.slice(0, REVIEW_MANIFEST_CHARS)}\n[… ${m.text.length - REVIEW_MANIFEST_CHARS} more characters]`
            : m.text,
          '```',
          '',
        ]),
      ]
    : [];
  const ran = i.verification
    ? [
        '## Verification, run by code just before this review',
        ...i.verification.flatMap((v) => {
          const tail = tailOf(v.output);
          return [`- \`${v.command}\`: ${v.ok ? 'passed (exit 0)' : 'failed'}`, ...(tail ? ['```', tail, '```'] : [])];
        }),
        '',
      ]
    : [];
  return [
    "## The person's request (word for word)",
    i.task || '(the person gave the task earlier in the conversation; the plan states it)',
    '',
    '## The plan',
    steps,
    '',
    'Verification commands the run must pass at the end:',
    ...i.plan.verification.map((c) => `- \`${c}\``),
    ...(i.verification ? [] : ['(Code runs them at the finish; they have not run for this step.)']),
    '',
    i.step
      ? `## Under review: step ${i.step.n}. ${i.step.title}\nAcceptance: ${i.step.acceptance}`
      : '## Under review: the whole run, every step, against the request',
    '',
    ...(i.earlier.length ? ['## Findings of earlier reviews', ...i.earlier.map((f) => `- ${f}`), ''] : []),
    ...(signals.length ? ['## What code found in the diff', ...signals, ''] : []),
    ...project,
    ...ran,
    '## Commits',
    i.commits || '(none)',
    '',
    '## Files changed',
    i.stat || '(none)',
    '',
    '## Diff',
    diff || '(empty)',
  ].join('\n');
}

/** The end of a command's output: its last REVIEW_TAIL_LINES lines, at most REVIEW_TAIL_CHARS characters. */
export function tailOf(output: string): string {
  return output.trimEnd().split('\n').slice(-REVIEW_TAIL_LINES).join('\n').slice(-REVIEW_TAIL_CHARS);
}

/** The verdict and findings of a reviewer's answer. An answer without a verdict line counts as concerns. */
export function parseReview(text: string): { verdict: Exclude<ReviewVerdict, 'unavailable'>; findings: string[]; clear: boolean } {
  const m = /^\s*\**\s*VERDICT\s*\**\s*:\s*\**\s*(PASS|CONCERNS|FAIL)\b/im.exec(text);
  const findings = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+\S/.test(l))
    .map((l) => truncate(l.replace(/^[-*•]\s+/, ''), 400))
    .filter((l) => !/^none\.?$/i.test(l))
    .slice(0, 30);
  if (!m) return { verdict: 'concerns', findings: findings.length ? findings : [truncate(text.trim() || 'The review gave no answer.', 400)], clear: false };
  const verdict = m[1]!.toLowerCase() as 'pass' | 'concerns' | 'fail';
  return { verdict, findings, clear: true };
}

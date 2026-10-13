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
  return [
    "## The person's request (word for word)",
    i.task || '(the person gave the task earlier in the conversation; the plan states it)',
    '',
    '## The plan',
    steps,
    '',
    'Verification commands the run must pass at the end:',
    ...i.plan.verification.map((c) => `- \`${c}\``),
    '',
    i.step
      ? `## Under review: step ${i.step.n}. ${i.step.title}\nAcceptance: ${i.step.acceptance}`
      : '## Under review: the whole run, every step, against the request',
    '',
    ...(i.earlier.length ? ['## Findings of earlier reviews', ...i.earlier.map((f) => `- ${f}`), ''] : []),
    ...(signals.length ? ['## What code found in the diff', ...signals, ''] : []),
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

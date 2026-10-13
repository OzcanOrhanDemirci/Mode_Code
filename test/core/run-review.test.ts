// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffSignals,
  parseReview,
  REVIEW_DIFF_CHARS,
  REVIEW_FILES,
  REVIEW_MANIFEST_CHARS,
  REVIEW_MANIFEST_COUNT,
  REVIEW_MANIFESTS,
  REVIEW_SYSTEM,
  REVIEW_TAIL_CHARS,
  REVIEW_TAIL_LINES,
  reviewManifests,
  reviewPrompt,
  tailOf,
  type ReviewInput,
} from '../../src/core/run-review.js';
import type { RunPlan } from '../../src/core/run.js';

const PLAN: RunPlan = {
  steps: [
    { n: 1, title: 'Limiter', acceptance: 'unit tests for the limiter pass' },
    { n: 2, title: 'Wire it in', acceptance: 'the API answers 429 past the limit' },
  ],
  verification: ['npm test', 'npm run check'],
  required: ['npm run check'],
  acceptedAt: 0,
  revisions: 0,
};

const DIFF = [
  'diff --git a/src/limiter.ts b/src/limiter.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/limiter.ts',
  '+export const limit = 10;',
  'diff --git a/test/limiter.test.ts b/test/limiter.test.ts',
  'deleted file mode 100644',
  '--- a/test/limiter.test.ts',
  '+++ /dev/null',
  '-test("limits", () => {});',
  'diff --git a/src/api.test.ts b/src/api.test.ts',
  '--- a/src/api.test.ts',
  '+++ b/src/api.test.ts',
  "+  it.skip('answers 429', () => {});",
  "+  test.only('one', () => {});",
  '+  // a mention of it.skip without a call is not a skip',
  '-  xit("old", () => {});',
  'diff --git a/tests/test_api.py b/tests/test_api.py',
  'deleted file mode 100644',
  'diff --git a/docs/testing.md b/docs/testing.md',
  'deleted file mode 100644',
].join('\n');

/** A final review's input with nothing in it, for the cases that vary one part. */
const base = (): ReviewInput => ({
  task: 't',
  plan: PLAN,
  step: null,
  commits: '',
  stat: '',
  diff: 'd',
  signals: { deletedTests: [], skipMarkers: 0 },
  earlier: [],
  files: [],
  manifests: [],
  verification: null,
});

test('code finds deleted test files and added skip markers in a diff', () => {
  const s = diffSignals(DIFF);
  assert.deepEqual(s.deletedTests, ['test/limiter.test.ts', 'tests/test_api.py']);
  assert.equal(s.skipMarkers, 2);
  assert.deepEqual(diffSignals(''), { deletedTests: [], skipMarkers: 0 });
  for (const line of ['+@pytest.mark.skip(reason="x")', '+    t.Skip("slow")', '+#[ignore]', '+  @Disabled', '+describe.only("x", () => {})'])
    assert.equal(diffSignals(`diff --git a/x b/x\n${line}`).skipMarkers, 1, line);
  assert.equal(diffSignals('diff --git a/x b/x\n+const skipped = 1;\n+++ b/x').skipMarkers, 0);
});

test('the prompt carries the request word for word, the plan, the step, the signals and the diff; a long diff is cut and says so', () => {
  const p = reviewPrompt({
    task: 'Add rate limiting to the public API, with tests.',
    plan: PLAN,
    step: PLAN.steps[1]!,
    commits: 'b1 feat: wire the limiter',
    stat: ' src/api.ts | 4 ++--',
    diff: DIFF,
    signals: diffSignals(DIFF),
    earlier: [],
    files: [],
    manifests: [],
    verification: null,
  });
  assert.match(p, /## The person's request \(word for word\)\nAdd rate limiting to the public API, with tests\./);
  assert.match(p, /1\. Limiter \(acceptance: unit tests for the limiter pass\)/);
  assert.match(p, /- `npm run check`/);
  assert.match(p, /## Under review: step 2\. Wire it in\nAcceptance: the API answers 429 past the limit/);
  assert.match(p, /The diff deletes test files: test\/limiter\.test\.ts, tests\/test_api\.py\./);
  assert.match(p, /adds 2 line\(s\) that skip or narrow tests/);
  assert.ok(p.endsWith(DIFF));
  const big = 'x'.repeat(REVIEW_DIFF_CHARS + 500);
  const cut = reviewPrompt({
    task: 't',
    plan: PLAN,
    step: null,
    commits: '',
    stat: '',
    diff: big,
    signals: { deletedTests: [], skipMarkers: 0 },
    earlier: ['step 1: no test for reset'],
    files: [],
    manifests: [],
    verification: [],
  });
  assert.match(cut, /\[… 500 more characters of diff not shown; the stat above lists every file\]$/);
  assert.match(cut, /## Under review: the whole run, every step, against the request/);
  assert.match(cut, /## Findings of earlier reviews\n- step 1: no test for reset/);
  assert.match(cut, /## Commits\n\(none\)/);
  assert.match(REVIEW_SYSTEM, /VERDICT: PASS \| CONCERNS \| FAIL/);
});

test('the verdict is read from the answer; findings are its bullet lines; an answer without a verdict counts as concerns', () => {
  assert.deepEqual(parseReview('VERDICT: PASS'), { verdict: 'pass', findings: [], clear: true });
  assert.deepEqual(parseReview('VERDICT: FAIL\n- src/api.ts:12 never calls the limiter\n- the test was deleted'), {
    verdict: 'fail',
    findings: ['src/api.ts:12 never calls the limiter', 'the test was deleted'],
    clear: true,
  });
  assert.equal(parseReview('**VERDICT:** CONCERNS\n* reset window not tested').verdict, 'concerns');
  assert.equal(parseReview('Some text first.\nverdict: pass\n- none').verdict, 'pass');
  assert.deepEqual(parseReview('Verdict: PASS\n- None.').findings, []);
  const unclear = parseReview('Looks fine to me.');
  assert.deepEqual([unclear.verdict, unclear.clear, unclear.findings], ['concerns', false, ['Looks fine to me.']]);
  assert.deepEqual(parseReview('').findings, ['The review gave no answer.']);
  assert.equal(parseReview(`VERDICT: CONCERNS\n${Array.from({ length: 50 }, (_, i) => `- f${i}`).join('\n')}`).findings.length, 30);
});

test('the edges of the review: a context line is no added line, a diff exactly at the limit is whole, no stat says so', () => {
  assert.equal(diffSignals("diff --git a/x b/x\n it.skip('kept as it was', () => {}) // +").skipMarkers, 0);
  const exact = 'y'.repeat(REVIEW_DIFF_CHARS);
  const p = reviewPrompt({
    task: 't',
    plan: PLAN,
    step: null,
    commits: '',
    stat: '',
    diff: exact,
    signals: { deletedTests: [], skipMarkers: 0 },
    earlier: [],
    files: [],
    manifests: [],
    verification: null,
  });
  assert.ok(p.endsWith(exact));
  assert.match(p, /## Files changed\n\(none\)/);
  // No tracked files read (git failed): no project section at all, rather than an empty one.
  assert.doesNotMatch(p, /## The project at the reviewed commit/);
});

test('the reviewer sees the project beyond the diff: its tracked files and its manifests, cut where they are long', () => {
  // Measured in the first live run: shown only the diff, the reviewer called an ES module broken for want of a
  // "type": "module" that the untouched package.json had, and asked for output the run had already checked.
  const files = ['package.json', 'src/limiter.ts', 'src/package.json', 'Makefile', 'tsconfig.json', 'README.md'];
  assert.deepEqual(reviewManifests(files), ['package.json', 'tsconfig.json', 'Makefile'], 'top-level only, in the fixed order');
  assert.deepEqual(reviewManifests([...REVIEW_MANIFESTS]).length, REVIEW_MANIFEST_COUNT);
  assert.deepEqual(reviewManifests(['docs/package.json']), []);
  const long = 'z'.repeat(REVIEW_MANIFEST_CHARS + 7);
  const p = reviewPrompt({
    task: 't',
    plan: PLAN,
    step: PLAN.steps[0]!,
    commits: '',
    stat: '',
    diff: 'd',
    signals: { deletedTests: [], skipMarkers: 0 },
    earlier: [],
    files,
    manifests: [
      { path: 'package.json', text: '{ "type": "module" }' },
      { path: 'Makefile', text: long },
    ],
    verification: null,
  });
  assert.match(p, /## The project at the reviewed commit\nTracked files \(6\):\npackage\.json\nsrc\/limiter\.ts\n/);
  assert.match(p, /### package\.json\n```\n\{ "type": "module" \}\n```/);
  assert.match(p, new RegExp(`### Makefile\\n\`\`\`\\nz{${REVIEW_MANIFEST_CHARS}}\\n\\[… 7 more characters\\]\\n\`\`\``));
  const exact = 'e'.repeat(REVIEW_MANIFEST_CHARS);
  const atLimit = reviewPrompt({ ...base(), files, manifests: [{ path: 'package.json', text: exact }] });
  assert.match(atLimit, new RegExp(`\\n${exact}\\n\`\`\``), 'a manifest exactly at the limit is shown whole');
  assert.doesNotMatch(atLimit, /more characters\]/);
  assert.match(p, /- `npm run check`\n\(Code runs them at the finish; they have not run for this step\.\)/);
  assert.doesNotMatch(p, /## Verification, run by code/);
  assert.match(REVIEW_SYSTEM, /What they list exists even when the diff does not touch it/);
  assert.match(REVIEW_SYSTEM, /do not ask for their output/);
  // A long listing is cut at REVIEW_FILES names and counts the rest; exactly REVIEW_FILES is whole.
  const many = Array.from({ length: REVIEW_FILES + 3 }, (_, i) => `f${i}.ts`);
  const cut = reviewPrompt({ ...base(), files: many });
  assert.match(cut, new RegExp(`\\nf${REVIEW_FILES - 1}\\.ts\\n\\[… 3 more\\]\\n`));
  assert.doesNotMatch(cut, new RegExp(`\\nf${REVIEW_FILES}\\.ts\\n`));
  const whole = reviewPrompt({ ...base(), files: many.slice(0, REVIEW_FILES) });
  assert.doesNotMatch(whole, /more\]/);
  assert.match(whole, new RegExp(`Tracked files \\(${REVIEW_FILES}\\):`));
});

test('the final review gets the verification code ran, with the end of each output', () => {
  const out = Array.from({ length: REVIEW_TAIL_LINES + 5 }, (_, i) => `line ${i}`).join('\n');
  const p = reviewPrompt({
    ...base(),
    verification: [
      { command: 'node --test', ok: true, output: `${out}\n\n` },
      { command: 'npm run lint', ok: true, output: '' },
    ],
  });
  assert.match(p, /## Verification, run by code just before this review\n- `node --test`: passed \(exit 0\)\n```\nline 5\n/);
  assert.match(p, new RegExp(`line ${REVIEW_TAIL_LINES + 4}\\n\`\`\`\\n- \`npm run lint\`: passed \\(exit 0\\)\\n\\n`));
  assert.doesNotMatch(p, /line 4\n/);
  assert.doesNotMatch(p, /they have not run for this step/);
  assert.match(reviewPrompt({ ...base(), verification: [{ command: 'x', ok: false, output: 'boom' }] }), /- `x`: failed\n```\nboom\n```/);
  // The tail: the last lines, and of those at most REVIEW_TAIL_CHARS characters.
  assert.equal(tailOf('a\nb\n'), 'a\nb');
  assert.equal(tailOf(''), '');
  const wide = 'w'.repeat(REVIEW_TAIL_CHARS + 10);
  assert.equal(tailOf(`x\n${wide}`), wide.slice(-REVIEW_TAIL_CHARS));
  assert.equal(tailOf('q'.repeat(REVIEW_TAIL_CHARS)).length, REVIEW_TAIL_CHARS);
});

test('a file header is no added line, whatever the file is called', () => {
  assert.equal(
    diffSignals('diff --git a/src/pending (copy).ts b/src/pending (copy).ts\n--- a/src/pending (copy).ts\n+++ b/src/pending (copy).ts\n').skipMarkers,
    0,
  );
});

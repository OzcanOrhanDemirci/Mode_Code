// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSignals, parseReview, REVIEW_DIFF_CHARS, REVIEW_SYSTEM, reviewPrompt } from '../../src/core/run-review.js';
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

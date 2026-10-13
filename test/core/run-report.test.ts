// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDraft, composeReport, durationText, factsSection, rollbackCommands } from '../../src/core/run-report.js';
import {
  acceptMilestone,
  acceptPlan,
  addBlocker,
  addDeferred,
  finishRun,
  pauseRun,
  startRun,
  type Review,
  type Run,
  type RunResult,
} from '../../src/core/run.js';

const T = Date.parse('2026-10-13T09:10:00Z');
const MIN = 60_000;
const ok = (r: RunResult): Run => {
  assert.equal(r.ok, true);
  return r.run;
};
const review = (verdict: Review['verdict'], findings: string[] = []): Review => ({
  verdict,
  findings,
  model: 'opus',
  at: T,
  signals: { deletedTests: 0, skipMarkers: 0 },
});

function sample(): Run {
  let r = startRun({
    id: '20261013-1210-rate-limit',
    task: 'Add rate limiting to the public API, with tests.',
    project: 'api',
    cwd: '/home/ada/api',
    sessionId: 's1',
    workDir: '/tmp/terminal-code/runs',
    budget: { weeklyTarget: 52, source: '+10' },
    start: { commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', branch: 'main' },
    now: T,
  });
  r = ok(
    acceptPlan(
      r,
      {
        steps: [
          { n: 1, title: 'Limiter | core', acceptance: 'tests pass' },
          { n: 2, title: 'Wire it in', acceptance: '429' },
        ],
        verification: ['npm test'],
      },
      [],
      T + MIN,
    ),
  );
  r = ok(
    acceptMilestone(
      r,
      {
        n: 1,
        at: T + 30 * MIN,
        commit: 'b'.repeat(40),
        ref: 'refs/terminal-code/runs/x/1',
        commits: 2,
        review: review('concerns', ['no test for the reset window']),
        note: '',
      },
      T + 30 * MIN,
    ),
  );
  r = ok(
    acceptMilestone(
      r,
      { n: 2, at: T + 60 * MIN, commit: 'c'.repeat(40), ref: 'refs/terminal-code/runs/x/2', commits: 1, review: review('pass'), note: '' },
      T + 60 * MIN,
    ),
  );
  r = ok(addDeferred(r, { kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main' }, T + 61 * MIN));
  r = ok(addDeferred(r, { kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main' }, T + 62 * MIN));
  return r;
}

test('the draft needs a summary and its decisions; a stuck run also says what blocked it', () => {
  const draft = '# Rate limiting\n\n## Summary\n\nAdded a token bucket.\n\n## Decisions\n\n- 100 requests a minute, as the docs suggest.\n';
  assert.deepEqual(checkDraft(draft, 'done', '/x/report.md'), []);
  assert.deepEqual(checkDraft('# Hız sınırı\n\n## Özet\n\nEklendi.\n\n## Kararlar\n\nyok\n', 'done', 'p'), []);
  assert.deepEqual(
    checkDraft('# x\n\n## Summary\n\n## Decisions\n', 'done', 'p').map((p) => p.key),
    ['auto.check.report.noSummary'],
    'an empty decisions section is allowed (no decisions); an empty summary is not',
  );
  assert.deepEqual(
    checkDraft('# x\n\nText only.', 'done', 'p').map((p) => p.key),
    ['auto.check.report.noSummary', 'auto.check.report.noDecisions'],
  );
  assert.deepEqual(checkDraft(null, 'done', '/x/report.md'), [{ key: 'auto.check.report.missing', params: { path: '/x/report.md' } }]);
  assert.deepEqual(
    checkDraft(draft, 'stuck', 'p').map((p) => p.key),
    ['auto.check.report.noBlocked'],
  );
  assert.deepEqual(checkDraft(`${draft}\n## Engeller\n\n- Erişim yok.\n`, 'stuck', 'p'), []);
  // A heading inside a fenced block is no heading.
  assert.deepEqual(
    checkDraft('# x\n\n```\n## Summary\nfake\n```\n', 'done', 'p').map((p) => p.key),
    ['auto.check.report.noSummary', 'auto.check.report.noDecisions'],
  );
});

test('two ways back to every point: a new branch, or the current one moved', () => {
  const r = sample();
  assert.deepEqual(rollbackCommands(r, 0), { keep: 'git switch -c back-20261013-1210-rate-limit-0 a1b2c3d4e5f6', move: 'git reset --hard a1b2c3d4e5f6' });
  assert.deepEqual(rollbackCommands(r, 2), {
    keep: `git switch -c back-20261013-1210-rate-limit-2 ${'c'.repeat(12)}`,
    move: `git reset --hard ${'c'.repeat(12)}`,
  });
  assert.equal(rollbackCommands(r, 3), null);
});

test('durations read as people say them', () => {
  assert.equal(durationText(20_000, 'en'), 'less than a minute');
  assert.equal(durationText(45 * MIN, 'en'), '45 min');
  assert.equal(durationText(192 * MIN, 'en'), '3 h 12 min');
  assert.equal(durationText(192 * MIN, 'tr'), '3 sa 12 dk');
});

test('the facts section: milestones with the ways back, reviews, the verification, what waits for the person, blockers', () => {
  let r = sample();
  r = ok(finishRun(r, { at: T + 70 * MIN, verification: [{ command: 'npm test', ok: true, seconds: 41 }], review: review('pass') }, true, T + 70 * MIN));
  const md = factsSection(r, 'en', { now: T + 70 * MIN, notes: true, quota: { five: 20, week: 49.6 } });
  assert.match(md, /^## What terminal-code measured/);
  assert.match(md, /- Request: «Add rate limiting to the public API, with tests\.»/);
  assert.match(md, /- Status: done/);
  assert.match(md, /- Running time: 1 h 10 min/);
  assert.match(md, /- Budget: weekly 52% \(given as \+10\) · weekly now 50%/);
  assert.match(md, /- Started from a1b2c3d4e5f6 on main; back to the start: `git switch -c back-20261013-1210-rate-limit-0 a1b2c3d4e5f6`/);
  assert.match(
    md,
    /\| 1 \| Limiter \\\| core \| `bbbbbbbbbbbb` \(2\) \| CONCERNS \| `git switch -c back-20261013-1210-rate-limit-1 bbbbbbbbbbbb` · `git reset --hard bbbbbbbbbbbb` \|/,
  );
  assert.match(md, /Review findings:\n- 1: no test for the reset window/);
  assert.match(md, /- `npm test` ✓ \(41 s\)\n- Final review: PASS/);
  assert.match(md, /- \*\*push\*\* · Bash: `git push origin main` \(pushes to the protected branch main\) ×2/);
  assert.match(md, /### Blockers\n\nNone\./);
  assert.match(md, /Claude left notes for your memory in \/tmp\/terminal-code\/runs\/20261013-1210-rate-limit\/notes\.md/);
  assert.doesNotMatch(md, /\{\w+\}/);
});

test('a paused run says why, in Turkish too; a run that did not finish says when its verification runs', () => {
  let r = sample();
  r = ok(addBlocker(r, 'access', 'Staging refuses the credentials.', T + 63 * MIN));
  r = ok(pauseRun(r, 'stalled', T + 64 * MIN));
  const md = factsSection(r, 'tr', { now: T + 64 * MIN, notes: false, quota: null });
  assert.match(md, /- Durum: duraklatıldı \(ölçülebilir ilerleme yok\)/);
  assert.match(md, /Bitmedi: 1 doğrulama komutu bitişte çalışır\./);
  assert.match(md, /- \*\*erişim\*\*: Staging refuses the credentials\./);
  assert.doesNotMatch(md, /Hafıza için notlar/);
  assert.doesNotMatch(md, /\{\w+\}/);
});

test('the report is the draft followed by the facts; without a draft it says so', () => {
  const r = sample();
  const x = { now: T + 64 * MIN, notes: false, quota: null };
  const full = composeReport('# Rate limiting\n\n## Summary\n\nDone.\n', r, 'en', x);
  assert.ok(full.startsWith('# Rate limiting\n\n## Summary\n\nDone.\n\n## What terminal-code measured'));
  const bare = composeReport(null, r, 'en', x);
  assert.ok(bare.startsWith('# Add rate limiting to the public API, with tests.\n\n(Claude wrote no report draft.)\n\n## What terminal-code measured'));
});

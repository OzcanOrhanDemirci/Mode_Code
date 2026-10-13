// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptMilestone,
  acceptPlan,
  activeTime,
  addBlocker,
  addDeferred,
  cancelRun,
  finishRun,
  heartbeat,
  isLive,
  isTerminal,
  lastProgressAt,
  markStuck,
  nextStep,
  noteRefusal,
  parseRun,
  pauseRun,
  progress,
  recordKey,
  resumeRun,
  rollbackRef,
  runId,
  startRun,
  type Milestone,
  type Review,
  type Run,
  type RunResult,
} from '../../src/core/run.js';
import { layout, runDir } from '../../src/core/layout.js';

const T = Date.parse('2026-10-13T09:10:00Z');
const MIN = 60_000;

const start = (): Run =>
  startRun({
    id: '20261013-1210-add-rate-limiting',
    task: '  Add rate limiting to the public API, with tests.  ',
    project: 'api',
    cwd: '/home/ada/api',
    sessionId: 's1',
    workDir: '/tmp/terminal-code/runs/',
    budget: { weeklyTarget: 52, source: '+10' },
    start: { commit: 'a'.repeat(40), branch: 'main' },
    now: T,
  });
const ok = (r: RunResult): Run => {
  assert.equal(r.ok, true, r.ok ? '' : `${r.error} ${r.detail ?? ''}`);
  return r.run;
};
const PLAN = {
  steps: [
    { n: 1, title: 'Limiter', acceptance: 'unit tests for the limiter pass' },
    { n: 2, title: 'Wire it in', acceptance: 'the API answers 429 past the limit' },
  ],
  verification: ['npm test'],
};
const review = (verdict: Review['verdict'] = 'pass', findings: string[] = []): Review => ({
  verdict,
  findings,
  model: 'opus',
  at: T,
  signals: { deletedTests: 0, skipMarkers: 0 },
});
const ms = (n: number, commit: string, r: Review = review()): Milestone => ({
  n,
  at: T + n * MIN,
  commit,
  ref: rollbackRef('x', n),
  commits: 1,
  review: r,
  note: '',
});
const working = (): Run => ok(acceptPlan(start(), PLAN, [], T + MIN));
const finished = { at: T, verification: [{ command: 'npm test', ok: true, seconds: 12 }], review: review() };

test('a run starts in its plan phase, active, with its files in the work folder and its start point kept', () => {
  const r = start();
  assert.equal(r.task, 'Add rate limiting to the public API, with tests.');
  assert.deepEqual([r.status, r.phase, r.plan, r.milestones.length], ['active', 'plan', null, 0]);
  assert.equal(r.workDir, '/tmp/terminal-code/runs/20261013-1210-add-rate-limiting');
  assert.equal(r.planPath, `${r.workDir}/plan.md`);
  assert.equal(r.reportPath, `${r.workDir}/report.md`);
  assert.equal(r.notesPath, `${r.workDir}/notes.md`);
  assert.equal(r.start.ref, 'refs/terminal-code/runs/20261013-1210-add-rate-limiting/0');
  assert.deepEqual([isLive(r), isTerminal(r), nextStep(r), progress(r)], [true, false, null, { done: 0, of: 0 }]);
  assert.deepEqual(r.history, [{ at: T, event: 'start' }]);
});

test('run ids are sortable, readable and unique; folders refuse other shapes', () => {
  const now = new Date(2026, 9, 13, 12, 10).getTime();
  assert.equal(runId('Add rate limiting to the API', now, new Set()), '20261013-1210-add-rate-limiting-to-the');
  assert.equal(runId('', now, new Set()), '20261013-1210-run');
  assert.equal(runId('Hız sınırı ekle', now, new Set()), '20261013-1210-hiz-siniri-ekle');
  assert.equal(runId('x', now, new Set(['20261013-1210-x', '20261013-1210-x-2'])), '20261013-1210-x-3');
  const l = layout('/home/ada/.terminal-code');
  assert.equal(runDir(l, '20261013-1210-x'), '/home/ada/.terminal-code/runs/20261013-1210-x');
  assert.equal(runDir(l, '../x'), null);
  assert.equal(runDir(l, 'A'), null);
});

test("the plan is accepted with the person's own commands, which a revision can never drop", () => {
  let r = ok(acceptPlan(start(), PLAN, ['npm run check'], T + MIN));
  assert.equal(r.phase, 'work');
  assert.deepEqual(r.plan!.verification, ['npm test', 'npm run check']);
  assert.deepEqual(r.plan!.required, ['npm run check']);
  assert.equal(r.plan!.revisions, 0);
  assert.deepEqual(nextStep(r), PLAN.steps[0]);
  // A revision that leaves out a command (the person's or the plan's) is refused and names it.
  const dropped = acceptPlan(r, { steps: PLAN.steps, verification: ['npm run lint'] }, [], T + 2 * MIN);
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.ok ? null : [dropped.error, dropped.detail], ['verification-dropped', 'npm test']);
  // Adding is fine; the person's commands come back even when the revision does not list them.
  r = ok(acceptPlan(r, { steps: PLAN.steps, verification: ['npm test', 'npm run lint'] }, ['npm run check'], T + 2 * MIN));
  assert.deepEqual(r.plan!.verification, ['npm test', 'npm run lint', 'npm run check']);
  assert.equal(r.plan!.revisions, 1);
  assert.deepEqual(
    r.history.map((h) => h.event),
    ['start', 'plan', 'revise'],
  );
});

test('a revision keeps the steps that already have a milestone', () => {
  const r = ok(acceptMilestone(working(), ms(1, 'b'.repeat(40)), T + 2 * MIN));
  const shorter = acceptPlan(r, { steps: [], verification: ['npm test'] }, [], T + 3 * MIN);
  assert.deepEqual(shorter.ok ? null : [shorter.error, shorter.detail], ['steps-dropped', '1']);
  const r2 = ok(
    acceptPlan(
      r,
      { steps: [PLAN.steps[0]!, { n: 2, title: 'Wire it in, behind a flag', acceptance: 'off by default' }], verification: ['npm test'] },
      [],
      T + 3 * MIN,
    ),
  );
  assert.deepEqual(nextStep(r2)?.title, 'Wire it in, behind a flag');
});

test("milestones go in the plan's order, never after a failed review, and only in the work phase", () => {
  assert.deepEqual(acceptMilestone(start(), ms(1, 'b'), T).ok ? 'ok' : (acceptMilestone(start(), ms(1, 'b'), T) as { error: string }).error, 'phase');
  const r = working();
  const skip = acceptMilestone(r, ms(2, 'b'), T + 2 * MIN);
  assert.deepEqual(skip.ok ? null : [skip.error, skip.detail], ['order', '1']);
  const failed = acceptMilestone(r, ms(1, 'b', review('fail', ['the limiter is never called'])), T + 2 * MIN);
  assert.deepEqual(failed.ok ? null : failed.error, 'review-failed');
  let next = ok(acceptMilestone(r, ms(1, 'b', review('concerns', ['no test for the reset'])), T + 2 * MIN));
  assert.deepEqual([progress(next), nextStep(next)?.n], [{ done: 1, of: 2 }, 2]);
  next = ok(acceptMilestone(next, ms(2, 'c'), T + 3 * MIN));
  assert.equal(nextStep(next), null);
  const again = acceptMilestone(next, ms(3, 'd'), T + 4 * MIN);
  assert.deepEqual(again.ok ? null : again.error, 'order');
});

test('done only through a finish whose facts all passed', () => {
  const r = working();
  assert.deepEqual((finishRun(r, finished, true, T) as { error: string; detail: string }).detail, '1');
  let r2 = ok(acceptMilestone(r, ms(1, 'b'), T + 2 * MIN));
  r2 = ok(acceptMilestone(r2, ms(2, 'c'), T + 3 * MIN));
  const failing = { ...finished, verification: [{ command: 'npm test', ok: false, seconds: 3 }] };
  assert.deepEqual((finishRun(r2, failing, true, T) as { detail: string }).detail, 'verification');
  assert.deepEqual((finishRun(r2, { ...finished, verification: [] }, true, T) as { detail: string }).detail, 'verification');
  assert.equal((finishRun(r2, { ...finished, review: review('fail') }, true, T) as { error: string }).error, 'review-failed');
  assert.deepEqual((finishRun(r2, finished, false, T) as { detail: string }).detail, 'report');
  const done = ok(finishRun(r2, finished, true, T + 4 * MIN));
  assert.deepEqual([done.status, done.phase, isTerminal(done), done.finish], ['done', 'finish', true, finished]);
  // A terminal run never changes again.
  for (const res of [
    acceptPlan(done, PLAN, [], T),
    acceptMilestone(done, ms(1, 'z'), T),
    addBlocker(done, 'other', 'x', T),
    addDeferred(done, { kind: 'push', tool: 'Bash', what: 'git push', reason: 'r' }, T),
    finishRun(done, finished, true, T),
    markStuck(done, true, T),
    pauseRun(done, 'person', T),
    resumeRun(done, 's2', T),
    cancelRun(done, T),
  ])
    assert.deepEqual(res.ok ? 'changed' : res.error, 'terminal');
});

test('stuck needs a recorded blocker and the report', () => {
  const r = working();
  assert.equal((markStuck(r, true, T) as { error: string }).error, 'no-blocker');
  const b = ok(addBlocker(r, 'access', '  The staging database refuses the credentials in .env.  ', T + 2 * MIN));
  assert.deepEqual(b.blockers, [{ at: T + 2 * MIN, kind: 'access', text: 'The staging database refuses the credentials in .env.' }]);
  assert.deepEqual((markStuck(b, false, T) as { detail: string }).detail, 'report');
  const stuck = ok(markStuck(b, true, T + 3 * MIN));
  assert.deepEqual([stuck.status, isTerminal(stuck)], ['stuck', true]);
});

test('a deferred step is counted when it is attempted again, not listed twice', () => {
  let r = working();
  r = ok(addDeferred(r, { kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main' }, T + MIN));
  r = ok(addDeferred(r, { kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main' }, T + 2 * MIN));
  r = ok(addDeferred(r, { kind: 'release', tool: 'Bash', what: 'gh release create v1', reason: 'changes a release' }, T + 3 * MIN));
  assert.deepEqual(
    r.deferred.map((d) => [d.kind, d.count, d.at]),
    [
      ['push', 2, T + 2 * MIN],
      ['release', 1, T + 3 * MIN],
    ],
  );
  assert.equal(r.history.filter((h) => h.event === 'deferred').length, 2);
  // Recorded while paused too: what was refused on the way out belongs in the report.
  const paused = ok(pauseRun(r, 'quota', T + 4 * MIN));
  assert.equal(ok(addDeferred(paused, { kind: 'mcp', tool: 'mcp__x__send', what: 'send', reason: 'r' }, T + 5 * MIN)).deferred.length, 3);
});

test('pausing stops the clock, resuming starts it again in the new session, and the stall clock restarts', () => {
  const r = working();
  const p = ok(pauseRun(r, 'quota', T + 60 * MIN, 'five-hour window'));
  assert.deepEqual(
    [p.status, p.pause, p.runningSince, p.activeMs],
    ['paused', { reason: 'quota', at: T + 60 * MIN, detail: 'five-hour window' }, null, 60 * MIN],
  );
  assert.equal(activeTime(p, T + 600 * MIN), 60 * MIN);
  assert.equal(ok(pauseRun(p, 'person', T + 61 * MIN)), p, 'pausing a paused run changes nothing');
  assert.equal((resumeRun(r, 's2', T) as { error: string }).error, 'not-paused');
  const back = ok(resumeRun(p, 's2', T + 300 * MIN));
  assert.deepEqual([back.status, back.sessionId, back.pause, back.runningSince], ['active', 's2', null, T + 300 * MIN]);
  assert.equal(activeTime(back, T + 310 * MIN), 70 * MIN);
  assert.equal(lastProgressAt(back), T + 300 * MIN);
  // Model-driven changes wait while the run is paused.
  assert.equal((addBlocker(p, 'other', 'x', T) as { error: string }).error, 'paused');
  assert.equal((acceptMilestone(p, ms(1, 'b'), T) as { error: string }).error, 'paused');
  assert.equal(ok(cancelRun(p, T + 400 * MIN)).status, 'canceled');
});

test('the heartbeat is written at most once a minute and is not progress', () => {
  const r = start();
  assert.equal(heartbeat(r, T + 30_000), null);
  const b = heartbeat(r, T + 61_000)!;
  assert.equal(b.aliveAt, T + 61_000);
  assert.equal(recordKey(b), recordKey(r));
  assert.notEqual(recordKey(ok(addBlocker(r, 'tool', 'x', T))), recordKey(r));
  assert.notEqual(recordKey(noteRefusal(r, 'milestone: no commit', T)), recordKey(r));
});

test('the record reads back as written, and a torn or foreign file reads as nothing', () => {
  let r = working();
  r = ok(acceptMilestone(r, ms(1, 'b'.repeat(40), review('concerns', ['x'])), T + 2 * MIN));
  r = ok(addDeferred(r, { kind: 'belt', tool: 'Bash', what: 'git push --force', reason: 'force push [git.force-push]' }, T + 3 * MIN));
  r = ok(addBlocker(r, 'decision', 'which header name', T + 4 * MIN));
  r = ok(pauseRun(r, 'stalled', T + 5 * MIN, 'no milestone'));
  assert.deepEqual(parseRun(JSON.stringify(r)), r);
  for (const bad of [
    null,
    '',
    '{',
    '[]',
    '{"v":2}',
    JSON.stringify({ ...r, status: 'running' }),
    JSON.stringify({ ...r, phase: 'x' }),
    JSON.stringify({ ...r, budget: null }),
  ])
    assert.equal(parseRun(bad), null, String(bad));
  // Unknown kinds inside degrade one entry, not the record.
  const odd = parseRun(JSON.stringify({ ...r, deferred: [{ kind: 'nope' }, r.deferred[0]], blockers: [{ kind: 'nope', text: 't', at: 1 }] }))!;
  assert.deepEqual([odd.deferred.length, odd.blockers[0]!.kind], [1, 'other']);
});

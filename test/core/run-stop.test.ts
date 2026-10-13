// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintOf, missingOf, pauseFor, STALL_STOPS, stopDecision, type StopFacts, type StopMemory } from '../../src/core/run-stop.js';
import { acceptMilestone, acceptPlan, addBlocker, cancelRun, finishRun, pauseRun, startRun, type Run, type RunResult } from '../../src/core/run.js';

const T = Date.parse('2026-10-13T09:10:00Z');
const MIN = 60_000;
const ok = (r: RunResult): Run => {
  assert.equal(r.ok, true);
  return r.run;
};
const start = (): Run =>
  startRun({
    id: 'r1',
    task: 'Add rate limiting',
    project: null,
    cwd: '/home/ada/api',
    sessionId: 's1',
    workDir: '/tmp/tc/runs',
    budget: { weeklyTarget: 52, source: '+10' },
    start: { commit: 'a'.repeat(40), branch: 'main' },
    now: T,
  });
const PLAN = {
  steps: [
    { n: 1, title: 'Limiter', acceptance: 'tests pass' },
    { n: 2, title: 'Wire it in', acceptance: '429 past the limit' },
  ],
  verification: ['npm test'],
};
const review = { verdict: 'pass' as const, findings: [], model: 'opus', at: T, signals: { deletedTests: 0, skipMarkers: 0 } };
const working = () => ok(acceptPlan(start(), PLAN, [], T + MIN));
const facts = (o: Partial<StopFacts> = {}): StopFacts => ({
  now: T + 10 * MIN,
  fingerprint: 'f1',
  quotaLevel: 'ok',
  background: 0,
  maxHours: 12,
  stallMinutes: 90,
  ...o,
});
const EMPTY: StopMemory = { runId: null, fingerprint: null, streak: 0 };

test('an unfinished run is turned back with exactly what is missing', () => {
  const d1 = stopDecision(start(), facts(), EMPTY);
  assert.deepEqual(d1.allow ? null : [d1.missing, d1.streak], [{ kind: 'plan' }, 1]);
  const d2 = stopDecision(working(), facts(), EMPTY);
  assert.deepEqual(d2.allow ? null : d2.missing, { kind: 'step', n: 1, of: 2, title: 'Limiter' });
  let r = ok(acceptMilestone(working(), { n: 1, at: T + 2 * MIN, commit: 'b', ref: 'x', commits: 1, review, note: '' }, T + 2 * MIN));
  r = ok(acceptMilestone(r, { n: 2, at: T + 3 * MIN, commit: 'c', ref: 'x', commits: 1, review, note: '' }, T + 3 * MIN));
  const d3 = stopDecision(r, facts(), EMPTY);
  assert.deepEqual(d3.allow ? null : d3.missing, { kind: 'finish' });
  assert.deepEqual(missingOf(r), { kind: 'finish' });
});

test(`${STALL_STOPS} attempts in a row with nothing changed let it stop as no progress; a change starts the count again`, () => {
  const r = working();
  let mem = EMPTY;
  const seen: string[] = [];
  for (const fp of ['f1', 'f1', 'f2', 'f2', 'f2']) {
    const d = stopDecision(r, facts({ fingerprint: fp }), mem);
    seen.push(d.allow ? `allow:${d.why}` : `block:${d.streak}`);
    mem = d.memory;
  }
  assert.deepEqual(seen, ['block:1', 'block:2', 'block:1', 'block:2', 'allow:noProgress']);
  assert.deepEqual(mem, { runId: 'r1', fingerprint: 'f2', streak: 0 });
  // Another run's memory does not count for this one.
  const d = stopDecision(r, facts(), { runId: 'other', fingerprint: 'f1', streak: 2 });
  assert.equal(d.allow, false);
});

test('a stop is let through for a run that is over or paused, the budget, background work, the time limit, the stall', () => {
  const r = working();
  const why = (run: Run, f: Partial<StopFacts>) => {
    const d = stopDecision(run, facts(f), EMPTY);
    return d.allow ? d.why : 'block';
  };
  assert.equal(stopDecision(null, facts(), EMPTY).allow, true);
  assert.equal(why(ok(cancelRun(r, T)), {}), 'over');
  assert.equal(why(ok(addBlocker(r, 'other', 'x', T)), {}), 'block');
  assert.equal(why(ok(pauseRun(r, 'person', T)), {}), 'paused');
  assert.equal(why(r, { quotaLevel: 'wrapUp' }), 'budget');
  assert.equal(why(r, { quotaLevel: 'stop' }), 'budget');
  assert.equal(why(r, { background: 1 }), 'waiting');
  assert.equal(why(r, { now: T + 12 * 60 * MIN }), 'timeout');
  assert.equal(why(r, { now: T + 12 * 60 * MIN - 1, maxHours: 12, stallMinutes: 720 }), 'block');
  // The stall needs twice the setting since the last progress (the plan was accepted at T + 1 min).
  assert.equal(why(r, { now: T + MIN + 179 * MIN }), 'block');
  assert.equal(why(r, { now: T + MIN + 180 * MIN }), 'stalled');
  const done = ok(
    finishRun(
      ok(
        acceptMilestone(
          ok(acceptMilestone(r, { n: 1, at: T, commit: 'b', ref: 'x', commits: 1, review, note: '' }, T)),
          { n: 2, at: T, commit: 'c', ref: 'x', commits: 1, review, note: '' },
          T,
        ),
      ),
      { at: T, verification: [{ command: 'npm test', ok: true, seconds: 1 }], review },
      true,
      T,
    ),
  );
  assert.equal(why(done, {}), 'over');
});

test('what a let-through stop leaves on the run', () => {
  assert.equal(pauseFor('noProgress'), 'stalled');
  assert.equal(pauseFor('stalled'), 'stalled');
  assert.equal(pauseFor('timeout'), 'timeout');
  assert.equal(pauseFor('budget'), 'quota');
  for (const w of ['none', 'over', 'paused', 'waiting'] as const) assert.equal(pauseFor(w), null);
});

test('the fingerprint changes with the commit, the work tree and the record, not with the heartbeat', () => {
  const r = working();
  const base = fingerprintOf('a', ' M src/x.ts\n', r);
  assert.equal(fingerprintOf('a', ' M src/x.ts\n', r), base);
  assert.notEqual(fingerprintOf('b', ' M src/x.ts\n', r), base);
  assert.notEqual(fingerprintOf('a', ' M src/x.ts\n?? src/y.ts\n', r), base);
  assert.notEqual(fingerprintOf('a', ' M src/x.ts\n', ok(addBlocker(r, 'other', 'x', T))), base);
  assert.equal(fingerprintOf('a', ' M src/x.ts\n', { ...r, aliveAt: T + 99 * MIN }), base);
  assert.match(fingerprintOf(null, '', r), /^-:0:/);
});

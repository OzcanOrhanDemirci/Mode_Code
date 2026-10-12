// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvePlan,
  cancelFlow,
  completeStep,
  currentStep,
  flowId,
  isRunning,
  noteRefusal,
  parseFlow,
  pauseFlow,
  progress,
  resumeFlow,
  revisePlan,
  startFlow,
  stepMode,
  type Flow,
  type FlowResult,
} from '../../src/core/flow.js';
import { flowDir, layout } from '../../src/core/layout.js';

const T = Date.parse('2026-10-12T20:15:00Z');
const start = (variant: 'full' | 'plan' | 'research' = 'full'): Flow =>
  startFlow({ id: 'f1', variant, task: 'Add sign-in', project: 'app', cwd: '/home/ada/app', sessionId: 's1', workDir: '/tmp/tc/flows/', now: T });
const ok = (r: FlowResult): Flow => {
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return r.flow;
};
const R = { kind: 'research', findings: 3, sources: 2 } as const;
const P = { kind: 'plan', steps: 2, commands: 1 } as const;
const C = { kind: 'code', commands: 1, seconds: 4 } as const;

test('a full flow runs research ▶ plan → approval → code, in order', () => {
  let f = start();
  assert.deepEqual(
    f.steps.map((s) => [s.kind, s.status]),
    [
      ['research', 'active'],
      ['plan', 'pending'],
      ['approve', 'pending'],
      ['code', 'pending'],
    ],
  );
  assert.equal(f.workDir, '/tmp/tc/flows/f1');
  assert.equal(f.reportPath, '/tmp/tc/flows/f1/research.md');
  assert.equal(f.planPath, '/tmp/tc/flows/f1/plan.md');
  f = ok(completeStep(f, 'research', R, T + 1));
  assert.equal(currentStep(f)?.kind, 'plan');
  f = ok(completeStep(f, 'plan', P, T + 2));
  assert.equal(f.status, 'waiting');
  assert.equal(stepMode(currentStep(f)!.kind), 'plan');
  f = ok(approvePlan(f, 'dialog', ['npm test'], T + 3));
  assert.deepEqual([f.status, currentStep(f)?.kind, f.verification, f.approval], ['active', 'code', ['npm test'], { at: T + 3, via: 'dialog' }]);
  f = ok(completeStep(f, 'code', C, T + 4));
  assert.deepEqual([f.status, f.current, progress(f)], ['done', 4, { at: 4, of: 4 }]);
  assert.deepEqual(
    f.history.map((h) => h.event),
    ['start', 'done', 'done', 'approve', 'done'],
  );
  assert.deepEqual(f.steps[0]!.evidence, R);
});

test("no step is skipped, and the approval is never the model's", () => {
  const f = start();
  assert.deepEqual(completeStep(f, 'plan', P, T).ok ? null : (completeStep(f, 'plan', P, T) as { error: string }).error, 'not-current');
  assert.equal((completeStep(f, 'code', C, T) as { error: string }).error, 'not-current');
  assert.equal((completeStep(f, 'approve', { kind: 'approve', via: 'dialog' }, T) as { error: string }).error, 'person-only');
  assert.equal((approvePlan(f, 'keyword', [], T) as { error: string }).error, 'not-waiting');
  // Evidence of another step's kind does not finish this one.
  assert.equal((completeStep(f, 'research', P as never, T) as { error: string }).error, 'not-current');
});

test('a revision goes back to the plan step; the approval waits again after it', () => {
  let f = ok(completeStep(start('plan'), 'plan', P, T));
  f = ok(revisePlan(f, 'split step 2', T + 1));
  assert.deepEqual([f.status, currentStep(f)?.kind, f.steps[0]!.status, f.steps[1]!.status], ['active', 'plan', 'active', 'pending']);
  assert.equal(f.history.at(-1)?.detail, 'split step 2');
  f = ok(completeStep(f, 'plan', P, T + 2));
  assert.equal(f.status, 'waiting');
});

test("pause, resume and cancel are the person's; a paused flow refuses steps", () => {
  let f = ok(pauseFlow(start(), 'stop', T));
  assert.equal(f.status, 'paused');
  assert.equal(isRunning(f), false);
  assert.equal((completeStep(f, 'research', R, T) as { error: string }).error, 'paused');
  f = ok(resumeFlow(f, 's2', T + 1));
  assert.deepEqual([f.status, f.sessionId], ['active', 's2']);
  // A flow paused at the approval resumes waiting.
  let w = ok(completeStep(start('plan'), 'plan', P, T));
  w = ok(resumeFlow(ok(pauseFlow(w, 'stop', T)), 's3', T));
  assert.equal(w.status, 'waiting');
  const c = ok(cancelFlow(f, T + 2));
  assert.equal(c.status, 'canceled');
  for (const r of [completeStep(c, 'research', R, T), resumeFlow(c, 's', T), pauseFlow(c, 'x', T), cancelFlow(c, T), approvePlan(c, 'dialog', [], T)])
    assert.equal((r as { error: string }).error, 'terminal');
});

test('a research flow ends after its report', () => {
  const f = ok(completeStep(start('research'), 'research', R, T));
  assert.equal(f.status, 'done');
});

test('refusals are recorded without changing the step', () => {
  const f = noteRefusal(start(), 'research', 'no Sources section', T + 5);
  assert.deepEqual([f.history.at(-1)?.event, currentStep(f)?.status, f.updatedAt], ['refused', 'active', T + 5]);
});

test('flow ids are sortable, readable, safe and unique', () => {
  const id = flowId('Girişe İKİ aşamalı doğrulama ekle!', T, new Set());
  assert.match(id, /^\d{8}-\d{4}-giris(e)?-iki-asamali-dogrulama-ekle$/);
  assert.match(flowId('', T, new Set()), /^\d{8}-\d{4}-flow$/);
  const taken = new Set([flowId('x', T, new Set())]);
  assert.match(flowId('x', T, taken), /-x-2$/);
});

test('records round-trip, and anything torn or foreign is rejected rather than half-read', () => {
  const f = ok(approvePlan(ok(completeStep(start('plan'), 'plan', P, T)), 'plan-mode', ['npm test'], T));
  assert.deepEqual(parseFlow(JSON.stringify(f)), f);
  for (const bad of [
    null,
    '',
    '{',
    '[]',
    '{"v":2}',
    JSON.stringify({ ...f, steps: [] }),
    JSON.stringify({ ...f, status: 'odd' }),
    JSON.stringify({ ...f, steps: [{ kind: 'x' }] }),
  ])
    assert.equal(parseFlow(bad), null, String(bad));
  const odd = parseFlow(JSON.stringify({ ...f, current: 99, approval: { at: 1, via: 'chat' }, verification: [1, 'a'] }))!;
  assert.deepEqual([odd.current, odd.approval, odd.verification], [0, null, ['a']]);
});

test('a flow folder only for ids of the flows own shape', () => {
  const l = layout('/home/ada/.terminal-code');
  assert.equal(flowDir(l, '20261012-2015-add-sign-in'), '/home/ada/.terminal-code/flows/20261012-2015-add-sign-in');
  for (const bad of ['', '../x', 'A', 'a/b', 'x'.repeat(90), '-x']) assert.equal(flowDir(l, bad), null, bad);
});

test('running means active or waiting; a second pause changes nothing; only the first step has started', () => {
  const f = start('plan');
  assert.deepEqual(
    f.steps.map((s) => s.startedAt),
    [T, null, null],
  );
  const w = ok(completeStep(f, 'plan', P, T + 1));
  assert.equal(isRunning(w), true);
  assert.equal(isRunning(f), true);
  const p = ok(pauseFlow(w, 'stop', T + 2));
  assert.equal(isRunning(p), false);
  const again = pauseFlow(p, 'stop', T + 3);
  assert.equal(again.ok, true);
  assert.equal(again.flow, p);
});

test('flow ids keep whole words up to 40 characters', () => {
  const forty = 'abcdefghij-abcdefghij-abcdefghij-abcdefg'; // 40 characters in three words
  assert.equal(forty.length, 40);
  assert.match(flowId('abcdefghij abcdefghij abcdefghij abcdefg', T, new Set()), /-abcdefghij-abcdefghij-abcdefghij-abcdefg$/);
  assert.match(flowId('abcdefghij abcdefghij abcdefghij abcdefgh', T, new Set()), /-abcdefghij-abcdefghij-abcdefghij$/);
});

test('records: every field of the wrong kind is caught, each on its own', () => {
  const f = ok(approvePlan(ok(completeStep(start('plan'), 'plan', P, T)), 'plan-mode', ['npm test'], T));
  const json = (o: object) => JSON.stringify({ ...f, ...o });
  assert.equal(parseFlow('null'), null);
  assert.equal(parseFlow('5'), null);
  assert.equal(parseFlow(json({ v: 2 })), null);
  assert.equal(parseFlow(json({ id: 5 })), null);
  assert.equal(parseFlow(json({ steps: 'x' })), null);
  assert.equal(parseFlow(json({ status: 'odd' })), null);
  assert.equal(parseFlow(json({ current: 3 }))!.current, 3);
  assert.equal(parseFlow(json({ current: 4 }))!.current, 0);
  assert.equal(parseFlow(json({ current: -1 }))!.current, 0);
  assert.equal(parseFlow(json({ current: 0 }))!.current, 0);
  assert.equal(parseFlow(json({ variant: 'research' }))!.variant, 'research');
  assert.equal(parseFlow(json({ variant: 'plan' }))!.variant, 'plan');
  assert.equal(parseFlow(json({ variant: 'odd' }))!.variant, 'full');
  assert.equal(parseFlow(json({ createdAt: 'x' }))!.createdAt, 0);
  const h = parseFlow(json({ history: [{ at: 1, event: 'start' }, { at: 'x', event: 'start' }, { at: 1, event: 2 }, [1], null] }))!;
  assert.deepEqual(h.history, [{ at: 1, event: 'start' }]);
});

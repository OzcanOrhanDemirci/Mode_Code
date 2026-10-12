// SPDX-License-Identifier: Apache-2.0
/**
 * Modes and flows, for every input: the command classifier never throws and answers the same twice; a
 * restricted mode never lets through what the classifier could not place; no sequence of events, whoever
 * sends them, completes a flow's step out of order, without its check, or without the person's approval;
 * the report and plan checks read any text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fc, shellish } from '../helpers/prop.js';
import { commandEffects, EFFECT_ORDER, strongest, type EffectEnv } from '../../src/core/shell/effects.js';
import { checkMode, type ModeGuard } from '../../src/core/guard.js';
import {
  approvePlan,
  cancelFlow,
  completeStep,
  pauseFlow,
  resumeFlow,
  revisePlan,
  startFlow,
  type Flow,
  type FlowEvidence,
  type FlowStepKind,
} from '../../src/core/flow.js';
import { checkPlan, checkReport } from '../../src/core/flow-checks.js';
import { messageWithoutKeyword } from '../../src/core/keywords.js';

const ENV: EffectEnv = { platform: 'linux', home: '/home/ada', cwd: '/home/ada/app', env: { TMPDIR: '/tmp' } };

test('the classifier never throws, places every program in one of its five classes, and answers the same twice', () => {
  fc.assert(
    fc.property(shellish, fc.constantFrom('bash' as const, 'powershell' as const), (cmd, dialect) => {
      const a = commandEffects(cmd, dialect, ENV);
      for (const e of a.effects) assert.ok(EFFECT_ORDER.includes(e.kind));
      assert.deepEqual(commandEffects(cmd, dialect, ENV), a);
      assert.ok(EFFECT_ORDER.includes(strongest(a.effects)));
    }),
  );
});

test('a restricted mode lets a command through only when every program reads, writes into its folders, or runs inside them', () => {
  const guard: ModeGuard = {
    mode: 'chat',
    zones: { temp: ['/tmp'], work: [], plan: [] },
    env: { TMPDIR: '/tmp' },
    flowStep: null,
    words: { code: 'code', free: 'free' },
  };
  fc.assert(
    fc.property(shellish, (cmd) => {
      const refused = checkMode('Bash', { command: cmd }, guard, ENV, 'en');
      if (refused) return;
      const a = commandEffects(cmd, 'bash', ENV);
      for (const e of a.effects) {
        assert.notEqual(e.kind, 'outside', cmd);
        for (const t of e.targets) assert.ok(t !== null && (t === '/tmp' || t.startsWith('/tmp/')), `${cmd} writes ${t}`);
        if (e.kind === 'local' || e.kind === 'unknown') assert.ok(e.cwd !== null && (e.cwd === '/tmp' || e.cwd.startsWith('/tmp/')), cmd);
      }
    }),
  );
});

type Ev = { k: 'complete'; step: FlowStepKind } | { k: 'approve' } | { k: 'revise' } | { k: 'pause' } | { k: 'resume' } | { k: 'cancel' };

const event: fc.Arbitrary<Ev> = fc.oneof(
  fc.constantFrom('research', 'plan', 'approve', 'code').map((step) => ({ k: 'complete' as const, step: step as FlowStepKind })),
  fc.constant({ k: 'approve' as const }),
  fc.constant({ k: 'revise' as const }),
  fc.constant({ k: 'pause' as const }),
  fc.constant({ k: 'resume' as const }),
  fc.constant({ k: 'cancel' as const }),
);

function evidence(step: FlowStepKind): FlowEvidence {
  if (step === 'research') return { kind: 'research', findings: 1, sources: 1 };
  if (step === 'plan') return { kind: 'plan', steps: 1, commands: 1 };
  if (step === 'code') return { kind: 'code', commands: 1, seconds: 1 };
  return { kind: 'approve', via: 'dialog' };
}

test('no sequence of events completes a step out of order, skips the approval, or changes an ended flow', () => {
  fc.assert(
    fc.property(fc.constantFrom('full' as const, 'plan' as const, 'research' as const), fc.array(event, { maxLength: 30 }), (variant, events) => {
      let f: Flow = startFlow({ id: 'f', variant, task: 't', project: null, cwd: '/a', sessionId: 's', workDir: '/w', now: 0 });
      let now = 0;
      for (const e of events) {
        now++;
        const before = f;
        const r =
          e.k === 'complete'
            ? completeStep(f, e.step, evidence(e.step), now)
            : e.k === 'approve'
              ? approvePlan(f, 'keyword', ['npm test'], now)
              : e.k === 'revise'
                ? revisePlan(f, 'x', now)
                : e.k === 'pause'
                  ? pauseFlow(f, 'x', now)
                  : e.k === 'resume'
                    ? resumeFlow(f, 's', now)
                    : cancelFlow(f, now);
        f = r.flow;
        // An ended flow never changes.
        if (before.status === 'done' || before.status === 'canceled') assert.equal(r.ok, false);
        // A step is only ever completed when it was the current one, and the approval only by the person's event.
        if (e.k === 'complete' && r.ok) {
          assert.equal(before.steps[before.current]?.kind, e.step);
          assert.notEqual(e.step, 'approve');
        }
        // Invariants of the record itself.
        const doneSteps = f.steps.filter((s) => s.status === 'done').length;
        for (let i = 0; i < f.steps.length; i++) {
          if (i < f.current) assert.equal(f.steps[i]!.status, 'done', `step ${i} before the current one is done`);
          if (i > f.current) assert.equal(f.steps[i]!.status, 'pending', `step ${i} after the current one is pending`);
        }
        assert.equal(doneSteps, Math.min(f.current, f.steps.length));
        // Code is only ever reached through an approval.
        const code = f.steps.findIndex((s) => s.kind === 'code');
        if (code !== -1 && f.current >= code) assert.ok(f.approval !== null, 'code without an approval');
        if (f.status === 'waiting') assert.equal(f.steps[f.current]?.kind, 'approve');
      }
    }),
  );
});

test('the report and plan checks read any text without throwing; a form that passes keeps passing', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 400 }), (text) => {
      const r = checkReport(text);
      const p = checkPlan(text);
      assert.deepEqual(checkReport(text), r);
      assert.deepEqual(checkPlan(text), p);
      assert.ok(r.findings >= 0 && p.steps.length >= 0);
      messageWithoutKeyword(text);
    }),
  );
  const line = fc.stringMatching(/^[A-Za-z][A-Za-z ,]{0,30}$/);
  fc.assert(
    fc.property(fc.array(line, { minLength: 1, maxLength: 5 }), (titles) => {
      const plan = `## Steps\n\n${titles.map((t, i) => `### ${i + 1}. ${t}\n\nAcceptance: ${t} works\n`).join('\n')}\n## Verification\n\n- \`npm test\`\n`;
      const p = checkPlan(plan);
      assert.deepEqual(p.problems, []);
      assert.equal(p.steps.length, titles.length);
    }),
  );
});

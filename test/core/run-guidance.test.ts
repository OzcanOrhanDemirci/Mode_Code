// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_TOOL,
  autoNoTaskContext,
  autoPendingContext,
  autoRefusedContext,
  autoResumeContext,
  autoStallContext,
  autoStartContext,
  autoStateText,
  autoTurnContext,
} from '../../src/core/run-guidance.js';
import { acceptPlan, pauseRun, startRun, type Run, type RunResult } from '../../src/core/run.js';
import type { GateResult } from '../../src/core/run-gate.js';

const ok = (r: RunResult): Run => {
  assert.equal(r.ok, true);
  return r.run;
};
const r0 = startRun({
  id: 'r1',
  task: 'Add rate limiting to the public API, with tests.',
  project: 'api',
  cwd: '/home/ada/api',
  sessionId: 's1',
  workDir: '/tmp/tc/runs',
  budget: { weeklyTarget: 52, source: '+10' },
  start: { commit: 'a', branch: 'main' },
  now: 0,
});

test('a start or resume waiting for its last checks tells the model to call "start" first, and nothing else', () => {
  const start = autoPendingContext(false);
  assert.match(start, /^\[terminal-code\] The person asked for full autonomy\. The start checks that can be measured now passed;/);
  assert.match(start, /Claude Code's permission mode for this prompt, and a live probe of the sandbox/);
  assert.ok(start.includes(`call ${AUTO_TOOL} with action "start"`));
  assert.match(start, /every other tool call is held\. Its answer says whether the run started and what comes next/);
  const resume = autoPendingContext(true);
  assert.match(resume, /The person asked to resume the paused full-autonomy run\./);
  assert.match(resume, /whether the run resumed and what comes next/);
});

test("the start tells the rules, the request word for word, where the plan goes, its form and the person's commands", () => {
  const s = autoStartContext(r0, ['npm run check']);
  assert.match(s, /creating the run's branch, reading, and running the verification are not steps/);
  assert.match(s, /^\[terminal-code\] The person started full autonomy \(run r1, weekly budget 52%\)\./);
  assert.match(s, /"Add rate limiting to the public API, with tests\."/);
  assert.match(s, /never ask the person anything/);
  assert.match(s, /write the plan at \/tmp\/tc\/runs\/r1\/plan\.md/);
  assert.match(s, /`npm run check`/);
  assert.match(s, /## Verification/);
  assert.ok(s.includes(AUTO_TOOL));
  assert.doesNotMatch(autoStartContext(r0, []), /definition of done for this project/);
});

test("a refusal lists each failed check in the person's language, and asks Claude not to start", () => {
  const g: GateResult = {
    ok: false,
    checks: [
      { id: 'enabled', ok: true, key: 'auto.gate.enabled.ok' },
      { id: 'platform', ok: false, key: 'auto.gate.platform.windows' },
      { id: 'probe', ok: null, key: 'auto.gate.probe.notHere' },
      { id: 'project', ok: false, key: 'auto.gate.project.dirty', params: { n: 2 } },
    ],
  };
  const s = autoRefusedContext(g, 'tr');
  assert.match(s, /2 start check\(s\) failed/);
  assert.match(s, /- Platform: Yerel Windows/);
  assert.match(s, /- Proje: 2 izlenen dosyada/);
  assert.doesNotMatch(s, /Açık:/, 'passed checks are not listed');
  assert.match(s, /do not start the task/);
  assert.match(autoNoTaskContext(), /without a task/);
});

test('each prompt, a resume, a compaction and a stall say where the run stands', () => {
  assert.match(autoTurnContext(r0), /phase plan: write \/tmp\/tc\/runs\/r1\/plan\.md/);
  const w = ok(acceptPlan(r0, { steps: [{ n: 1, title: 'Limiter', acceptance: 'tests' }], verification: ['npm test'] }, [], 1));
  assert.match(autoTurnContext(w), /phase work, 0\/1 milestones; next: step 1 \(Limiter\)/);
  assert.match(autoResumeContext(w), /resumed\. The person's request, word for word: "Add rate limiting/);
  assert.match(autoStateText(w), /a full-autonomy run runs \(r1, the person's request: "Add rate limiting/);
  const paused = autoStateText(ok(pauseRun(w, 'quota', 2)));
  assert.match(paused, /is paused/);
  assert.match(paused, /until then the session works as they ask/);
  assert.doesNotMatch(paused, /never ask the person/);
  assert.match(autoStallContext(w, 95), /no milestone for 95 minutes/);
});

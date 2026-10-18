// SPDX-License-Identifier: Apache-2.0
/**
 * Full autonomy, for every input: no sequence of events, whoever sends them, makes a run done without every
 * milestone and a finish whose facts all passed, accepts a milestone out of order or after a failed review,
 * drops a verification command, or changes a run that is over; a start check that fails never lets a run
 * start; an unfinished run that makes progress is never let stop; the guard never throws on any command.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fc, shellish } from '../helpers/prop.js';
import {
  acceptMilestone,
  acceptPlan,
  addBlocker,
  addDeferred,
  cancelRun,
  finishRun,
  isTerminal,
  markStuck,
  pauseRun,
  resumeRun,
  startRun,
  type Review,
  type Run,
  type RunResult,
} from '../../src/core/run.js';
import { checkGate, gateOpen, type GateFacts } from '../../src/core/run-gate.js';
import { STALL_STOPS, stopDecision, type StopMemory } from '../../src/core/run-stop.js';
import { checkAutonomy, credentialPaths, type AutoEnv } from '../../src/core/run-guard.js';
import { assessQuota } from '../../src/core/quota.js';

const verdict = fc.constantFrom<Review['verdict']>('pass', 'concerns', 'fail', 'unavailable');
const commands = fc.subarray(['npm test', 'npm run check', 'npm run lint', 'make'], { minLength: 0 });

type Ev =
  | { k: 'plan'; steps: number; verification: string[]; required: string[] }
  | { k: 'milestone'; n: number; verdict: Review['verdict'] }
  | { k: 'blocker' }
  | { k: 'defer' }
  | { k: 'finish'; ok: boolean[]; verdict: Review['verdict']; report: boolean }
  | { k: 'stuck'; report: boolean }
  | { k: 'pause' }
  | { k: 'resume' }
  | { k: 'cancel' };

const event: fc.Arbitrary<Ev> = fc.oneof(
  fc.record({ k: fc.constant('plan' as const), steps: fc.integer({ min: 0, max: 4 }), verification: commands, required: commands }),
  fc.record({ k: fc.constant('milestone' as const), n: fc.integer({ min: 0, max: 5 }), verdict }),
  fc.constant({ k: 'blocker' as const }),
  fc.constant({ k: 'defer' as const }),
  fc.record({ k: fc.constant('finish' as const), ok: fc.array(fc.boolean(), { maxLength: 3 }), verdict, report: fc.boolean() }),
  fc.record({ k: fc.constant('stuck' as const), report: fc.boolean() }),
  fc.constant({ k: 'pause' as const }),
  fc.constant({ k: 'resume' as const }),
  fc.constant({ k: 'cancel' as const }),
);

const review = (v: Review['verdict']): Review => ({ verdict: v, findings: [], model: 'm', at: 0, signals: { deletedTests: 0, skipMarkers: 0 } });

test('no sequence of events makes a run done without its facts, skips a milestone, drops a check, or changes a run that is over', () => {
  fc.assert(
    fc.property(fc.array(event, { maxLength: 40 }), (events) => {
      let r: Run = startRun({
        id: 'r',
        task: 't',
        project: null,
        cwd: '/p',
        sessionId: 's',
        workDir: '/w',
        budget: { weeklyTarget: 50, source: '50' },
        start: { commit: 'c0', branch: null },
        now: 0,
      });
      let now = 0;
      let commits = 0;
      for (const e of events) {
        now++;
        const before = r;
        const res: RunResult =
          e.k === 'plan'
            ? acceptPlan(
                r,
                { steps: Array.from({ length: e.steps }, (_, i) => ({ n: i + 1, title: `s${i + 1}`, acceptance: 'a' })), verification: e.verification },
                e.required,
                now,
              )
            : e.k === 'milestone'
              ? acceptMilestone(r, { n: e.n, at: now, commit: `c${++commits}`, ref: 'x', commits: 1, review: review(e.verdict), note: '' }, now)
              : e.k === 'blocker'
                ? addBlocker(r, 'other', 'b', now)
                : e.k === 'defer'
                  ? addDeferred(r, { kind: 'push', tool: 'Bash', what: `w${now % 3}`, reason: 'r' }, now)
                  : e.k === 'finish'
                    ? finishRun(
                        r,
                        { at: now, verification: e.ok.map((ok, i) => ({ command: `c${i}`, ok, seconds: 1 })), review: review(e.verdict) },
                        e.report,
                        now,
                      )
                    : e.k === 'stuck'
                      ? markStuck(r, e.report, now)
                      : e.k === 'pause'
                        ? pauseRun(r, 'person', now)
                        : e.k === 'resume'
                          ? resumeRun(r, 's', now)
                          : cancelRun(r, now);
        r = res.run;
        if (isTerminal(before)) {
          assert.equal(res.ok, false, 'a run that is over never changes');
          assert.equal(r, before);
        }
        // Milestones: 1, 2, 3 … in the plan's order, none after a failed review, each on its own commit.
        r.milestones.forEach((m, i) => {
          assert.equal(m.n, i + 1);
          assert.notEqual(m.review.verdict, 'fail');
        });
        assert.equal(new Set(r.milestones.map((m) => m.commit)).size, r.milestones.length);
        // A revision never drops a verification command, and the person's commands are always in.
        if (before.plan && r.plan) for (const c of before.plan.verification) assert.ok(r.plan.verification.includes(c), `dropped ${c}`);
        if (r.plan) for (const c of r.plan.required) assert.ok(r.plan.verification.includes(c));
        if (r.status === 'done') {
          assert.ok(r.plan && r.plan.steps.length === r.milestones.length, 'done with a step left');
          assert.ok(r.finish && r.finish.verification.length > 0 && r.finish.verification.every((v) => v.ok), 'done without a passing verification');
          assert.notEqual(r.finish!.review.verdict, 'fail');
        }
        if (r.status === 'stuck') assert.ok(r.blockers.length > 0);
        // The clock runs exactly while the run is active.
        assert.equal(r.runningSince !== null, r.status === 'active');
      }
    }),
  );
});

const NOW = 1_000_000_000_000;
const facts = fc.record({
  enabled: fc.boolean(),
  budget: fc.record({
    explicit: fc.boolean(),
    target: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    week: fc.integer({ min: 0, max: 100 }),
    five: fc.integer({ min: 0, max: 100 }),
    fresh: fc.boolean(),
  }),
  platform: fc.constantFrom('linux' as const, 'darwin' as const, 'win32' as const),
  wsl: fc.option(
    fc.record({
      osrelease: fc.constantFrom('6.6.87.2-microsoft-standard-WSL2', '4.4.0-19041-Microsoft', 'x', null),
      interop: fc.constantFrom('enabled\n', 'disabled\n', '', null),
      mounts: fc.constantFrom('/dev/sdd / ext4 rw 0 0\n', 'C:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\ 0 0\n', '', null),
    }),
    { nil: null },
  ),
  settings: fc.option(fc.record({ sandbox: fc.record({ enabled: fc.boolean(), failIfUnavailable: fc.boolean(), allowUnsandboxedCommands: fc.boolean() }) }), {
    nil: null,
  }),
  probe: fc.option(fc.record({ ran: fc.boolean(), refused: fc.boolean(), detail: fc.constant('') }), { nil: null }),
  permissionMode: fc.constantFrom('bypassPermissions', 'acceptEdits', 'default', 'plan', 'dontAsk', 'auto', null),
  permissionMeasured: fc.boolean(),
  hookRan: fc.boolean(),
  modes: fc.boolean(),
  tracked: fc.integer({ min: 0, max: 2 }),
  top: fc.boolean(),
  sameFolder: fc.boolean(),
  flow: fc.boolean(),
  ownRun: fc.boolean(),
  elsewhere: fc.boolean(),
  paused: fc.boolean(),
});

test('a run starts only when no check failed, the live probe passed and the permission mode was measured', () => {
  fc.assert(
    fc.property(facts, (x) => {
      const quota = assessQuota(
        {
          windows: [
            { kind: 'five_hour', used: x.budget.five, resetsAt: NOW + 1e6 },
            { kind: 'seven_day', used: x.budget.week, resetsAt: NOW + 1e8 },
          ],
          measuredAt: x.budget.fresh ? NOW : NOW - 1e9,
          source: 'mod',
        },
        { weeklyTarget: x.budget.target, fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360 },
        NOW,
      );
      const f: GateFacts = {
        enabled: x.enabled,
        budget: { explicit: x.budget.explicit, target: x.budget.target, quota },
        platform: x.platform,
        wsl: x.wsl,
        settings: x.settings,
        probe: x.probe,
        permissionMode: x.permissionMode,
        permissionMeasured: x.permissionMeasured,
        hookRan: x.hookRan,
        modes: x.modes,
        git: { topLevel: x.top ? '/p' : null, cwd: '/p', tracked: x.tracked, sameFolder: x.sameFolder },
        alone: { flow: x.flow, ownRun: x.ownRun, elsewhere: x.elsewhere, paused: x.paused ? { id: 'r', cont: 'c', cancel: 'x' } : null },
      };
      const g = checkGate(f);
      const probe = g.checks.find((c) => c.id === 'probe')!;
      const permission = g.checks.find((c) => c.id === 'permission')!;
      assert.equal(g.ok, g.checks.every((c) => c.ok !== false) && probe.ok === true && permission.ok === true);
      assert.equal(
        gateOpen(g),
        g.checks.every((c) => c.ok !== false),
      );
      // Each fact that is wrong on its own fails the run.
      if (g.ok) {
        assert.ok(x.enabled && x.budget.explicit && x.hookRan && x.modes && x.top && x.sameFolder && x.tracked === 0);
        assert.ok(!x.flow && !x.ownRun && !x.elsewhere && !x.paused);
        assert.notEqual(x.platform, 'win32');
        assert.ok(x.probe?.ran && x.probe.refused);
        assert.ok(x.permissionMeasured && ['bypassPermissions', 'dontAsk', 'auto'].includes(String(x.permissionMode)));
        assert.ok(x.settings?.sandbox.enabled && x.settings.sandbox.failIfUnavailable && x.settings.sandbox.allowUnsandboxedCommands === false);
        if (x.wsl)
          assert.ok(x.wsl.osrelease?.includes('WSL2') && (x.wsl.interop === null || x.wsl.interop.startsWith('disabled')) && x.wsl.mounts?.includes('ext4'));
      }
    }),
  );
});

test('an unfinished, active run whose work keeps changing is never let stop while nothing else says so', () => {
  const plan = { steps: [{ n: 1, title: 's', acceptance: 'a' }], verification: ['npm test'] };
  const run = (
    acceptPlan(
      startRun({
        id: 'r',
        task: 't',
        project: null,
        cwd: '/p',
        sessionId: 's',
        workDir: '/w',
        budget: { weeklyTarget: 50, source: '50' },
        start: { commit: 'c', branch: null },
        now: 0,
      }),
      plan,
      [],
      0,
    ) as { run: Run }
  ).run;
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 30 }), (prints) => {
      let mem: StopMemory = { runId: null, fingerprint: null, streak: 0 };
      let same = 0;
      let last: number | null = null;
      for (const p of prints) {
        same = last === p ? same + 1 : 1;
        last = p;
        const d = stopDecision(
          run,
          { now: 60_000, fingerprint: `f${p}`, quotaLevel: 'ok', background: 0, maxHours: 12, stallMinutes: 90, atTimeLimit: 'pause' },
          mem,
        );
        mem = d.memory;
        if (d.allow) {
          assert.equal(d.why, 'noProgress');
          assert.ok(same >= STALL_STOPS, 'let stop before the attempts in a row with nothing changed');
          same = 0;
          last = null;
        } else assert.ok(same < STALL_STOPS);
      }
    }),
  );
});

test('the guard answers every command, the same twice, and never lets the escape hatch through', () => {
  const E: AutoEnv = {
    platform: 'linux',
    home: '/home/ada',
    cwd: '/home/ada/api',
    env: { HOME: '/home/ada' },
    writable: ['/home/ada/api', '/tmp'],
    memoryDirs: ['/home/ada/notes'],
    credentials: credentialPaths('/home/ada', '/home/ada/.claude'),
    protectedBranches: ['main'],
    branch: 'main',
  };
  fc.assert(
    fc.property(shellish, fc.boolean(), (cmd, escape) => {
      const v = checkAutonomy('Bash', { command: cmd, dangerouslyDisableSandbox: escape }, E);
      assert.deepEqual(checkAutonomy('Bash', { command: cmd, dangerouslyDisableSandbox: escape }, E), v);
      if (escape) assert.deepEqual(v.kind === 'refuse' ? v.why : v.kind, 'sandbox-escape');
    }),
  );
});

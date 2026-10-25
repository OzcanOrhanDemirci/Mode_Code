// SPDX-License-Identifier: Apache-2.0
/**
 * Now (src/core/ux/now.ts): the cockpit's facts for a session as its files hold them, the sessions at work, and what
 * Mo says, the most pressing first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults } from '../../src/core/config.js';
import { startFlow } from '../../src/core/flow.js';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits } from '../../src/core/quota.js';
import { newModState, type ModSessionState } from '../../src/core/session.js';
import { canNow } from '../../src/core/ux/cockpit.js';
import { centerFacts, guide, liveSessions, type Guide } from '../../src/core/ux/now.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');
const quota = (five: number, week: number) =>
  assessQuota(
    fromModRateLimits(
      [
        { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-20T12:00:00Z' },
        { kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-25T06:00:00Z' },
      ],
      NOW - 60_000,
    ),
    DEFAULT_BUDGET,
    NOW,
  );
const state = (over: Partial<ModSessionState> = {}): ModSessionState => ({ ...newModState('s1', 'dev', NOW - 60_000), cwd: 'C:/work/app', ...over });
const flow = (sessionId = 's1') =>
  startFlow({ id: 'f1', variant: 'full', task: 'Add sign-in', project: null, cwd: 'C:/work/app', sessionId, workDir: 'C:/tmp/w', now: NOW - 600_000 });
const facts = (over: Partial<Parameters<typeof centerFacts>[0]> = {}) =>
  centerFacts({ config: cloneDefaults(), state: null, flow: null, quota: quota(20, 30), events: [], now: NOW, lang: 'en', ...over });

test('a new session, as it starts: free, its own mode, manual, nothing attached', () => {
  const f = facts();
  assert.equal(f.session, null);
  assert.equal(f.mode, 'free');
  assert.equal(f.modeFrom, 'session');
  assert.equal(f.style, 'manual');
  assert.equal(f.flow, null);
  // What only a running session knows is left empty: no turn at work, the belt as the settings have it.
  assert.deepEqual([f.working, f.mo, f.calls.length, f.agents.length], [false, 'idle', 0, 0]);
  // The cockpit's lines come from these facts as they do inside a session.
  assert.deepEqual(
    canNow(f, 'en').map((r) => r.id),
    ['write', 'risky', 'delete', 'self', 'style', 'agents'],
  );
});

test('the mode in force and where it comes from: a mode for this message, a flow step, Claude Code plan mode', () => {
  assert.deepEqual((({ mode, modeFrom }) => ({ mode, modeFrom }))(facts({ state: state({ mode: 'code', turnMode: 'chat' }) })), {
    mode: 'chat',
    modeFrom: 'turn',
  });
  const f = facts({ state: state({ flowId: 'f1' }), flow: flow() });
  assert.equal(f.mode, 'research');
  assert.equal(f.modeFrom, 'flow');
  assert.equal(f.flow?.at, '1/4');
  // A flow the session does not work on is not its own.
  assert.equal(facts({ state: state({ flowId: 'other' }), flow: flow() }).flow, null);
  // Full autonomy is the session's way of working, nothing more.
  const r = facts({ state: state({ interaction: 'full' }) });
  assert.deepEqual([r.mode, r.modeFrom, r.style], ['free', 'session', 'full']);
  // With modes off a flow says nothing.
  const modesOff = cloneDefaults();
  modesOff.modules.modes = false;
  assert.equal(facts({ config: modesOff, state: state({ flowId: 'f1' }), flow: flow() }).flow, null);
  // A flow's place: at work, waiting for the person's approval, or paused.
  assert.equal(f.flow?.state, 'running');
  assert.equal(facts({ state: state({ flowId: 'f1' }), flow: { ...flow(), status: 'waiting' } }).flow?.state, 'approval');
  assert.equal(facts({ state: state({ flowId: 'f1' }), flow: { ...flow(), status: 'paused' } }).flow?.state, 'paused');
  const p = facts({ state: state({ nativePlan: { on: true, planFile: null, at: NOW } }) });
  assert.deepEqual([p.mode, p.modeFrom], ['plan', 'plan']);
  assert.equal(facts({ state: state({ interaction: 'autonomous' }) }).style, 'autonomous');
});

test("a session's own events only, as the cockpit inside it shows them", () => {
  const events = [
    { at: NOW - 1000, kind: 'belt', session: 's1', verdict: 'deny' },
    { at: NOW - 2000, kind: 'belt', session: 's2', verdict: 'deny' },
  ];
  assert.deepEqual(
    facts({ state: state(), events }).events.map((e) => e.session),
    ['s1'],
  );
  assert.equal(facts({ events }).events.length, 0);
});

test('the sessions at work: this folder first, then the most recently seen; ended, gone and quiet ones are not', () => {
  const s = (id: string, cwd: string, aliveAt: number, over: Partial<ModSessionState> = {}) => ({ ...newModState(id, 'dev', aliveAt), cwd, ...over });
  const live = liveSessions(
    [
      s('old', 'C:/other', NOW - 20 * 60_000),
      s('ended', 'C:/work/app', NOW - 60_000, { endedAt: NOW - 30_000 }),
      s('gone', 'C:/work/app', NOW - 60_000),
      s('elsewhere', 'C:/other', NOW - 30_000),
      s('here', 'C:\\Work\\App\\', NOW - 120_000),
    ],
    new Set(['gone']),
    'C:/work/app',
    NOW,
  );
  assert.deepEqual(
    live.map((x) => x.sessionId),
    ['here', 'elsewhere'],
  );
});

test('what Mo says, the most pressing first, and where a press leads', () => {
  const base = {
    protectionBroken: false,
    flows: [] as ReturnType<typeof flow>[],
    away: 0,
    quota: quota(20, 30),
    live: [] as ModSessionState[],
    folder: (x: ModSessionState) => x.cwd ?? '?',
    flowTitle: (f: { task: string }) => f.task,
  };
  const g = (over: Partial<typeof base>): Pick<Guide, 'key' | 'mo' | 'address'> => {
    const r = guide({ ...base, ...over });
    return { key: r.key, mo: r.mo, address: r.address };
  };
  const waiting = { ...flow(), status: 'waiting' as const };
  assert.deepEqual(g({}), { key: 'calm', mo: 'idle', address: null });
  assert.deepEqual(g({ live: [state()] }), { key: 'session', mo: 'work', address: 'memory/sessions/s1' });
  assert.deepEqual(g({ live: [state()], quota: quota(97, 30) }), { key: 'quota', mo: 'low', address: 'quota/usage' });
  assert.deepEqual(g({ quota: quota(97, 30), away: 2 }), { key: 'away', mo: 'wait', address: 'activity/away' });
  assert.deepEqual(g({ away: 2, flows: [waiting] }), { key: 'flow', mo: 'wait', address: 'work/flows/f1' });
  assert.deepEqual(g({ flows: [waiting], protectionBroken: true }), { key: 'broken', mo: 'error', address: 'protection/status' });
  assert.equal(guide({ ...base, live: [state(), state({ sessionId: 's2' })] }).params.n, 2);
});

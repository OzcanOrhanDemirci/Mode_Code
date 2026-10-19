// SPDX-License-Identifier: Apache-2.0
// Parallel agents (core/agents.ts): what each agent's start becomes in each mode, the assigned batch from its prompt to
// its end, what Claude is told and reminded, the strip's words, and the state as a file holds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentCount,
  batchOver,
  batchRunning,
  closeBatch,
  countRunning,
  decideSpawn,
  DEFAULT_AGENTS,
  modeNote,
  onPersonPrompt,
  parseAgents,
  parseRow,
  reminderDue,
  reminderNote,
  rowsFor,
  setMode,
  stripAgents,
  withStarted,
  type AgentsState,
  type Spawn,
} from '../../src/core/agents.js';

const ON = { enabled: true, helpers: true };
const sp = (type: string, o: Partial<Spawn> = {}): Spawn => ({
  type,
  prompt: 'Look.',
  description: 'a task',
  toolUseId: 't',
  workflow: false,
  running: 0,
  ...o,
});
const off: AgentsState = { ...DEFAULT_AGENTS };
const free = (n: number): AgentsState => ({ ...off, mode: 'free', n });
const assigned = (rows: AgentsState['rows'], open = true): AgentsState => ({
  ...off,
  mode: 'assigned',
  n: rows.length,
  rows,
  batch: open ? { at: 5, started: [], sealed: false } : null,
});
const kind = (d: ReturnType<typeof decideSpawn>) => (d.kind === 'deny' ? `deny:${d.why}` : d.kind === 'assign' ? `row:${d.row}` : 'pass');

test('counts: whole numbers of 1 to 999, as a number or as typed', () => {
  for (const [x, want] of [
    [1, 1],
    [999, 999],
    ['7', 7],
    [' 12 ', 12],
    [0, null],
    [1000, null],
    [2.5, null],
    ['7a', null],
    ['', null],
    [null, null],
    [[7] as unknown as number, null],
  ] as const)
    assert.equal(agentCount(x), want, String(x));
});

test('off in the settings, a workflow, ultracode: every agent starts untouched', () => {
  assert.equal(kind(decideSpawn(sp('general-purpose'), off, { enabled: false, helpers: true })), 'pass');
  assert.equal(kind(decideSpawn(sp('general-purpose', { workflow: true }), off, ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('general-purpose'), { ...off, ultracode: true }, ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('general-purpose', { workflow: true }), assigned([{ task: '', kind: 'code', model: null }]), ON)), 'pass');
});

test('off: no agent, but Explore and Plan while the helpers are free', () => {
  assert.equal(kind(decideSpawn(sp('general-purpose'), off, ON)), 'deny:off');
  assert.equal(kind(decideSpawn(sp('my-reviewer'), off, ON)), 'deny:off');
  assert.equal(kind(decideSpawn(sp('Explore'), off, ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('Plan'), off, ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('Explore'), off, { enabled: true, helpers: false })), 'deny:off');
});

test('free: at most N at once; a helper is not counted while helpers are free', () => {
  assert.equal(kind(decideSpawn(sp('general-purpose', { running: 1 }), free(2), ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('general-purpose', { running: 2 }), free(2), ON)), 'deny:full');
  assert.equal(kind(decideSpawn(sp('Explore', { running: 9 }), free(2), ON)), 'pass');
  assert.equal(kind(decideSpawn(sp('Explore', { running: 2 }), free(2), { enabled: true, helpers: false })), 'deny:full');
  const seen = [
    { type: 'general-purpose', status: 'running' },
    { type: 'general-purpose', status: 'pending' },
    { type: 'general-purpose', status: 'waiting' },
    { type: 'general-purpose', status: 'completed' },
    { type: 'general-purpose', status: 'idle' },
    { type: 'Explore', status: 'running' },
  ];
  assert.equal(countRunning(seen, ON), 3);
  assert.equal(countRunning(seen, { enabled: true, helpers: false }), 4);
});

test('assigned: each agent fitted to a row of its kind first, the task word for word with the context, the model; none past N', () => {
  const s = assigned([
    { task: '', kind: 'code', model: null },
    { task: 'Read the logs.', kind: 'research', model: 'sonnet' },
  ]);
  const a = decideSpawn(sp('Explore', { prompt: 'Find the error.' }), s, ON);
  assert.deepEqual(a, {
    kind: 'assign',
    row: 1,
    type: 'Explore',
    prompt: 'Read the logs.\n\n[Mode_Code] Context the main session added: Find the error.',
    model: 'sonnet',
    description: '[2/2] a task',
  });
  const s2 = withStarted(s, 1, 't1');
  // Explore with no research row left is Claude's own search; a worker takes the first row left, fitted to its kind.
  assert.equal(kind(decideSpawn(sp('Explore'), s2, ON)), 'pass');
  assert.deepEqual(decideSpawn(sp('Plan', { prompt: 'p' }), { ...s2, rows: s2.rows }, { enabled: true, helpers: false }), {
    kind: 'assign',
    row: 0,
    type: 'general-purpose',
    prompt: 'p',
    model: null,
    description: '[1/2] a task',
  });
  const s3 = withStarted(s2, 0, 't2');
  assert.equal(kind(decideSpawn(sp('general-purpose'), s3, ON)), 'deny:done');
  assert.equal(kind(decideSpawn(sp('Explore'), s3, ON)), 'pass');
  // Before the person's prompt opens the batch, and after a later prompt seals it: no worker.
  assert.equal(kind(decideSpawn(sp('general-purpose'), assigned(s.rows, false), ON)), 'deny:done');
  assert.equal(kind(decideSpawn(sp('general-purpose'), { ...s, batch: { at: 5, started: [], sealed: true } }, ON)), 'deny:done');
  assert.equal(withStarted(off, 0, 'x'), off, 'no batch, nothing to add');
});

test('the batch: opened by the next prompt, sealed by the one after; over when all started or sealed, and none at work', () => {
  const rows = [
    { task: '', kind: 'code' as const, model: null },
    { task: '', kind: 'code' as const, model: null },
  ];
  const set = setMode(off, 'assigned', 2, rows);
  assert.deepEqual([set.mode, set.n, set.rows.length, set.batch, set.untold], ['assigned', 2, 2, null, 'set']);
  assert.deepEqual(setMode(off, 'free', 4, rows).rows, [], 'a free mode keeps no rows');
  const f3 = free(3);
  assert.equal(onPersonPrompt(f3, 9), f3, 'a free mode has no batch');
  const open = onPersonPrompt(set, 9);
  assert.deepEqual(open.batch, { at: 9, started: [], sealed: false });
  const sealed = onPersonPrompt(open, 10);
  assert.equal(sealed.batch?.sealed, true);
  assert.equal(onPersonPrompt(sealed, 11), sealed, 'sealed stays as it is');
  const one = withStarted(open, 0, 'a');
  const seen = (status: string) => [
    { description: '[1/2] a task', status },
    { description: 'Claude search', status: 'running' },
  ];
  assert.equal(batchRunning(one, seen('running')), 1);
  assert.equal(batchOver(one, seen('completed')), false, 'not all started, not sealed');
  assert.equal(batchOver(withStarted(one, 1, 'b'), seen('running')), false, 'still at work');
  assert.equal(batchOver(withStarted(one, 1, 'b'), seen('completed')), true);
  assert.equal(batchOver({ ...one, batch: { ...one.batch!, sealed: true } }, seen('failed')), true);
  assert.equal(batchOver({ ...one, batch: { ...one.batch!, sealed: true } }, seen('killed')), true);
  assert.equal(batchOver(free(2), []), false);
  assert.equal(batchOver(set, []), false, 'no batch yet');
  assert.deepEqual(closeBatch(one), { ...one, mode: 'off', rows: [], batch: null, untold: 'done' });
});

test('rows for a count: kept, made or cut; a mode that cannot write gets no code agent', () => {
  const given = [{ task: 'A', kind: 'code' as const, model: 'haiku' }];
  assert.deepEqual(rowsFor(2, given, true), [given[0], { task: '', kind: 'code', model: null }]);
  assert.deepEqual(rowsFor(1, [...given, ...given], true), [given[0]]);
  assert.deepEqual(rowsFor(2, given, false), [
    { task: 'A', kind: 'research', model: 'haiku' },
    { task: '', kind: 'research', model: null },
  ]);
  assert.deepEqual(rowsFor(1, [{ task: '', kind: 'plan', model: null }], false), [{ task: '', kind: 'plan', model: null }]);
});

test("what Claude is told: the mode set, the batch's rows, the batch done; and the one reminder", () => {
  assert.match(modeNote(off, ON), /turned parallel agents off for this session: start no agent\. The read-only helpers \(Explore, Plan\) stay yours/);
  assert.doesNotMatch(modeNote(off, { enabled: true, helpers: false }), /helpers/);
  assert.match(modeNote(off, ON, 'done'), /^\[Mode_Code\] The assigned agents are done, and parallel agents are off again/);
  assert.match(modeNote(free(4), ON), /at most 4 at once, or none; you are free to/);
  const s = assigned([
    { task: '', kind: 'code', model: null },
    { task: '  Read the logs. ', kind: 'research', model: 'sonnet' },
  ]);
  assert.equal(
    modeNote(s, ON),
    [
      '[Mode_Code] For this request the person wants exactly 2 agent(s), no fewer and no more: start them in this order, in one message where you can.',
      '1. code (general-purpose): no task given: write it from the request',
      "2. research (Explore, model sonnet): the person's task, which it gets word for word: Read the logs.",
      'Give an agent whatever an agent can do. Do not work around this.',
    ].join('\n'),
  );
  const one = withStarted(s, 1, 'a');
  assert.equal(
    reminderNote(one),
    '[Mode_Code] The person asked for exactly 2 agent(s) for this request; 1 started. Start the rest now (1. code), as they asked. Do not work around it. This is said once.',
  );
  assert.equal(reminderNote({ ...s, batch: null }).includes('0 started'), true);
  const three = assigned([
    { task: '', kind: 'code', model: null },
    { task: '', kind: 'plan', model: null },
    { task: '', kind: 'research', model: null },
  ]);
  assert.match(reminderNote(withStarted(withStarted(three, 0, 'a'), 2, 'b')), /2 started\. Start the rest now \(2\. plan\), as they asked/);
  assert.equal(reminderDue(one, null), true);
  assert.equal(reminderDue(one, 5), false, 'reminded for this batch');
  assert.equal(reminderDue(one, 4), true, 'a reminder for another batch');
  assert.equal(reminderDue(withStarted(one, 0, 'b'), null), false, 'all started');
  assert.equal(reminderDue({ ...one, batch: { ...one.batch!, sealed: true } }, null), false);
  assert.equal(reminderDue({ ...one, ultracode: true }, null), false);
  assert.equal(reminderDue({ ...one, mode: 'free' }, null), false);
  assert.equal(reminderDue({ ...one, batch: null }, null), false);
  assert.equal(reminderDue(null, null), false);
});

test("the strip's words, wide and tight", () => {
  // Off is the control not lit: no ✕ beside the close control's.
  assert.equal(stripAgents(off, 0, 'agents', false), '👥 agents');
  assert.equal(stripAgents(off, 0, 'agents', true), '👥');
  assert.equal(stripAgents(free(5), 0, 'agents', false), '👥 agents ≤5');
  assert.equal(stripAgents(free(5), 2, 'agents', false), '👥 agents ≤5 · 2');
  assert.equal(stripAgents(free(5), 2, 'agents', true), '👥≤5·2');
  const s = assigned([{ task: '', kind: 'code', model: null }], false);
  assert.equal(stripAgents(s, 0, 'agents', false), '👥 agents =1');
  assert.equal(stripAgents(withStarted(onPersonPrompt(s, 1), 0, 'a'), 0, 'agents', false), '👥 agents =1 · 1/1');
  assert.equal(stripAgents(withStarted(onPersonPrompt(s, 1), 0, 'a'), 0, 'agents', true), '👥=1·1/1');
  assert.equal(stripAgents({ ...off, ultracode: true }, 0, 'agents', false), '👥 agents · ultracode');
  assert.equal(stripAgents({ ...off, ultracode: true }, 0, 'agents', true), '👥∞');
});

test('the state as a file holds it: what is broken falls back, what is right is kept', () => {
  assert.deepEqual(parseAgents(null), DEFAULT_AGENTS);
  assert.deepEqual(parseAgents('x'), DEFAULT_AGENTS);
  assert.deepEqual(parseAgents({ mode: 'turbo', n: 5000, rows: 'x', batch: { at: 'x' }, untold: 'maybe', ultracode: 'yes' }), DEFAULT_AGENTS);
  const s = {
    mode: 'assigned',
    n: 2,
    rows: [{ task: 'A', kind: 'plan', model: 'opus' }, { kind: 'wizard', model: 'gpt' }, null],
    batch: { at: 3, started: [{ row: 0, toolUseId: 't' }, { row: 'x' }, null], sealed: true },
    untold: 'done',
    ultracode: true,
  };
  assert.deepEqual(parseAgents(s), {
    mode: 'assigned',
    n: 2,
    rows: [
      { task: 'A', kind: 'plan', model: 'opus' },
      { task: '', kind: 'code', model: null },
      { task: '', kind: 'code', model: null },
    ],
    batch: { at: 3, started: [{ row: 0, toolUseId: 't' }], sealed: true },
    untold: 'done',
    ultracode: true,
  });
  assert.equal(parseAgents({ untold: 'set' }).untold, 'set');
  assert.equal(parseAgents({ batch: { at: 1, started: [] } }).batch?.sealed, false);
  assert.equal(parseRow({ task: 'x'.repeat(5000) }).task.length, 4000);
});

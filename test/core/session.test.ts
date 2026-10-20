// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addApproval,
  applyKeyword,
  APPROVAL_TTL_MS,
  LIVE_WINDOW_MS,
  isApproved,
  newModState,
  noteOwed,
  parseHookState,
  parseModState,
  sameFolderSessions,
  workingNow,
} from '../../src/core/session.js';
import { detectKeyword, type KeywordMatch } from '../../src/core/keywords.js';

const s0 = newModState('abc', '1.0.0', 1000);
const kw = (k: Partial<KeywordMatch> & Pick<KeywordMatch, 'kind'>): KeywordMatch => ({ lang: 'tr', text: '', standalone: true, ...k });

test('continue names the project and clears a wrap-up; the mode and the way of working stay as the person set them', () => {
  // The person, 2026-10-13: chat and manual on the strip, then "terminal devam" turned them into free and autonomous.
  for (const mode of ['chat', 'research', 'plan', 'code', 'free'] as const)
    for (const interaction of ['default', 'manual', 'autonomous'] as const) {
      const s = applyKeyword({ ...s0, wrapUp: true, mode, interaction }, kw({ kind: 'continue', project: 'mode-code' }), null);
      assert.deepEqual([s.mode, s.interaction, s.wrapUp, s.project], [mode, interaction, false, 'mode-code'], `${mode} ${interaction}`);
    }
  // With a budget too ("terminal devam kota 40").
  const budget = applyKeyword({ ...s0, mode: 'chat', interaction: 'manual' }, kw({ kind: 'continue', budget: { n: 40, plus: false } }), 40);
  assert.deepEqual([budget.mode, budget.interaction, budget.weeklyTarget], ['chat', 'manual', 40]);
});

test('"manual <project> continue" names the way of working, so it sets it; the mode stays', () => {
  const s = applyKeyword({ ...s0, mode: 'chat', interaction: 'autonomous', wrapUp: true }, kw({ kind: 'manual', project: 'app' }), null);
  assert.deepEqual([s.mode, s.interaction, s.wrapUp, s.project], ['chat', 'manual', false, 'app']);
});

test('chat, wrap up and stop change only what they say', () => {
  assert.equal(applyKeyword(s0, kw({ kind: 'chat' }), null).mode, 'chat');
  assert.equal(applyKeyword(s0, kw({ kind: 'wrapUp' }), null).wrapUp, true);
  const stopped = applyKeyword({ ...s0, interaction: 'autonomous', mode: 'code', resumeAt: 5 }, kw({ kind: 'stop' }), null);
  // Stop ends the work and any resume; the way of working on the strip is still the person's.
  assert.deepEqual([stopped.wrapUp, stopped.resumeAt, stopped.interaction, stopped.mode], [true, null, 'autonomous', 'code']);
});

test('a quota keyword sets the weekly target and nothing else, alone or at the end of a task', () => {
  const alone = applyKeyword(s0, kw({ kind: 'quota', n: 40, plus: false }), 40);
  assert.equal(alone.weeklyTarget, 40);
  assert.equal(alone.interaction, 'default');
  const atEnd = applyKeyword({ ...s0, interaction: 'manual' }, kw({ kind: 'quota', n: 8, plus: true, standalone: false }), 34);
  assert.equal(atEnd.weeklyTarget, 34);
  assert.equal(atEnd.weeklyTargetSource, '+8');
  assert.equal(atEnd.interaction, 'manual');
  assert.equal(applyKeyword(s0, kw({ kind: 'quota', n: 8, plus: true }), null), s0); // +N with no reading changes nothing
});

test('an approval covers one tool call, for a short time', () => {
  const s = addApproval(s0, { toolUseId: 'toolu_1', at: 10_000, rules: ['git.clean'] });
  assert.equal(isApproved(s, 'toolu_1', 10_500), true);
  assert.equal(isApproved(s, 'toolu_2', 10_500), false);
  assert.equal(isApproved(s, 'toolu_1', 10_000 + APPROVAL_TTL_MS + 1), false);
  assert.equal(isApproved(s, undefined, 10_500), false);
  assert.equal(isApproved(null, 'toolu_1', 10_500), false);
});

test('two live sessions in one folder are found; old ones, other folders and self are not', () => {
  const now = 1_000_000_000;
  const me = { ...newModState('me', '1', now), cwd: 'C:/work/app' };
  const others = [
    { ...newModState('a', '1', now - 60_000), cwd: 'c:\\WORK\\app\\' }, // same folder, other spelling
    { ...newModState('b', '1', now - 60 * 60_000), cwd: 'C:/work/app' }, // asleep for an hour
    { ...newModState('c', '1', now), cwd: 'C:/work/other' },
    { ...me },
  ];
  assert.deepEqual(
    sameFolderSessions(me, others, now, true).map((s) => s.sessionId),
    ['a'],
  );
  assert.deepEqual(sameFolderSessions(me, others, now, false), []); // case matters on Linux
});

test('a session that ended is not working, however recently it was alive; a resumed one is again', () => {
  // The person, 2026-10-14: a session closed seconds before the next one opened was said to be working.
  const now = 1_000_000_000;
  const me = { ...newModState('me', '1', now), cwd: 'C:/work/app' };
  const ended = { ...newModState('a', '1', now - 7_000), cwd: 'C:/work/app', endedAt: now - 7_000 };
  const open = { ...newModState('b', '1', now - 7_000), cwd: 'C:/work/app' };
  assert.deepEqual(
    sameFolderSessions(me, [ended, open], now, true).map((s) => s.sessionId),
    ['b'],
  );
  assert.equal(workingNow(ended, now), false);
  assert.equal(workingNow({ ...ended, endedAt: null }, now), true);
  assert.equal(workingNow(open, now - 7_000 + LIVE_WINDOW_MS - 1), true);
  assert.equal(workingNow(open, now - 7_000 + LIVE_WINDOW_MS), false);
});

test('a note is owed for another session that changed something after its last note, while the note would be offered', () => {
  const now = 1_000_000_000;
  const work = { startedAt: now - 3600_000, changedAt: now - 600_000, handoffAt: 0, project: 'app', request: 'Fix it.' };
  const s = { ...newModState('other', '1', now - 600_000), work };
  assert.equal(noteOwed(s, 'me', now, 14), true);
  assert.equal(noteOwed(s, 'other', now, 14), false); // its own
  assert.equal(noteOwed({ ...s, work: null }, 'me', now, 14), false); // never changed anything
  assert.equal(noteOwed({ ...s, work: { ...work, handoffAt: work.changedAt } }, 'me', now, 14), false); // its note is written
  assert.equal(noteOwed({ ...s, work: { ...work, handoffAt: work.changedAt - 1 } }, 'me', now, 14), true);
  assert.equal(noteOwed({ ...s, aliveAt: now - 14 * 86_400_000 }, 'me', now, 14), true);
  assert.equal(noteOwed({ ...s, aliveAt: now - 14 * 86_400_000 - 1 }, 'me', now, 14), false); // too old to be offered
});

test("the ended time, the work kept and the hook's process round-trip; anything of another shape is dropped", () => {
  const work = { startedAt: 1, changedAt: 3, handoffAt: 2, project: 'app', request: 'Fix it.' };
  const s = { ...s0, endedAt: 9, work };
  assert.deepEqual(parseModState(JSON.stringify(s)), s);
  const odd = parseModState(JSON.stringify({ ...s0, endedAt: '9', work: { startedAt: 1, changedAt: 3 } }))!;
  assert.deepEqual([odd.endedAt, odd.work], [null, null]);
  const loose = parseModState(JSON.stringify({ ...s0, work: { startedAt: 1, changedAt: 3, handoffAt: 0, project: '', request: 5 } }))!;
  assert.deepEqual(loose.work, { startedAt: 1, changedAt: 3, handoffAt: 0, project: null, request: null });
  for (const k of ['startedAt', 'changedAt', 'handoffAt'] as const)
    assert.equal(parseModState(JSON.stringify({ ...s0, work: { ...work, [k]: 'x' } }))!.work, null, k);
  assert.equal(parseModState(JSON.stringify({ ...s0, work: [1] }))!.work, null);
  const hook = { v: 1, sessionId: 's1', lastRunAt: 5, blocks: {}, host: { pid: 25820, name: 'claude.exe' } };
  assert.deepEqual(parseHookState(JSON.stringify(hook), 's1').host, { pid: 25820, name: 'claude.exe' });
  assert.equal(parseHookState(JSON.stringify({ ...hook, host: { pid: 'x' } }), 's1').host, null);
  assert.equal(parseHookState(JSON.stringify({ ...hook, host: undefined }), 's1').host, null);
  assert.equal(parseHookState(null, 's1').host, null);
  // The agent batch the hook reminded about: its start time, or none.
  assert.equal(parseHookState(JSON.stringify({ ...hook, agentsRemindedAt: 1_760_000_000_000 }), 's1').agentsRemindedAt, 1_760_000_000_000);
  assert.equal(parseHookState(JSON.stringify({ ...hook, agentsRemindedAt: '1760' }), 's1').agentsRemindedAt, null);
  assert.equal(parseHookState(JSON.stringify(hook), 's1').agentsRemindedAt, null);
});

test('a folder frozen and the outside content read: kept when they have their shape, nothing when not', () => {
  const s = { ...s0, frozen: '/home/ada/dev/app/src', tainted: { source: 'WebFetch', at: 3 } };
  assert.deepEqual(parseModState(JSON.stringify(s)), s);
  for (const [frozen, tainted] of [
    ['', { source: 5, at: 3 }],
    [5, { source: 'x', at: '3' }],
    [null, [1]],
  ] as const) {
    const odd = parseModState(JSON.stringify({ ...s0, frozen, tainted }))!;
    assert.deepEqual([odd.frozen, odd.tainted], [null, null], JSON.stringify([frozen, tainted]));
  }
  assert.equal(parseModState(JSON.stringify({ ...s0, tainted: { source: 'x'.repeat(200), at: 1 } }))!.tainted!.source.length, 120);
});

test('state files that are missing, torn or foreign parse to nothing', () => {
  assert.equal(parseModState(null), null);
  assert.equal(parseModState('{"v":1,"sessionId":"abc","aliveAt":'), null);
  assert.equal(parseModState('{"v":2,"sessionId":"abc","aliveAt":1}'), null);
  assert.deepEqual(parseModState(JSON.stringify(s0)), s0);
  assert.equal(parseHookState('{"v":1,"sessionId":"other","lastRunAt":5,"blocks":{}}', 'abc').lastRunAt, 0);
});

test('full autonomy: the keyword chooses it, with the project and the budget; "cancel" leaves it for Autonomous', () => {
  const s0 = newModState('s1', 'dev', 0);
  const kw = detectKeyword('Hız sınırı ekle. terminal tam otonom kota +10', [{ id: 'terminal', names: ['terminal'] }])!;
  const s = applyKeyword({ ...s0, wrapUp: true, resumeAt: 5, turnMode: 'chat' }, kw, 51);
  assert.deepEqual(
    [s.interaction, s.project, s.weeklyTarget, s.weeklyTargetSource, s.wrapUp, s.resumeAt, s.turnMode],
    ['full', 'terminal', 51, '+10', false, 5, null],
  );
  // Without a budget the week's budget stays as it was.
  assert.deepEqual(
    [applyKeyword(s0, detectKeyword('tam otonom')!, 51).interaction, applyKeyword(s0, detectKeyword('tam otonom')!, 51).weeklyTarget],
    ['full', null],
  );
  const cancel = applyKeyword({ ...s0, interaction: 'full', resumeAt: 9 }, detectKeyword('tam otonom iptal')!, null);
  assert.deepEqual([cancel.interaction, cancel.resumeAt], ['autonomous', null]);
  // Cancel says nothing to a session that is not in full autonomy.
  assert.equal(applyKeyword({ ...s0, interaction: 'manual' }, detectKeyword('tam otonom iptal')!, null).interaction, 'manual');
  // The way of working survives the state file; an unknown one does not; a run an older version recorded is left aside.
  const back = parseModState(JSON.stringify({ ...s0, interaction: 'full', runId: 'r1', interactionBefore: 'manual' }))!;
  assert.equal(back.interaction, 'full');
  assert.equal(parseModState(JSON.stringify({ ...s0, interaction: 'turbo' }))!.interaction, 'default');
});

test('a fresh state is all defaults; a state file needs its version, its session and when it was alive', () => {
  assert.deepEqual([s0.mode, s0.interaction, s0.wrapUp, s0.resumeAt, s0.project, s0.weeklyTarget], ['free', 'default', false, null, null, null]);
  for (const torn of ['5', '[1]', '{"v":1,"sessionId":"a"}', '{"v":1,"aliveAt":1}', '{"sessionId":"a","aliveAt":1}'])
    assert.equal(parseModState(torn), null, torn);
  // Approvals in the file: only well-formed ones come back.
  const approvals = [{ toolUseId: 't1', at: 1, rules: [] }, { at: 2 }, 'x', null, { toolUseId: 3 }];
  assert.deepEqual(
    parseModState(JSON.stringify({ ...s0, approvals }))!.approvals.map((a) => a.toolUseId),
    ['t1'],
  );
});

test('the hook state: its own session and version only; each field kept when it has its type, a default when not', () => {
  const full = { v: 1, sessionId: 's1', lastRunAt: 5, permissionMode: 'plan', permissionModeAt: 7, promptAt: 9, blocks: { 'git.clean': 2 } };
  const h = parseHookState(JSON.stringify(full), 's1');
  assert.deepEqual([h.lastRunAt, h.permissionMode, h.permissionModeAt, h.promptAt, h.blocks], [5, 'plan', 7, 9, { 'git.clean': 2 }]);
  const odd = parseHookState(JSON.stringify({ ...full, lastRunAt: '5', permissionMode: 1, permissionModeAt: '7', promptAt: null, blocks: [] }), 's1');
  assert.deepEqual([odd.lastRunAt, odd.permissionMode, odd.permissionModeAt, odd.promptAt, odd.blocks], [0, null, 0, 0, {}]);
  assert.equal(parseHookState(JSON.stringify({ ...full, v: 2 }), 's1').lastRunAt, 0);
  assert.equal(parseHookState('[1]', 's1').lastRunAt, 0);
  assert.equal(parseHookState('{', 's1').lastRunAt, 0);
});

test('approvals: the same call approved again replaces the old one; one as old as the limit is gone', () => {
  const a1 = addApproval(s0, { toolUseId: 't1', at: 1000, rules: [] });
  const again = addApproval(a1, { toolUseId: 't1', at: 2000, rules: ['x'] });
  assert.deepEqual(
    again.approvals.map((a) => [a.toolUseId, a.at]),
    [['t1', 2000]],
  );
  const other = addApproval(a1, { toolUseId: 't2', at: 1000 + APPROVAL_TTL_MS - 1, rules: [] });
  assert.deepEqual(
    other.approvals.map((a) => a.toolUseId),
    ['t1', 't2'],
  );
  const late = addApproval(a1, { toolUseId: 't2', at: 1000 + APPROVAL_TTL_MS, rules: [] });
  assert.deepEqual(
    late.approvals.map((a) => a.toolUseId),
    ['t2'],
  );
  // One approval among others is found; at the limit it no longer counts.
  assert.equal(isApproved(other, 't1', 1000 + APPROVAL_TTL_MS - 1), true);
  assert.equal(isApproved(other, 't2', 1000 + APPROVAL_TTL_MS - 1), true);
  assert.equal(isApproved(a1, 't1', 1000 + APPROVAL_TTL_MS), false);
});

test('a session alive exactly the live window ago no longer counts as working', () => {
  const now = 1_000_000_000;
  const me = { sessionId: 'me', cwd: 'C:/w' };
  const edge = { ...newModState('a', '1', now - LIVE_WINDOW_MS), cwd: 'C:/w' };
  const inside = { ...newModState('b', '1', now - LIVE_WINDOW_MS + 1), cwd: 'C:/w' };
  assert.deepEqual(
    sameFolderSessions(me, [edge, inside], now, true).map((s) => s.sessionId),
    ['b'],
  );
});

test('a budget is set only when the keyword gave one and it could be worked out', () => {
  for (const k of [
    kw({ kind: 'continue' }),
    kw({ kind: 'manual' }),
    detectKeyword('Bunu yap. terminal tam otonom', [{ id: 'terminal', names: ['terminal'] }])!,
  ]) {
    const s = applyKeyword(s0, k, 40);
    assert.deepEqual([s.weeklyTarget, s.weeklyTargetSource], [null, null], k.kind);
  }
  for (const k of [
    kw({ kind: 'continue', budget: { n: 40, plus: false } }),
    detectKeyword('Bunu yap. terminal tam otonom kota +10', [{ id: 'terminal', names: ['terminal'] }])!,
  ]) {
    const s = applyKeyword(s0, k, null);
    assert.deepEqual([s.weeklyTarget, s.weeklyTargetSource], [null, null], `${k.kind} with no reading`);
  }
});

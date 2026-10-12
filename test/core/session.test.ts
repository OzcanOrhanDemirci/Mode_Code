// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addApproval,
  applyKeyword,
  APPROVAL_TTL_MS,
  isApproved,
  newModState,
  parseHookState,
  parseModState,
  sameFolderSessions,
} from '../../src/core/session.js';
import type { KeywordMatch } from '../../src/core/keywords.js';

const s0 = newModState('abc', '1.0.0', 1000);
const kw = (k: Partial<KeywordMatch> & Pick<KeywordMatch, 'kind'>): KeywordMatch => ({ lang: 'tr', text: '', standalone: true, ...k });

test('continue makes the session autonomous and clears a wrap-up', () => {
  const s = applyKeyword({ ...s0, wrapUp: true, mode: 'chat' }, kw({ kind: 'continue', project: 'terminal-code' }), null);
  assert.equal(s.interaction, 'autonomous');
  assert.equal(s.mode, 'free');
  assert.equal(s.wrapUp, false);
  assert.equal(s.project, 'terminal-code');
});

test('chat, wrap up and stop change only what they say', () => {
  assert.equal(applyKeyword(s0, kw({ kind: 'chat' }), null).mode, 'chat');
  assert.equal(applyKeyword(s0, kw({ kind: 'wrapUp' }), null).wrapUp, true);
  const stopped = applyKeyword({ ...s0, interaction: 'autonomous', resumeAt: 5 }, kw({ kind: 'stop' }), null);
  assert.equal(stopped.interaction, 'default');
  assert.equal(stopped.resumeAt, null);
});

test('a quota keyword sets the weekly target; at the end of a task it also means autonomous', () => {
  const alone = applyKeyword(s0, kw({ kind: 'quota', n: 40, plus: false }), 40);
  assert.equal(alone.weeklyTarget, 40);
  assert.equal(alone.interaction, 'default');
  const atEnd = applyKeyword(s0, kw({ kind: 'quota', n: 8, plus: true, standalone: false }), 34);
  assert.equal(atEnd.weeklyTarget, 34);
  assert.equal(atEnd.weeklyTargetSource, '+8');
  assert.equal(atEnd.interaction, 'autonomous');
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

test('state files that are missing, torn or foreign parse to nothing', () => {
  assert.equal(parseModState(null), null);
  assert.equal(parseModState('{"v":1,"sessionId":"abc","aliveAt":'), null);
  assert.equal(parseModState('{"v":2,"sessionId":"abc","aliveAt":1}'), null);
  assert.deepEqual(parseModState(JSON.stringify(s0)), s0);
  assert.equal(parseHookState('{"v":1,"sessionId":"other","lastRunAt":5,"blocks":{}}', 'abc').lastRunAt, 0);
});

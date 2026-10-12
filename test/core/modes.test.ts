// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMode, inZones, isRestricted, isWorkMode, MODE_ICON, tempZones, WORK_MODES, writableIn } from '../../src/core/modes.js';
import { applyKeyword, newModState, parseModState } from '../../src/core/session.js';
import { detectKeyword } from '../../src/core/keywords.js';

test('the five modes; chat, research and plan are the restricted ones', () => {
  assert.deepEqual(WORK_MODES, ['free', 'chat', 'research', 'plan', 'code']);
  assert.deepEqual(WORK_MODES.filter(isRestricted), ['chat', 'research', 'plan']);
  for (const m of WORK_MODES) assert.equal(isWorkMode(m), true);
  for (const x of ['', 'Plan', 'review', null, 3, '__proto__']) assert.equal(isWorkMode(x), false, String(x));
  assert.deepEqual(MODE_ICON, { free: '', chat: '💬', research: '🔍', plan: '📐', code: '🔨' });
});

test('the mode in force: this turn, then the flow step, then Claude Code plan mode, then the session', () => {
  const base = { session: 'free' as const, turn: null, flowStep: null, nativePlan: false };
  assert.equal(effectiveMode(base), 'free');
  assert.equal(effectiveMode({ ...base, session: 'chat' }), 'chat');
  assert.equal(effectiveMode({ ...base, session: 'chat', nativePlan: true }), 'plan');
  assert.equal(effectiveMode({ ...base, nativePlan: true, flowStep: 'research' }), 'research');
  assert.equal(effectiveMode({ ...base, nativePlan: true, flowStep: 'code', turn: 'chat' }), 'chat');
});

test('where each mode writes', () => {
  const z = { temp: ['/tmp'], work: ['/w'], plan: ['/p'] };
  assert.deepEqual(writableIn('chat', z), ['/tmp']);
  assert.deepEqual(writableIn('research', z), ['/tmp', '/w']);
  assert.deepEqual(writableIn('plan', z), ['/tmp', '/w', '/p']);
  assert.equal(writableIn('free', z), null);
  assert.equal(writableIn('code', z), null);
  assert.equal(inZones('/tmp/a/b', ['/tmp'], 'linux'), true);
  assert.equal(inZones('/tmpx', ['/tmp'], 'linux'), false);
  assert.equal(inZones('C:/Temp/A', ['c:/temp'], 'win32'), true);
  assert.equal(inZones('/x', [], 'linux'), false);
});

test('temporary folders from the environment, resolved once each; Git Bash /tmp on Windows', () => {
  assert.deepEqual(tempZones({ TMPDIR: '/var/folders/x/T/' }, { platform: 'darwin', home: '/Users/a', cwd: '/' }), ['/var/folders/x/T', '/tmp']);
  assert.deepEqual(tempZones({}, { platform: 'linux', home: '/home/a', cwd: '/' }), ['/tmp']);
  assert.deepEqual(tempZones({ TMPDIR: '/tmp' }, { platform: 'linux', home: '/home/a', cwd: '/' }), ['/tmp']);
  const win = tempZones(
    { TEMP: 'C:\\Users\\a\\AppData\\Local\\Temp', TMP: 'C:/Users/a/AppData/Local/Temp' },
    { platform: 'win32', home: 'C:/Users/a', cwd: 'C:/' },
  );
  assert.deepEqual(win, ['C:/Users/a/AppData/Local/Temp']);
  assert.deepEqual(tempZones({ TEMP: 'D:/t' }, { platform: 'win32', home: 'C:/Users/a', cwd: 'C:/' }), ['D:/t', 'C:/Users/a/AppData/Local/Temp']);
});

test('mode keywords change the session: alone or at the end outside a flow; one turn inside one unless alone', () => {
  const s = newModState('s', '1', 0);
  const kw = (t: string) => detectKeyword(t)!;
  assert.equal(applyKeyword(s, kw('research'), null).mode, 'research');
  assert.equal(applyKeyword(s, kw('Look into it.\nresearch'), null).mode, 'research');
  const turn = applyKeyword(s, kw('Look into it.\nresearch'), null, { inFlow: true });
  assert.deepEqual([turn.mode, turn.turnMode], ['free', 'research']);
  const alone = applyKeyword(s, kw('research'), null, { inFlow: true });
  assert.deepEqual([alone.mode, alone.turnMode], ['research', null]);
  // Continue leaves chat only.
  assert.equal(applyKeyword({ ...s, mode: 'chat' }, kw('devam'), null).mode, 'free');
  assert.equal(applyKeyword({ ...s, mode: 'plan', turnMode: 'code' }, kw('devam'), null).mode, 'plan');
  assert.equal(applyKeyword({ ...s, turnMode: 'code' }, kw('devam'), null).turnMode, null);
  // Flow and approval keywords leave the session to the flow.
  assert.deepEqual(applyKeyword(s, kw('akış'), null), s);
  assert.deepEqual(applyKeyword(s, kw('onay'), null), s);
});

test('session files from before modes read with defaults; a wrong mode is free', () => {
  const old = JSON.stringify({ v: 1, sessionId: 's', aliveAt: 1, modVersion: '0.1', mode: 'chat', interaction: 'default', approvals: [], blocks: {} });
  const s = parseModState(old)!;
  assert.deepEqual([s.mode, s.turnMode, s.flowId, s.nativePlan], ['chat', null, null, null]);
  const odd = parseModState(JSON.stringify({ ...JSON.parse(old), mode: 'boss', turnMode: 'x', flowId: 3, nativePlan: { on: 'yes' } }))!;
  assert.deepEqual([odd.mode, odd.turnMode, odd.flowId, odd.nativePlan], ['free', null, null, null]);
  const plan = parseModState(JSON.stringify({ ...JSON.parse(old), nativePlan: { on: true, planFile: '/p.md', at: 5 } }))!;
  assert.deepEqual(plan.nativePlan, { on: true, planFile: '/p.md', at: 5 });
});

test('nested temporary folders are both kept: only the same folder is written once', () => {
  assert.deepEqual(tempZones({ TMPDIR: '/tmp/a' }, { platform: 'linux', home: '/home/a', cwd: '/' }), ['/tmp/a', '/tmp']);
});

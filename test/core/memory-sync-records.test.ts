// SPDX-License-Identifier: Apache-2.0
/** The sync's records (docs/memory.md): read back from their files, the newest of the writers, what needs the person. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestRecord, parseSyncRecord, syncProblem, type SyncResult } from '../../src/core/memory-sync.js';
import { handoffRoot } from '../../src/core/memory.js';

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  repo: true,
  commit: 'ok',
  committed: 1,
  held: [],
  pull: 'ok',
  push: 'ok',
  conflicts: [],
  ahead: 0,
  behind: 0,
  detail: '',
  ...over,
});

test('a record reads back; a torn or foreign file is none', () => {
  const r = { at: 5, trigger: 'turn', session: 's1', result: result({ held: [{ path: 'a.md', reason: 'secret' }], conflicts: ['M.md'] }) };
  assert.deepEqual(parseSyncRecord(JSON.stringify(r)), r);
  for (const t of [
    null,
    '',
    'x',
    '{}',
    '{"at":1}',
    '{"at":1,"result":null}',
    '{"at":1,"result":{"commit":"ok","pull":"ok"}}',
    '{"at":1,"result":{"pull":"ok","push":"ok"}}',
    '{"at":"1","result":{"commit":"ok","pull":"ok","push":"ok"}}',
  ])
    assert.equal(parseSyncRecord(t), null, String(t));
  // Fields of the wrong kind fall back to what says nothing.
  const loose = parseSyncRecord(
    JSON.stringify({
      at: 2,
      trigger: 'later',
      session: 3,
      result: {
        commit: 'ok',
        pull: 'ok',
        push: 'ok',
        held: [{ x: 1 }, { path: 'b.md', reason: 'large' }],
        conflicts: [1, 'c.md'],
        committed: 'two',
        ahead: 'x',
        behind: null,
        repo: 'yes',
        detail: 9,
      },
    }),
  )!;
  assert.deepEqual(
    [
      loose.trigger,
      loose.session,
      loose.result.committed,
      loose.result.ahead,
      loose.result.behind,
      loose.result.repo,
      loose.result.detail,
      loose.result.conflicts,
      loose.result.held.length,
    ],
    ['manual', null, 0, null, null, false, '', ['c.md'], 1],
  );
  for (const trigger of ['start', 'turn', 'manual', 'setup']) assert.equal(parseSyncRecord(JSON.stringify({ ...r, trigger }))?.trigger, trigger);
});

test('the newest of the writers wins; none is none', () => {
  const a = { at: 1, trigger: 'turn' as const, session: null, result: result() };
  const b = { ...a, at: 3 };
  const c = { ...a, at: 2 };
  assert.equal(newestRecord([a, null, b, c]), b);
  assert.equal(newestRecord([null, null]), null);
  assert.equal(newestRecord([]), null);
  const twin = { ...a };
  assert.equal(newestRecord([a, twin]), a, 'on a tie the first stays');
});

test('what needs the person, in the order it matters; offline is said but tried again', () => {
  assert.equal(syncProblem(result()), null);
  assert.equal(syncProblem(result({ pull: 'conflict', commit: 'identity', push: 'auth' })), 'conflict');
  assert.equal(syncProblem(result({ commit: 'identity', push: 'auth' })), 'identity');
  for (const k of ['pull', 'push', 'commit'] as const) assert.equal(syncProblem(result({ [k]: 'auth' } as Partial<SyncResult>)), 'auth', k);
  assert.equal(syncProblem(result({ push: 'rejected', pull: 'offline' })), 'rejected');
  assert.equal(syncProblem(result({ pull: 'offline' })), 'offline');
  assert.equal(syncProblem(result({ push: 'offline', commit: 'failed' })), 'offline');
  for (const k of ['pull', 'push', 'commit'] as const) assert.equal(syncProblem(result({ [k]: 'failed' } as Partial<SyncResult>)), 'failed', k);
  assert.equal(syncProblem(result({ held: [{ path: 'a', reason: 'large' }] })), 'held');
  assert.equal(syncProblem(result({ held: [{ path: 'a', reason: 'large' }], push: 'failed' })), 'failed');
  for (const o of ['none', 'skipped', 'busy'] as const) assert.equal(syncProblem(result({ pull: o, push: o === 'busy' ? 'busy' : o })), null, o);
});

test('handoffs live in the store when there is one, else in the fallback folder', () => {
  assert.equal(handoffRoot('/m', '/d/handoffs'), '/m/handoffs');
  assert.equal(handoffRoot(null, '/d/handoffs'), '/d/handoffs');
});

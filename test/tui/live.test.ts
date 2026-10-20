// SPDX-License-Identifier: Apache-2.0
/**
 * The control center is live (docs/design.md, The control center): what a session writes into the data folder (its
 * state, an event, the quota, a flow, the settings) shows at once, one refresh for each burst of writes; the session
 * index's own files do not count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneDefaults } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { LiveData } from '../../src/tui/store.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a write in the data folder reaches the screen once per burst; the index files do not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mc-live-'));
  const l = layout(root.replace(/\\/g, '/'));
  for (const d of [l.stateDir, l.sessionsDir, l.eventsDir, l.flowsDir, l.runsDir]) mkdirSync(d, { recursive: true });
  const data = new LiveData({ layout: l, config: cloneDefaults(), problems: [], lang: 'en', cwd: root });
  let calls = 0;
  const stop = data.watch(() => calls++);
  try {
    // Settle: the watchers are armed.
    await wait(200);
    writeFileSync(join(l.sessionsDir, 's1.mod.json'), '{}');
    writeFileSync(join(l.stateDir, 'quota.json'), '{}');
    writeFileSync(join(l.eventsDir, 'e.jsonl'), '{}\n');
    for (let i = 0; i < 60 && calls === 0; i++) await wait(50);
    assert.equal(calls, 1, 'one refresh for the burst');
    await wait(500);
    assert.equal(calls, 1);
    writeFileSync(join(root, 'index.db'), 'x');
    await wait(700);
    assert.equal(calls, 1, 'the index is not news');
    writeFileSync(join(root, 'config.json'), '{}');
    for (let i = 0; i < 60 && calls === 1; i++) await wait(50);
    assert.equal(calls, 2, 'the settings are');
  } finally {
    stop();
    data.close();
    rmSync(root, { recursive: true, force: true });
  }
  // Stopped, nothing more comes.
  assert.ok(calls >= 2);
});

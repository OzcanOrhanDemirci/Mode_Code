// SPDX-License-Identifier: Apache-2.0
/** Sync across computers in the control center (docs/sync.md): Settings › Sync, not set up and set up. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, NOW } from './harness.js';

test('Settings › Sync: not set up, "s" leaves for the setup and comes back here', async () => {
  const data = new FakeData();
  const left: [string, string][] = [];
  const s = await draw(data, { address: 'memory/sync', onLeave: (action, back) => left.push([action, back]) });
  try {
    assert.match(s.text(), /Where\s+Sync · not set up/);
    assert.match(s.text(), /s: set it up/);
    await s.press('s');
    assert.deepEqual(left, [['sync-setup', 'memory/sync']]);
  } finally {
    s.close();
  }
  const s2 = await draw(data, { address: 'memory/sync' });
  try {
    await s2.press('s');
    assert.match(s2.text(), /Run mode-code sync setup in a terminal\./);
  } finally {
    s2.close();
  }
});

test('Settings › Sync: where, this computer and the others, what waits, projects without a folder here', async () => {
  const data = new FakeData();
  data.syncState = {
    setting: {
      place: 'github',
      dir: '/home/ada/.mode-code/sync',
      remote: 'https://github.com/ada/tc-sync.git',
      repo: 'ada/tc-sync',
      machine: { id: 'pc-1a2b', name: 'PC' },
      everyMinutes: 30,
      keepMonths: 3,
      handoffs: true,
    },
    exists: true,
    machines: [
      { id: 'pc-1a2b', name: 'PC', platform: 'win32', self: true, lastSeen: NOW - 60_000 },
      { id: 'mac-0002', name: 'MacBook', platform: 'darwin', self: false, lastSeen: NOW - 2 * 3_600_000 },
    ],
    last: { at: NOW - 60_000, trigger: 'turn', session: null, written: 2, result: null, error: null },
    pending: [{ key: 'belt.verdicts', machine: 'mac-0002', at: NOW - 3_600_000, current: {}, incoming: { 'git.clean': 'allow' } }],
    applied: [{ key: 'footer.mode', machine: 'mac-0002', at: NOW - 3_600_000 }],
    homeless: ['car'],
    handoffs: 'shared',
  };
  const s = await draw(data, { address: 'memory/sync' });
  try {
    const t = s
      .text()
      .replace(/[│╭╮╰╯─]/g, '')
      .replace(/\s+/g, ' ');
    assert.match(t, /Where a private repository on your GitHub · ada\/tc-sync/);
    assert.match(t, /This computer PC \(pc-1a2b\)/);
    assert.match(t, /Others MacBook · darwin · last seen 2 h ago/);
    assert.match(t, /Waiting belt\.verdicts: from MacBook, 1 h ago; it lowers a protection here/);
    assert.match(t, /From others 1 setting\(s\) in effect here/);
    assert.match(t, /Projects car: no folder on this computer/);
    assert.match(t, /Handoff notes in the shared place/);
    assert.match(t, /s: change where it lives or what this computer is called/);
  } finally {
    s.close();
  }
});

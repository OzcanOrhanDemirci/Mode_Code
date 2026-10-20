// SPDX-License-Identifier: Apache-2.0
/**
 * The control center is live (docs/design.md, The control center): what a session writes into the data folder (its
 * state, an event, the quota, a flow, the settings) shows at once, one refresh for each burst of writes; the session
 * index's own files do not count, a folder not made yet is no failure, and once stopped nothing more comes.
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

function fresh(make: (l: ReturnType<typeof layout>) => string[]) {
  const root = mkdtempSync(join(tmpdir(), 'mc-live-'));
  const l = layout(root.replace(/\\/g, '/'));
  for (const d of make(l)) mkdirSync(d, { recursive: true });
  const data = new LiveData({ layout: l, config: cloneDefaults(), problems: [], lang: 'en', cwd: root });
  return { root, l, data, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a write in the data folder reaches the screen once per burst; the index files do not', async () => {
  const { root, l, data, done } = fresh((l) => [l.stateDir, l.sessionsDir, l.eventsDir, l.flowsDir, l.runsDir]);
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
    // What the store reads stays its own: the settings it was given, the language, the folder.
    assert.equal(data.lang, 'en');
    assert.equal(data.cwd, root);
    assert.equal(data.layout.root, l.root);
    assert.deepEqual(data.configProblems(), []);
    assert.equal(data.config().view, 'recommended');
  } finally {
    stop();
    data.close();
    done();
  }
});

test('a folder not made yet is no failure, and a refresh still waiting when it stops never comes', async () => {
  // No flows, no runs, no events yet: only the state and the settings are watched.
  const { l, data, done } = fresh((l) => [l.stateDir]);
  let calls = 0;
  const stop = data.watch(() => calls++);
  try {
    await wait(200);
    writeFileSync(join(l.stateDir, 'quota.json'), '{}');
    // Stopped within the burst's wait: its refresh is dropped.
    await wait(50);
    stop();
    await wait(600);
    assert.equal(calls, 0);
  } finally {
    data.close();
    done();
  }
});

test('the store keeps what it read for a moment, reads again on a refresh, and saves a change with its record', async () => {
  const { data, done } = fresh((l) => [l.stateDir, l.eventsDir]);
  try {
    const first = data.events(1);
    assert.equal(data.events(1), first, 'kept for a moment');
    data.refresh();
    assert.notEqual(data.events(1), first, 'read again after a refresh');
    assert.deepEqual(data.setConfig('view', 'detailed'), []);
    assert.equal(data.config().view, 'detailed');
    assert.deepEqual(
      data.changes().map((c) => [c.path, c.from, c.to, c.who]),
      [['view', 'recommended', 'detailed', 'center']],
    );
    assert.ok(data.setConfig('view', 'everything').length > 0, 'a value the setting does not take is refused');
    assert.equal(data.config().view, 'detailed');
    assert.equal(data.lastSeen(), null);
    data.markSeen(1234);
    assert.equal(data.lastSeen(), 1234);
  } finally {
    data.close();
    done();
  }
});

test('the session index opens on first need and catches up on a refresh; one that cannot open is asked no more', async () => {
  const claude = mkdtempSync(join(tmpdir(), 'mc-claude-'));
  mkdirSync(join(claude, 'projects'), { recursive: true });
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claude;
  const { l, data, done } = fresh((l) => [l.stateDir]);
  // Where the index would be is a folder: it cannot open there.
  const { l: l2, data: broken, done: done2 } = fresh((l) => [l.stateDir]);
  mkdirSync(l2.index, { recursive: true });
  try {
    assert.deepEqual(data.sessions({}), []);
    assert.equal(data.session('none'), null);
    assert.equal(data.totals(1)?.messages ?? 0, 0);
    data.refresh();
    assert.deepEqual(data.sessions({}), [], 'read again, the index brought up to date');
    // A setting of the memory puts the plugin's kept skills in line (docs/skills.md).
    assert.deepEqual(data.setConfig('memory.dirs', [l.root]), []);
    assert.deepEqual(data.config().memory.dirs, [l.root]);
    assert.deepEqual(broken.sessions({}), []);
    assert.equal(broken.totals(1), null);
    broken.refresh();
    assert.equal(broken.session('none'), null, 'no index, asked once');
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = was;
    data.close();
    broken.close();
    done();
    done2();
    rmSync(claude, { recursive: true, force: true });
  }
});

test('what cannot be written is no failure: the last look stays unsaved, the kept skills wait for the next session', () => {
  const { l, data, done } = fresh((l) => [l.stateDir, join(l.stateDir, 'ui.json'), l.pluginDir]);
  // Where the skills go is a file, and where the last look goes a folder.
  writeFileSync(join(l.pluginDir, 'skills'), '');
  try {
    data.markSeen(1234);
    assert.equal(data.lastSeen(), null);
    assert.deepEqual(data.setConfig('memory.dirs', [l.root]), [], 'the setting is saved all the same');
    assert.deepEqual(data.config().memory.dirs, [l.root]);
  } finally {
    data.close();
    done();
  }
});

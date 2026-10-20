// SPDX-License-Identifier: Apache-2.0
// The record of changes (src/core/ux/changes.ts, src/node/changes.ts): every change to a setting, by whom and when,
// taken back from it, and a page put back to its defaults with the list shown first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneDefaults, setConfigValue, type Config } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import {
  appendChanges,
  changeRows,
  changeText,
  CHANGES_KEPT,
  lastUndoable,
  parseChanges,
  settingChanges,
  settingPaths,
  toDefaults,
  undoOf,
} from '../../src/core/ux/changes.js';
import { readChanges, saveConfig } from '../../src/node/changes.js';

const set = (c: Config, path: string, v: unknown) => setConfigValue(c, path, v).config;

test('what changed between two configs, setting by setting, with a pack and a skill among them', () => {
  const a = cloneDefaults();
  let b = set(a, 'autonomy.enabled', true);
  b = set(b, 'packs.items.flutter', 'never');
  b = set(b, 'quota.fiveHourStop', 98);
  assert.deepEqual(settingChanges(a, b), [
    { path: 'quota.fiveHourStop', from: 99, to: 98 },
    { path: 'autonomy.enabled', from: false, to: true },
    { path: 'packs.items.flutter', from: 'auto', to: 'never' },
  ]);
  assert.deepEqual(settingChanges(b, b), []);
  assert.ok(settingPaths().some((p) => p.startsWith('skills.items.')));
  const rows = changeRows(a, b, 'center', 5);
  assert.deepEqual(
    rows.map((r) => [r.v, r.at, r.who]),
    [
      [1, 5, 'center'],
      [1, 5, 'center'],
      [1, 5, 'center'],
    ],
  );
});

test('the record: rows read back in order, a torn line or a setting no longer known skipped, the oldest cut first', () => {
  const a = cloneDefaults();
  const rows = changeRows(a, set(a, 'view', 'simple'), 'command', 1);
  const text = appendChanges('{"broken\n' + JSON.stringify({ v: 1, at: 0, who: 'center', path: 'no.such.setting', from: 1, to: 2 }) + '\n', rows);
  assert.deepEqual(parseChanges(text), rows);
  assert.deepEqual(parseChanges(null), []);
  assert.deepEqual(parseChanges('{"v":1,"at":1,"who":"stranger","path":"view","from":"a","to":"b"}'), []);
  const many = Array.from({ length: CHANGES_KEPT + 5 }, (_, i) => ({ ...rows[0]!, at: i }));
  const cut = parseChanges(appendChanges(null, many));
  assert.equal(cut.length, CHANGES_KEPT);
  assert.equal(cut[0]!.at, 5);
});

test('a change is taken back while it still holds; one changed again since is not, the newer one is', () => {
  const a = cloneDefaults();
  const b = set(a, 'view', 'simple');
  const c = set(b, 'view', 'detailed');
  const first = changeRows(a, b, 'center', 1)[0]!;
  const second = changeRows(b, c, 'center', 2)[0]!;
  assert.deepEqual(undoOf(b, first), { path: 'view', to: 'recommended' });
  assert.equal(undoOf(c, first), null);
  assert.deepEqual(undoOf(c, second), { path: 'view', to: 'simple' });
  assert.equal(lastUndoable(c, [first, second]), second);
  assert.equal(lastUndoable(a, [first, second]), null);
  // The first row of the record counts too: the only one that still holds.
  assert.equal(lastUndoable(b, [first, second]), first);
});

test('back to the defaults: what goes back on one page, or everywhere, and nothing when all are at their defaults', () => {
  const a = cloneDefaults();
  let b = set(a, 'view', 'simple');
  b = set(b, 'autonomy.enabled', true);
  assert.deepEqual(toDefaults(b, 'settings/general'), [{ path: 'view', from: 'simple', to: 'recommended' }]);
  assert.deepEqual(
    toDefaults(b).map((c) => c.path),
    ['view', 'autonomy.enabled'],
  );
  assert.deepEqual(toDefaults(a), []);
});

test('a row in words: the setting, from and to, and who', () => {
  assert.match(changeText({ path: 'autonomy.enabled', from: false, to: true, who: 'center' }, 'en'), /^Full autonomy: off → on · the control center$/);
  assert.match(changeText({ path: 'autonomy.enabled', from: true, to: false, who: 'undo' }, 'tr'), /: açık → kapalı · bir geri alma$/);
  assert.match(changeText({ path: 'view', from: 'simple', to: 'detailed', at: Date.UTC(2026, 9, 19, 10, 42) }, 'en'), /^\S.* · View level: Simple → Detailed$/);
});

test('saving the settings writes the file and adds the rows; a save that changes no setting adds none', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-changes-'));
  try {
    const l = layout(root.replace(/\\/g, '/'));
    const a = cloneDefaults();
    const b = set(a, 'update.check', true);
    saveConfig(l, a, b, 'center', 7);
    saveConfig(l, b, b, 'center', 8);
    assert.match(readFileSync(l.config, 'utf8'), /"check": true/);
    assert.deepEqual(readChanges(l), [{ v: 1, at: 7, who: 'center', path: 'update.check', from: false, to: true }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// SPDX-License-Identifier: Apache-2.0
/**
 * What the control center does with the record of changes and the activity (docs/design.md, Say, do, undo; No
 * invisible work): a setting goes back to its default after showing what goes back, a page too; the history lists
 * every change and takes one back; the activity lists what happened, what waits for you first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW } from './harness.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('d puts a setting back to its default after showing it; D the whole page; each is one record row, by "default"', async () => {
  const data = new FakeData('en', { view: 'detailed', language: 'tr' } as never);
  const s = await draw(data, { address: 'settings/general', rows: 44, columns: 100 });
  try {
    await s.press('d');
    assert.match(flat(s.text()), /! Back to its default: Language: Türkçe → Automatic \(system\)\./);
    assert.equal(data.saved.length, 0);
    await s.press(KEY.esc);
    assert.doesNotMatch(s.text(), /Back to its default/);
    await s.press('D');
    assert.match(flat(s.text()), /Back to the defaults on this page: Language: Türkçe → Automatic \(system\); View level: Detailed → Recommended\./);
    await s.press(KEY.enter);
    assert.deepEqual(
      data.rows.map((r) => [r.who, r.path, r.to]),
      [
        ['default', 'language', 'auto'],
        ['default', 'view', 'recommended'],
      ],
    );
    assert.match(s.text(), /✓ Back to the default: .* \[ undo · u \]/);
    await s.press('u');
    assert.deepEqual(
      data.rows.slice(-2).map((r) => [r.who, r.path, r.to]),
      [
        ['undo', 'language', 'tr'],
        ['undo', 'view', 'detailed'],
      ],
    );
    // A page already at its defaults says so instead of asking.
    await s.press('D', KEY.enter, 'D');
    assert.match(s.text(), /Every setting on this page is at its default already\./);
  } finally {
    s.close();
  }
});

test('Activity › History of changes: every change newest first; Enter or a click takes one back, an old one changed since is not', async () => {
  const data = new FakeData();
  data.setConfig('view', 'simple');
  data.setConfig('view', 'detailed');
  data.setConfig('update.check', true);
  const s = await draw(data, { address: 'activity/changes', rows: 40 });
  try {
    const t = flat(s.text());
    assert.match(t, /Check for updates daily: off → on · the control center .* View level: Simple → Detailed .* View level: Recommended → Simple/);
    await s.press(KEY.enter);
    assert.deepEqual(data.rows.at(-1), { v: 1, at: data.rows.at(-1)!.at, who: 'undo', path: 'update.check', from: true, to: false });
    assert.match(s.text(), /✓ Taken back: Check for updates daily: on → off\./);
    // The oldest row: the view changed again since, so it is not taken back from there.
    const before = data.rows.length;
    await s.clickText('View level: Recommended → Simple');
    assert.equal(data.rows.length, before);
    assert.match(s.text(), /Changed again since: take back the newer change first\./);
  } finally {
    s.close();
  }
  // Taking back what would lower a protection asks first, with apply and cancel; the bar's key is a click too.
  const guarded = new FakeData();
  guarded.setConfig('modules.quota', false);
  guarded.setConfig('modules.quota', true);
  const g = await draw(guarded, { address: 'activity/changes', rows: 40, columns: 100 });
  try {
    await g.clickText('Enter take it back');
    assert.match(flat(g.text()), /! This lowers a protection \(off\)/);
    await g.press(KEY.esc);
    assert.equal(guarded.rows.length, 2);
    await g.press(KEY.enter);
    await g.clickText('[ apply · Enter ]');
    assert.deepEqual(guarded.rows.at(-1)!.to, false);
  } finally {
    g.close();
  }
  const empty = await draw(new FakeData('tr'), { address: 'activity/changes' });
  try {
    assert.match(flat(empty.text()), /Henüz hiçbir ayar değişmedi\./);
  } finally {
    empty.close();
  }
});

test('Activity › Activity feed: what waits for you first, then the newest; Enter goes where it is changed; a shows the routine work', async () => {
  const data = new FakeData();
  data.extraEvents = [
    { v: 1, at: NOW - 3600_000, kind: 'conflict', source: 'mod', session: 's2', sessions: ['a', 'b'] } as never,
    { v: 1, at: NOW - 30_000, kind: 'reading', source: 'mod', session: 's2', five: 20, week: 30 } as never,
    { v: 1, at: NOW - 20_000, kind: 'packs', source: 'mod', session: 's2', on: ['flutter'], by: 'auto' } as never,
  ];
  const s = await draw(data, { address: 'activity/feed', rows: 40 });
  try {
    const lines = s.text().split('\n');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    assert.ok(at(/\? Another session works in the same folder/) < at(/✓ Tool packs turned on for this project: flutter/));
    assert.equal(at(/Quota read/), -1);
    await s.press('a');
    assert.match(s.text(), /· Quota read: 5-hour 20%, weekly 30%/);
    await s.clickText('Tool packs turned on');
    assert.match(s.text(), /Address: claude-code\/packs/);
  } finally {
    s.close();
  }
});

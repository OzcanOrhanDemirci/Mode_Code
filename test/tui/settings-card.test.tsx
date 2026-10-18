// SPDX-License-Identifier: Apache-2.0
/**
 * The settings editor answers the four questions for the selected setting, from the catalog (docs/design.md): what
 * it is, how it is now and whether that is the default, what each change does before it is made, how to take it
 * back. A setting another one keeps from mattering says which, and where that one lives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW } from './harness.js';
import { buildTree } from '../../src/tui/tree.js';
import { resolve } from '../../src/tui/nav.js';
import { SETTING_IDS, SETTINGS } from '../../src/core/ux/catalog.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('a switch: what it is, now and its default, what the other side does, how to take it back, who changes it', async () => {
  const s = await draw(new FakeData(), { address: 'automation/agents', rows: 48 });
  try {
    const t = flat(s.text());
    assert.match(t, /What it is Who decides how many helper Claudes \(agents\) run beside the main one/);
    assert.match(t, /Now off \(default\)\. Mode_Code leaves agents alone/);
    assert.match(t, /If you change it on: Every session starts with no agents/);
    assert.match(t, /Taking it back Here at once, in Claude Code from your next message/);
    assert.match(t, /Who changes it Only you, here or in your own terminal\. Claude cannot change it\./);
  } finally {
    s.close();
  }
});

test('a choice in Turkish: the value now, then each other option with its effect, the one Enter picks first', async () => {
  const s = await draw(new FakeData('tr'), { address: 'settings/general', rows: 44 });
  try {
    await s.press(KEY.down); // view
    const t = flat(s.text());
    assert.match(t, /Şu an Önerilen \(varsayılan\)\. Bütün sayfalar\./);
    assert.match(t, /Değiştirirsen Ayrıntılı: Önerilen gibi bütün sayfalar.* Sade: Uzmanlara yönelik dört sayfa/);
  } finally {
    s.close();
  }
});

test('a value other than the default says what the default is', async () => {
  const s = await draw(new FakeData('en', { view: 'detailed' }), { address: 'settings/general', rows: 44 });
  try {
    await s.press(KEY.down);
    assert.match(flat(s.text()), /Now Detailed \(default: Recommended\)\./);
  } finally {
    s.close();
  }
});

test('a number: its range, then what the typed value would do before Enter saves it', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'automation/full-auto', rows: 48 });
  try {
    await s.press(KEY.down, KEY.down, KEY.down); // stall time
    assert.match(flat(s.text()), /Now 90 minutes \(default\)\. After 90 minutes without a finished step Claude is told/);
    assert.match(flat(s.text()), /If you change it Type a number from 10 minutes to 720 minutes\./);
    await s.press(KEY.enter);
    await s.type('\b\b30');
    assert.match(flat(s.text()), /If you change it 30 minutes: After 30 minutes without a finished step/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'autonomy.stallMinutes', value: 30 }]);
    assert.match(flat(s.text()), /Stall time: 30 minutes\. Saved\./);
  } finally {
    s.close();
  }
});

test('a setting another keeps from mattering says which one and where it lives', async () => {
  const s = await draw(new FakeData('tr'), { address: 'automation/agents', rows: 48 });
  try {
    await s.press(KEY.down); // read-only helpers, while agents are left to Claude Code
    assert.match(flat(s.text()), /Şu an etkisiz, çünkü "Ajan sayısını ben belirlerim" ayarı: kapalı \(Otomasyon › Paralel ajanlar\)\./);
  } finally {
    s.close();
  }
});

test('lowering a protection asks with the value in words, before anything else in the card', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'settings/modules' });
  try {
    await s.press(KEY.down, KEY.down, KEY.down, KEY.enter); // quota guard
    assert.equal(data.saved.length, 0);
    assert.match(flat(s.text()), /This lowers a protection \(off\)/);
    assert.doesNotMatch(s.text(), /false/);
  } finally {
    s.close();
  }
});

test('every page a setting lives on is a real page, reachable in every view; quota settings too in Simple', () => {
  const data = new FakeData('en', { view: 'simple' });
  const roots = buildTree(data, 'en', NOW);
  const pages = new Set(SETTING_IDS.map((id) => SETTINGS[id].page));
  assert.ok(pages.has('settings/footer-quota'));
  for (const page of pages) assert.equal(resolve(roots, page, 'simple').length, page.split('/').length, page);
});

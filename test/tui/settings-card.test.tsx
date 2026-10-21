// SPDX-License-Identifier: Apache-2.0
/**
 * The settings editor answers the four questions for the selected setting, from the catalog (docs/design.md): what
 * it is, how it is now and whether that is the default, what each change does before it is made, how to take it
 * back. A setting another one keeps from mattering says which, and where that one lives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults } from '../../src/core/config.js';
import { draw, FakeData, KEY, NOW } from './harness.js';
import { buildTree } from '../../src/tui/tree.js';
import { resolve } from '../../src/tui/nav.js';
import { placeOf, SETTING_IDS, SETTINGS } from '../../src/core/ux/catalog.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('a switch: what it is, now and its default, what the other side does, how to take it back, who changes it', async () => {
  const s = await draw(new FakeData(), { address: 'work/agents', rows: 48, columns: 100 });
  try {
    const t = flat(s.text());
    assert.match(t, /What it is Who decides how many helper Claudes \(agents\) run beside the main one/);
    assert.match(t, /Now off \(default\)\. Mode_Code leaves agents alone/);
    assert.match(t, /If you change it on: Every session starts with no agents/);
    assert.match(t, /Taking it back You can change it back the same way; it takes effect at once, in Claude Code from your next message/);
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
    assert.match(t, /Şu an Önerilen \(varsayılan\)\. Uzmanlara yönelik dört sayfa dışında hepsi/);
    assert.match(t, /Değiştirirsen Ayrıntılı: Bütün sayfalar\..* Sade: Yalnız gündelik sayfalar/);
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
  const s = await draw(data, { address: 'memory/notes', rows: 48, columns: 100 });
  try {
    await s.press(KEY.down, KEY.down, KEY.down, KEY.down); // how old a note may be
    assert.match(flat(s.text()), /Now 14 days \(default\)\. A note older than 14 days is not offered/);
    assert.match(flat(s.text()), /If you change it Type a number from 1 day to 365 days\./);
    await s.press(KEY.enter);
    await s.type('\b\b30');
    assert.match(flat(s.text()), /If you change it 30 days: A note older than 30 days is not offered/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'memory.handoff.maxAgeDays', value: 30 }]);
    assert.match(flat(s.text()), /Offer notes up to: 30 days\. Saved\./);
  } finally {
    s.close();
  }
});

test('a setting another keeps from mattering says which one and where it lives', async () => {
  const s = await draw(new FakeData('tr'), { address: 'work/agents', rows: 48, columns: 100 });
  try {
    await s.press(KEY.down); // read-only helpers, while agents are left to Claude Code
    assert.match(flat(s.text()), /Şu an etkisiz, çünkü "Ajan sayısını ben belirlerim" ayarı: kapalı \(Çalışma › Paralel ajanlar\)\./);
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
    // What it does is said before Enter applies it.
    assert.match(flat(s.text()), /! Quota guard: off lowers a protection\. Nothing holds the work back: Claude can use the quota to its end/);
    assert.doesNotMatch(s.text(), /false/);
  } finally {
    s.close();
  }
});

test('every page a setting lives on is a real page, reachable in every view; quota settings too in Simple', () => {
  const data = new FakeData('en', { view: 'simple' });
  const roots = buildTree(data, 'en', NOW);
  const pages = new Set(SETTING_IDS.map((id) => SETTINGS[id].page));
  assert.ok(pages.has('quota/limits'));
  for (const page of pages) assert.equal(resolve(roots, page, 'simple').length, page.split('/').length, page);
});

test('the same four answers in the other language: a Turkish switch and number, an English choice', async () => {
  const sw = await draw(new FakeData('tr'), { address: 'work/agents', rows: 48, columns: 100 });
  try {
    const t = flat(sw.text());
    assert.match(t, /Bu ne Ana Claude'un yanında kaç yardımcı Claude \(ajan\) çalışacağına/);
    assert.match(t, /Şu an kapalı \(varsayılan\)\. Mode_Code ajanlara karışmaz/);
    assert.match(t, /Değiştirirsen açık: Her oturum ajansız başlar/);
    assert.match(t, /Geri almak Aynı yoldan eski hâline döndürebilirsin; hemen, Claude Code'da sonraki mesajından itibaren/);
    assert.match(t, /Kim değiştirir Yalnız sen/);
  } finally {
    sw.close();
  }
  const quiet = cloneDefaults();
  quiet.memory.morning.enabled = false;
  const num = await draw(new FakeData('tr', quiet), { address: 'memory/notes', rows: 48, columns: 100 });
  try {
    await num.press(KEY.down, KEY.down, KEY.down, KEY.down, KEY.down, KEY.down); // away after
    const t = flat(num.text());
    assert.match(t, /Şu an 6 saat \(varsayılan\)\./);
    assert.match(t, /Değiştirirsen 1 saat ile 72 saat arasında bir sayı yaz\./);
    assert.match(t, /Şu an etkisiz, çünkü "Sabah raporu" ayarı: kapalı \(Hafıza ve projeler › Devir notları ve sabah raporu\)\./);
  } finally {
    num.close();
  }
  const ch = await draw(new FakeData(), { address: 'settings/footer', rows: 44 });
  try {
    await ch.press(KEY.down); // the feature's own switch first, then who writes the lines
    const t = flat(ch.text());
    assert.match(t, /What it is How the lines under each answer are made\./);
    assert.match(t, /Now Mode_Code draws them \(default\)\. Mode_Code draws them under the answer/);
    assert.match(t, /If you change it Claude writes them: Claude writes them at the end of each answer .* Off: No lines under the answers\./);
  } finally {
    ch.close();
  }
});

test("a pack's card says what that pack does and its size; choosing always asks first", async () => {
  const data = new FakeData('tr');
  const s = await draw(data, { address: 'claude-code/packs', rows: 48 });
  try {
    await s.press(KEY.down); // the first pack
    const t = flat(s.text());
    assert.match(t, /Flutter ve Dart/);
    assert.match(t, /Bu ne Flutter ve Dart: Dart araçlarıyla analiz, test ve paketler/);
    assert.match(t, /Açıkken oturum başına ~\d+ token\./);
    // A choice of four shows its options; → marks the next, and nothing is saved until Enter.
    await s.press(KEY.enter);
    assert.match(flat(s.text()), /◉ otomatik ○ hep açık ○ yalnız ben açınca ○ asla/);
    await s.press(KEY.right);
    assert.match(flat(s.text()), /○ otomatik ◉ hep açık/);
    assert.match(flat(s.text()), /Uygularsan hep açık: Dosyaları ne olursa olsun çalıştığın her projede açık\./);
    assert.equal(data.saved.length, 0);
    // Applying it still asks first.
    await s.press(KEY.enter);
    assert.equal(data.saved.length, 0);
    assert.match(flat(s.text()), /Hep açık: dosyaları ne olursa olsun çalıştığın her projede açık\. Enter tuşuna bir kez daha bas\./);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'packs.items.flutter', value: 'always' }]);
  } finally {
    s.close();
  }
});

test("the command line names a setting's page as the control center labels it, in both languages", () => {
  for (const lang of ['en', 'tr'] as const) {
    const roots = buildTree(new FakeData(lang), lang, NOW);
    for (const page of new Set(SETTING_IDS.map((id) => SETTINGS[id].page)))
      assert.equal(
        placeOf(page, lang),
        resolve(roots, page, 'detailed')
          .map((n) => n.label)
          .join(' › '),
        `${lang} ${page}`,
      );
  }
});

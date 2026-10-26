// SPDX-License-Identifier: Apache-2.0
/**
 * The first installation's choices (src/cli/install-ask.ts): five steps said with their place, each explained before
 * its question, the simple view's two skipped steps said so; and the summary the one yes rests on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askInstall, installSummary, type InstallAsk } from '../../src/cli/install-ask.js';
import { setColor } from '../../src/cli/style.js';
import { cloneDefaults } from '../../src/core/config.js';
import { scripted } from '../helpers/setup.js';

setColor(false);

const ask = (lang: 'en' | 'tr', memoryGiven = false): InstallAsk => ({
  lang,
  cli: 'mode-code',
  memory: { dir: '/home/ada/.claude/projects/-home-ada/memory', shown: '~/.claude/projects/-home-ada/memory' },
  memoryGiven,
});

test('five steps, each with its place and title; the question comes after what it decides, indented under the step', async () => {
  const s = scripted([
    [/^ {2}How much detail/, 2],
    [/^ {2}Tell you when a new version is out\?$/, true],
    [/^ {2}May Claude turn on the packs/, ''],
    [/^ {2}Memory folder \(Enter = ~\/\.claude\/projects\/-home-ada\/memory · - = none to protect\)$/, ''],
    [/^ {2}Show this summary\?$/, 1],
  ]);
  const r = await askInstall(s.io, ask('en'));
  assert.deepEqual(s.steps, ['1/5 View', '2/5 Updates', '3/5 Tool packs', '4/5 Memory', '5/5 Answer summary']);
  assert.equal(s.left(), 0);
  assert.equal(r.chosen.view, 'detailed');
  assert.deepEqual(r.chosen.update, { check: true });
  assert.deepEqual(r.chosen.packs, { autoUse: true, items: {} }, 'Enter keeps the packs on');
  assert.deepEqual(r.chosen.memory?.dirs, ['/home/ada/.claude/projects/-home-ada/memory'], 'Enter takes the folder offered');
  assert.equal(r.chosen.footer?.mode, 'check');
  assert.equal(r.memoryAsked, true);
  const said = s.said.join('\n');
  // The example under the last step is the footer's own lines, indented under what it explains.
  assert.match(said, /\n {6}Changes made: Yes \(2 files written\)\n {6}5-hour quota: 83\n/);
  assert.match(said, /^\nA few choices\. You can change each of them later in the control center \(mode-code\)\./);
});

test('Enter on the view takes the recommended one, as the setting does; the summary step offers Mode_Code drawing it first', async () => {
  const s = scripted([
    [/How much detail/, ''],
    [/new version/, ''],
    [/packs/, false],
    [/Memory folder/, '-'],
    [/Show this summary/, ''],
  ]);
  const r = await askInstall(s.io, ask('en'));
  assert.equal(r.chosen.view, 'recommended');
  assert.deepEqual(r.chosen.update, { check: false }, 'nothing reaches the network without a yes');
  assert.equal(r.chosen.packs?.autoUse, false);
  assert.equal(r.chosen.memory, undefined, 'a "-" protects no folder');
  assert.equal(r.memoryAsked, true);
  assert.equal(r.chosen.footer?.mode, 'draw');
});

test('the simple view asks three steps and says why the other two are not asked; a memory folder given is not asked for', async () => {
  const simple = scripted([
    [/ekranlarında ne kadar ayrıntı/, 0],
    [/Yeni sürüm çıkınca haber verilsin mi\?/, false],
    [/paketleri kendisi açabilsin mi\?/, true],
  ]);
  const r = await askInstall(simple.io, ask('tr'));
  assert.deepEqual(simple.steps, ['1/5 Görünüm', '2/5 Güncellemeler', '3/5 Araç paketleri', '4/5 Hafıza · skipped', '5/5 Cevap sonu özeti · skipped']);
  assert.deepEqual([r.chosen.view, r.chosen.memory, r.chosen.footer, r.memoryAsked], ['simple', undefined, undefined, false]);

  const given = scripted([
    [/How much detail/, ''],
    [/new version/, ''],
    [/packs/, ''],
    [/Show this summary/, ''],
  ]);
  const g = await askInstall(given.io, ask('en', true));
  assert.ok(given.steps.includes('4/5 Memory · skipped'));
  assert.equal(g.memoryAsked, false);
});

const opts = (lang: 'en' | 'tr', memoryAsked: boolean) => ({
  lang,
  cli: 'mode-code',
  show: (d: string) => d.replace('/home/ada', '~'),
  memoryAsked,
  columns: 100,
});

test("the summary: every choice under its step's name, in words, aligned; what the installation does; how to change or undo it", () => {
  const lines = installSummary(
    {
      view: 'detailed',
      update: { check: true },
      packs: { autoUse: true, items: {} },
      memory: { ...cloneDefaults().memory, dirs: ['/home/ada/notes'] },
      footer: { mode: 'draw', showFiveFrom: 70, showWeekFrom: 85 },
    },
    opts('tr', true),
  );
  const text = lines.join('\n');
  const rule = '─'.repeat(60);
  assert.equal(lines.filter((l) => l === rule).length, 2, 'between two rules, no wider than 60 columns');
  // The longest name, "Cevap sonu özeti", and four spaces set where every value starts.
  for (const [name, value] of [
    ['Görünüm', 'Ayrıntılı: bütün sayfalar'],
    ['Güncellemeler', 'Yeni sürüm çıkınca haber ver'],
    ['Araç paketleri', 'Claude gerektiğinde kendisi açar'],
    ['Hafıza', '~/notes, korunur'],
    ['Cevap sonu özeti', 'Göster: Mode_Code ekler'],
  ]) {
    const row = `    ${name!.padEnd(20)}${value}`;
    assert.ok(lines.includes(row), `${row}\n---\n${text}`);
  }
  assert.match(
    text,
    /Kurulum ne yapacak\n {4}• Claude Code'a Mode_Code eklentisini ve korumasını ekler\n {4}• Claude Code ayarlarını değiştirmeden önce yedekler\n {4}• Korumanın çalıştığını iki zararsız denemeyle doğrular/,
  );
  assert.match(text, /Seçimlerin hepsi sonradan mode-code ile değiştirilebilir\.\n {2}Vazgeçersen mode-code uninstall kurulumu kaldırır/);
  assert.doesNotMatch(text, /emniyet kemeri|hook/i, 'no word a newcomer has not met yet');
});

test('the summary of the simple view says where the memory is set up later; a narrow terminal gets narrower rules', () => {
  const lines = installSummary({ view: 'simple', update: { check: false }, packs: { autoUse: false, items: {} } }, { ...opts('en', false), columns: 40 });
  assert.ok(lines.includes('─'.repeat(39)));
  const text = lines.join('\n');
  assert.match(text, /Memory {12}Not asked in the simple view; later: mode-code memory setup/);
  assert.match(text, /Updates {11}Do not tell me; mode-code update looks when I run it/);
  assert.match(text, /Tool packs {8}Only I turn them on/);
  assert.match(text, /Answer summary {4}Show: Mode_Code adds it/, 'the default where it was not asked');
  // Asked and answered "-": no folder, said so.
  assert.match(installSummary({ view: 'recommended' }, opts('en', true)).join('\n'), /Memory {12}No folder protected/);
});

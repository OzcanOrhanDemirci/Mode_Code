// SPDX-License-Identifier: Apache-2.0
/**
 * One idea, one name (docs/design.md, rule 10): no message of either dictionary uses a form the glossary
 * (src/core/ux/glossary.ts) rules out, and the glossary the page shows is the one the code holds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, type MessageKey } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { GLOSSARY } from '../../src/core/ux/glossary.js';

/** Messages that may use a ruled-out form, and why. Keep it short: each line is an exception the person reads. */
const ALLOWED: readonly { key: MessageKey; lang: 'en' | 'tr'; why: string }[] = [];

test('no message uses a form the glossary rules out, in either language', () => {
  const found: string[] = [];
  for (const k of Object.keys(en) as MessageKey[])
    for (const term of GLOSSARY)
      for (const [lang, text, not] of [
        ['en', en[k], term.notEn],
        ['tr', tr[k], term.notTr],
      ] as const) {
        if (!not || !not.test(text)) continue;
        if (ALLOWED.some((a) => a.key === k && a.lang === lang)) continue;
        found.push(`${lang} ${k}: "${text.match(not)![0]}" (say "${lang === 'en' ? term.en : term.tr}")`);
      }
  assert.deepEqual(found, []);
});

test('the glossary catches what it is meant to, and not the words that only look alike', () => {
  const tr = (idea: string) => GLOSSARY.find((g) => g.idea.startsWith(idea))!.notTr!;
  const enOf = (idea: string) => GLOSSARY.find((g) => g.idea.startsWith(idea))!.notEn!;
  for (const s of ['Bir koşu başladı', 'Koşular', 'koşunun raporu', 'koşuyu durdur']) assert.ok(tr('the way of working').test(s), s);
  for (const s of ['bir koşul', 'koşulları', 'yarışkoşusu yok']) assert.ok(!tr('the way of working').test(s), s);
  assert.ok(tr('the 5-hour').test('5 saatlik pencere'));
  assert.ok(tr('the 5-hour').test('Kota penceresi sıfırlandı'));
  assert.ok(!tr('the 5-hour').test('Kontrol merkezi yeni pencerede açıldı.'));
  assert.ok(enOf('the 5-hour').test('the quota window reset'));
  assert.ok(!enOf('the 5-hour').test('opens a window'));
  assert.ok(enOf('helper').test('a subagent cannot'));
  assert.ok(tr('thousands').test('250 B token'));
  assert.ok(!tr('thousands').test('250 bin token'));
});

test('the glossary on docs/design.md is the one the code holds', () => {
  const page = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8');
  const table = page.slice(page.indexOf('## Glossary'), page.indexOf('## Components'));
  for (const g of GLOSSARY) {
    assert.ok(table.includes(g.en), `docs/design.md glossary misses "${g.en}"`);
    assert.ok(table.includes(g.tr), `docs/design.md glossary misses "${g.tr}"`);
  }
});

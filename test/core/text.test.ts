// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, fold, format, truncate } from '../../src/core/text.js';

test('fold makes Turkish keyboard variants equal', () => {
  assert.equal(fold('termınal devam'), 'terminal devam'); // dotless ı, the way the first session was opened
  assert.equal(fold('TERMİNAL DEVAM'), 'terminal devam'); // dotted capital İ
  assert.equal(fold('Terminal   Devam\n'), 'terminal devam');
  assert.equal(fold('çğıöşü ÇĞİÖŞÜ'), 'cgiosu cgiosu');
});

test('fold avoids the "İ".toLowerCase() trap', () => {
  assert.notEqual('İ'.toLowerCase(), 'i'); // the trap itself: "i" + U+0307
  assert.equal(fold('İ'), 'i');
});

test('editDistance counts one swap as one edit and caps early', () => {
  assert.equal(editDistance('checklist', 'chechlist'), 1);
  assert.equal(editDistance('devam', 'devma'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('kitten', 'sitting', 2), 3); // capped at max + 1
});

test('truncate counts code points and marks the cut', () => {
  assert.equal(truncate('merhaba', 10), 'merhaba');
  assert.equal(truncate('merhaba dünya', 8), 'merhaba…');
  assert.equal(truncate('🛡🛡🛡', 2), '🛡…');
});

test('format fills placeholders and keeps unknown ones visible', () => {
  assert.equal(format('{n} files in {dir}', { n: 3, dir: 'src' }), '3 files in src');
  assert.equal(format('{missing} stays', {}), '{missing} stays');
});

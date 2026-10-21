// SPDX-License-Identifier: Apache-2.0
/**
 * What changed, for someone who updated (src/core/news.ts): the notes between the version replaced and this one, said
 * once; the installation's record of what it replaced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEWS, newsFor, newsToSay, replacedVersion, type News } from '../../src/core/news.js';
import { tIn, type MessageKey } from '../../src/core/i18n/index.js';

const two: News[] = [
  { since: '1.2.0', key: 'news.1_2', short: 'news.1_2.short' },
  { since: '1.4.0', key: 'news.1_2', short: 'news.1_2.short' },
];
const since = (list: News[]) => list.map((n) => n.since);

test('the notes between the version replaced and this one: none for a new installation, a build or the same version', () => {
  assert.deepEqual(since(newsFor('1.1.0', '1.2.0')), ['1.2.0']);
  assert.deepEqual(since(newsFor('1.1.3', '1.2.5')), ['1.2.0']);
  assert.deepEqual(since(newsFor('1.2.0', '1.2.1')), []);
  assert.deepEqual(since(newsFor('1.0.0', '1.1.9')), []);
  for (const from of [null, undefined, '', 'dev']) assert.deepEqual(newsFor(from, '1.2.0'), [], String(from));
  assert.deepEqual(newsFor('1.1.0', 'dev'), []);
  // Every note a long jump passes; only those up to this version.
  assert.deepEqual(since(newsFor('1.1.0', '1.4.0', two)), ['1.2.0', '1.4.0']);
  assert.deepEqual(since(newsFor('1.1.0', '1.3.0', two)), ['1.2.0']);
  assert.deepEqual(since(newsFor('1.2.0', '1.4.0', two)), ['1.4.0']);
  // A pre-release of a version comes before it.
  assert.deepEqual(since(newsFor('1.2.0-rc.1', '1.2.0')), ['1.2.0']);
});

test('as a session starts, a note is said once: what was said before is not said again', () => {
  assert.deepEqual(since(newsToSay('1.1.0', undefined, '1.2.0')), ['1.2.0']);
  assert.deepEqual(since(newsToSay('1.1.0', '1.2.0', '1.2.0')), []);
  assert.deepEqual(since(newsToSay('1.1.0', '1.2.0', '1.4.0', two)), ['1.4.0']);
  assert.deepEqual(since(newsToSay('1.1.0', 5, '1.2.0')), ['1.2.0'], 'a said that does not read says it again');
  assert.deepEqual(newsToSay(undefined, undefined, '1.2.0'), []);
  assert.deepEqual(newsToSay(110, undefined, '1.2.0'), []);
});

test("the installation's record of what it replaced: another version, or what a reinstall of the same one had kept", () => {
  assert.equal(replacedVersion({ version: '1.1.0' }, '1.2.0'), '1.1.0');
  assert.equal(replacedVersion({ version: '1.2.0', updatedFrom: '1.1.0' }, '1.2.0'), '1.1.0');
  assert.equal(replacedVersion({ version: '1.2.0' }, '1.2.0'), undefined);
  assert.equal(replacedVersion({ version: '1.2.0', updatedFrom: 3 }, '1.2.0'), undefined);
  assert.equal(replacedVersion({ version: 7 }, '1.2.0'), undefined);
  assert.equal(replacedVersion(null, '1.2.0'), undefined);
});

test('every note reads in both languages, the line shorter than the note', () => {
  for (const n of NEWS)
    for (const lang of ['en', 'tr'] as const) {
      const full = tIn(lang, n.key as MessageKey);
      const short = tIn(lang, n.short as MessageKey);
      assert.ok(full.length > short.length && short.length > 20 && short.length <= 140, `${lang} ${n.since}`);
      assert.ok(!full.includes(n.key) && !short.includes(n.short), `${lang} ${n.since} is a written text`);
    }
  assert.match(tIn('tr', 'news.title', { from: '1.1.0' }), /1\.1\.0/);
});

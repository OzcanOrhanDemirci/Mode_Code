// SPDX-License-Identifier: Apache-2.0
// Updates (core/update.ts): the newest version read from a release's SHA256SUMS, newer or not, due or not, where.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDue, CHECK_EVERY_MS, newerThan, parseUpdateState, releaseBase, releasePage, sumOf, versionInSums } from '../../src/core/update.js';

const H = (c: string) => c.repeat(64);
const SUMS = [
  `${H('a')}  install.ps1`,
  `${H('b')}  install.sh`,
  `${H('c')}  mode-code-1.2.0.tgz`,
  `${H('d')}  mode-code.tgz`,
  `${H('e')} *mode-code-1.10.0-rc.1.tgz`,
  `${H('f')}  mode-code-1.9.9.tgz`,
  '',
].join('\n');

test("the newest version is the versioned package's, compared as versions, not as text", () => {
  assert.equal(versionInSums(SUMS), '1.10.0-rc.1');
  assert.equal(versionInSums(`${H('c')}  mode-code-1.2.0.tgz\n${H('f')}  mode-code-1.9.9.tgz\n`), '1.9.9');
  for (const none of ['', `${H('d')}  mode-code.tgz\n`, `${H('a')}  mode-code-x.tgz\n`, `${H('a')}  other-1.0.0.tgz\n`, `${H('a')}  mode-code-1.0.0.zip\n`])
    assert.equal(versionInSums(none), null, none);
});

test("a file's checksum: either spelling of the name, a full SHA-256 only", () => {
  assert.equal(sumOf(SUMS, 'install.sh'), H('b'));
  assert.equal(sumOf(SUMS, 'mode-code-1.10.0-rc.1.tgz'), H('e'));
  assert.equal(sumOf(`${'A'.repeat(64)}  x\n`, 'x'), 'a'.repeat(64), 'upper case read as lower');
  assert.equal(sumOf(SUMS, 'missing.txt'), null);
  assert.equal(sumOf('abc  install.sh\n', 'install.sh'), null);
  assert.equal(sumOf(`${H('a')}  install.sh extra\n`, 'install.sh'), null);
});

test('newer only when it is: an older or equal release, or a version that does not read, is none', () => {
  assert.equal(newerThan('1.1.0', '1.2.0'), '1.2.0');
  assert.equal(newerThan('1.2.0', '1.2.0'), null);
  assert.equal(newerThan('1.3.0', '1.2.0'), null, 'a build ahead of its release');
  assert.equal(newerThan('1.2.0-rc.1', '1.2.0'), '1.2.0');
  assert.equal(newerThan('1.1.0', null), null);
  assert.equal(newerThan('1.1.0', 'later'), null);
  assert.equal(newerThan('dev', '1.2.0'), null);
});

test('a check is due once a day, when none ran, or when the last one is dated ahead of the clock', () => {
  const now = 10 * CHECK_EVERY_MS;
  assert.equal(checkDue(null, now), true);
  assert.equal(checkDue({ checkedAt: now - CHECK_EVERY_MS + 1, latest: '1.2.0', error: null }, now), false);
  assert.equal(checkDue({ checkedAt: now - CHECK_EVERY_MS, latest: '1.2.0', error: null }, now), true);
  assert.equal(checkDue({ checkedAt: now + 1, latest: null, error: null }, now), true, 'a clock set back');
  assert.equal(checkDue({ checkedAt: now, latest: null, error: null }, now), false);
  assert.equal(checkDue({ checkedAt: now - 5, latest: null, error: null }, now, 5), true);
});

test('the state file: read defensively', () => {
  assert.deepEqual(parseUpdateState(JSON.stringify({ checkedAt: 5, latest: '1.2.0', error: null })), { checkedAt: 5, latest: '1.2.0', error: null });
  assert.deepEqual(parseUpdateState(JSON.stringify({ checkedAt: 5, latest: 'soon', error: 'x'.repeat(400) })), {
    checkedAt: 5,
    latest: null,
    error: 'x'.repeat(300),
  });
  for (const bad of [null, '', '{', '[]', '{"checkedAt":"5"}', '{"checkedAt":null}']) assert.equal(parseUpdateState(bad), null, String(bad));
});

test("a release's files: GitHub's newest or one version, or the place named instead", () => {
  assert.equal(releaseBase(null), 'https://github.com/OzcanOrhanDemirci/Mode_Code/releases/latest/download');
  assert.equal(releaseBase('1.2.0'), 'https://github.com/OzcanOrhanDemirci/Mode_Code/releases/download/v1.2.0');
  assert.equal(releaseBase('1.2.0', 'https://mirror.example/mc/'), 'https://mirror.example/mc');
  assert.equal(releaseBase(null, 'C:\\rel\\\\'), 'C:\\rel');
  assert.equal(releaseBase(null, ''), 'https://github.com/OzcanOrhanDemirci/Mode_Code/releases/latest/download');
  assert.equal(releasePage('1.2.0'), 'https://github.com/OzcanOrhanDemirci/Mode_Code/releases/tag/v1.2.0');
});

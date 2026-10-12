// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, bar, compact, percent, shortPath, sparkline, until } from '../../src/core/format.js';
import { compareVersions } from '../../src/core/version.js';
import { fitWidth, textWidth } from '../../src/node/width.js';

test('numbers read naturally in both languages', () => {
  assert.equal(compact(999, 'en'), '999');
  assert.equal(compact(1234, 'en'), '1.2 K');
  assert.equal(compact(2_500_000, 'en'), '2.5 M');
  assert.equal(compact(3_300_000_000, 'en'), '3.3 B');
  assert.equal(compact(1234, 'tr'), '1,2 B');
  assert.equal(compact(2_500_000, 'tr'), '2,5 Mn');
  assert.equal(percent(14, 'en'), '14%');
  assert.equal(percent(14, 'tr'), '%14');
  assert.equal(percent(98.49, 'tr', 1), '%98,5');
  assert.equal(percent(null, 'en'), '?');
});

test('times are coarse and in the language of the person', () => {
  const now = Date.parse('2026-10-12T08:00:00Z');
  assert.equal(ago(now - 10_000, now, 'en'), 'just now');
  assert.equal(ago(now - 5 * 60_000, now, 'tr'), '5 dk önce');
  assert.equal(ago(now - 3 * 3600_000, now, 'en'), '3 h ago');
  assert.equal(ago(now - 3 * 86400_000, now, 'en'), '3 days ago');
  assert.equal(ago(null, now, 'en'), 'never');
  assert.equal(until(now + 250 * 60_000, now, 'en'), 'in 4 h 10 min');
});

test('bars and sparklines have fixed widths and plain fallbacks', () => {
  assert.equal(bar(50, 10).length, 10);
  assert.equal(bar(100, 4), '████');
  assert.equal(bar(0, 4), '    ');
  assert.equal(bar(50, 10, true), '#####-----');
  assert.equal(bar(150, 4, true), '####');
  assert.equal(sparkline([0, 1, 2, 4]), '▁▂▄█');
  assert.equal(sparkline([0, 0], true), '__');
});

test('paths are shortened around the home folder and in the middle', () => {
  assert.equal(shortPath('C:/Users/ozcan/dev/x', 'C:/Users/ozcan'), '~/dev/x');
  assert.equal(shortPath('c:\\users\\ozcan\\dev', 'C:/Users/ozcan'), '~/dev');
  const long = shortPath('/very/long/path/that/goes/on/and/on/and/on/forever/file.ts', '/home/u', 30);
  assert.ok(long.length <= 30 && long.includes('…'));
});

test('terminal width counts wide emoji as two columns', () => {
  assert.equal(textWidth('abc'), 3);
  assert.equal(textWidth('🛡 x'), 3); // a pictograph shown as text is one column
  assert.equal(textWidth('🛡️ x'), 4); // asked for as a picture (U+FE0F), two
  assert.equal(textWidth('✅ ⚪ ⛔'), 8);
  assert.equal(textWidth('çğış'), 4);
  assert.equal(fitWidth('Delete a critical folder', 10), 'Delete a…');
  assert.equal(textWidth(fitWidth('🔒🔒🔒🔒', 5)), 5);
});

test('version comparison, pre-releases sort before the release', () => {
  assert.equal(compareVersions('2.1.296', '2.1.295'), 1);
  assert.equal(compareVersions('2.1.290', '2.1.290'), 0);
  assert.equal(compareVersions('2.1.9', '2.1.10'), -1);
  assert.equal(compareVersions('2.1.290-dev', '2.1.290'), -1);
  assert.equal(compareVersions('garbage', '2.1.0'), -1);
});

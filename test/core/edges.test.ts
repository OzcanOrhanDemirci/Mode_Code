// SPDX-License-Identifier: Apache-2.0
/**
 * Boundaries in quota, secrets and keywords that mutation testing showed unwatched: the exact moment a
 * window resets or a reading goes stale, which reset the guard waits for, the status line's format, the
 * randomness a generic secret needs, overlapping matches, and how close a typo must be to be suggested.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQuota, DEFAULT_BUDGET, fromStatusLine } from '../../src/core/quota.js';
import { maskSecrets, scanSecrets } from '../../src/core/secrets/scan.js';
import { detectKeyword } from '../../src/core/keywords.js';

const NOW = Date.parse('2026-10-12T10:00:00Z');
const reading = (windows: { kind: string; used: number; resetsAt: number | null }[], measuredAt = NOW) => ({ measuredAt, source: 'mod' as const, windows });

test('quota: a window resets at its reset time exactly; a reading is stale only after the limit', () => {
  const at = (resetsAt: number) => assessQuota(reading([{ kind: 'five_hour', used: 99.5, resetsAt }]), DEFAULT_BUDGET, NOW);
  assert.equal(at(NOW).five?.used, 0, 'at the reset time the window is empty');
  assert.equal(at(NOW + 1).level, 'stop');
  const limit = DEFAULT_BUDGET.staleMinutes * 60000;
  assert.equal(assessQuota(reading([], NOW - limit), DEFAULT_BUDGET, NOW).stale, false, 'exactly at the limit it is still fresh');
  assert.equal(assessQuota(reading([], NOW - limit - 1), DEFAULT_BUDGET, NOW).stale, true);
});

test('quota: the guard waits for the latest reset among the windows that stopped it', () => {
  const a = assessQuota(
    reading([
      { kind: 'five_hour', used: 99.5, resetsAt: NOW + 3600_000 },
      { kind: 'seven_day', used: 99.5, resetsAt: NOW + 7200_000 },
    ]),
    DEFAULT_BUDGET,
    NOW,
  );
  assert.equal(a.resumeAt, NOW + 7200_000);
  const b = assessQuota(
    reading([
      { kind: 'five_hour', used: 99.5, resetsAt: NOW + 7200_000 },
      { kind: 'seven_day', used: 99.5, resetsAt: NOW + 3600_000 },
    ]),
    DEFAULT_BUDGET,
    NOW,
  );
  assert.equal(b.resumeAt, NOW + 7200_000);
  const c = assessQuota(reading([{ kind: 'five_hour', used: 99.5, resetsAt: null }]), DEFAULT_BUDGET, NOW);
  assert.equal(c.resumeAt, null, 'no reset time known: no resume time');
  const d = assessQuota(reading([{ kind: 'five_hour', used: 10, resetsAt: NOW + 60_000 }]), DEFAULT_BUDGET, NOW);
  assert.equal(d.resumeAt, null, 'below the levels nothing is waited for');
});

test('quota: the status line format, read field by field', () => {
  assert.equal(fromStatusLine(null, NOW), null);
  assert.equal(fromStatusLine('five_hour', NOW), null);
  assert.equal(fromStatusLine({}, NOW), null);
  assert.equal(fromStatusLine({ five_hour: null, seven_day: 'x' }, NOW), null);
  const r = fromStatusLine(
    { five_hour: { used_percentage: 40, resets_at: 1_760_000_000 }, seven_day: { used_percentage: 12 }, odd: { used_percentage: '9' } },
    NOW,
  )!;
  assert.deepEqual(r.windows, [
    { kind: 'five_hour', used: 40, resetsAt: 1_760_000_000_000 },
    { kind: 'seven_day', used: 12, resetsAt: null },
  ]);
  assert.equal(r.source, 'statusline');
});

test('secrets: a generic value needs two kinds of character and enough randomness; placeholders never count', () => {
  const found = (v: string) => scanSecrets(`password = "${v}"`).length > 0;
  assert.equal(found('Xk3p9Qz7Lm2Rt8Wv'), true);
  assert.equal(found('xkpqzlmrtwvbnghj'), false, 'one kind of character');
  assert.equal(found('aaaaaaaaaaaaaaaB'), false, 'two kinds, but not random');
  assert.equal(found('your_password_here'), false);
  assert.equal(found('${DB_PASSWORD}'), false);
  assert.equal(found('process.env.DB_PASSWORD'), false);
});

test('secrets: a short secret shows no tail; overlapping matches are found once', () => {
  assert.doesNotMatch(maskSecrets('token=npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'), /npm_a1B2/);
  const twelve = scanSecrets(`password = "${'Xk3p9Qz7' + 'Lm2R'}"`)[0];
  if (twelve) assert.match(twelve.masked, /•••\s\(12\)$/);
  const gh = 'ghp' + '_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYzA1b';
  const both = scanSecrets(`GITHUB_TOKEN="${gh}"`);
  assert.deepEqual(
    both.map((m) => m.kind),
    ['github-token'],
    'the documented format wins over the generic assignment it sits in',
  );
});

test('keywords: any of a project names counts; a four-letter name gets suggestions; the first close name wins a tie', () => {
  assert.equal(detectKeyword('terminal devam', [{ id: 'tc', names: ['tc', 'terminal'] }])?.project, 'tc');
  assert.equal(detectKeyword('my app devam', [{ id: 'mine', names: ['my app'] }])?.project, 'mine', 'a registered name of two words');
  assert.equal(detectKeyword('doks devam', [{ id: 'docs-site', names: ['docs'] }])?.suggestion, 'docs-site');
  const tie = [
    { id: 'first', names: ['abcd'] },
    { id: 'second', names: ['abce'] },
  ];
  assert.equal(detectKeyword('abcf devam', tie)?.suggestion, 'first');
});

test('secrets: exactly two kinds of character are enough for a random generic value', () => {
  assert.equal(scanSecrets(`password = "${'xk3p9qz7' + 'lm2rt8wv4hd6'}"`).length, 1);
});

test('keywords: a typo is suggested only for names of four letters or more, one edit away', () => {
  const projects = [
    { id: 'terminal-code', names: ['terminal'] },
    { id: 'app', names: ['app'] },
  ];
  assert.equal(detectKeyword('termnal devam', projects)?.suggestion, 'terminal-code');
  assert.equal(detectKeyword('termnl devam', projects)?.suggestion, undefined, 'two edits away');
  assert.equal(detectKeyword('apq devam', projects)?.suggestion, undefined, 'short names are not guessed');
  assert.equal(detectKeyword('terminal-code devam', projects)?.project, 'terminal-code', 'the id itself names the project');
  // A budget with continue or manual; after anything else it is a budget for the task in front of it.
  assert.equal(detectKeyword('manuel terminal devam kota 40', projects)?.budget?.n, 40);
  assert.deepEqual([detectKeyword('sohbet kota 40', projects)?.kind, detectKeyword('sohbet kota 40', projects)?.budget], ['quota', undefined]);
  // Several words before "devam" are a sentence; a single unknown word may be a project not registered yet.
  assert.equal(detectKeyword('bu işe devam', projects), null);
  assert.deepEqual([detectKeyword('testlere devam', projects)?.kind, detectKeyword('testlere devam', projects)?.project], ['continue', null]);
});

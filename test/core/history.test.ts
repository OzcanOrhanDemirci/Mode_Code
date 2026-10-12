// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketize, type ReadingPoint } from '../../src/core/history.js';

const H = 3600_000;
const T0 = Date.parse('2026-10-12T00:00:00Z');

test('one value per bucket, the highest; gaps repeat the last value', () => {
  const pts: ReadingPoint[] = [
    { at: T0 + 0.5 * H, five: 10, week: 20 },
    { at: T0 + 0.8 * H, five: 14, week: 21 },
    { at: T0 + 3.2 * H, five: 30, week: 25 },
  ];
  assert.deepEqual(bucketize(pts, 'five', T0, T0 + 4 * H, 4), [14, 14, 14, 30]);
  assert.deepEqual(bucketize(pts, 'week', T0, T0 + 4 * H, 4), [21, 21, 21, 25]);
});

test('before the first reading there is nothing; a reading before the range carries in', () => {
  assert.deepEqual(bucketize([{ at: T0 + 2.5 * H, five: 5, week: null }], 'five', T0, T0 + 4 * H, 4), [null, null, 5, 5]);
  assert.deepEqual(bucketize([{ at: T0 - H, five: 7, week: null }], 'five', T0, T0 + 2 * H, 2), [7, 7]);
});

test('after the window resets, a quiet stretch draws zero, not the old value', () => {
  const pts: ReadingPoint[] = [{ at: T0 + 0.5 * H, five: 80, week: 30, fiveResetsAt: T0 + 2 * H, weekResetsAt: T0 + 100 * H }];
  assert.deepEqual(bucketize(pts, 'five', T0, T0 + 4 * H, 4), [80, 80, 0, 0]);
  assert.deepEqual(bucketize(pts, 'week', T0, T0 + 4 * H, 4), [30, 30, 30, 30]);
});

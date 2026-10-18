// SPDX-License-Identifier: Apache-2.0
// The repository's settings as code (scripts/github-settings.mjs): what its dry run reports from GitHub's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain JavaScript script, run by hand
import { securityGaps } from '../../scripts/github-settings.mjs';

const on = { status: 'enabled' };
const off = { status: 'disabled' };
const all = ['secret scanning', 'push protection', 'private vulnerability reporting'];

test('a public repository with everything on has no security gap', () => {
  assert.deepEqual(securityGaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: true }), { off: [], unknown: [] });
});

test('each setting that is off is named', () => {
  const gaps = (a: object, r: object) => securityGaps(a, r).off;
  assert.deepEqual(gaps({ secret_scanning: off, secret_scanning_push_protection: on }, { enabled: true }), ['secret scanning']);
  assert.deepEqual(gaps({ secret_scanning: on, secret_scanning_push_protection: off }, { enabled: true }), ['push protection']);
  assert.deepEqual(gaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: false }), ['private vulnerability reporting']);
});

test('an answer GitHub did not give is unknown, never on', () => {
  assert.deepEqual(securityGaps(undefined, null), { off: [], unknown: all });
  assert.deepEqual(securityGaps({}, {}), { off: [], unknown: all });
  assert.deepEqual(securityGaps({ secret_scanning: off }, null), { off: ['secret scanning'], unknown: all.slice(1) });
});

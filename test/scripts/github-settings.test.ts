// SPDX-License-Identifier: Apache-2.0
// The repository's settings as code (scripts/github-settings.mjs): what its dry run reports from GitHub's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain JavaScript script, run by hand
import { securityGaps } from '../../scripts/github-settings.mjs';

const on = { status: 'enabled' };
const off = { status: 'disabled' };

test('a public repository with everything on has no security gap', () => {
  assert.deepEqual(securityGaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: true }), []);
});

test('each setting that is off is named', () => {
  assert.deepEqual(securityGaps({ secret_scanning: off, secret_scanning_push_protection: on }, { enabled: true }), ['secret scanning']);
  assert.deepEqual(securityGaps({ secret_scanning: on, secret_scanning_push_protection: off }, { enabled: true }), ['push protection']);
  assert.deepEqual(securityGaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: false }), ['private vulnerability reporting']);
});

test('an answer GitHub did not give counts as off: the dry run never says it is on when it cannot tell', () => {
  const all = ['secret scanning', 'push protection', 'private vulnerability reporting'];
  assert.deepEqual(securityGaps(undefined, null), all);
  assert.deepEqual(securityGaps({}, {}), all);
});

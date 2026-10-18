// SPDX-License-Identifier: Apache-2.0
/**
 * The development switch that turns the safety belt off (src/core/dev-switch.ts) is temporary: it holds only the
 * value 1, and it is gone before the release it was made for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beltOffForDevelopment, DEV_BELT_OFF } from '../../src/core/dev-switch.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('only the value 1 turns the belt off', () => {
  assert.equal(beltOffForDevelopment({ [DEV_BELT_OFF]: '1' }), true);
  for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) assert.equal(beltOffForDevelopment({ [DEV_BELT_OFF]: v }), false, String(v));
  assert.equal(beltOffForDevelopment({}), false);
});

test('the switch is gone before 1.2.0 is released', () => {
  const version = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version as string;
  const here = existsSync(`${root}/src/core/dev-switch.ts`);
  assert.ok(!(here && !/^1\.1\./.test(version)), `version ${version}: remove src/core/dev-switch.ts and its uses first`);
});

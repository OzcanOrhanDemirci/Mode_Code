// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flag, intValue, parseArgs, value, values } from '../../src/cli/args.js';

test('positionals, flags and values', () => {
  const a = parseArgs(['belt', 'test', '--command', 'git status', '--json', '--days=3', '-y']);
  assert.deepEqual(a.positionals, ['belt', 'test']);
  assert.equal(value(a, 'command'), 'git status');
  assert.equal(flag(a, 'json'), true);
  assert.equal(intValue(a, 'days', 7), 3);
  assert.equal(flag(a, 'yes', 'y'), true);
});

test('boolean flags never swallow the next word', () => {
  const a = parseArgs(['--json', 'sessions']);
  assert.deepEqual(a.positionals, ['sessions']);
});

test('repeated keys collect; -- ends the options', () => {
  const a = parseArgs(['install', '--memory', 'a', '--memory', 'b', '--', '--not-a-flag']);
  assert.deepEqual(values(a, 'memory'), ['a', 'b']);
  assert.deepEqual(a.positionals, ['install', '--not-a-flag']);
});

test('numbers are clamped to the allowed range', () => {
  assert.equal(intValue(parseArgs(['--days', '99999']), 'days', 7, 1, 3650), 3650);
  assert.equal(intValue(parseArgs(['--days', 'x']), 'days', 7), 7);
});

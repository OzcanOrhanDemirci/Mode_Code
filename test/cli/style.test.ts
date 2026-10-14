// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorDepth } from '../../src/cli/style.js';

test('24-bit colors where the terminal says so or is known to take them; the 256-color palette elsewhere', () => {
  assert.equal(colorDepth({ COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(colorDepth({ COLORTERM: '24bit' }), 'truecolor');
  assert.equal(colorDepth({ WT_SESSION: 'x' }), 'truecolor');
  for (const program of ['iTerm.app', 'WezTerm', 'vscode', 'ghostty']) assert.equal(colorDepth({ TERM_PROGRAM: program }), 'truecolor');
  assert.equal(colorDepth({ TERM_PROGRAM: 'Apple_Terminal' }), '256');
  assert.equal(colorDepth({ COLORTERM: 'yes' }), '256');
  assert.equal(colorDepth({}), '256');
});

// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from '../../src/core/ux/text.js';

test('prose wraps at word boundaries, and no line starts or ends with a space', () => {
  const lines = wrapText('Every session starts with no agents: Claude starts none until you give a number.', 20);
  assert.deepEqual(lines, ['Every session starts', 'with no agents:', 'Claude starts none', 'until you give a', 'number.']);
  for (const l of lines) assert.ok(l.length <= 20 && l === l.trim(), JSON.stringify(l));
});

test('a word wider than the line is cut across lines; paragraphs stay apart; a width is honoured as given', () => {
  assert.deepEqual(wrapText('a supercalifragilistic b', 8), ['a', 'supercal', 'ifragili', 'stic b']);
  assert.deepEqual(wrapText('one\n\ntwo', 10), ['one', '', 'two']);
  assert.deepEqual(wrapText('  spaced   out  ', 40), ['spaced out']);
  assert.deepEqual(wrapText('ab', 0), ['a', 'b']);
  // Two columns for each character: a measure decides, not the length.
  assert.deepEqual(
    wrapText('ab cd', 4, (s) => [...s].length * 2),
    ['ab', 'cd'],
  );
});

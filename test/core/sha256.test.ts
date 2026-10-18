// SPDX-License-Identifier: Apache-2.0
// SHA-256 in plain code (src/core/sha256.ts), checked against Node's own on the edges of a block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../src/core/sha256.js';

test('the same digest as node:crypto, block edges and UTF-8 included', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const text of ['', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(119), 'ğüşİı ✓ 🙂'.repeat(9), 'x'.repeat(1000)])
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), `${text.length} characters`);
});

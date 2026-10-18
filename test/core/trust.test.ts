// SPDX-License-Identifier: Apache-2.0
// What runs inside Claude Code besides the model (src/core/trust.ts): what is new or gone since the last look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustSnapshot, trustChanges, trustKey, type TrustItem } from '../../src/core/trust.js';

const hook: TrustItem = { kind: 'hook', name: 'PreToolUse', scope: 'user', detail: 'node guard.js' };
const mcp: TrustItem = { kind: 'mcp', name: 'docs', scope: 'project', detail: 'stdio npx docs' };

test('the first look marks nothing; later, what was added and what went; a changed command is new', () => {
  assert.deepEqual(trustChanges([hook, mcp], null), { added: [], gone: [] });
  assert.deepEqual(trustChanges([hook, mcp], [trustKey(hook), trustKey(mcp)]), { added: [], gone: [] });
  assert.deepEqual(trustChanges([hook, mcp], [trustKey(hook)]).added, [mcp]);
  assert.deepEqual(trustChanges([hook], [trustKey(hook), trustKey(mcp)]).gone, [trustKey(mcp)]);
  const swapped = { ...hook, detail: 'node evil.js' };
  assert.deepEqual(trustChanges([swapped], [trustKey(hook)]), { added: [swapped], gone: [trustKey(hook)] });
});

test('the snapshot file is read defensively', () => {
  for (const bad of ['', '{', '[]', '{"items":5}']) assert.equal(parseTrustSnapshot(bad) === null || parseTrustSnapshot(bad)!.length === 0, true, bad);
  assert.deepEqual(parseTrustSnapshot(JSON.stringify({ items: ['a', 5, 'b'] })), ['a', 'b']);
  assert.equal(parseTrustSnapshot(null), null);
});

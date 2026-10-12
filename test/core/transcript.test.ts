// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentTurn, isHumanPrompt } from '../../src/core/transcript.js';

const J = (o: unknown) => JSON.stringify(o);
const user = (text: string, ts: string, extra: object = {}) => J({ type: 'user', timestamp: ts, message: { role: 'user', content: text }, ...extra });
const toolUse = (id: string, name: string, input: object) =>
  J({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id: string) => J({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

test('the turn starts at the last prompt the person typed', () => {
  const lines = [
    user('first task', '2026-10-12T05:00:00Z'),
    toolUse('t1', 'Bash', { command: 'echo old' }),
    toolResult('t1'),
    user('second task', '2026-10-12T06:00:00Z'),
    toolUse('t2', 'Write', { file_path: 'a.txt', content: 'x' }),
    toolResult('t2'),
    user('<task-notification>done</task-notification>', '2026-10-12T06:05:00Z'),
    user('injected reminder', '2026-10-12T06:06:00Z', { isMeta: true }),
    toolUse('t3', 'Bash', { command: 'git status' }),
    toolUse('t3', 'Bash', { command: 'git status' }), // the same block written twice
    'not json',
  ];
  const t = currentTurn(lines);
  assert.equal(t.complete, true);
  assert.equal(t.startedAt, Date.parse('2026-10-12T06:00:00Z'));
  assert.deepEqual(
    t.uses.map((u) => u.name),
    ['Write', 'Bash'],
  );
});

test('calls that did not run do not count: refused ones, and file tools that failed', () => {
  const result = (id: string, text: string) =>
    J({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] } });
  const t = currentTurn([
    user('do it', '2026-10-12T06:00:00Z'),
    toolUse('a', 'Write', { file_path: 'x', content: '' }),
    result('a', 'PreToolUse:Write hook error: 🛡 Blocked by the safety belt: …'),
    toolUse('b', 'Edit', { file_path: 'y', old_string: 'q', new_string: 'r' }),
    result('b', 'String to replace not found'),
    toolUse('c', 'Bash', { command: 'npm run build' }),
    result('c', 'exit code 1'),
  ]);
  assert.deepEqual(
    t.uses.map((u) => u.name),
    ['Bash'],
  );
});

test('a tail without the turn start says so', () => {
  const t = currentTurn([toolUse('t1', 'Bash', { command: 'ls' })]);
  assert.equal(t.complete, false);
  assert.equal(t.startedAt, null);
  assert.equal(t.uses.length, 1);
});

test('what counts as a human prompt', () => {
  assert.equal(isHumanPrompt({ type: 'user', message: { content: [{ type: 'text', text: 'merhaba' }] } }), true);
  assert.equal(isHumanPrompt({ type: 'user', message: { content: [{ type: 'tool_result' }] } }), false);
  assert.equal(isHumanPrompt({ type: 'user', isSidechain: true, message: { content: 'sub-agent prompt' } }), false);
  assert.equal(isHumanPrompt({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }), false);
});

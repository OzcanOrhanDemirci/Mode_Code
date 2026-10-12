// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuards } from '../../src/core/guard.js';
import { newModState } from '../../src/core/session.js';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits } from '../../src/core/quota.js';
import type { ClassifyEnv } from '../../src/core/footer.js';

const env: ClassifyEnv = { platform: 'linux', home: '/home/u', cwd: '/home/u/proj', memoryRoots: ['/home/u/notes'], ignore: ['/tmp'] };
const chat = { ...newModState('s', '1', 0), mode: 'chat' as const };
const NOW = Date.parse('2026-10-12T06:00:00Z');
const q = (five: number) =>
  assessQuota(
    fromModRateLimits(
      [
        { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T08:00:00Z' },
        { kind: 'seven_day', percentUsed: 10 },
      ],
      NOW,
    ),
    DEFAULT_BUDGET,
    NOW,
  );

test('chat mode: project and memory writes are refused, temporary files and reads are not', () => {
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, chat, null, env, 'en')?.kind, 'chat');
  assert.equal(checkGuards('Edit', { file_path: '/home/u/notes/n.md', old_string: 'a', new_string: 'b' }, chat, null, env, 'en')?.kind, 'chat');
  assert.equal(checkGuards('Bash', { command: 'git commit -m x' }, chat, null, env, 'en')?.kind, 'chat');
  assert.equal(checkGuards('Write', { file_path: '/tmp/try.ts', content: '' }, chat, null, env, 'en'), null);
  assert.equal(checkGuards('Read', { file_path: '/home/u/proj/a.ts' }, chat, null, env, 'en'), null);
  assert.equal(checkGuards('Bash', { command: 'git status' }, chat, null, env, 'en'), null);
});

test('the refusal is in the language of the person', () => {
  assert.match(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, chat, null, env, 'tr')!.reason, /Sohbet modu/);
});

test('quota wrap-up: no new heavy work; stop: only reads, notes and commits', () => {
  const free = newModState('s', '1', 0);
  assert.equal(checkGuards('Agent', { prompt: 'x' }, free, q(50), env, 'en'), null);
  assert.equal(checkGuards('Agent', { prompt: 'x' }, free, q(96), env, 'en')?.kind, 'quota');
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, free, q(96), env, 'en'), null);
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, free, q(99), env, 'en')?.kind, 'quota');
  assert.equal(checkGuards('Write', { file_path: '/home/u/notes/n.md', content: '' }, free, q(99), env, 'en'), null);
  assert.equal(checkGuards('Bash', { command: 'git commit -m wip' }, free, q(99), env, 'en'), null);
  assert.equal(checkGuards('Read', { file_path: '/home/u/proj/a.ts' }, free, q(99), env, 'en'), null);
});

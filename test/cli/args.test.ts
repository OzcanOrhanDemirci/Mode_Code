// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flag, intValue, parseArgs, testedCommand, value, values } from '../../src/cli/args.js';

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

test("belt test's command is the words as typed, its options kept; belt test's own options are not the command's", () => {
  const t = (...w: string[]) => testedCommand(parseArgs(w).raw!);
  assert.equal(t('belt', 'test', 'rm', '-rf', '/srv/x'), 'rm -rf /srv/x');
  assert.equal(t('belt', 'test', 'git', 'push', '--force', 'origin', 'main', '--level', 'full', '--json'), 'git push --force origin main');
  assert.equal(t('belt', 'test', '--level=auto', 'git', 'clean', '-fdx'), 'git clean -fdx');
  assert.equal(t('belt', 'test', '--tool', 'Bash', 'ls', '--path', 'x', '--content', 'y', '--command', 'z'), 'ls');
  // One word is the whole command; words with spaces or shell characters are quoted back.
  assert.equal(t('belt', 'test', 'git clean -f'), 'git clean -f');
  assert.equal(t('belt', 'test', 'echo', 'a b', "it's", '$HOME'), "echo 'a b' 'it'\\''s' '$HOME'");
  // After --, every word is the command's, its own --json too.
  assert.equal(t('belt', 'test', '--', 'grep', '--json', 'x'), 'grep --json x');
  // Not a belt test: nothing.
  assert.equal(t('belt', 'rules'), '');
  assert.equal(t('test', 'x'), '');
  assert.deepEqual(parseArgs(['a', '-b']).raw, ['a', '-b']);
});

test('numbers are clamped to the allowed range', () => {
  assert.equal(intValue(parseArgs(['--days', '99999']), 'days', 7, 1, 3650), 3650);
  assert.equal(intValue(parseArgs(['--days', 'x']), 'days', 7), 7);
});

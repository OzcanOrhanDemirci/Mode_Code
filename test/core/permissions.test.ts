// SPDX-License-Identifier: Apache-2.0
// Permission fatigue (src/core/permissions.ts): a compound command whose every part the person allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partsAllowed, shellRules } from '../../src/core/permissions.js';

const env = { platform: 'linux' as const, home: '/home/ada', cwd: '/home/ada/dev/app' };
const rules = shellRules(['Bash(npm test:*)', 'Bash(npm run build)', 'Bash(git status)', 'Bash(tail *)', 'Read(*)', 'Bash(rm:*) ignored?', 5], 'Bash');
const ok = (command: string) => partsAllowed(command, 'bash', rules, env.cwd, env);

test('the rules: exact commands, prefixes written either way, a bare tool name', () => {
  assert.deepEqual([...rules.exact].sort(), ['git status', 'npm run build']);
  assert.deepEqual(rules.prefixes, ['npm test', 'tail']);
  assert.equal(rules.all, false);
  assert.equal(shellRules(['Bash'], 'Bash').all, true);
  assert.equal(shellRules(['Bash(*)'], 'Bash').all, true);
  assert.equal(shellRules(['Bash'], 'PowerShell').all, false);
  assert.deepEqual([...shellRules(['PowerShell(Get-ChildItem)'], 'PowerShell').exact], ['Get-ChildItem']);
});

test('every part allowed, and a cd into the project only says where: the person said yes already', () => {
  for (const c of [
    'npm run build && npm test',
    'npm test -- --watch=false; git status',
    'npm test 2>&1 | tail -20',
    'cd /home/ada/dev/app && npm test',
    'cd packages/web && npm run build && npm test',
  ])
    assert.equal(ok(c), true, c);
});

test('a part no rule covers, a cd out of the project, a write or a nested command: asked as before', () => {
  for (const c of [
    'npm test && npm publish',
    'cd /tmp && npm test',
    'cd .. && npm test',
    'npm test > out.txt && git status',
    'npm test && $(git status)',
    'npm test',
    'cd /home/ada/dev/app',
    'cd "$DIR" && npm test',
    'npm test && echo "unterminated',
  ])
    assert.equal(ok(c), false, c);
  assert.equal(partsAllowed('rm -rf x && rm -rf y', 'bash', shellRules(['Bash'], 'Bash'), env.cwd, env), true, 'a bare Bash rule allows all');
});

// SPDX-License-Identifier: Apache-2.0
// Tool hygiene (src/core/hygiene.ts): a shell command that only reads files, and the tool that does its work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellReadTool } from '../../src/core/hygiene.js';

const bash = (command: string) => shellReadTool('Bash', { command });

test('reading a file through the shell is Read; searching files is Grep', () => {
  for (const c of ['cat src/a.ts', 'head -n 50 src/a.ts', 'tail -20 log.txt', "sed -n '1,80p' src/a.ts", 'cat a.ts b.ts']) assert.equal(bash(c), 'Read', c);
  for (const c of ['grep -rn TODO src', 'rg -n "fn main" src', 'grep -n x a.ts && grep -n y b.ts']) assert.equal(bash(c), 'Grep', c);
  assert.equal(shellReadTool('PowerShell', { command: 'Get-Content src\\a.ts' }), 'Read');
  assert.equal(shellReadTool('PowerShell', { command: 'Select-String -Path src\\*.ts -Pattern TODO' }), 'Grep');
});

test('anything else is no file read: a filter on a stream, a write, an edit, other programs', () => {
  for (const c of [
    'git log | head -5',
    'npm test 2>&1 | tail -20',
    'cat a.ts > b.ts',
    "sed -i 's/a/b/' a.ts",
    'sed -n 1p',
    'grep x',
    'ls -la',
    'cat a.ts | node -e "x"',
    'echo "unterminated',
    '',
  ])
    assert.equal(bash(c), null, c);
  assert.equal(shellReadTool('Read', { file_path: 'a.ts' }), null);
});

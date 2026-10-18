// SPDX-License-Identifier: Apache-2.0
// Tool hygiene (src/core/hygiene.ts): a shell command that only reads files, and the tool that does its work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { shellReadTool, shellTrap, wholeRead, WHOLE_READ_CHARS } from '../../src/core/hygiene.js';

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
    'sed -n -i.bak 1p a.ts',
    'sed -n 1p',
    'cat "a.ts',
    'grep x',
    'ls -la',
    'cat a.ts | node -e "x"',
    'echo "unterminated',
    '',
  ])
    assert.equal(bash(c), null, c);
  assert.equal(shellReadTool('Read', { file_path: 'a.ts' }), null);
});

test('the shell traps: an unquoted heredoc with backslashes on Windows, a build piped into a filter without pipefail', () => {
  const trap = (command: string, platform: 'win32' | 'linux' = 'win32') => shellTrap('Bash', { command }, platform);
  assert.equal(trap('cat > a.txt <<EOF\nC:\\dev\\x\nEOF'), 'heredoc');
  assert.equal(trap("cat > a.txt <<'EOF'\nC:\\dev\\x\nEOF"), null, 'a quoted delimiter keeps the text');
  assert.equal(trap('cat > a.txt <<EOF\nC:\\dev\\x\nEOF', 'linux'), null, 'paths there have no backslashes');
  assert.equal(trap('cat > a.txt <<EOF\nplain\nEOF'), null);
  assert.equal(trap('cd x && cat > a.txt <<EOF\nC:\\dev\\x\nEOF'), 'heredoc', 'in any command of the line');
  assert.equal(trap("cat <<'A' 3<<EOF\nplain\nA\nC:\\dev\\x\nEOF"), 'heredoc', 'in any heredoc of the command');
  assert.equal(trap('npm test 2>&1 | tail -20', 'linux'), 'pipe');
  assert.equal(trap('npx tsc --noEmit | head', 'linux'), 'pipe');
  assert.equal(trap('set -o pipefail; npm test | tail -20', 'linux'), null);
  assert.equal(trap('git log | head -5', 'linux'), null);
  assert.equal(trap('npm test || tail log.txt', 'linux'), null);
  assert.equal(shellTrap('PowerShell', { command: 'npm test | Select-Object -Last 5' }, 'win32'), null);
});

test('what the traps rest on, measured in bash where it is installed', (t) => {
  // The script goes in on standard input: an argument would pass Windows' own quoting of backslashes first.
  const run = (script: string) => spawnSync('bash', ['-s'], { input: script, encoding: 'utf8' });
  if (run('true').status !== 0) return t.skip('bash is not installed');
  // An unquoted heredoc turns a doubled backslash into one; a quoted one keeps both.
  assert.equal(run('cat <<EOF\na\\\\b\nEOF').stdout, 'a\\b\n');
  assert.equal(run("cat <<'EOF'\na\\\\b\nEOF").stdout, 'a\\\\b\n');
  // A failure piped into a filter exits 0; with pipefail it does not.
  assert.equal(run('false | tail -1').status, 0);
  assert.notEqual(run('set -o pipefail; false | tail -1').status, 0);
});

test('a large file read whole is worth reading in part; a part, a small file or another tool is not', () => {
  assert.equal(wholeRead('Read', { file_path: 'a.ts' }, WHOLE_READ_CHARS), true);
  assert.equal(wholeRead('Read', { file_path: 'a.ts' }, WHOLE_READ_CHARS - 1), false);
  assert.equal(wholeRead('Read', { file_path: 'a.ts', offset: 1 }, WHOLE_READ_CHARS * 2), false);
  assert.equal(wholeRead('Read', { file_path: 'a.ts', limit: 50 }, WHOLE_READ_CHARS * 2), false);
  assert.equal(wholeRead('Grep', { pattern: 'x' }, WHOLE_READ_CHARS * 2), false);
});

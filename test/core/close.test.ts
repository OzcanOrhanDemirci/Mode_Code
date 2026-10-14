// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CLOSE_SHELLS, CLOSE_WAIT_S, closeTabArgv, closeTabOutcome, helperScript, starterScript } from '../../src/core/close.js';

const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');
/** The helper as the starter carries it, before the two processes are filled in. */
const carried = () => decode(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(starterScript())![1]!);

test('the starter runs as Windows PowerShell by its full path, encoded, with no profile and no questions', () => {
  const argv = closeTabArgv('C:\\WINDOWS\\');
  assert.deepEqual(argv.slice(0, 5), [
    'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ]);
  assert.equal(argv.length, 6);
  assert.equal(decode(argv[5]!), starterScript());
  assert.equal(closeTabArgv(undefined)[0], 'powershell.exe', 'no SystemRoot: the name');
  assert.equal(closeTabArgv('')[0], 'powershell.exe');
  // Windows takes a command line of at most 32767 characters.
  assert.ok(argv.join(' ').length < 30000, String(argv.join(' ').length));
});

test('the starter checks the shell by name and by console before it starts the helper hidden, and says one line', () => {
  const s = starterScript();
  for (const shell of CLOSE_SHELLS) assert.ok(s.includes(`'${shell}'`), shell);
  assert.match(s, /-notcontains \$name\) \{ "none \$name"; exit 0 \}/);
  assert.match(s, /'none console'/);
  assert.match(s, /'none gone'/);
  assert.match(s, /Start-Process -WindowStyle Hidden/);
  assert.match(s, /"armed \$name"/);
  assert.match(s, /catch \{ 'failed' \}/);
  // Its parent is Claude Code, Claude Code's parent the shell.
  assert.match(s, /ProcessId=\$PID[\s\S]*ProcessId=\$\(\$me\.ParentProcessId\)[\s\S]*ProcessId=\$\(\$claude\.ParentProcessId\)/);
  assert.equal(carried(), helperScript());
});

test('the helper waits for Claude Code to end, for a while, and types exit only into a shell still there', () => {
  const h = helperScript();
  assert.match(h, /\$claude = __CLAUDE__; \$shell = __SHELL__/);
  assert.match(h, new RegExp(`AddSeconds\\(${CLOSE_WAIT_S}\\)`));
  assert.equal(CLOSE_WAIT_S, 60);
  assert.match(h, /if \(Get-Process -Id \$claude -ErrorAction SilentlyContinue\) \{ exit \}/);
  assert.match(h, /if \(-not \(Get-Process -Id \$shell -ErrorAction SilentlyContinue\)\) \{ exit \}/);
  assert.match(h, /\[TcType\]::Type\(\[uint32\]\$shell, 'exit'\)/);
  // The typing is compiled before the wait, and the console is let go of right after it.
  assert.ok(h.indexOf('Add-Type') < h.indexOf('while'));
  assert.match(h, /WriteConsoleInputW\(h, recs, \(uint\)recs\.Length, out w\);\n {4}\}\n {4}FreeConsole\(\);/);
});

test("what the starter said: its last line's first word, anything else a failure", () => {
  assert.deepEqual(closeTabOutcome('armed pwsh.exe\r\n'), { tab: 'armed', detail: 'pwsh.exe' });
  assert.deepEqual(closeTabOutcome('WARNING: x\nnone console'), { tab: 'none', detail: 'console' });
  assert.deepEqual(closeTabOutcome('none windowsterminal.exe'), { tab: 'none', detail: 'windowsterminal.exe' });
  assert.deepEqual(closeTabOutcome('failed'), { tab: 'failed', detail: '' });
  assert.deepEqual(closeTabOutcome(''), { tab: 'failed', detail: '' });
  assert.deepEqual(closeTabOutcome('Add-Type : boom'), { tab: 'failed', detail: 'Add-Type : boom' });
  assert.deepEqual(closeTabOutcome('armedx'), { tab: 'failed', detail: 'armedx' });
  assert.equal(closeTabOutcome('x'.repeat(200)).detail.length, 80);
});

test('both scripts parse, and the typing and the console check compile, in Windows PowerShell itself', { skip: process.platform !== 'win32' }, () => {
  const helper = helperScript().replace('__CLAUDE__', '1').replace('__SHELL__', '2');
  const types = (s: string) => /Add-Type -TypeDefinition @'\n([\s\S]*?)\n'@/.exec(s)![1]!;
  const check = [
    "$ErrorActionPreference = 'Stop'",
    'foreach ($s in @($env:TC_STARTER, $env:TC_HELPER)) {',
    '  $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($s, [ref]$null, [ref]$errors)',
    '  if ($errors.Count) { "parse: $($errors[0].Message)"; exit 1 } }',
    'Add-Type -TypeDefinition $env:TC_TYPE1; Add-Type -TypeDefinition $env:TC_TYPE2',
    "if (-not ([TcType] -and [TcConsole])) { 'types'; exit 1 }",
    "'ok'",
  ].join('\n');
  const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', check], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, TC_STARTER: starterScript(), TC_HELPER: helper, TC_TYPE1: types(helperScript()), TC_TYPE2: types(starterScript()) },
  });
  assert.equal(r.stdout.trim(), 'ok', r.stderr);
});

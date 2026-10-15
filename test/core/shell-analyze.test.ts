// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCommand, decodeUtf16Base64, programName, psNamed } from '../../src/core/shell/analyze.js';
import { parsePowerShell } from '../../src/core/shell/powershell.js';
import { parseCmd } from '../../src/core/shell/cmd.js';
import type { Dialect } from '../../src/core/shell/types.js';

/** "program arg arg" per invocation, for compact assertions. */
function runs(command: string, dialect: Dialect = 'bash'): string[] {
  return analyzeCommand(command, dialect).invocations.map((i) => [i.program, ...i.args].join(' '));
}

test('program names drop directories and extensions', () => {
  assert.equal(programName('C:\\Program Files\\Git\\cmd\\git.EXE'), 'git');
  assert.equal(programName('/usr/bin/rm'), 'rm');
  assert.equal(programName('./build.sh'), 'build.sh');
});

test('wrappers are unwrapped to the command that runs', () => {
  assert.deepEqual(runs('sudo -u root git push --force'), ['git push --force']);
  assert.deepEqual(runs('env FOO=1 -u BAR git push'), ['git push']);
  assert.deepEqual(runs("env -S 'git push origin main'"), ['git push origin main']);
  assert.deepEqual(runs('nohup nice -n 5 timeout -s KILL 30s rm -rf build'), ['rm -rf build']);
  assert.deepEqual(runs('command git push'), ['git push']);
  assert.deepEqual(runs('command -v git'), []);
  assert.deepEqual(runs('time -p git status'), ['git status']);
  assert.deepEqual(runs('flock /tmp/lock git push'), ['git push']);
});

test('xargs runs its command with unknown trailing arguments', () => {
  const a = analyzeCommand('find . -name "*.tmp" | xargs rm -f', 'bash');
  assert.deepEqual(
    a.invocations.map((i) => i.program),
    ['find', 'rm'],
  );
  assert.ok(a.invocations[1]!.dynamic.at(-1));
  assert.ok(a.issues.includes('xargs-stdin-arguments'));
});

test('shell interpreters are re-entered', () => {
  assert.deepEqual(runs('bash -c "git push --force"'), ['bash -c git push --force', 'git push --force']);
  assert.deepEqual(runs("sh -lc 'rm -rf ~'").slice(1), ['rm -rf ~']);
  assert.deepEqual(runs('bash <<EOF\ngit push -f\nEOF').slice(1), ['git push -f']);
  assert.deepEqual(runs("bash <<< 'rm -rf /tmp/x'").slice(1), ['rm -rf /tmp/x']);
  assert.deepEqual(runs('eval "git push --force"').slice(1), ['git push --force']);
  const via = analyzeCommand('sudo bash -c "eval \'git push -f\'"', 'bash').invocations.find((i) => i.program === 'git');
  assert.deepEqual(via?.via, ['sudo', 'bash -c', 'eval']);
});

test('eval of a runtime value is flagged', () => {
  assert.ok(analyzeCommand('eval "$CMD"', 'bash').issues.includes('eval-dynamic'));
  assert.ok(analyzeCommand('$X -rf /', 'bash').issues.includes('dynamic-program'));
});

test('cmd /c and wsl are re-entered', () => {
  assert.deepEqual(runs('cmd /c "del /s /q C:\\temp & rd /s /q C:\\temp"').slice(1), ['del /s /q C:\\temp', 'rd /s /q C:\\temp']);
  assert.deepEqual(runs('cmd.exe /C git push --force').slice(1), ['git push --force']);
  assert.deepEqual(runs('wsl -e rm -rf /mnt/c/Users/x'), ['wsl -e rm -rf /mnt/c/Users/x', 'rm -rf /mnt/c/Users/x']);
});

test('PowerShell: statements, pipelines, call operator, aliases', () => {
  assert.deepEqual(runs('Get-ChildItem | Remove-Item -Recurse -Force; rm -r C:\\x', 'powershell'), [
    'get-childitem',
    'remove-item -Recurse -Force',
    'remove-item -r C:\\x',
  ]);
  assert.deepEqual(runs("& 'C:\\Program Files\\Git\\cmd\\git.exe' push --force", 'powershell'), ['git push --force']);
  assert.deepEqual(runs('& $tool --version', 'powershell'), ['$tool --version']);
  assert.deepEqual(runs('$r = git push origin main', 'powershell'), ['git push origin main']);
  assert.deepEqual(runs("'just a string'; 42; $x", 'powershell'), []);
});

test('PowerShell: quotes, backticks and typographic characters decode', () => {
  assert.deepEqual(runs("g`it push 'or''igin' \u2013Force", 'powershell'), ["git push or'igin -Force"]);
  assert.deepEqual(runs('Remove-Item \u201CC:\\x\u201D', 'powershell'), ['remove-item C:\\x']);
  assert.deepEqual(runs('Write-Output "a$(git push -f)b"', 'powershell'), ['write-output a$(…)b', 'git push -f']);
});

test('PowerShell: script blocks, subexpressions and here-strings', () => {
  assert.deepEqual(runs('Get-Item x | ForEach-Object { Remove-Item $_ -Recurse }', 'powershell'), [
    'get-item x',
    'foreach-object {…}',
    'remove-item $_ -Recurse',
  ]);
  assert.deepEqual(runs('(Get-ChildItem).Count', 'powershell'), ['get-childitem']);
  const h = parsePowerShell("$s = @'\nrm -rf /\n'@\nWrite-Output done");
  assert.deepEqual(
    h.commands.map((c) => c.argv.map((w) => w.text)),
    [['Write-Output', 'done']],
  );
});

test('PowerShell: .NET calls become pseudo-commands', () => {
  const r = runs("[System.IO.Directory]::Delete('C:\\Users\\ada\\.claude', $true)", 'powershell');
  assert.deepEqual(r, ['[system.io.directory]::delete C:\\Users\\ada\\.claude $true']);
});

test('PowerShell CLI: -Command and -EncodedCommand are re-entered', () => {
  assert.deepEqual(runs('pwsh -NoProfile -Command "Remove-Item -Recurse C:\\x"').slice(1), ['remove-item -Recurse C:\\x']);
  const b64 = Buffer.from('git push --force', 'utf16le').toString('base64');
  assert.equal(decodeUtf16Base64(b64), 'git push --force');
  assert.deepEqual(runs(`powershell.exe -ep Bypass -enc ${b64}`).slice(1), ['git push --force']);
  assert.ok(analyzeCommand('pwsh -EncodedCommand ###', 'bash').issues.includes('encoded-command-undecodable'));
});

test('PowerShell: Invoke-Expression and Start-Process', () => {
  assert.deepEqual(runs("iex 'git push --force'", 'powershell').slice(1), ['git push --force']);
  assert.ok(analyzeCommand('Invoke-Expression $code', 'powershell').issues.includes('eval-dynamic'));
  assert.deepEqual(runs("Start-Process -FilePath git -ArgumentList 'push','--force'", 'powershell').slice(1), ['git push --force']);
});

test('psNamed resolves unambiguous prefixes and positional parameters', () => {
  const w = (t: string) => ({ text: t, dynamic: false, glob: false });
  const r = psNamed([w('-Rec'), w('-Fo'), w('C:\\x')], { path: 'Path', recurse: 'Recurse', force: 'Force' }, ['path']);
  assert.equal(r.path?.text, 'C:\\x');
});

test('cmd parser: carets, quotes, separators and redirects', () => {
  const s = parseCmd('del /s /q "C:\\my dir" && e^cho x > out.txt');
  assert.deepEqual(
    s.commands.map((c) => c.argv.map((w) => w.text)),
    [
      ['del', '/s', '/q', 'C:\\my dir'],
      ['echo', 'x'],
    ],
  );
  assert.equal(s.commands[1]!.redirects[0]!.target!.text, 'out.txt');
});

test('inline interpreter code is attached, not parsed as shell', () => {
  const inv = analyzeCommand(`node -e "require('fs').rmSync('x',{recursive:true})"`, 'bash').invocations[0]!;
  assert.equal(inv.program, 'node');
  assert.match(inv.inlineCode ?? '', /rmSync/);
});

test('redirect-only commands still count as writes', () => {
  const inv = analyzeCommand('> ~/.bashrc', 'bash').invocations[0]!;
  assert.deepEqual(inv.writes, ['~/.bashrc']);
});

test('package runners run the program of the package they name', () => {
  const programs = (c: string) => analyzeCommand(c, 'bash').invocations.map((i) => `${i.program} ${i.args.join(' ')}`.trim());
  assert.deepEqual(programs('npx --yes prettier --check .'), ['prettier --check .']);
  assert.deepEqual(programs('npx rimraf@5 dist'), ['rimraf dist']);
  assert.deepEqual(programs('npx -p typescript tsc --noEmit'), ['tsc --noEmit']);
  assert.deepEqual(programs('pnpm dlx @scope/tool@1.2 x'), ['tool x']);
  assert.deepEqual(programs('bunx eslint .'), ['eslint .']);
  assert.deepEqual(programs('bun x tsc'), ['tsc']);
  assert.deepEqual(programs('yarn dlx create-app y'), ['create-app y']);
  assert.deepEqual(programs('npx -c "rm -rf x"'), ['rm -rf x']);
  // Not runners: their own commands stay as they are.
  assert.deepEqual(programs('pnpm install'), ['pnpm install']);
  assert.deepEqual(programs('bun run build'), ['bun run build']);
  assert.deepEqual(programs('yarn test'), ['yarn test']);
  assert.deepEqual(programs('npx'), ['npx']);
});

test('package runners run the program they name in PowerShell too; bash wrappers stay bash', () => {
  const programs = (c: string) => analyzeCommand(c, 'powershell').invocations.map((i) => `${i.program} ${i.args.join(' ')}`.trim());
  assert.deepEqual(programs('npx rimraf C:/Users/ada'), ['rimraf C:/Users/ada']);
  assert.deepEqual(programs('pnpm dlx rimraf dist'), ['rimraf dist']);
  assert.deepEqual(programs('bunx eslint .'), ['eslint .']);
  assert.deepEqual(programs('pnpm install'), ['pnpm install']);
  // PowerShell has no sudo or env: those names are programs of their own there.
  assert.deepEqual(programs('sudo rm x'), ['sudo rm x']);
});

test('names every JavaScript object has are ordinary words to the parsers and the belt', async () => {
  const { evaluateToolCall } = await import('../../src/core/belt/evaluate.js');
  const { winCtx } = await import('../helpers/belt.js');
  for (const w of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    for (const d of ['bash', 'powershell'] as const) assert.deepEqual(runs(`${w} x`, d), [`${w.toLowerCase()} x`]);
    for (const cmd of [`${w} x`, `echo $${w}`, `rm -rf $${w}/x`, `echo %${w}%`])
      assert.ok(['allow', 'ask', 'warn', 'deny'].includes((await evaluateToolCall('Bash', { command: cmd }, winCtx())).verdict), cmd);
  }
});

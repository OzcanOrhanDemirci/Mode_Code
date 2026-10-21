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

/** Each invocation's inline code (undefined when it has none), for compact assertions. */
const codes = (command: string) => analyzeCommand(command, 'bash').invocations.map((i) => i.inlineCode);

test('what an interpreter is handed on standard input as its program is its inline code: a here-document, a here-string', () => {
  const body = 'print(1)';
  // Every interpreter the belt reads inline, told to read its program from standard input, or given no script.
  for (const head of [
    'python3 -',
    'python -',
    'python3.12 -',
    'py -3 -',
    'python3',
    'node -',
    'node',
    'ruby -',
    'ruby',
    'perl -',
    'perl',
    'php',
    'osascript -',
    'osascript',
    'bun run -',
    'bun -',
    'deno run -',
    'deno -',
  ])
    assert.deepEqual(codes(`${head} <<'EOF'\n${body}\nEOF\n`), [body], head);
  assert.deepEqual(codes(`python3 - <<< 'print(2)'`), ['print(2)'], 'a here-string');
  assert.deepEqual(codes('node <<< "console.log(2)"'), ['console.log(2)']);
  // Options come first, and standard input may be named by its file.
  for (const head of [
    'python3 -u -',
    'python3 -W ignore -',
    'python3 -I -',
    'python3 -E',
    'python3 -E -',
    'python3 -B -X utf8',
    'node --input-type=module -',
    'node -r ./a.js -',
    'perl -w -',
    'ruby -w',
    'python3 /dev/stdin',
    'node /dev/stdin',
    'deno run --allow-all -',
  ])
    assert.deepEqual(codes(`${head} <<'EOF'\n${body}\nEOF\n`), [body], head);
  // Through the wrappers, the paths and the versions the program goes by.
  for (const head of [
    'sudo python3 -',
    'sudo -u ada python3 -',
    'env A=1 python3 -',
    'nohup python3 -',
    'time python3 -',
    'timeout 5 python3 -',
    '/usr/bin/python3 -',
    'C:/Python/python.exe -',
  ])
    assert.deepEqual(codes(`${head} <<'EOF'\n${body}\nEOF\n`), [body], head);
});

test('a here-document that is data, or code an option carries, is not the interpreter’s program', () => {
  const doc = "<<'EOF'\nprint(1)\nEOF\n";
  for (const command of [
    `python3 check.py ${doc}`,
    `python3 -m json.tool ${doc}`,
    `python3 -mjson.tool ${doc}`,
    `node check.js ${doc}`,
    `node --require ./a.js check.js ${doc}`,
    `ruby run.rb ${doc}`,
    `perl check.pl ${doc}`,
    `bun ${doc}`,
    `bun run run - ${doc}`,
    `python3 run ${doc}`,
    `bun run build ${doc}`,
    `bun test ${doc}`,
    `deno ${doc}`,
    `deno test ${doc}`,
    `php artisan x ${doc}`,
    `cat ${doc}`,
    `tee out.txt ${doc}`,
    `git commit -F - ${doc}`,
    `curl -d @- https://example.com ${doc}`,
    `psql ${doc}`,
    `sort ${doc}`,
    `grep x ${doc}`,
  ])
    assert.deepEqual(codes(command), [undefined], command);
  // Inline code is the program, and a here-document beside it is its input.
  assert.deepEqual(codes(`python3 -c 'print(2)' ${doc}`), ['print(2)']);
  assert.deepEqual(codes(`node -e 'x' ${doc}`), ['x']);
  assert.deepEqual(codes(`ruby -e 'x' -`), ['x'], 'a dash beside inline code is an argument of it');
  // A here-document of another command in a pipeline or a list stays that command's.
  assert.deepEqual(codes(`cat <<'EOF' | python3 check.py\nx\nEOF\n`), [undefined, undefined]);
  assert.deepEqual(codes(`cat <<'EOF' && python3 - <<'PY'\nx\nEOF\nprint(3)\nPY\n`), [undefined, 'print(3)']);
});

test('the code is what the interpreter receives: an unquoted delimiter lets the shell take backslashes off, a quoted one does not', () => {
  assert.deepEqual(codes("python3 - <<'EOF'\nprint('\\\\$HOME \\n')\nEOF"), ["print('\\\\$HOME \\n')"]);
  assert.deepEqual(codes('python3 - <<EOF\nprint("\\\\ \\$HOME \\` \\n")\nEOF'), ['print("\\ $HOME ` \\n")']);
  assert.deepEqual(codes('python3 - <<EOF\nx = 1 + \\\n2\nEOF'), ['x = 1 + 2'], 'a backslash at a line end joins the lines');
  assert.deepEqual(codes('python3 - <<"EOF"\nx = 1 + \\\n2\nEOF'), ['x = 1 + \\\n2'], 'a quoted delimiter of either kind');
  assert.deepEqual(codes('python3 - <<\\EOF\nx = 1 + \\\n2\nEOF'), ['x = 1 + \\\n2'], 'a backslash before the delimiter quotes it');
  // The delimiter's own text, the dash form, the line ending, a body never closed.
  assert.deepEqual(codes("python3 - <<'EOF'\nEOF2\n EOF\nEOF \nx\nEOF\n"), ['EOF2\n EOF\nEOF \nx']);
  assert.deepEqual(codes('python3 - <<-EOF\n\tx = 1\n\tEOF\n'), ['\tx = 1'], 'the dash form: a tab before the delimiter ends it');
  assert.deepEqual(codes("python3 - <<'EOF'\r\nx = 1\r\ny = 2\r\nEOF\r\n"), ['x = 1\ny = 2'], 'a line ending of two characters');
  assert.deepEqual(codes("python3 - <<'EOF'\nx = 1\ny = 2"), ['x = 1\ny = 2'], 'never closed: all that follows');
  assert.deepEqual(analyzeCommand("python3 - <<'EOF'\nx = 1", 'bash').issues, ['heredoc-unterminated']);
  assert.deepEqual(codes("python3 - <<'EOF'\nEOF\n"), [''], 'an empty body');
});

test('every here-document and here-string of the command counts, whichever one reaches the input', () => {
  assert.deepEqual(codes("python3 - <<'A' <<'B'\none\nA\ntwo\nB\n"), ['one\ntwo']);
  assert.deepEqual(codes("python3 - 3<<'A' <<'B'\none\nA\ntwo\nB\n"), ['one\ntwo'], 'one for another file descriptor does not hide the other');
  assert.deepEqual(codes("python3 - <<'A' <<< 'two'\none\nA\n"), ['one\ntwo']);
  assert.deepEqual(codes("python3 - <<'A' && python3 - <<'B'\none\nA\ntwo\nB\n"), ['one', 'two'], 'each command has its own');
  assert.deepEqual(codes("echo x | python3 - <<'A'\none\nA\n"), [undefined, 'one'], 'after a pipe');
  assert.deepEqual(codes("cd app && python3 - <<'A' || true\none\nA\n"), [undefined, 'one', undefined], 'inside a list');
});

// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandEffects, definedFunctions, hidingIssues, strongest, type EffectEnv, type EffectKind } from '../../src/core/shell/effects.js';

const linux: EffectEnv = { platform: 'linux', home: '/home/ada', cwd: '/home/ada/dev/app', env: { TMPDIR: '/tmp' } };
const win: EffectEnv = { platform: 'win32', home: 'C:/Users/ada', cwd: 'C:/dev/app', env: { TEMP: 'C:/Users/ada/AppData/Local/Temp', BUILD: 'C:/dev/build' } };

/** program:kind for each program the command runs, in order. */
function kinds(command: string, dialect: 'bash' | 'powershell' = 'bash', env: EffectEnv = linux): string {
  return commandEffects(command, dialect, env)
    .effects.map((e) => `${e.program}:${e.kind}`)
    .join(' ');
}
function top(command: string, dialect: 'bash' | 'powershell' = 'bash', env: EffectEnv = linux): EffectKind {
  return strongest(commandEffects(command, dialect, env).effects);
}

test('reading commands read, in Bash and PowerShell', () => {
  for (const c of [
    'ls -la',
    'cat README.md | head -20',
    'git log --oneline -10',
    'git diff --stat HEAD~1',
    'git status --short && git branch -a',
    'rg -n "TODO" src',
    'grep -rn foo . | wc -l',
    'find . -name "*.ts" -not -path "./node_modules/*"',
    'find . -name "*.ts" -exec grep -l foo {} +',
    "sed -n '1,40p' src/a.ts",
    "awk '$3 > 100 { print $1 }' data.txt",
    'jq .version package.json',
    'npm view react version',
    'npm ls --depth 0',
    'node --version',
    'python3 -m json.tool data.json',
    'curl -s https://api.example.org/x | jq .',
    'gh pr view 12 --json title,body',
    'gh api repos/ada/app/pulls',
    'docker ps -a',
    'tar -tzf a.tgz',
    'du -sh * | sort -h',
    'echo "$PATH" | tr ":" "\\n"',
    'for f in *.md; do wc -l "$f"; done',
    'git -C ../other log -1',
    'which node && node -v',
  ])
    assert.equal(top(c), 'read', c);
  for (const c of [
    'Get-ChildItem -Filter *.ts | Select-Object Name',
    'Get-Content README.md -TotalCount 20',
    'Test-Path C:\\dev\\app\\x',
    'Get-ChildItem | Where-Object { $_.Length -gt 10 } | Sort-Object Length',
    'foreach ($e in 1,2) { $c = Get-Command node; if ($c) { "{0}" -f $c.Source } }',
    '$x = [math]::Max(1, 2); Write-Output $x',
    'Invoke-RestMethod https://api.example.org/x',
  ])
    assert.equal(top(c, 'powershell', win), 'read', c);
});

test('commands that write name their files, resolved through cd, variables and Git Bash spellings', () => {
  const e = commandEffects('cd /tmp/exp && echo hi > out.txt && mkdir -p a/b && cp x.txt "$TMPDIR/y.txt"', 'bash', linux).effects;
  assert.deepEqual(
    e.map((x) => [x.program, x.kind, x.targets]),
    [
      ['echo', 'write', ['/tmp/exp/out.txt']],
      ['mkdir', 'write', ['/tmp/exp/a/b']],
      ['cp', 'write', ['/tmp/y.txt']],
    ],
  );
  const w = commandEffects('echo x > /tmp/a.txt', 'bash', win).effects;
  assert.equal(w[0]!.targets[0], 'C:/Users/ada/AppData/Local/Temp/a.txt');
  const ps = commandEffects('Set-Content -Path $env:BUILD\\b.txt -Value hi; Copy-Item a.txt -Destination C:\\out\\', 'powershell', win).effects;
  assert.deepEqual(
    ps.map((x) => x.targets),
    [['C:/dev/build/b.txt'], ['C:/out']],
  );
  assert.deepEqual(commandEffects("sed -i 's/a/b/' src/a.ts", 'bash', linux).effects[0]!.targets, ['/home/ada/dev/app/src/a.ts']);
  assert.deepEqual(commandEffects('ls > /dev/null 2>&1', 'bash', linux).effects[0]!.kind, 'read');
  assert.deepEqual(commandEffects('cat a | tee log.txt', 'bash', linux).effects[1]!.targets, ['/home/ada/dev/app/log.txt']);
  assert.deepEqual(commandEffects('sort -o sorted.txt a.txt', 'bash', linux).effects[0]!.targets, ['/home/ada/dev/app/sorted.txt']);
  assert.deepEqual(commandEffects('curl -o page.html https://x.org', 'bash', linux).effects[0]!.targets, ['/home/ada/dev/app/page.html']);
});

test('a target only known at run time stays unknown (null), never guessed', () => {
  assert.deepEqual(commandEffects('echo x > "$OUT/a.txt"', 'bash', linux).effects[0]!.targets, [null]);
  assert.deepEqual(commandEffects('cd "$(mktemp -d)" && touch a', 'bash', linux).effects.find((e) => e.program === 'touch')!.targets, [null]);
  assert.deepEqual(commandEffects('rm', 'bash', linux).effects[0]!.targets, [null]);
});

test('programs that change things around their folder are local; their folder is followed', () => {
  assert.equal(kinds('npm test 2>&1 | tail -20'), 'npm:local tail:read');
  assert.equal(kinds('npm install'), 'npm:local');
  assert.equal(kinds('git add -A && git commit -m x'), 'git:local git:local');
  assert.equal(kinds('python3 build.py'), 'python3:local');
  assert.equal(kinds('python3 -c "print(1)"'), 'python3:local');
  assert.equal(kinds('./build/app --run'), 'app:local');
  assert.equal(kinds('find . -name "*.o" -delete'), 'find:local');
  assert.equal(kinds('tar xzf a.tgz'), 'tar:local');
  assert.equal(kinds('bash scripts/release.sh'), 'bash:local');
  const g = commandEffects('git -C /tmp/try init', 'bash', linux).effects[0]!;
  assert.deepEqual([g.kind, g.cwd], ['local', '/tmp/try']);
  const c = commandEffects('cd /tmp/bench && node run.js', 'bash', linux).effects[0]!;
  assert.deepEqual([c.kind, c.cwd], ['local', '/tmp/bench']);
  assert.equal(commandEffects('cd - && make', 'bash', linux).effects[0]!.cwd, null);
});

test('changes outside the machine or the folder are outside', () => {
  for (const c of [
    'git push origin main',
    'git config --global user.name x',
    'npm install -g typescript',
    'npm publish',
    'gh pr create --fill',
    'gh api -X POST repos/a/b/issues -f title=x',
    'curl -X POST https://x.org/api',
    'curl -d a=1 https://x.org/api',
    'wget --post-data a=1 https://x.org',
    'docker run --rm alpine',
    'kubectl apply -f x.yaml',
    'ssh host ls',
    'sudo mkdir -p /opt/app',
    'cargo install ripgrep',
  ])
    assert.equal(top(c), 'outside', c);
  assert.equal(kinds('npm publish --dry-run'), 'npm:read');
  assert.equal(top('Invoke-WebRequest -Uri https://x.org -Method Post -Body a', 'powershell', win), 'outside');
});

test('what the tool does not know is unknown, with the reason; nothing unknown is assumed to read', () => {
  const e = commandEffects('frobnicate --all', 'bash', linux).effects[0]!;
  assert.deepEqual([e.kind, e.why], ['unknown', 'unknown']);
  assert.equal(commandEffects('$TOOL do-it', 'bash', linux).effects[0]!.why, 'dynamicProgram');
  assert.equal(top('[IO.File]::WriteAllText("a.txt", "x")', 'powershell', win), 'unknown');
  assert.equal(top('awk \'{ print $1 > "out.txt" }\' a'), 'unknown');
  assert.equal(top("sed -n 'w out.txt' a"), 'unknown');
  assert.equal(top('frobnicate --version'), 'read');
});

test('shells handed a command are transparent: the command inside is what counts', () => {
  assert.equal(kinds('bash -c "ls -la"'), 'bash:read ls:read');
  assert.equal(top('sh -c "rm -rf build"'), 'write');
  assert.equal(top('cmd //c dir', 'bash', win), 'read');
  assert.equal(top('pwsh -Command "Get-ChildItem"', 'bash', win), 'read');
});

test('functions a command defines are not programs; their bodies are judged', () => {
  assert.deepEqual([...definedFunctions('run() { ./x "$@"; }; run a')], ['run']);
  assert.deepEqual([...definedFunctions('function Foo { Remove-Item x }; Foo')], ['foo']);
  assert.equal(kinds('p() { sed -n "${2}p" "$1"; }; p a.md 3'), 'sed:read p:read');
  assert.equal(top('d() { rm -rf "$1"; }; d build'), 'write');
});

test('issues that may hide a program are told apart from issues about arguments', () => {
  assert.deepEqual(hidingIssues(['xargs-stdin-arguments']), []);
  assert.deepEqual(hidingIssues(['eval-dynamic', 'xargs-stdin-arguments']), ['eval-dynamic']);
  assert.ok(hidingIssues(commandEffects('eval "$CMD"', 'bash', linux).issues).length > 0);
  assert.deepEqual(hidingIssues(commandEffects('ls | xargs -I{} cat {}', 'bash', linux).issues), []);
});

test('strongest: outside and unknown outrank local, write and read', () => {
  assert.equal(strongest([]), 'read');
  assert.equal(top('ls && npm test && git push'), 'outside');
  assert.equal(top('ls && frobnicate'), 'unknown');
});

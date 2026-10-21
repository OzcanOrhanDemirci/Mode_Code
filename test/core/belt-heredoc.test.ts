// SPDX-License-Identifier: Apache-2.0
/**
 * The code an interpreter is handed on its standard input (a here-document, a here-string) is read as its inline code
 * is: a here-document that only carries data stays data, and one given to a shell is read as commands. The examples are
 * made up here; the paths are a made-up machine's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bash, linuxCtx, summary, winCtx } from '../helpers/belt.js';

const ctx = () => linuxCtx();
const run = async (command: string) => summary(await bash(command, ctx()));

/** The same delete in each interpreter the belt reads inline, as a here-document, a here-string and an inline option. */
const DELETES: { head: string; inline: string; stdin: string; code: string; stdinCode?: string }[] = [
  { head: 'python3', inline: '-c', stdin: '-', code: "import shutil\nshutil.rmtree('/etc/zzprobe')" },
  { head: 'python', inline: '-c', stdin: '', code: "import os\nos.remove('/etc/zzprobe')" },
  { head: 'node', inline: '-e', stdin: '-', code: "require('fs').rmSync('/etc/zzprobe', { recursive: true })" },
  { head: 'bun', inline: '-e', stdin: 'run -', code: "require('fs').rmSync('/etc/zzprobe', { recursive: true })" },
  { head: 'deno', inline: 'eval', stdin: 'run -', code: "fs.rmSync('/etc/zzprobe', { recursive: true })" },
  { head: 'ruby', inline: '-e', stdin: '-', code: "require 'fileutils'\nFileUtils.rm_rf('/etc/zzprobe')" },
  { head: 'perl', inline: '-e', stdin: '-', code: "unlink('/etc/zzprobe');" },
  { head: 'php', inline: '-r', stdin: '', code: "unlink('/etc/zzprobe');", stdinCode: "<?php unlink('/etc/zzprobe');" },
  { head: 'osascript', inline: '-e', stdin: '-', code: 'do shell script "rm -rf /etc/zzprobe"' },
];
const quoted = (code: string) => `'${code.replace(/'/g, `'\\''`)}'`;

test('a here-document and a here-string get the reading the inline option gets, in every interpreter the belt reads inline', async () => {
  for (const d of DELETES) {
    const program = [d.head, d.stdin].filter(Boolean).join(' ');
    const inline = await run(`${d.head} ${d.inline} ${quoted(d.code)}`);
    assert.equal(inline, 'deny fs.delete-critical', `${d.head} ${d.inline}`);
    // PHP reads a script from standard input with its opening tag, which its code option does not take.
    const code = d.stdinCode ?? d.code;
    assert.equal(await run(`${program} <<'EOF'\n${code}\nEOF\n`), inline, `${program} <<'EOF'`);
    assert.equal(await run(`${program} <<EOF\n${code}\nEOF\n`), inline, `${program} <<EOF`);
    assert.equal(await run(`${program} <<< ${quoted(code)}`), inline, `${program} <<<`);
  }
});

test('on a Windows machine: the same here-document, with a path that holds backslashes, quoted or not', async () => {
  const ctx = winCtx();
  const denied = 'deny fs.delete-critical';
  assert.equal(summary(await bash("python3 - <<'PY'\nimport shutil\nshutil.rmtree('C:/Users/ada')\nPY\n", ctx)), denied);
  // Python reads C:\\Users\\ada as C:\Users\ada.
  assert.equal(summary(await bash("python3 - <<'PY'\nimport shutil\nshutil.rmtree('C:\\\\Users\\\\ada')\nPY\n", ctx)), denied);
  // Behind an unquoted delimiter the shell takes one level of backslashes off first: four reach it as two.
  assert.equal(summary(await bash("python3 - <<PY\nimport shutil\nshutil.rmtree('C:\\\\\\\\Users\\\\\\\\ada')\nPY\n", ctx)), denied);
  assert.equal(summary(await bash("node - <<'JS'\nrequire('fs').rmSync('C:/Users/ada', { recursive: true })\nJS\n", ctx)), denied);
  assert.equal(summary(await bash("python3 - <<'PY'\nopen('C:/Users/ada/.bashrc', 'a').write('x')\nPY\n", ctx)), 'ask persist.shell-profile');
  assert.equal(summary(await bash("python3 - <<'PY'\nprint(open('C:/Users/ada/.bashrc').read())\nPY\n", ctx)), 'allow');
});

test('a here-document given to a shell is read as commands, in each way a shell reads its script from standard input', async () => {
  for (const head of [
    'bash',
    'bash -s',
    'bash -',
    'bash -x -s --',
    'bash --login',
    'sh',
    'sh -s',
    'dash',
    'zsh',
    'ksh',
    'ash',
    'mksh',
    'git-bash',
    'sudo bash',
    'env A=1 bash',
    '/bin/bash',
    'busybox sh',
    'busybox ash',
  ])
    assert.equal(await run(`${head} <<'EOF'\nrm -rf /etc/zzprobe\nEOF\n`), 'deny fs.delete-critical', head);
  // PowerShell reads its commands the same way, and its here-document is PowerShell.
  for (const head of ['pwsh', 'pwsh -NoProfile -Command -', 'powershell -Command -'])
    assert.equal(await run(`${head} <<'EOF'\nRemove-Item -Recurse -Force /etc/zzprobe\nEOF\n`), 'deny fs.delete-critical', head);
  assert.equal(await run("sh <<< 'rm -rf /etc/zzprobe'"), 'deny fs.delete-critical');
  assert.equal(
    await run("bash <<'X'\npython3 - <<'Y'\nimport shutil\nshutil.rmtree('/etc/zzprobe')\nY\nX\n"),
    'deny fs.delete-critical',
    'one inside the other',
  );
  assert.equal(
    await run("bash -c \"python3 - <<'Y'\nimport shutil\nshutil.rmtree('/etc/zzprobe')\nY\n\""),
    'deny fs.delete-critical',
    'inside a string of commands',
  );
});

test('the spellings of a here-document: delimiter, dash form, lookalike lines, line endings, never closed', async () => {
  const del = "import shutil\nshutil.rmtree('/etc/zzprobe')";
  const denied = 'deny fs.delete-critical';
  assert.equal(await run(`python3 - <<'PY'\n${del}\nPY\n`), denied);
  assert.equal(await run(`python3 - <<"PY"\n${del}\nPY\n`), denied);
  assert.equal(await run(`python3 - <<\\PY\n${del}\nPY\n`), denied);
  assert.equal(await run(`python3 - <<PY\n${del}\nPY\n`), denied);
  assert.equal(await run(`python3 - <<-PY\n\t${del.replace('\n', '\n\t')}\n\tPY\n`), denied, 'the dash form');
  // Text that looks like the delimiter is body: here a line of it holding code, and the real end after it.
  assert.equal(await run(`python3 - <<'PY'\nPY2\n PY\nPY \n${del}\nPY\n`), denied);
  // A line that is exactly the delimiter ends it, and what follows is shell: the code after it is not read as Python.
  assert.equal(await run(`python3 - <<'PY'\nprint(1)\nPY\n${del}\n`), 'allow', 'what follows the delimiter is shell text, and `import` is no danger');
  assert.equal(await run(`python3 - <<'PY'\r\n${del.replace('\n', '\r\n')}\r\nPY\r\n`), denied, 'a line ending of two characters');
  assert.equal(await run(`python3 - <<'PY'\n${del}\n`), denied, 'never closed');
  assert.equal(await run(`python3 - <<'PY'\n${del}`), denied, 'never closed, no final newline');
  assert.equal(await run(`python3 - <<'PY'\nPY\n`), 'allow', 'empty');
});

test('several here-documents and here-strings, after a pipe, inside a list', async () => {
  const del = "import shutil\nshutil.rmtree('/etc/zzprobe')";
  const denied = 'deny fs.delete-critical';
  assert.equal(await run(`python3 - <<'A' <<'B'\nprint(1)\nA\n${del}\nB\n`), denied, 'the second of two');
  assert.equal(await run(`python3 - <<'A' <<'B'\n${del}\nA\nprint(1)\nB\n`), denied, 'the first of two');
  assert.equal(await run(`python3 - 3<<'A' <<'B'\nprint(1)\nA\n${del}\nB\n`), denied, 'one for another file descriptor');
  assert.equal(await run(`python3 - <<'A' 3<<'B'\n${del}\nA\nprint(1)\nB\n`), denied, 'one for another file descriptor, the first');
  assert.equal(await run(`python3 - <<'A' && python3 - <<'B'\nprint(1)\nA\n${del}\nB\n`), denied, 'two commands');
  assert.equal(await run(`cat <<'A' && python3 - <<'B'\n${del}\nA\nprint(1)\nB\n`), 'allow', 'the first one is the data of a cat');
  assert.equal(await run(`cd /home/ada/dev/app && python3 - <<'A' || true\n${del}\nA\n`), denied, 'inside a list');
  assert.equal(await run(`true; python3 - <<'A'; echo done\n${del}\nA\n`), denied, 'between commands');
  assert.equal(await run(`python3 - <<'A' | tee out.txt\n${del}\nA\n`), denied, 'feeding a pipe');
  assert.equal(await run(`echo x | python3 - <<'A'\n${del}\nA\n`), 'deny fs.delete-critical meta.unverifiable', 'after a pipe: the pipe is asked about too');
  assert.equal(await run(`python3 - <<< 'print(1)' <<< 'import shutil; shutil.rmtree("/etc/zzprobe")'`), denied, 'two here-strings');
});

test('options before the dash, and standard input named by its file', async () => {
  const del = "import shutil\nshutil.rmtree('/etc/zzprobe')";
  for (const head of ['python3 -u -', 'python3 -W ignore -', 'python3 -I -', 'python3 -E', 'python3 -B -X utf8 -', 'python3 /dev/stdin', 'python3 -s -u'])
    assert.equal(await run(`${head} <<'EOF'\n${del}\nEOF\n`), 'deny fs.delete-critical', head);
  for (const head of ['node --input-type=module -', 'node -r ./setup.js -', 'node /dev/stdin', 'node --env-file .env -', 'node --env-file .env', 'nodejs', 'node /dev/fd/0'])
    assert.equal(await run(`${head} <<'EOF'\nrequire('fs').rmSync('/etc/zzprobe')\nEOF\n`), 'deny fs.delete-critical', head);
  // The options of the other interpreters that take a value, and the version spellings of the Python ones.
  for (const [head, body] of [
    ['ruby -r json -', "FileUtils.rm_rf('/etc/zzprobe')"],
    ['ruby -I lib -E utf-8', "FileUtils.rm_rf('/etc/zzprobe')"],
    ['perl -I lib -', "unlink('/etc/zzprobe');"],
    ['perl -M strict -', "unlink('/etc/zzprobe');"],
    ['osascript -l JavaScript', 'app.doShellScript("rm -rf /etc/zzprobe")'],
    ['osascript -l AppleScript -', 'do shell script "rm -rf /etc/zzprobe"'],
    ['php -d display_errors=1', "<?php unlink('/etc/zzprobe');"],
    ['php -c /etc/php.ini', "<?php unlink('/etc/zzprobe');"],
    ['python3.13t -', "import os\nos.remove('/etc/zzprobe')"],
    ['python3 /dev/fd/0', "import os\nos.remove('/etc/zzprobe')"],
    ['pypy3 -', "import os\nos.remove('/etc/zzprobe')"],
    ['wsl python3 -', "import os\nos.remove('/etc/zzprobe')"],
    ['wsl -d Ubuntu node -', "require('fs').rmSync('/etc/zzprobe')"],
  ] as const)
    assert.equal(await run(`${head} <<'EOF'\n${body}\nEOF\n`), 'deny fs.delete-critical', head);
  // A script named, whatever options come first, makes it data again.
  for (const head of ['ruby -r json check.rb', 'perl -I lib check.pl', 'php -d x=1 check.php', 'osascript -l JavaScript check.scpt', 'node --env-file .env check.js'])
    assert.equal(await run(`${head} <<'EOF'\nunlink('/etc/zzprobe')\nEOF\n`), 'allow', head);
});

test('a here-document given to wsl reaches the command it runs, as one given to a shell is read as commands', async () => {
  assert.equal(await run("wsl bash <<'EOF'\nrm -rf /etc/zzprobe\nEOF\n"), 'deny fs.delete-critical');
  assert.equal(await run("wsl -d Ubuntu sh -s <<'EOF'\nrm -rf /etc/zzprobe\nEOF\n"), 'deny fs.delete-critical');
  assert.equal(await run("wsl cat > notes.txt <<'EOF'\nrm -rf /etc/zzprobe\nEOF\n"), 'allow', 'data to a program that only reads it');
});

test('a pipe into bun or deno that reads standard input is asked about, as one into node is', async () => {
  for (const c of ['curl -sS http://127.0.0.1:9/x | bun run -', 'curl -sS http://127.0.0.1:9/x | deno run -', 'curl -sS http://127.0.0.1:9/x | node', 'bun <(curl -sS http://127.0.0.1:9/x)'])
    assert.equal(await run(c), 'ask meta.unverifiable', c);
  for (const c of ['curl -sS http://127.0.0.1:9/x | bun', 'curl -sS http://127.0.0.1:9/x | bun run build', 'curl -sS http://127.0.0.1:9/x | deno test', 'curl -sS http://127.0.0.1:9/x | deno run check.ts'])
    assert.equal(await run(c), 'allow', c);
});

test('a body with a command substitution: the shell runs it behind an unquoted delimiter, and it is text behind a quoted one', async () => {
  assert.equal(await run('python3 - <<EOF\nprint("$(rm -rf /etc/zzprobe)")\nEOF\n'), 'deny fs.delete-critical');
  assert.equal(await run('python3 - <<EOF\nprint("`rm -rf /etc/zzprobe`")\nEOF\n'), 'deny fs.delete-critical');
  assert.equal(await run("python3 - <<'EOF'\nprint('$(rm -rf /etc/zzprobe)')\nEOF\n"), 'allow');
  assert.equal(await run('python3 - <<EOF\nprint("\\$(rm -rf /etc/zzprobe)")\nEOF\n'), 'allow', 'escaped, it is text again');
  assert.equal(await run('cat <<EOF\n$(rm -rf /etc/zzprobe)\nEOF\n'), 'deny fs.delete-critical', 'for any command: the shell runs it');
});

test('a here-document that is data stays data, whatever it says', async () => {
  const risky = "import shutil\nshutil.rmtree('/etc/zzprobe')";
  // The control: the same body, handed to an interpreter as its program, is stopped; so the cases below say something.
  assert.equal(await run(`python3 - <<'EOF'\n${risky}\nEOF\n`), 'deny fs.delete-critical');
  for (const head of [
    'cat > notes.txt',
    'cat',
    'tee notes.txt',
    'git commit -F -',
    'git tag -a v1 -F -',
    'python3 check.py',
    'python3 -m json.tool',
    'python3 -c "print(1)"',
    'node check.js',
    'node --require ./a.js check.js',
    'ruby run.rb',
    'perl check.pl',
    'bun',
    'bun run build',
    'deno',
    'deno test',
    'php artisan x',
    'curl -sS -d @- http://127.0.0.1:9/x',
    'sort',
    'grep -c x',
  ])
    assert.equal(await run(`${head} <<'EOF'\n${risky}\nEOF\n`), 'allow', head);
  // The same with a here-string.
  assert.equal(await run(`cat <<< "rm -rf /etc/zzprobe"`), 'allow');
  assert.equal(await run(`python3 check.py <<< "shutil.rmtree('/etc/zzprobe')"`), 'allow');
});

test('a script is read as code: text it holds, a comment, a read, a prose string are no calls; the calls themselves still are', async () => {
  const home = '/home/ada';
  // A script that edits another script holds delete calls as text.
  assert.equal(
    await run(
      [
        "python3 - <<'PY'",
        "s = open('notes.md').read()",
        's = s.replace("shutil.rmtree(p)", "shutil.rmtree(q)")',
        'old = """',
        'os.remove(x)',
        '"""',
        "# os.remove('/etc/zzprobe')",
        "open('notes.md', 'w').write(s)",
        'PY',
      ].join('\n'),
    ),
    'allow',
  );
  assert.equal(
    await run("node - <<'JS'\nconst s = `fs.rmSync('/etc/zzprobe')`;\n// fs.rmSync('/etc/zzprobe')\nrequire('fs').writeFileSync('a.js', s);\nJS\n"),
    'allow',
  );
  // A function of the script's own, named like a delete.
  assert.equal(await run("node - <<'JS'\nconst rm = (f, re) => f.replace(re, '');\nrm(x, /a/);\nconsole.log('/etc/zzprobe');\nJS\n"), 'allow');
  // A read of a protected file is a read; a write is not.
  assert.equal(await run(`python3 - <<'PY'\nimport json\nprint(json.load(open('${home}/.claude/settings.json')))\nPY\n`), 'allow');
  assert.equal(await run(`python3 - <<'PY'\nimport json\nprint(json.load(open('${home}/.claude/settings.json', encoding='utf8')))\nPY\n`), 'allow');
  assert.equal(await run(`python3 - <<'PY'\nopen('${home}/.claude/settings.json', 'w').write('{}')\nPY\n`), 'deny self.claude-settings');
  assert.equal(await run(`python3 - <<'PY'\nopen('${home}/.bashrc', mode='a').write('x')\nPY\n`), 'ask persist.shell-profile');
  assert.equal(await run(`python3 - <<'PY'\nopen('${home}/.bashrc', 'rb').read()\nPY\n`), 'allow');
  assert.equal(await run(`python3 - <<'PY'\nfrom pathlib import Path\nPath('${home}/.bashrc').write_text('x')\nPY\n`), 'ask persist.shell-profile');
  // A string that looks like a command, in code that runs none.
  assert.equal(await run("python3 - <<'PY'\nprint('git push --force origin main')\ni = s.find('gh release create')\nPY\n"), 'allow');
  assert.equal(await run("python3 - <<'PY'\nimport os\nos.system('git push --force origin main')\nPY\n"), 'deny git.force-push-protected');
  assert.equal(await run("node - <<'JS'\nrequire('child_process').execSync('git push --force origin main');\nJS\n"), 'deny git.force-push-protected');
  // A call the code does not name still counts as one that may run a command.
  assert.equal(await run("python3 - <<'PY'\nimport os\ngetattr(os, 'sys' + 'tem')('git push --force origin main')\nPY\n"), 'deny git.force-push-protected');
  assert.equal(await run("node - <<'JS'\nrequire('child_process')['exec' + 'Sync']('git push --force origin main');\nJS\n"), 'deny git.force-push-protected');
  // A comment cannot hide a call from the reader, nor a hash that is no comment.
  assert.equal(await run("perl - <<'PL'\nfor my $i (0..$#a) { unlink('/etc/zzprobe') }\nPL\n"), 'deny fs.delete-critical');
  assert.equal(await run("python3 - <<'PY'\nx = 1 # it's fine\nimport shutil\nshutil.rmtree('/etc/zzprobe')\nPY\n"), 'deny fs.delete-critical');
  // A name the code gives a path.
  assert.equal(await run("python3 - <<'PY'\nimport shutil\nd = '/etc/zzprobe'\nshutil.rmtree(d)\nPY\n"), 'deny fs.delete-critical');
});

test('options are options: standard input is code for a shell or an interpreter that was given neither code nor a script', async () => {
  for (const c of [
    'cat x | python3 -E',
    'cat x | python3 -E -',
    'cat x | python3.12 -',
    'cat x | python3.12',
    'cat x | bash -e',
    'cat x | sh -e -s',
    'cat x | bash -f',
    'cat x | node -C development',
  ])
    assert.equal(await run(c), 'ask meta.unverifiable', c);
  for (const c of [
    'cat x | python3 -E check.py',
    'cat x | python3 -c "print(1)"',
    'cat x | node -e "1"',
    'cat x | bash -c "cat"',
    'cat x | bash -c -x',
    'cat x | bash -e check.sh',
    'cat x | node -C development main.js',
  ])
    assert.equal(await run(c), 'allow', c);
});

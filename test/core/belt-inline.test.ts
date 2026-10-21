// SPDX-License-Identifier: Apache-2.0
/**
 * What code handed to an interpreter deletes (src/core/belt/inline.ts): the literals a delete call is given,
 * directly or through names the code assigns; every literal when a name is unknown; nothing for another object's
 * `remove`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeLiterals, deletedLiterals, runsCommands, writesFiles } from '../../src/core/belt/inline.js';

const py = (code: string) => deletedLiterals(code, 'python3').sort();
const node = (code: string) => deletedLiterals(code, 'node').sort();

test("a code's literals: either quote, backticks, escapes undone", () => {
  assert.deepEqual(codeLiterals(`a('x') + "y\\"z" + \`w\` + 'it\\'s'`), ['x', 'y"z', 'w', "it's"]);
  assert.deepEqual(codeLiterals('no strings here'), []);
});

test('code that deletes nothing gives nothing, whatever paths it names', () => {
  assert.deepEqual(py("print(open('/etc/hosts').read())"), []);
  assert.deepEqual(node("console.log('/etc/hosts')"), []);
});

test("Python's deletes: its modules, a bare rmtree, a path's own method; another object's remove is no delete", () => {
  assert.deepEqual(py("import shutil; shutil.rmtree('/srv/data')"), ['/srv/data']);
  assert.deepEqual(py("import os; os.remove('/srv/a'); os.unlink('/srv/b')"), ['/srv/a', '/srv/b']);
  assert.deepEqual(py("import os; os.rmdir('/srv/c'); os.removedirs('/srv/d')"), ['/srv/c', '/srv/d']);
  assert.deepEqual(py("from shutil import rmtree; rmtree('/srv/e')"), ['/srv/e']);
  assert.deepEqual(py("from send2trash import send2trash; send2trash('/srv/f')"), ['/srv/f']);
  assert.deepEqual(py("import send2trash; send2trash.send2trash('/srv/g')"), ['/srv/g']);
  assert.deepEqual(py("from pathlib import Path; Path('/srv/h').unlink()"), ['/srv/h']);
  assert.deepEqual(py("from pathlib import Path; Path('/srv/i').rmdir()"), ['/srv/i']);
  assert.deepEqual(py("from pathlib import Path\np = Path('/srv/j')\np.unlink(missing_ok=True)"), ['/srv/j']);
  // The path is the statement's own, from the line's start or the last `;`.
  assert.deepEqual(py("from pathlib import Path\np = Path('/srv/j')\nprint('/srv/k')\nzz;p.unlink()"), ['/srv/j']);
  assert.deepEqual(py("from pathlib import Path\np = Path('/srv/j')\np.\nunlink()"), ['/srv/j']);
  // A list's, an XML tree's, an in-memory filesystem's.
  assert.deepEqual(py("xs = ['/a']; xs.remove('/a')"), []);
  assert.deepEqual(py("fs = fsspec.filesystem('memory'); fs.rm('/test'); fs.rmdir('/test')"), []);
  assert.deepEqual(py("mem.removetree('/test')"), []);
  assert.deepEqual(py("tree.unlink('/x')"), [], 'a method given a path is no path of its own');
});

test('a name the code assigns is followed to its value, a few assignments deep', () => {
  assert.deepEqual(py("import shutil\np = '/srv/k'\nshutil.rmtree(p)"), ['/srv/k']);
  assert.deepEqual(py("import os, shutil\nbase = '/srv'\np = os.path.join(base, 'l')\nshutil.rmtree(p)"), ['/srv', 'l']);
  assert.deepEqual(py("import shutil\nfor d in ['/srv/m', '/srv/n']: shutil.rmtree(d)\nprint('/srv/z')"), ['/srv/m', '/srv/n']);
  assert.deepEqual(py("import shutil, tempfile\nwith tempfile.TemporaryDirectory() as d:\n  shutil.rmtree(d)\nprint('/srv/o')"), []);
  assert.deepEqual(py("import shutil\np: str = '/srv/p'\nshutil.rmtree(p)"), ['/srv/p'], 'a typed assignment');
  // A JavaScript name may hold `$`, which a pattern reads as the end.
  assert.deepEqual(node("const $d = '/srv/r'; fs.rmSync($d); console.log('/srv/s')"), ['/srv/r']);
  // A comparison or an arrow is no assignment.
  assert.deepEqual(node("const d = '/srv/q'; if (d == '/x') {}; fs.rmSync(d)"), ['/srv/q']);
  // The measured case: a temporary file deleted beside an XPath.
  const xml = [
    'import os, tempfile',
    "found = root.xpath('//h:CoolingSystem', namespaces=ns)",
    "with tempfile.NamedTemporaryFile(mode='wb', suffix='.xml', delete=False) as f:",
    '    tree.write(f)',
    '    temp_file = f.name',
    'os.unlink(temp_file)',
  ].join('\n');
  assert.deepEqual(deletedLiterals(xml, 'python'), ['wb', '.xml']);
});

test('a name the code never assigns leaves the target unknown: every literal of the code counts', () => {
  assert.deepEqual(py("import shutil\ndef f(p): shutil.rmtree(p)\nf('/srv/r'); print('/srv/s')"), ['/srv/r', '/srv/s']);
  assert.deepEqual(node("require('fs').rmSync(process.argv[1]); console.log('/srv/t')"), ['/srv/t', 'fs']);
  // Five assignments deep is as unknown.
  const deep = "import shutil\na = '/srv/u'\nb = a\nc = b\nd = c\ne = d\nshutil.rmtree(e)\nprint('/srv/v')";
  assert.deepEqual(py(deep), ['/srv/u', '/srv/v']);
  assert.deepEqual(py(deep.replace('e = d\nshutil.rmtree(e)', 'shutil.rmtree(d)')), ['/srv/u']);
});

test("other languages: Node's fs and rimraf, keyword arguments and object keys no names, f-strings no names", () => {
  assert.deepEqual(node("require('fs').rmSync('/srv/w', { recursive: true, force: true })"), ['/srv/w']);
  assert.deepEqual(node("const fs = require('fs'); const d = '/srv/x'; fs.rmSync(d, { recursive: true })"), ['/srv/x']);
  assert.deepEqual(deletedLiterals("FileUtils.rm_rf('/srv/y')", 'ruby'), ['/srv/y']);
  assert.deepEqual(py("import shutil; name = 'z'; shutil.rmtree(f'/srv/{name}', ignore_errors=True)"), ['/srv/{name}']);
  // A call ends at its own closing parenthesis, the one right after a literal too.
  assert.deepEqual(node("fs.rmSync('/srv/c'); console.log('/srv/d')"), ['/srv/c']);
  // A callee inside the arguments is no name (`pick(d)`).
  assert.deepEqual(py("import shutil\nd = '/srv/e'\nshutil.rmtree(pick(d))\nprint('/srv/f')"), ['/srv/e']);
  // An unclosed call reads to the end of the code.
  assert.deepEqual(node("fs.rmSync('/srv/a'"), ['/srv/a']);
  // A string's own parentheses do not close the call.
  assert.deepEqual(node("fs.rmSync(')' + '/srv/b')"), [')', '/srv/b']);
});

// ── a script is code with text in it: what is a comment, a string or a regular expression is not a call ──

const lits = (code: string, program = '') => codeLiterals(code, program);

test('Python: triple-quoted strings are one literal, a comment is none, a stray quote ends at its line', () => {
  assert.deepEqual(lits('a = """one\ntwo \'x\' # not a comment\n"""\nb = \'c\'', 'python3'), ["one\ntwo 'x' # not a comment\n", 'c']);
  assert.deepEqual(lits("a = '''it's \"q\"'''", 'python'), ['it\'s "q"']);
  assert.deepEqual(lits('a = """open', 'py'), ['open'], 'unterminated: to the end of the code');
  assert.deepEqual(lits('a = """x\\"""y"""', 'python3'), ['x"""y'], 'an escaped quote does not end it');
  assert.deepEqual(lits("# it's a comment\nb = 'c' # and 'd' too\n", 'python3'), ['c']);
  assert.deepEqual(lits("b = 'a # b'\n", 'python3'), ['a # b'], 'a hash inside a string stays');
  assert.deepEqual(lits("a = it's\nb = 'c'\n", 'python3'), ['c'], 'a quote with no mate ends at its line');
  assert.deepEqual(lits("a = 'x\\\ny'\n", 'python3'), ['x\\\ny'], 'a backslash continues the line');
  assert.deepEqual(lits("a = 'x // y' // 2", 'python3'), ['x // y'], 'floor division is no comment in Python');
});

test('JavaScript: comments, regular expressions and templates', () => {
  assert.deepEqual(lits("// it's\nconst a = 'x'; // 'y'\n", 'node'), ['x']);
  assert.deepEqual(lits("/* 'no'\n 'no' */ const a = 'x';", 'node'), ['x']);
  assert.deepEqual(lits("/* 'never closed", 'node'), []);
  assert.deepEqual(lits("s.replace(/'a/g, 'b')", 'node'), ['b'], 'a regular expression after a parenthesis');
  assert.deepEqual(lits("const r = /[/']x/; const a = 'y';", 'node'), ['y'], 'a slash inside a class does not end it');
  assert.deepEqual(lits("function f() { return /'q/.test(x) }", 'bun'), [], 'a regular expression after return');
  assert.deepEqual(lits("const a = 4 / 2; const b = c / 'x' / 'y';", 'deno'), ['x', 'y'], 'a division is no regular expression');
  assert.deepEqual(lits('const a = `plain`; const b = `with ${x}`; const c = `esc \\${x}`;', 'node'), ['plain', 'esc ${x}']);
  assert.deepEqual(lits("const a = it's;\nconst b = 'z';", 'nodejs'), ['z'], 'a quote with no mate ends at its line');
});

test("each interpreter's own syntax: which comments, quotes and regular expressions its code has", () => {
  // The same seven snippets, read as each interpreter reads them: a # comment, one glued to a word, a // comment, a
  // block comment, a regular expression holding a quote, a triple-quoted string, and a quote with no mate on its line.
  const snippets = ["# 'h'\n'x'", "a# 'h'\n'x'", "// 's'\n'x'", "/* 'b' */ 'x'", "f(/'r'/)", `"""t""" 'x'`, "'m\nm'"];
  const python = [['x'], ['x'], ['s', 'x'], ['b', 'x'], ['r'], ['t', 'x'], []];
  const script = [['h', 'x'], ['h', 'x'], ['x'], ['x'], [], ['', 't', '', 'x'], []];
  const php = [['x'], ['h', 'x'], ['x'], ['x'], ['r'], ['', 't', '', 'x'], ['m\nm']];
  const hashed = [['x'], ['h', 'x'], ['s', 'x'], ['b', 'x'], ['r'], ['', 't', '', 'x'], ['m\nm']];
  const plain = [['h', 'x'], ['h', 'x'], ['s', 'x'], ['b', 'x'], ['r'], ['', 't', '', 'x'], ['m\nm']];
  const table: [string[], string[][]][] = [
    [['python', 'python3', 'python3.12', 'py', 'pypy'], python],
    [['node', 'nodejs', 'node22', 'bun', 'deno'], script],
    [['php', 'php8.2'], php],
    [['ruby', 'perl', 'perl5.36'], hashed],
    [['osascript', 'bash', ''], plain],
  ];
  for (const [programs, expected] of table)
    for (const program of programs)
      snippets.forEach((code, i) => assert.deepEqual(lits(code, program), expected[i], `${program || '(none)'}: ${JSON.stringify(code)}`));
});

test('where the lexer is unsure it reads code: a hash that is not a comment, a slash that is a division', () => {
  // Perl's last index, a substitution or a pattern with `#` for its delimiter, a Ruby regular expression: code, not comments.
  assert.deepEqual(lits("for my $i (0..$#a) { unlink('/x') }", 'perl'), ['/x']);
  assert.deepEqual(lits("$s =~ s#a#b#; unlink('/x');", 'perl'), ['/x']);
  assert.deepEqual(lits("x = /#/; File.delete('/x')", 'ruby'), ['/x']);
  assert.deepEqual(lits("$#a; unlink('/x')", 'perl'), ['/x']);
  assert.deepEqual(lits("x = 1 # then 'y'\nz = 'w'", 'ruby'), ['w'], 'after a blank it is a comment');
  assert.deepEqual(lits("$x = 1; # then 'y'\n$z = 'w';", 'php'), ['w']);
  assert.equal(deletedLiterals("for my $i (0..$#a) { unlink('/x') }", 'perl')[0], '/x');
  // After a closing bracket a slash divides, whatever follows it: no regular expression there.
  assert.deepEqual(lits("a = {}\n/'q'/.test(x)", 'node'), ['q']);
  assert.deepEqual(lits("a = f(x)/'q'/y; b = c[0] / 'r' / d", 'node'), ['q', 'r']);
  assert.deepEqual(lits("a = x ? /'p'/ : /'q'/", 'node'), []);
  assert.deepEqual(
    lits("const ok = (t) => /'p`'/.test(t); const b = 'z';", 'node'),
    ['z'],
    'a regular expression after an arrow, a quote and a backtick in it',
  );
  assert.deepEqual(lits("a = x;\n/'p'/.test(y); b = 'z'", 'node'), ['z']);
});

test('strings at the edges: empty, unterminated, escaped, with a backtick or a dollar', () => {
  assert.deepEqual(lits('a = """"""; b = \'\'', 'python3'), ['', '']);
  assert.deepEqual(lits("a = '''open", 'python3'), ['open']);
  assert.deepEqual(lits('a = """b$c`', 'python3'), ['b$c`'], 'a string that ends in a backtick is no template');
  assert.deepEqual(lits("a = '''x\\'''y'''", 'python3'), ["x'''y"]);
  assert.deepEqual(lits('const a = `x\\${y}`; const b = `$`;', 'node'), ['x${y}'], 'an escaped dollar stays a literal; a bare one is an expression');
});

test('what stands inside the brackets of an open is one argument, whatever commas it holds', () => {
  const w = (code: string) => writesFiles(code, 'python3');
  for (const reads of ["open(f(a, b), 'r')", "open(x[a, b], 'r')", "open({1: 2, 3: 4}[1], 'r')", "open(f(g(a, b), c), 'r')"])
    assert.equal(w(reads), false, reads);
  for (const writes of ["open(f(a, b), 'w')", "open(x[a, b], 'w')", "open({1: 2, 3: 4}[1], 'w')", "open(f(g(a, b), c), 'w')"])
    assert.equal(w(writes), true, writes);
});

test('other interpreters: Ruby and Perl comments, PHP comments of both kinds, strings that run on', () => {
  assert.deepEqual(lits("# 'a'\nx = 'b'\n", 'ruby'), ['b']);
  assert.deepEqual(lits("x = 'a\nb' # 'c'", 'perl5.36'), ['a\nb']);
  assert.deepEqual(lits("// 'a'\n# 'b'\n/* 'c' */ $x = 'd';", 'php8.2'), ['d']);
  assert.deepEqual(lits('do shell script "x" -- "y"', 'osascript'), ['x', 'y'], 'AppleScript has no comment this reads');
  assert.deepEqual(lits("a('x') # 'y'"), ['x', 'y'], 'no interpreter named: strings only');
});

test('a call is looked for in code: not in a string that holds code, a comment, a regular expression or a template', () => {
  assert.deepEqual(py("s = 'shutil.rmtree(p)'\nprint('/srv/a')"), []);
  assert.deepEqual(py('s = """\nos.remove(x)\n"""\nprint("/srv/a")'), []);
  assert.deepEqual(py("# os.remove(x)\nprint('/srv/a')"), []);
  assert.deepEqual(py("import os\nos.remove('/srv/a')  # then os.remove(y)\nprint('/srv/b')"), ['/srv/a']);
  assert.deepEqual(node("fs.writeFileSync(p, `x.delete(a)`)\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("const r = /rm\\(x\\)/;\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("// fs.rmSync(x)\n/* rimraf(y) */ console.log('/srv/a')"), []);
  assert.deepEqual(node("fs.rmSync('/srv/a') // (not closed"), ['/srv/a'], 'a comment inside the call does not close or open anything');
  // A parenthesis in a comment or a string inside the arguments does not end them.
  assert.deepEqual(py("import shutil\np = '/srv/a'\nshutil.rmtree(p # )\n)\nprint('/srv/b')"), ['/srv/a']);
  // A name only a comment or a string mentions is no name to look up.
  assert.deepEqual(py("import shutil\np = '/srv/a'\nshutil.rmtree(p, 'ignore_errors') # q\nprint('/srv/b')"), ['/srv/a', 'ignore_errors']);
});

test('where strings are not read surely (Ruby, Perl, PHP, others) a call in a string still counts as before; a comment never does', () => {
  const sorted = (code: string, program: string) => deletedLiterals(code, program).sort();
  assert.deepEqual(sorted("puts 'File.delete(x)'; puts '/srv/a'", 'ruby'), ['/srv/a', 'File.delete(x)']);
  assert.deepEqual(sorted("# File.delete(x)\nputs '/srv/a'", 'ruby'), []);
  assert.deepEqual(sorted("echo 'unlink(x)'; // unlink(y)\necho '/srv/a';", 'php'), ['/srv/a', 'unlink(x)']);
  assert.deepEqual(sorted("print 'unlink(x)'; # unlink(y)\nprint '/srv/a';", 'perl'), ['/srv/a', 'unlink(x)']);
  assert.deepEqual(sorted("say 'rm(x)' & '/srv/a'", 'osascript'), ['/srv/a', 'rm(x)']);
  // Names and parentheses are read from the code with strings emptied, in every language, as before.
  assert.deepEqual(sorted("File.delete(')' + '/srv/b'); puts '/srv/c'", 'ruby'), [')', '/srv/b']);
  assert.deepEqual(sorted("p = '/srv/a'; File.delete(p); puts 'q'", 'ruby'), ['/srv/a']);
  // A command run is a command wherever its word stands in the code; a word in a comment is none.
  assert.equal(runsCommands('puts "system"', 'ruby'), true);
  assert.equal(runsCommands('# system "x"', 'ruby'), false);
  assert.equal(runsCommands('echo "exec"; // popen', 'php'), true);
  assert.equal(runsCommands('// popen', 'php'), false);
  // An open written in a string is no open: it has no arguments of its own to read.
  assert.equal(writesFiles('puts "open(x, \'w\')"', 'ruby'), false);
  assert.equal(writesFiles("# open(x, 'w')", 'ruby'), false);
  assert.equal(writesFiles("open(x, 'w')", 'ruby'), true);
});

test("a function the script defines itself is its own, called by its bare name; the system's, named in full, is still a delete", () => {
  assert.deepEqual(node("const rm = (f, re) => f;\nrm(g, 1);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("const rm = async (f) => f;\nrm(g);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("const rm = f => f;\nrm(g);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("let rimraf = function (f) {};\nrimraf(g);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("const unlink = async function (f) {};\nunlink(g);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("function remove(f) {}\nremove(g);\nconsole.log('/srv/a')"), []);
  assert.deepEqual(py("def rmtree(p):\n  pass\nrmtree(q)\nprint('/srv/a')"), []);
  assert.deepEqual(py("remove = lambda p: p\nremove(q)\nprint('/srv/a')"), []);
  // Named in full it is the system's, whatever the script defines.
  assert.deepEqual(py("def remove(x): pass\nimport os\nos.remove('/srv/a')\nprint('/srv/b')"), ['/srv/a']);
  assert.deepEqual(node("const rm = (f) => f;\nfs.rm('/srv/a');"), ['/srv/a']);
  assert.deepEqual(py("from pathlib import Path\ndef unlink(x): pass\nPath('/srv/a').unlink()"), ['/srv/a'], "a path's own method is not the script's name");
  // An import is no definition: a bare call of what was imported is still the system's.
  assert.deepEqual(py("from shutil import rmtree\nrmtree('/srv/a')"), ['/srv/a']);
  // Defined after the call, or in a string, it does not matter: the code is read as a whole, strings aside.
  assert.deepEqual(node("const s = 'const rm = f => f';\nrm('/srv/a')"), ['/srv/a']);
});

test('an open is a write when its mode writes or is not shown; with no mode, or a read, it reads', () => {
  const w = (code: string, program = 'python3') => writesFiles(code, program);
  for (const reads of [
    "open('/x')",
    "open('/x', 'r')",
    "open('/x', 'rb')",
    "open('/x', mode='r')",
    "open('/x', encoding='utf8')",
    "open('/x', 'r', encoding='utf8')",
    "io.open('/x', encoding='utf8')",
    "Path('/x').open()",
    "Path('/x').open('rb')",
    'webbrowser.open(url)',
    "webbrowser.open('http://x')",
    'open(\n  "/x"\n)',
    "open('/x', 'rt')",
    "open(f('a,b', 'c'), 'r')",
  ])
    assert.equal(w(reads), false, reads);
  for (const writes of [
    "open('/x', 'w')",
    "open('/x', 'a')",
    "open('/x', 'x')",
    "open('/x', 'r+')",
    "open('/x', 'wb')",
    "open('/x', 'a+')",
    "open('/x', mode='w')",
    "open('/x', 'r', encoding='utf8') ; open('/y', 'w')",
    "open('/x', m)",
    "open('/x', mode=m)",
    "open('/x', mode='r', **more) ; open('/y', **more, mode=m)",
    "Path('/x').open('w')",
    "io.open('/x', 'a', encoding='utf8')",
    "open(os.path.join('/a', 'b'), 'w')",
    "with open(p, 'w') as f: pass",
  ])
    assert.equal(w(writes), true, writes);
  // Other languages: Perl's modes, Ruby's File.open, Node's fs.open (and an openSync is no `open(`).
  assert.equal(w("open(FH, '>', $f)", 'perl'), true);
  assert.equal(w('open(FH, ">>$f")', 'perl'), true);
  assert.equal(w("open(FH, '+<', $f)", 'perl'), true);
  assert.equal(w("open(FH, '<', $f)", 'perl'), false);
  assert.equal(w('open(FH, "<$f")', 'perl'), false);
  assert.equal(w("File.open('/x', 'w') { |f| f.write(1) }", 'ruby'), true);
  assert.equal(w("File.read('/x')", 'ruby'), false);
  assert.equal(w("fs.open('/x', 'w', cb)", 'node'), true);
  assert.equal(w("fs.openSync('/x', 'w')", 'node'), false);
  // Flags in place of a mode: a low-level open that creates, appends or updates writes; a read-only one reads.
  assert.equal(w("os.open('/x', os.O_WRONLY | os.O_CREAT)"), true);
  assert.equal(w("os.open('/x', os.O_RDWR)"), true);
  assert.equal(w("os.open('/x', os.O_APPEND)"), true);
  assert.equal(w("os.open('/x', os.O_TRUNC)"), true);
  assert.equal(w("os.open('/x', os.O_RDONLY)"), false);
  assert.equal(w('fs.open(p, fs.constants.O_APPEND, cb)', 'node'), true);
  assert.equal(w("File.open('/x', File::WRONLY | File::CREAT)", 'ruby'), true);
  // The calls that write whatever their arguments, and a call written inside a string is no call.
  for (const call of ["Path('/x').write_text('y')", "fs.writeFileSync('/x', 'y')", 'shutil.copy(a, b)', 'os.rename(a, b)', "fs.appendFile('/x', 'y', cb)"])
    assert.equal(w(call, call.startsWith('fs.') ? 'node' : 'python3'), true, call);
  assert.equal(w('s = \'open(p, "w")\' + "write_text(x)"'), false);
  assert.equal(w("# open(p, 'w')"), false);
});

test('code runs commands when it calls something that does; a string that looks like a command, searched for or printed, is no command', () => {
  const r = (code: string, program = 'python3') => runsCommands(code, program);
  for (const runs of [
    "os.system('x')",
    "os.popen('x')",
    "subprocess.run(['x'])",
    "subprocess.Popen('x', shell=True)",
    "commands.getoutput('x')",
    "os.execvp('x', [])",
    "asyncio.create_subprocess_shell('x')",
    "check_output('x')",
    'x = eval(s)',
  ])
    assert.equal(r(runs), true, runs);
  for (const runs of ["require('child_process').execSync('x')", 'cp.spawn(x)', 'const a = `x`;', 'Deno.run({ cmd: [x] })', 'proc.fork()'])
    assert.equal(r(runs, 'node'), true, runs);
  for (const runs of ["system 'x'", '%x(x)', 'IO.popen(x)', 'x = `x`', 'exec "x"', 'Open3.capture2e(x)']) assert.equal(r(runs, 'ruby'), true, runs);
  assert.equal(r('shell_exec($x); passthru($y); proc_open($z)', 'php'), true);
  assert.equal(r('do shell script "x"', 'osascript'), true);
  assert.equal(r('my $out = qx(x);', 'perl'), true);
  // A function reached by a string or a name may be a command's: the gate stays open where the code does that.
  for (const reaches of [
    "getattr(os, 's' + 'ystem')('x')",
    "__import__('o' + 's').system('x')",
    "importlib.import_module('x')",
    "globals()['f']('x')",
    "locals().get('f')('x')",
    'vars(m)[n](x)',
    'x = __builtins__',
    "ops['exec'](x)",
    'run = ops[n](x)',
  ])
    assert.equal(r(reaches), true, reaches);
  assert.equal(r("cp['exec' + 'Sync']('x')", 'node'), true);
  assert.equal(r("$f = 'sys' . 'tem'; $f('x');", 'php'), true);
  assert.equal(r("obj.send(:sys, 'x'); m = obj.method(:y)", 'ruby'), true);
  // Perl's and Ruby's `open` runs a command whose text ends or begins with a pipe; Python's reads and writes files.
  assert.equal(r("open(F, 'x |')", 'perl'), true);
  assert.equal(r("open('|x')", 'ruby3.2'), true);
  assert.equal(r("open('/x', 'w')"), false);
  assert.equal(r("open('/x')", 'node'), false);
  for (const text of [
    "print('git push --force')",
    "i = s.find('gh release create')",
    "s = 'os.system(x)'",
    '# os.system(x)',
    'x = """\nsubprocess.run(y)\n"""',
    "fs = fsspec.filesystem('memory')",
    'analyzeCommand(a)',
  ])
    assert.equal(r(text), false, text);
  assert.equal(r("console.log('git x'); /* exec(y) */", 'node'), false);
});

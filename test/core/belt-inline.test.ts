// SPDX-License-Identifier: Apache-2.0
/**
 * What code handed to an interpreter deletes (src/core/belt/inline.ts): the literals a delete call is given,
 * directly or through names the code assigns; every literal when a name is unknown; nothing for another object's
 * `remove`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeLiterals, deletedLiterals } from '../../src/core/belt/inline.js';

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

test("a delete written in a string or a comment is no call of the code's own: a name it leaves unknown counts only its own text", () => {
  // The measured case (2026-10-26): a script that edits another script's rmSync line and writes a file of its own.
  const edit = [
    "const fs=require('fs');const sp=process.argv[2];",
    "let s=fs.readFileSync('scripts/coverage.mjs','utf8');",
    's=s.replace("rmSync(recordsDir, { recursive: true, force: true });\\n","");',
    "fs.writeFileSync(sp+'/floors-minus.json',JSON.stringify({}));",
  ].join('\n');
  assert.deepEqual(node(edit), []);
  assert.deepEqual(node("// fs.rmSync(dir, { recursive: true })\nconsole.log('/srv/a')"), []);
  assert.deepEqual(node("/* rimraf(dir) */ console.log('/srv/a')"), []);
  assert.deepEqual(py("# shutil.rmtree(d)\nprint('/srv/b')"), []);
  assert.deepEqual(py("print('shutil.rmtree(d)', '/srv/b')"), []);
  // What it is given still counts, as code a string may become: a path written in it, a name the code assigns.
  assert.deepEqual(node(`eval("require('fs').rmSync('/srv/c', { recursive: true })")`), ['/srv/c']);
  assert.deepEqual(node(`const d = '/srv/d'; eval("fs.rmSync(d)")`), ['/srv/d']);
  assert.deepEqual(py(`exec("import shutil; shutil.rmtree('/srv/e')")`), ['/srv/e']);
  assert.deepEqual(node("// fs.rmSync('/srv/g')\nconsole.log('/srv/h')"), ['/srv/g']);
  // A name such a string leaves unknown: its own paths count, the code's others do not.
  assert.deepEqual(node(`const usage = "rmSync(dir) empties '/srv/k'"; console.log('/srv/l')`), ['/srv/k']);
  // A call right after a comment is the code's own.
  assert.deepEqual(node("const { rmSync } = require('fs'); /* go */rmSync('/srv/j')"), ['/srv/j']);
  // The code's own call beside such a string: every literal when its name is unknown, as before.
  assert.deepEqual(node(`const note = "rmSync(x)"; fs.rmSync(process.argv[1]); console.log('/srv/f')`), ['/srv/f', 'rmSync(x)']);
  // A language whose comments are not read here: its # is code (Ruby's interpolation, Perl's $#).
  assert.deepEqual(deletedLiterals("FileUtils.rm_rf(d) # '/srv/i'", 'ruby'), ['/srv/i']);
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

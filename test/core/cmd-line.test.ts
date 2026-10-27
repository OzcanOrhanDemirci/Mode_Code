// SPDX-License-Identifier: Apache-2.0
/**
 * The cmd.exe line that starts a .cmd shim: each argument quoted as a Windows program splits its command
 * line and escaped for both of cmd's readings. On Windows the lines are run through a real shim shaped like
 * npm's, and the program it starts must receive exactly the arguments given.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdShimLine, windowsArg } from '../../src/core/cmd-line.js';
import { fc } from '../helpers/prop.js';

test('an argument is quoted, and only the backslashes before a quote are doubled', () => {
  assert.equal(windowsArg(''), '""');
  assert.equal(windowsArg('a b'), '"a b"');
  assert.equal(windowsArg('a"b'), '"a\\"b"');
  assert.equal(windowsArg('a\\"b'), '"a\\\\\\"b"');
  assert.equal(windowsArg('C:\\x\\y'), '"C:\\x\\y"');
  assert.equal(windowsArg('C:\\x\\'), '"C:\\x\\\\"');
  assert.equal(windowsArg('a\\\\'), '"a\\\\\\\\"');
});

test('each argument is escaped for both readings, the program for the first only', () => {
  assert.equal(cmdShimLine('claude', ['a b', '50%']), 'claude ^^^"a^^^ b^^^" ^^^"50^^^%^^^"');
  assert.equal(cmdShimLine('C:\\a b\\x.cmd', []), 'C:\\a^ b\\x.cmd');
  assert.equal(cmdShimLine('npm', ['x&y']), 'npm ^^^"x^^^&y^^^"');
});

test('a line break, which ends a cmd line wherever it stands, is refused', () => {
  assert.throws(() => cmdShimLine('claude', ['-p', 'one\ntwo']), RangeError);
  assert.throws(() => cmdShimLine('claude', ['a\rb']), RangeError);
  assert.throws(() => cmdShimLine('clau\nde', []), RangeError);
});

// The characters cmd, the shim's `%*` and a program's own splitting each read specially, and plain ones.
const hard = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.string({
      unit: fc.constantFrom(...'aZ0 \t"\\%!^&|<>()[];,=*?`\'$~#@/:.çİé'),
      maxLength: 16,
    }),
  },
  { weight: 1, arbitrary: fc.constantFrom('%PATH%', '%USERPROFILE%', '!PATH!', '%%', '%~dp0', '"', '\\', '\\"', 'C:\\x\\', '') },
);

test("on Windows, a shim shaped like npm's hands the program exactly the arguments given", { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc cmd & (line) '));
  try {
    writeFileSync(join(dir, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    // npm's shim: the program is read into a variable, then run with `%*` on a line that holds `&` itself.
    const shim = join(dir, 'echo.cmd');
    writeFileSync(shim, `@ECHO off\r\nSETLOCAL\r\nSET "_prog=${process.execPath}"\r\nendLocal & "%_prog%" "%~dp0echo.js" %*\r\n`);
    const run = (args: string[]) => {
      const r = spawnSync(cmdShimLine(shim, args), { shell: true, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
      return JSON.parse(r.stdout) as string[];
    };
    assert.deepEqual(run(['plain', 'two words', '50% & "more"', '%PATH%', 'C:\\dir\\', 'a\\"b', '^^', '']), [
      'plain',
      'two words',
      '50% & "more"',
      '%PATH%',
      'C:\\dir\\',
      'a\\"b',
      '^^',
      '',
    ]);
    fc.assert(
      fc.property(fc.array(hard, { maxLength: 5 }), (args) => {
        assert.deepEqual(run(args), args);
      }),
      { numRuns: 40 },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

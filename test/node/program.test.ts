// SPDX-License-Identifier: Apache-2.0
// The program as the one-line installer put it (install.sh, install.ps1), and what `uninstall` removes of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMMAND_MARK,
  PATH_MARK,
  programReceipt,
  removeLaterScript,
  removeProgram,
  removeUserPathScript,
  withoutPathLine,
  type ProgramReceipt,
  type ProgramSystem,
} from '../../src/node/program.js';

interface Place {
  root: string;
  home: string;
  bin: string;
  rc: string;
  receipt: ProgramReceipt;
  done(): void;
}

/** A program folder, a command folder and a startup file, as the installer leaves them. */
function installed(opts: { pathLine?: boolean; foreignCommand?: boolean } = {}): Place {
  const root = mkdtempSync(join(tmpdir(), 'tc-program-'));
  const home = join(root, 'share', 'mode-code');
  const bin = join(root, 'bin');
  mkdirSync(join(home, 'app', 'dist'), { recursive: true });
  mkdirSync(join(home, 'node', 'bin'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(home, 'app', 'dist', 'cli.mjs'), '// cli');
  writeFileSync(join(home, 'node', 'bin', 'node'), 'binary');
  const command = join(bin, 'mode-code');
  writeFileSync(command, opts.foreignCommand ? '#!/bin/sh\necho someone else\n' : `#!/bin/sh\n# ${COMMAND_MARK}: runs Mode_Code.\nexec node cli.mjs "$@"\n`);
  const rc = join(root, '.zshrc');
  const line = `export PATH="${bin}:$PATH"`;
  writeFileSync(rc, `alias ll='ls -l'\n` + (opts.pathLine === false ? '' : `\n${PATH_MARK}\n${line}\n`));
  const receipt: ProgramReceipt = {
    v: 1,
    app: 'mode-code',
    version: '1.0.0',
    installedAt: '2026-10-14T12:00:00.000Z',
    home,
    program: join(home, 'app', 'dist', 'cli.mjs'),
    node: join(home, 'node', 'bin', 'node'),
    privateNode: true,
    command,
    path: { file: rc, line },
    source: 'https://example.invalid/mode-code.tgz',
    sha256: null,
  };
  writeFileSync(join(home, 'install.json'), JSON.stringify(receipt, null, 2));
  return { root, home, bin, rc, receipt, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A system that records what it was asked to do instead of doing it. */
function fakeSystem(platform: NodeJS.Platform = 'linux'): ProgramSystem & { scripts: string[]; laterScripts: string[] } {
  const scripts: string[] = [];
  const laterScripts: string[] = [];
  return {
    platform,
    pid: 4242,
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    scripts,
    laterScripts,
    powershell(script) {
      scripts.push(script);
      return { ok: true, out: '' };
    },
    later(script) {
      laterScripts.push(script);
      return true;
    },
  };
}

test('the record is read only for the program it describes', () => {
  const p = installed();
  try {
    assert.equal(programReceipt(join(p.home, 'app', 'dist'))?.version, '1.0.0');
    // A program elsewhere (a clone, an npm installation) has no record beside it.
    assert.equal(programReceipt(join(p.root, 'clone', 'dist')), null);
    // A record that names another folder is not this program's.
    writeFileSync(join(p.home, 'install.json'), JSON.stringify({ ...p.receipt, home: p.root }));
    assert.equal(programReceipt(join(p.home, 'app', 'dist')), null);
    // Nor is one of another tool.
    writeFileSync(join(p.home, 'install.json'), JSON.stringify({ ...p.receipt, app: 'other' }));
    assert.equal(programReceipt(join(p.home, 'app', 'dist')), null);
  } finally {
    p.done();
  }
});

test('the startup file loses the two lines the installer added, and nothing else', () => {
  const line = 'export PATH="$HOME/.local/bin:$PATH"';
  assert.equal(withoutPathLine(`a\n\n${PATH_MARK}\n${line}\nb\n`, line), 'a\nb\n');
  assert.equal(withoutPathLine(`${PATH_MARK}\n${line}\n`, line), '');
  assert.equal(withoutPathLine(`a\r\n\r\n${PATH_MARK}\r\n${line}\r\nb\r\n`, line), 'a\r\nb\r\n');
  // The same line written by the person, without the mark, stays.
  assert.equal(withoutPathLine(`a\n${line}\n`, line), null);
  // The mark above another line is not the installer's line.
  assert.equal(withoutPathLine(`${PATH_MARK}\nexport X=1\n`, line), null);
});

test('removal takes the command, the PATH line and the program folder', () => {
  const p = installed();
  try {
    const steps = removeProgram(p.receipt, fakeSystem());
    assert.deepEqual(
      steps.map((s) => [s.what, s.ok, !!s.kept, !!s.later]),
      [
        ['command', true, false, false],
        ['path', true, false, false],
        ['program', true, false, false],
      ],
    );
    assert.equal(existsSync(p.receipt.command), false);
    assert.equal(existsSync(p.home), false);
    assert.equal(readFileSync(p.rc, 'utf8'), `alias ll='ls -l'\n`);
  } finally {
    p.done();
  }
});

test("what is not the installer's stays: a command it did not write, a PATH folder other programs use, other files", () => {
  const p = installed({ foreignCommand: true });
  try {
    writeFileSync(join(p.bin, 'claude'), 'another program');
    writeFileSync(join(p.home, 'notes.txt'), "the person's own file");
    const steps = removeProgram(p.receipt, fakeSystem());
    assert.deepEqual(
      steps.map((s) => [s.what, s.ok, !!s.kept]),
      [
        ['command', true, true],
        ['path', true, true],
        ['program', true, false],
      ],
    );
    assert.equal(existsSync(p.receipt.command), true);
    assert.match(readFileSync(p.rc, 'utf8'), /Added by the Mode_Code installer/);
    // Only the installer's entries left the folder; the folder stays for the file that is not.
    assert.equal(existsSync(join(p.home, 'app')), false);
    assert.equal(existsSync(join(p.home, 'node')), false);
    assert.equal(existsSync(join(p.home, 'install.json')), false);
    assert.equal(existsSync(join(p.home, 'notes.txt')), true);
  } finally {
    p.done();
  }
});

test('a fish startup file made for the PATH line alone goes with it', () => {
  const p = installed({ pathLine: false });
  try {
    const fish = join(p.root, 'conf.d', 'mode-code.fish');
    mkdirSync(join(p.root, 'conf.d'));
    const line = `fish_add_path --global "${p.bin}"`;
    writeFileSync(fish, `\n${PATH_MARK}\n${line}\n`);
    removeProgram({ ...p.receipt, path: { file: fish, line } }, fakeSystem());
    assert.equal(existsSync(fish), false);
  } finally {
    p.done();
  }
});

test('a startup file that is gone is not a failure', () => {
  const p = installed();
  try {
    rmSync(p.rc);
    const steps = removeProgram(p.receipt, fakeSystem());
    assert.ok(steps.every((s) => s.ok));
  } finally {
    p.done();
  }
});

test('on Windows the user PATH entry is removed through the registry, with the key the installer used', () => {
  const p = installed();
  try {
    const sys = fakeSystem('win32');
    const steps = removeProgram({ ...p.receipt, path: { user: p.bin, key: 'Software\\ModeCodeTest\\Environment' } }, sys);
    assert.equal(steps.find((s) => s.what === 'path')?.ok, true);
    assert.equal(sys.scripts.length, 1);
    assert.ok(sys.scripts[0]!.includes(`'${p.bin}'`));
    assert.ok(sys.scripts[0]!.includes(`OpenSubKey('Software\\ModeCodeTest\\Environment', $true)`));
    // A key under test is never announced as the real environment.
    assert.ok(sys.scripts[0]!.includes(`if ('Software\\ModeCodeTest\\Environment' -eq 'Environment')`));
  } finally {
    p.done();
  }
});

test('the PowerShell scripts quote what they are given', () => {
  const s = removeUserPathScript("C:\\Users\\O'Brien\\.local\\bin\\");
  assert.ok(s.includes(`$dir = 'C:\\Users\\O''Brien\\.local\\bin'`));
  assert.ok(s.includes(`OpenSubKey('Environment', $true)`));
  const l = removeLaterScript(77, [{ path: "C:\\a'b\\node" }, { path: 'C:\\a\\home', ifEmpty: true }]);
  assert.ok(l.includes('GetProcessById(77)'));
  assert.ok(l.includes(`$p = 'C:\\a''b\\node'`));
  assert.ok(l.includes('[IO.Directory]::Delete($p, $true)'));
  // A folder that may hold the person's own files is deleted only when empty.
  assert.ok(l.includes('[IO.Directory]::Delete($p, $false)'));
});

test('on Windows what cannot be deleted now (the Node.js running this) is left to a helper, the folder only when empty', () => {
  const p = installed();
  try {
    const sys = {
      ...fakeSystem('win32'),
      remove: (path: string) => {
        if (path.endsWith('node')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        rmSync(path, { recursive: true, force: true });
      },
    };
    const steps = removeProgram(p.receipt, sys);
    const program = steps.find((s) => s.what === 'program')!;
    assert.deepEqual([program.ok, program.later], [true, true]);
    assert.equal(sys.laterScripts.length, 1);
    const script = sys.laterScripts[0]!;
    assert.ok(script.includes('GetProcessById(4242)'));
    assert.ok(script.includes(`$p = '${join(p.home, 'node')}'`));
    assert.ok(script.includes(`$p = '${p.home}'`) && script.includes('[IO.Directory]::Delete($p, $false)'));
    // Everything else is gone already.
    assert.equal(existsSync(join(p.home, 'app')), false);
    assert.equal(existsSync(join(p.home, 'install.json')), false);
  } finally {
    p.done();
  }
});

test('when the helper cannot start, what it was to remove is reported as not removed', () => {
  const p = installed();
  try {
    const sys = {
      ...fakeSystem('win32'),
      later: () => false,
      remove: (path: string) => {
        if (path.endsWith('node')) throw new Error('EBUSY');
        rmSync(path, { recursive: true, force: true });
      },
    };
    const program = removeProgram(p.receipt, sys).find((s) => s.what === 'program')!;
    assert.equal(program.ok, false);
    assert.equal(program.later, false);
    assert.ok(program.detail!.includes(join(p.home, 'node')));
  } finally {
    p.done();
  }
});

test('elsewhere a file that cannot be removed is a failed step, with the reason', () => {
  const p = installed();
  try {
    const sys = {
      ...fakeSystem('linux'),
      remove: (path: string) => {
        if (path === p.receipt.command || path.endsWith('app')) throw new Error('EACCES: permission denied');
        rmSync(path, { recursive: true, force: true });
      },
    };
    const steps = removeProgram(p.receipt, sys);
    assert.deepEqual(
      steps.map((s) => [s.what, s.ok, !!s.kept]),
      [
        ['command', false, false],
        ['path', true, true],
        ['program', false, false],
      ],
    );
    assert.match(steps[2]!.detail!, /EACCES/);
    // The folder keeps what could not be removed, and the command is still there to run again.
    assert.equal(existsSync(p.receipt.command), true);
  } finally {
    p.done();
  }
});

test('a PATH entry the registry would not give up is a failed step, with what PowerShell said', () => {
  const p = installed();
  try {
    const sys = { ...fakeSystem('win32'), powershell: () => ({ ok: false, out: 'Access denied' }) };
    const path = removeProgram({ ...p.receipt, path: { user: p.bin } }, sys).find((s) => s.what === 'path')!;
    assert.deepEqual([path.ok, path.detail], [false, 'Access denied']);
  } finally {
    p.done();
  }
});

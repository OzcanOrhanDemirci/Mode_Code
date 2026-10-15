// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clipboardCommands, copyText, osc52, realClipboard, type ClipboardSystem } from '../../src/node/clipboard.js';

const TEXT = 'Hız sınırı ekle.\nİkinci satır: "çift" \'tek\'';

/** A computer whose programs answer as `ok` says, recording what ran, the files it made and what reached the terminal. */
function system(platform: NodeJS.Platform, env: Record<string, string | undefined>, ok: (argv: string[]) => boolean) {
  const ran: { argv: string[]; input: string; env?: Record<string, string> }[] = [];
  const files = new Map<string, string>();
  const removed: string[] = [];
  const written: string[] = [];
  const sys: ClipboardSystem = {
    platform,
    env,
    run(argv, input, e) {
      ran.push({ argv, input, ...(e ? { env: e } : {}) });
      return ok(argv);
    },
    temp(text) {
      const path = `C:\\Temp\\mode-code-copy-1\\it's.txt`;
      files.set(path, text);
      return path;
    },
    remove(path) {
      removed.push(path);
    },
    write(text) {
      written.push(text);
    },
  };
  return { sys, ran, files, removed, written };
}

const script = (argv: string[]) => Buffer.from(argv.at(-1)!, 'base64').toString('utf16le');

test('Windows: PowerShell reads the text from a UTF-8 file it is named, so every letter arrives as typed; the file goes after', () => {
  const w = system('win32', { SystemRoot: 'D:\\Win' }, () => true);
  assert.deepEqual(copyText(TEXT, w.sys), { via: 'system' });
  assert.equal(w.ran.length, 1);
  const [cmd] = w.ran;
  assert.deepEqual(cmd!.argv.slice(0, 4), ['D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(script(cmd!.argv), "Set-Clipboard -Value ([IO.File]::ReadAllText('C:\\Temp\\mode-code-copy-1\\it''s.txt', [Text.Encoding]::UTF8))");
  assert.equal(cmd!.input, '');
  assert.deepEqual([...w.files.values()], [TEXT]);
  assert.deepEqual(w.removed, ["C:\\Temp\\mode-code-copy-1\\it's.txt"]);
  assert.deepEqual(w.written, []);
  // SYSTEMROOT as some shells spell it, and no root named at all.
  assert.match(clipboardCommands('win32', { SYSTEMROOT: 'E:\\W' }, 'f')[0]!.argv[0]!, /^E:\\W\\System32\\/);
  assert.match(clipboardCommands('win32', {}, 'f')[0]!.argv[0]!, /^C:\\Windows\\System32\\/);
});

test('when the system cannot take it, the terminal is asked (OSC 52), and the file is removed all the same', () => {
  const w = system('win32', {}, () => false);
  assert.deepEqual(copyText(TEXT, w.sys), { via: 'terminal' });
  assert.deepEqual(w.written, [osc52(TEXT)]);
  assert.equal(w.removed.length, 1);
  assert.equal(osc52(TEXT), `\x1b]52;c;${Buffer.from(TEXT, 'utf8').toString('base64')}\x07`);
  // A system that fails outright: the terminal too.
  const broken = system('win32', {}, () => {
    throw new Error('spawn EPERM');
  });
  assert.deepEqual(copyText(TEXT, broken.sys), { via: 'terminal' });
  assert.equal(broken.removed.length, 1);
});

test('macOS: pbcopy, the text on its input as UTF-8; Linux: Wayland, then X, then the terminal', () => {
  const mac = system('darwin', {}, () => true);
  assert.deepEqual(copyText(TEXT, mac.sys), { via: 'system' });
  assert.deepEqual(mac.ran, [{ argv: ['pbcopy'], input: TEXT, env: { LANG: 'en_US.UTF-8' } }]);
  assert.deepEqual(mac.removed, []);

  const both = { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };
  const linux = system('linux', both, (argv) => argv[0] === 'xsel');
  assert.deepEqual(copyText(TEXT, linux.sys), { via: 'system' });
  assert.deepEqual(
    linux.ran.map((r) => [r.argv, r.input]),
    [
      [['wl-copy'], TEXT],
      [['xclip', '-selection', 'clipboard'], TEXT],
      [['xsel', '--clipboard', '--input'], TEXT],
    ],
  );
  assert.deepEqual(
    clipboardCommands('linux', { DISPLAY: ':0' }, '').map((c) => c.argv[0]),
    ['xclip', 'xsel'],
  );

  // No display at all (a server, WSL without WSLg): the terminal.
  const bare = system('linux', {}, () => true);
  assert.deepEqual(copyText(TEXT, bare.sys), { via: 'terminal' });
  assert.deepEqual(bare.ran, []);
  assert.deepEqual(bare.written, [osc52(TEXT)]);
});

test("the real system, without touching the clipboard: a program's exit decides, the text reaches its input as UTF-8, the file goes with its folder", () => {
  const node = process.execPath;
  assert.equal(realClipboard.run([node, '-e', 'process.exit(0)'], ''), true);
  assert.equal(realClipboard.run([node, '-e', 'process.exit(3)'], ''), false);
  assert.equal(realClipboard.run([join(tmpdir(), 'no-such-program-mode-code')], ''), false);
  // The expected text goes in through the environment, so the program run is fixed code.
  const same =
    "process.stdin.setEncoding('utf8');let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>process.exit(s===process.env.MODE_CODE_COPY_EXPECT?0:4))";
  assert.equal(realClipboard.run([node, '-e', same], TEXT, { MODE_CODE_COPY_EXPECT: TEXT }), true);
  assert.equal(realClipboard.run([node, '-e', same], 'other', { MODE_CODE_COPY_EXPECT: TEXT }), false);
  assert.equal(realClipboard.run([node, '-e', 'process.exit(process.env.MODE_CODE_COPY_TEST === "1" ? 0 : 5)'], '', { MODE_CODE_COPY_TEST: '1' }), true);
  const file = realClipboard.temp(TEXT);
  assert.equal(readFileSync(file, 'utf8'), TEXT);
  realClipboard.remove(file);
  assert.equal(existsSync(dirname(file)), false);
  // Already gone: nothing to say.
  realClipboard.remove(file);
});

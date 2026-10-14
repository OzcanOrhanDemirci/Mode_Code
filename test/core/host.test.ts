// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGone, hostQuery, parseHost, readHost } from '../../src/core/host.js';

test('the lookup: tasklist by its full path on Windows, ps elsewhere', () => {
  assert.deepEqual(hostQuery('win32', 25820, 'C:\\WINDOWS'), ['C:\\WINDOWS\\System32\\tasklist.exe', '/FI', 'PID eq 25820', '/FO', 'CSV', '/NH']);
  assert.equal(hostQuery('win32', 1, 'D:\\Win\\')[0], 'D:\\Win\\System32\\tasklist.exe');
  assert.equal(hostQuery('win32', 1, null)[0], 'C:\\Windows\\System32\\tasklist.exe');
  assert.equal(hostQuery('win32', 1, '')[0], 'C:\\Windows\\System32\\tasklist.exe');
  assert.deepEqual(hostQuery('linux', 4242, null), ['ps', '-o', 'comm=', '-p', '4242']);
  assert.deepEqual(hostQuery('darwin', 7, 'ignored'), ['ps', '-o', 'comm=', '-p', '7']);
});

test("tasklist's answer: the process's row, or a line in the system's language when there is none", () => {
  // Measured on Windows 11 (2026-10-14): a running session, and a number nothing runs under.
  assert.deepEqual(readHost('win32', 25820, 0, '"claude.exe","25820","Console","1","489.908 K"\r\n'), { running: true, name: 'claude.exe' });
  assert.deepEqual(readHost('win32', 999999, 0, 'INFO: No tasks are running which match the specified criteria.\r\n'), { running: false, name: null });
  assert.deepEqual(readHost('win32', 999999, 0, 'BİLGİ: Belirtilen ölçütlerle eşleşen çalışan görev yok.\r\n'), { running: false, name: null });
  assert.deepEqual(readHost('win32', 4, 0, '\r\n"System","4","Services","0","22.748 K"\r\n'), { running: true, name: 'System' });
  // What cannot be read says nothing: a failure, no output, a row of another process.
  assert.equal(readHost('win32', 5, 1, 'ERROR: Invalid argument.'), null);
  assert.equal(readHost('win32', 5, 0, ''), null);
  assert.equal(readHost('win32', 5, 0, '  \r\n'), null);
  assert.equal(readHost('win32', 5, 0, '"other.exe","55","Console","1","1 K"'), null);
  assert.deepEqual(readHost('win32', 5, 0, '"","5","Console","1","1 K"'), { running: true, name: null });
});

test("ps's answer: the program (its file name), or a failure with nothing written when there is none", () => {
  assert.deepEqual(readHost('linux', 4242, 0, 'claude\n'), { running: true, name: 'claude' });
  assert.deepEqual(readHost('darwin', 7, 0, '/Users/ada/.local/bin/claude\n'), { running: true, name: 'claude' });
  assert.deepEqual(readHost('linux', 4242, 1, ''), { running: false, name: null });
  assert.equal(readHost('linux', 4242, 1, 'something\n'), null);
  assert.equal(readHost('linux', 4242, 2, ''), null);
  assert.equal(readHost('linux', 4242, 0, ''), null);
  assert.equal(readHost('linux', 4242, 0, '/\n')?.name, null);
});

test('gone only when sure: not running, or on Windows another program under the same number', () => {
  const claude = { pid: 25820, name: 'claude.exe' };
  assert.equal(hostGone(claude, null, 'win32'), false); // the lookup could not tell
  assert.equal(hostGone(claude, { running: false, name: null }, 'win32'), true);
  assert.equal(hostGone(claude, { running: false, name: null }, 'linux'), true);
  assert.equal(hostGone(claude, { running: true, name: 'claude.exe' }, 'win32'), false);
  assert.equal(hostGone(claude, { running: true, name: 'CLAUDE.EXE' }, 'win32'), false);
  // Windows hands a freed number out again soon: another program there means the session's is gone.
  assert.equal(hostGone(claude, { running: true, name: 'notepad.exe' }, 'win32'), true);
  // Elsewhere numbers come round slowly, and a program may rename its process: the number alone decides.
  assert.equal(hostGone({ pid: 4242, name: 'claude' }, { running: true, name: 'node' }, 'linux'), false);
  // A name that could not be read on either side decides nothing.
  assert.equal(hostGone({ pid: 1, name: null }, { running: true, name: 'notepad.exe' }, 'win32'), false);
  assert.equal(hostGone(claude, { running: true, name: null }, 'win32'), false);
});

test('a recorded host: a whole positive process number, the name if there is one', () => {
  assert.deepEqual(parseHost({ pid: 12, name: 'claude.exe' }), { pid: 12, name: 'claude.exe' });
  assert.deepEqual(parseHost({ pid: 12, name: '' }), { pid: 12, name: null });
  assert.deepEqual(parseHost({ pid: 12 }), { pid: 12, name: null });
  for (const bad of [null, undefined, 5, 'x', [], {}, { pid: 0 }, { pid: -3 }, { pid: 1.5 }, { pid: '12' }])
    assert.equal(parseHost(bad), null, JSON.stringify(bad));
});

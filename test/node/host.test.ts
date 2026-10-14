// SPDX-License-Identifier: Apache-2.0
/** Looking a session's process up on this computer, with real processes: one running, one that has exited. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layout } from '../../src/core/layout.js';
import { parseHookState } from '../../src/core/session.js';
import { lookUpHost, sessionGone, withHost } from '../../src/node/host.js';

/** This program as the lookup names it: Windows names the program; ps names the main thread, which Node calls MainThread. */
const OWN = process.platform === 'win32' ? /^node\.exe$/i : /./;

/** The number of a process that ran and has exited. */
function exited(): number {
  const r = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.ok(r.pid && r.status === 0);
  return r.pid;
}

test('a running process is found with its program; one that exited is not running', () => {
  const me = lookUpHost(process.pid);
  assert.equal(me?.running, true);
  assert.match(String(me?.name), OWN);
  assert.deepEqual(lookUpHost(exited()), { running: false, name: null });
});

test("the hook's state takes the process once; the same process again is not looked up", () => {
  const fresh = parseHookState(null, 's1');
  const once = withHost(fresh, process.pid);
  assert.equal(once.host?.pid, process.pid);
  assert.match(String(once.host?.name), OWN);
  assert.equal(withHost(once, process.pid), once);
  // A process that cannot be read is still recorded, without a name.
  const gone = exited();
  assert.deepEqual(withHost(fresh, gone).host, { pid: gone, name: null });
  for (const bad of [0, -1, Number.NaN]) assert.equal(withHost(fresh, bad), fresh);
});

test('a session is gone when its recorded process is; with no record it is kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-host-'));
  try {
    const l = layout(root.replace(/\\/g, '/'));
    mkdirSync(l.sessionsDir, { recursive: true });
    const record = (id: string, host: object) =>
      writeFileSync(join(l.sessionsDir, `${id}.hook.json`), JSON.stringify({ v: 1, sessionId: id, lastRunAt: 1, blocks: {}, host }));
    record('alive', { pid: process.pid, name: process.platform === 'win32' ? 'node.exe' : 'node' });
    record('shut', { pid: exited(), name: 'claude.exe' });
    assert.equal(sessionGone(l, 'alive'), false);
    assert.equal(sessionGone(l, 'shut'), true);
    assert.equal(sessionGone(l, 'never-recorded'), false);
    if (process.platform === 'win32') {
      // Windows: the number now runs another program than the one recorded.
      record('reused', { pid: process.pid, name: 'claude.exe' });
      assert.equal(sessionGone(l, 'reused'), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

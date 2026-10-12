// SPDX-License-Identifier: Apache-2.0
/**
 * Found by the built-in self-tests on their first run: on macOS and Linux every recursive delete under the
 * home folder was refused, because /Users and /home are operating system folders and "everything inside a
 * system folder is critical". These cases keep everyday clean-up silent there, and the real protections
 * in place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bash, linuxCtx, macCtx, summary } from '../helpers/belt.js';

test('macOS: clean-up inside a project in the home folder passes in silence', async () => {
  for (const c of ['rm -rf dist', 'rm -rf node_modules .next build', 'rm -rf /Users/ada/dev/app/dist', 'mv dist dist-old', 'find . -name "*.log" -delete'])
    assert.equal(summary(await bash(c, macCtx())), 'allow', c);
});

test('macOS: temporary folders under /private and /var are temporary, not system folders', async () => {
  for (const c of ['rm -rf /private/tmp/build-1', 'rm -rf /tmp/build-1', 'rm -rf /var/folders/xy/abc123/T/build-1', 'rm -rf $TMPDIR/build-1'])
    assert.equal(summary(await bash(c, macCtx())), 'allow', c);
});

test('macOS: a project on an external volume is a project like any other', async () => {
  const ctx = macCtx({ cwd: '/Volumes/SSD/dev/app', projectDir: '/Volumes/SSD/dev/app' });
  assert.equal(summary(await bash('rm -rf dist', ctx)), 'allow');
  assert.equal(summary(await bash('rm -rf /Volumes/SSD/dev/app', ctx)), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm -rf /Volumes/SSD', ctx)), 'deny fs.delete-critical');
});

test('macOS: other people, the system and the home folder itself stay protected', async () => {
  for (const c of ['rm -rf /Users/other', 'rm -rf /Users', 'rm -rf /Applications/Xcode.app', 'rm -rf /Library/Caches', 'rm -rf ~', 'rm -rf ~/Documents'])
    assert.equal(summary(await bash(c, macCtx())), 'deny fs.delete-critical', c);
});

test('Linux: clean-up in the home folder passes; /home itself and other homes do not', async () => {
  assert.equal(summary(await bash('rm -rf build target', linuxCtx())), 'allow');
  assert.equal(summary(await bash('rm -rf /home/ada/dev/app/target', linuxCtx())), 'allow');
  assert.equal(summary(await bash('rm -rf /var/tmp/x', linuxCtx())), 'allow');
  assert.equal(summary(await bash('rm -rf /home/other', linuxCtx())), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm -rf /home', linuxCtx())), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm -rf /usr/lib/x', linuxCtx())), 'deny fs.delete-critical');
});

test('Linux: a project under /srv, /opt or WSL /mnt/c is a project; the system folder itself is not', async () => {
  for (const dir of ['/srv/app', '/opt/app', '/mnt/c/dev/app']) {
    const ctx = linuxCtx({ cwd: dir, projectDir: dir });
    assert.equal(summary(await bash('rm -rf dist', ctx)), 'allow', dir);
  }
  // A session started in /usr does not make /usr a project whose insides may be deleted.
  const usr = linuxCtx({ cwd: '/usr', projectDir: '/usr' });
  assert.equal(summary(await bash('rm -rf /usr/lib/x', usr)), 'deny fs.delete-critical');
});

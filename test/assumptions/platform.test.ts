// SPDX-License-Identifier: Apache-2.0
/**
 * Assumptions the belt makes about the machine, measured on the machine the tests run on. CI runs them on
 * Windows, Linux and macOS, so each assumption is checked where it applies; elsewhere a test says why it
 * skipped. The doctor measures the same facts on the person's machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBuiltin } from 'node:module';
import { caseInsensitive } from '../../src/core/paths.js';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { cloneDefaults } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { beltContext } from '../../src/node/context.js';
import { home, platform, toolPath } from '../../src/node/env.js';
import { locateGitBash } from '../../src/app/doctor/facts.js';

test('letter case: where the disk ignores it, the belt ignores it too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tc-case-'));
  try {
    writeFileSync(join(dir, 'probe.txt'), 'x');
    const diskIgnores = existsSync(join(dir, 'PROBE.TXT'));
    // The belt may be stricter than the disk (it then protects more); never laxer.
    if (diskIgnores) assert.equal(caseInsensitive(platform), true, `${platform}: the disk ignores case but the belt compares case-sensitively`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the temporary folder, however this machine spells it, is a place where deleting is free', async () => {
  const ctx = beltContext({ cwd: toolPath(tmpdir()), config: cloneDefaults(), layout: layout(toolPath(join(tmpdir(), 'tc-none'))), lang: 'en' });
  const spellings = new Set([toolPath(tmpdir()), toolPath(realpathSync.native(tmpdir()))]);
  if (platform === 'darwin') {
    spellings.add('/tmp');
    spellings.add('/private/tmp');
  }
  if (platform === 'linux') spellings.add('/tmp');
  for (const p of spellings) {
    const d = await evaluateToolCall('Bash', { command: `rm -rf "${p}/tc-probe-cache"` }, ctx);
    assert.equal(d.verdict, 'allow', `${p}: ${d.findings.map((f) => f.rule).join(', ')}`);
  }
});

test('macOS: /tmp is a link to /private/tmp, as the belt assumes', (t) => {
  if (platform !== 'darwin') return t.skip('macOS only');
  assert.equal(realpathSync('/tmp'), '/private/tmp');
});

test('Windows: Git Bash spells the home folder and /tmp the way the belt resolves them', (t) => {
  if (platform !== 'win32') return t.skip('Windows only');
  const bash = locateGitBash(process.env, platform);
  if (!bash) return t.skip('Git Bash is not installed here');
  const r = spawnSync(bash, ['-c', 'cygpath -w /tmp; cygpath -w "$HOME"'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  const [tmp, gitHome] = r.stdout
    .trim()
    .split(/\r?\n/)
    .map((x) => toolPath(x.trim()));
  const longTmp = toolPath(realpathSync.native(tmp!));
  assert.equal(longTmp.toLowerCase(), toolPath(realpathSync.native(join(homedir(), 'AppData', 'Local', 'Temp'))).toLowerCase(), "/tmp is the user's Temp");
  assert.equal(toolPath(realpathSync.native(gitHome!)).toLowerCase(), toolPath(realpathSync.native(homedir())).toLowerCase(), '$HOME is the user profile');
});

test('Windows: PowerShell names the same home folder', (t) => {
  if (platform !== 'win32') return t.skip('Windows only');
  for (const shell of ['pwsh', 'powershell']) {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '$env:USERPROFILE'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (r.error) continue;
    assert.equal(toolPath(r.stdout.trim()).toLowerCase(), home().toLowerCase(), shell);
  }
});

test('the JavaScript and Node.js features the tool relies on are here', () => {
  assert.equal(typeof Intl.Segmenter, 'function', 'grapheme widths');
  assert.ok(/\p{Emoji_Presentation}/u.test('🔴'), 'Unicode property escapes');
  assert.equal(typeof structuredClone, 'function');
  assert.ok(isBuiltin('node:sqlite'), 'the session index');
  assert.ok(Number(statfsSync(tmpdir()).bavail) >= 0, 'free space');
  assert.equal(typeof realpathSync.native, 'function', 'links and short names');
});

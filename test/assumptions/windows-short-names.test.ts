// SPDX-License-Identifier: Apache-2.0
/**
 * Assumption, measured on this machine: Windows gives long folder names an 8.3 short name, and the belt
 * judges a write through that name as it judges the long one, however the data folder itself is spelled.
 * Runs on Windows where the volume has short names; elsewhere it says why it skipped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { layout } from '../../src/core/layout.js';
import { cloneDefaults } from '../../src/core/config.js';
import { beltContext } from '../../src/node/context.js';
import { toolPath } from '../../src/node/env.js';

function shortName(path: string): string | null {
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${path.replace(/\//g, '\\')}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  const s = (r.stdout ?? '').trim();
  return s ? toolPath(s) : null;
}

test('a write through the 8.3 short name of the data folder is refused like one through its long name', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'tc-short-')));
  try {
    const long = toolPath(join(base, '.mode-code-probe'));
    mkdirSync(long);
    const short = shortName(long);
    if (!short || short.toLowerCase() === long.toLowerCase()) return t.skip('this volume gives no 8.3 short names (fsutil 8dot3name)');
    assert.match(short.split('/').pop()!, /~\d/);
    for (const spelled of [long, short]) {
      const ctx = beltContext({ cwd: toolPath(base), config: cloneDefaults(), layout: layout(spelled), lang: 'en' });
      for (const target of [`${long}/config.json`, `${short}/config.json`]) {
        const d = await evaluateToolCall('Write', { file_path: target, content: '{}' }, ctx);
        assert.equal(d.verdict, 'deny', `data folder spelled ${spelled}, write to ${target}`);
        assert.ok(d.findings.some((f) => f.rule === 'self.tool-files'));
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the temporary folder, as this machine spells it, is a place where deleting is free', async () => {
  const tmp = toolPath(tmpdir());
  const ctx = beltContext({ cwd: tmp, config: cloneDefaults(), layout: layout(toolPath(join(tmpdir(), 'tc-data-none'))), lang: 'en' });
  for (const p of [tmp, toolPath(realpathSync.native(tmpdir()))]) {
    const d = await evaluateToolCall('Bash', { command: `rm -rf "${p}/tc-probe-build"` }, ctx);
    assert.equal(d.verdict, 'allow', `${p}: ${d.findings.map((f) => f.rule).join(', ')}`);
  }
});

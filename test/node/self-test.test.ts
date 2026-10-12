// SPDX-License-Identifier: Apache-2.0
// The installer's self-test runs the real hook program, and what its samples trigger is not recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selfTest } from '../../src/node/install.js';
import { layout } from '../../src/core/layout.js';

test('the self-test passes and leaves no belt events behind', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-selftest-'));
  try {
    // The hook from source, through tsx, the way the built one runs from dist.
    const wrapper = join(root, 'hook-from-source.mjs');
    const main = pathToFileURL(join(import.meta.dirname, '../../src/hook/main.ts')).href;
    const tsx = import.meta.resolve('tsx/esm/api');
    writeFileSync(wrapper, `import { register } from ${JSON.stringify(tsx)};\nregister();\nawait import(${JSON.stringify(main)});\n`);
    const l = layout(root.split('\\').join('/'));
    const r = selfTest(process.execPath, wrapper, l);
    assert.equal(r.ok, true, r.detail);
    assert.equal(existsSync(l.eventsDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

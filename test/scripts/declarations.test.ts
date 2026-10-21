// SPDX-License-Identifier: Apache-2.0
// Where Claude Code laid its declarations for mods (scripts/declarations.mjs): per version, the newest when several.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript script, run by hand
import { declarationsFor } from '../../scripts/declarations.mjs';

test('the declarations of exactly the version asked for, the newest of its folders; none laid, null', () => {
  const temp = mkdtempSync(join(tmpdir(), 'decl-'));
  try {
    const lay = (version: string, hash: string, at: number) => {
      const dir = join(temp, 'claude', 'bundled-skills', version, hash, 'plugin-authoring', 'types');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'claude-code.d.ts');
      writeFileSync(file, 'export {};\n');
      utimesSync(file, at, at);
      return file;
    };
    assert.equal(declarationsFor('2.1.306', temp), null);
    lay('2.1.305', 'a1', 1000);
    assert.equal(declarationsFor('2.1.306', temp), null);
    // A folder of the version with no guide in it is no declaration.
    mkdirSync(join(temp, 'claude', 'bundled-skills', '2.1.306', 'empty'), { recursive: true });
    assert.equal(declarationsFor('2.1.306', temp), null);
    const older = lay('2.1.306', 'b1', 1000);
    assert.equal(declarationsFor('2.1.306', temp), older);
    const newer = lay('2.1.306', 'b2', 2000);
    assert.equal(declarationsFor('2.1.306', temp), newer);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

// SPDX-License-Identifier: Apache-2.0
/**
 * docs/design.md says which test keeps each rule. A rule whose test is still to come names the stage that brings it
 * ("D3"); every other path it names is a file in the repository, so the page never claims a check nobody runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const page = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8');

test('every test and source file the design page names exists, unless its row names the stage that brings it', () => {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const line of page.split('\n')) {
    // Only a table row names its stage; prose that mentions a stage still names files that exist.
    const later = line.startsWith('| ') && /\bD\d+\b/.test(line);
    const paths = [...line.matchAll(/`((?:test|src)\/[^`\s]+\.(?:ts|tsx|mjs))`/g)].map((m) => m[1]!);
    const absent = paths.filter((p) => !existsSync(root + p));
    if (!later) missing.push(...absent);
    // A stage mark on a row whose files all exist is stale: the stage came, and the row should say the rule is kept.
    else if (paths.length && !absent.length) stale.push(line.trim());
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(stale, []);
});

test('the enforcement table names a test for every rule', () => {
  const table = page.slice(page.indexOf('## Where it is enforced'));
  const rows = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Rule') && !l.startsWith('| ---'));
  assert.ok(rows.length >= 8, `${rows.length} rows`);
  for (const r of rows) assert.match(r, /`test\//, r);
});

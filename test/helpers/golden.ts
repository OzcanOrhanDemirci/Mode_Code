// SPDX-License-Identifier: Apache-2.0
/**
 * Golden files: text a person reads (command output, reports) is kept in test/golden/ and compared whole,
 * so any change to it shows up in review. `UPDATE_GOLDEN=1 npm test` writes the current text instead; the
 * diff then says exactly what changed.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'golden');

export function golden(name: string, actual: string): void {
  const path = join(DIR, `${name}.txt`);
  const text = actual.endsWith('\n') ? actual : actual + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    if (process.env.UPDATE_GOLDEN !== '1') assert.fail(`golden file ${name}.txt did not exist; it was written now: review it and run the tests again`);
    return;
  }
  assert.equal(text, readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), `golden file ${name}.txt differs (UPDATE_GOLDEN=1 rewrites it)`);
}

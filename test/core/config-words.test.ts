// SPDX-License-Identifier: Apache-2.0
/**
 * Why a value of the settings is refused, in the person's language (src/core/config-words.ts): every reason the
 * settings' own check gives (src/core/config.ts) has its Turkish words, read from that file's source so a new reason
 * cannot be added without them; English stays as it is, and a reason it does not know is said as it is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { problemWords } from '../../src/core/config-words.js';
import { parseConfig, setConfigValue } from '../../src/core/config.js';

const SOURCE = readFileSync(new URL('../../src/core/config.ts', import.meta.url), 'utf8');

/** Every reason in the source: written whole, or with its numbers and names filled in as a run would. */
function reasons(): string[] {
  const out = new Set<string>();
  for (const m of SOURCE.matchAll(/detail: (['"])((?:(?!\1).)+)\1/g)) out.add(m[2]!);
  for (const m of SOURCE.matchAll(/detail: `([^`]+)`/g)) out.add(m[1]!.replace(/\$\{RULES[^}]+\}/g, 'ask').replace(/\$\{[^}]+\}/g, '7'));
  return [...out];
}

test('every reason the settings check gives has its Turkish words', () => {
  const all = reasons();
  assert.ok(all.length >= 30, `found ${all.length}`);
  const untold = all.filter((d) => problemWords(d, 'tr') === d);
  assert.deepEqual(untold, []);
  for (const d of all) assert.doesNotMatch(problemWords(d, 'tr'), /\bexpected\b|\bnot a\b|\bmust\b/, d);
});

test('English is said as the check wrote it; a reason it does not know, as it is', () => {
  assert.equal(problemWords('expected 1 to 72', 'en'), 'expected 1 to 72');
  assert.equal(problemWords('Unexpected token } in JSON', 'tr'), 'Unexpected token } in JSON');
});

test('a run of the check, refused in Turkish with its numbers and names kept', () => {
  const r = setConfigValue(parseConfig(null).config, 'quota.staleMinutes', 9999);
  assert.equal(problemWords(r.problems[0]!.detail, 'tr'), '5 ile 1440 arası bir sayı bekleniyordu');
  const view = setConfigValue(parseConfig(null).config, 'view', 'loud');
  assert.equal(problemWords(view.problems[0]!.detail, 'tr'), 'simple, recommended ya da detailed bekleniyordu');
});

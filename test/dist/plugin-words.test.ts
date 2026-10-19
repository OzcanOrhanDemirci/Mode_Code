// SPDX-License-Identifier: Apache-2.0
// The plugin carries only the messages its code names (scripts/plugin-words.mjs): Claude Code reads no hooks module
// over 1 MiB, and the two languages' dictionaries were nearly half of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { tIn, type MessageKey } from '../../src/core/i18n/index.js';
import { built, ROOT } from '../helpers/proc.js';
// @ts-expect-error: a plain JavaScript script, run by the build
import * as words from '../../scripts/plugin-words.mjs';

const wordsUsed = words.wordsUsed as (code: string, keys: string[]) => Set<string>;
const keys = Object.keys(en);

test('a message is kept when the code names it: the key, the key after @, a template that starts it, a dotted string above it', () => {
  const all = ['a.one', 'a.two', 'b.x.one', 'b.x.two', 'b.y', 'c.z', 'c.z.one', 'd.q', 'e.r'];
  const code = 'f("a.one");g(`b.x.${k}`);h("@d.q");j(k+".one","c.z");m("e");';
  assert.deepEqual([...wordsUsed(code, all)].sort(), ['a.one', 'b.x.one', 'b.x.two', 'c.z', 'c.z.one', 'd.q']);
  // A word without a dot is no prefix: "e" names no message under it, nor does a string that only ends like a key.
  assert.equal(wordsUsed('x("e");y("the a.two")', all).has('a.two'), false);
});

test("every key is spelled as the rule reads it: letters, digits, dashes and a template's stars, separated by dots", () => {
  for (const k of keys) assert.match(k, /^[A-Za-z][\w*-]*(?:\.[\w*-]+)*$/, k);
});

test('a message the plugin does not carry shows its key, never fails', () => {
  assert.equal(tIn('tr', 'no.such.key' as MessageKey, { n: 1 }), 'no.such.key');
});

/** The object literal assigned to `name` in the bundle, and where it starts and ends. */
function literal(code: string, name: string): { value: Record<string, string>; start: number; end: number } {
  const m = new RegExp(`var ${name}\\s*=\\s*\\{`).exec(code);
  assert.ok(m, `no dictionary ${name} in the plugin`);
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let quote = '';
  for (let i = start; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const value = new Function(`return ${code.slice(start, i + 1)}`)() as Record<string, string>;
      return { value, start, end: i + 1 };
    }
  }
  throw new Error(`the dictionary ${name} does not end`);
}

test('the built plugin carries every message its code names, the same in both languages, and nothing else', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const file = join(ROOT, 'dist', 'plugin', 'hooks', 'register.js');
  const code = readFileSync(file, 'utf8');
  const e = literal(code, 'en');
  const r = literal(code, 'tr');
  const [first, second] = e.start < r.start ? [e, r] : [r, e];
  const rest = code.slice(0, first.start) + code.slice(first.end, second.start) + code.slice(second.end);
  const named = [...wordsUsed(rest, keys)].sort();
  assert.deepEqual(Object.keys(e.value).sort(), named);
  assert.deepEqual(Object.keys(r.value).sort(), named);
  for (const k of named) {
    assert.equal(e.value[k], en[k as MessageKey], k);
    assert.equal(r.value[k], tr[k as MessageKey], k);
  }
  // Room left under what Claude Code reads.
  assert.ok(statSync(file).size < 0.9 * 1024 * 1024, `register.js is ${statSync(file).size} bytes`);
});

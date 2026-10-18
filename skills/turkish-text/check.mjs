#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Turkish text, measured (the turkish-text skill): long dashes, and the question particle against the word before it
 * (vowel harmony: "geldi mi", "oldu mu"). A particle written joined to its word ("geldimi") is left to reading:
 * "anlamı" and "durumu" are words. Code blocks in Markdown are left out. Nothing is changed. Node.js only, no packages.
 *
 * Usage: node check.mjs <file or folder>... [--json]
 * Exit code 0: nothing found; 1: something to look at; 2: nothing could be read.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEXT = new Set(['.md', '.txt', '.arb', '.json', '.html', '.typ', '.yaml', '.yml', '.dart', '.ts', '.tsx', '.js', '.mjs']);
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', '.dart_tool', '.next', 'coverage']);
const VOWELS = 'aıoueiöüâîû';

/** The question particle a word takes by its last vowel: a, ı → mı; e, i → mi; o, u → mu; ö, ü → mü. Null: no vowel. */
export function particleFor(word) {
  const w = word.toLocaleLowerCase('tr');
  for (let i = w.length - 1; i >= 0; i--) {
    const v = w[i];
    if (!VOWELS.includes(v)) continue;
    if ('aıâ'.includes(v)) return 'mı';
    if ('eiî'.includes(v)) return 'mi';
    if ('ouû'.includes(v)) return 'mu';
    return 'mü';
  }
  return null;
}

/** What one line holds: long dashes, and a question particle that disagrees with its word. */
export function lineFindings(line) {
  const out = [];
  if (/[—–]/.test(line)) out.push({ kind: 'dash', text: line.match(/[—–]/)[0] });
  // A particle written apart: "<word> mı/mi/mu/mü" with its endings (mısın, miydi, musunuz …).
  for (const m of line.matchAll(
    /([\p{L}]+)\s+(m[ıiuü])(?=(?:s[ıiuü]n|y[ıiuü]m|y[ıiuü]z|s[ıiuü]n[ıiuü]z|d[ıiuü]r|yd[ıiuü]|ym[ıiuü]ş|l[ae]r)?(?:[^\p{L}]|$))/gu,
  )) {
    const want = particleFor(m[1]);
    const got = m[2].toLocaleLowerCase('tr');
    if (want && got !== want && m[1].length > 1) out.push({ kind: 'harmony', text: `${m[1]} ${m[2]}`, want: `${m[1]} ${want}` });
  }
  return out;
}

/** Every finding in a text, by line; fenced code in Markdown is left out. */
export function textFindings(text, markdown = false) {
  const out = [];
  let fenced = false;
  for (const [i, line] of text.split('\n').entries()) {
    if (markdown && /^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const f of lineFindings(markdown ? line.replace(/`[^`]*`/g, '') : line)) out.push({ line: i + 1, ...f });
  }
  return out;
}

function files(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name) || e.name.startsWith('.')) return [];
    const p = join(path, e.name);
    return e.isDirectory() ? files(p) : TEXT.has(extname(e.name).toLowerCase()) ? [p] : [];
  });
}

function main(argv) {
  const targets = argv.filter((a) => !a.startsWith('--'));
  const list = (targets.length ? targets : ['.']).flatMap((t) => files(resolve(t)));
  if (!list.length) {
    console.error('turkish-text: nothing to read');
    return 2;
  }
  const found = list.flatMap((f) => textFindings(readFileSync(f, 'utf8'), f.toLowerCase().endsWith('.md')).map((x) => ({ file: f, ...x })));
  if (argv.includes('--json')) console.log(JSON.stringify({ files: list.length, found }, null, 2));
  else {
    for (const x of found) console.log(`${x.file}:${x.line}  ${x.kind === 'dash' ? `long dash (${x.text})` : `"${x.text}" → "${x.want}"`}`);
    console.log(`${list.length} file(s) read, ${found.length} to look at`);
  }
  return found.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));

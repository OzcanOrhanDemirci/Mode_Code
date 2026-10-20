// SPDX-License-Identifier: Apache-2.0
/**
 * Every place a message sends the person to ("Working › Parallel agents", "Ayarlar › Özellikler") is a real place in the
 * control center, in that message's language: each part a page under the one before, and a last part that may be a
 * setting's name on that page (from the catalog). A reference that leads nowhere is the price of a renamed page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, type MessageKey } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import type { Lang } from '../../src/core/i18n/index.js';
import { buildTree } from '../../src/tui/tree.js';
import type { NavNode } from '../../src/tui/nav.js';
import { allSettingPaths, nameOf, settingOf } from '../../src/core/ux/catalog.js';
import { FakeData, NOW } from './harness.js';

/** The words a message uses for the control center itself, before its first part. */
const CENTER = ['control center', 'kontrol merkezi'];

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
/** A part's words without the punctuation around a reference: brackets, quotes, a sentence's end. */
const bare = (s: string) => s.replace(/^[\s("'`]+|[\s)"'`.,;:!?]+$/g, '');

/**
 * The forms the last part may name a place by: it ends at a comma, or before a Turkish postposition ("Çalışma ›
 * Paralel ajanlar altında aç"), and its last word may carry a case ending after an apostrophe ("Paralel ajanlar'da").
 */
function lastForms(part: string): string[] {
  const s = part.replace(/\s+altınd[ae]n?(?:\s.*)?$/u, '');
  const forms = [s];
  const m = /^(.*?\p{L})'\p{L}+(?:\s.*)?$/u.exec(s);
  if (m) forms.push(m[1]!);
  return forms.map(norm);
}

interface Place {
  node: NavNode | null;
  address: string;
  children: NavNode[];
}

function references(text: string): { parts: string[]; whole: string }[] {
  // A chain is two or more parts joined by " › "; it ends where a sentence or a bracket does.
  const out: { parts: string[]; whole: string }[] = [];
  const re = /([^.:;()"\n]*?)((?: › [^›.:;()"\n]+)+)/g;
  for (const m of text.matchAll(re)) {
    const left = m[1]!;
    const rest = m[2]!.split(' › ').slice(1);
    out.push({ parts: [left, ...rest], whole: (left + m[2]).trim() });
  }
  return out;
}

/**
 * Resolves a chain against the tree: the longest tail of the first part that names a page (any page of that name:
 * two may share one at different depths), then each part a child of the one before. Null when one way leads through.
 */
function resolveChain(roots: NavNode[], parts: string[], lang: Lang): string | null {
  const all: { node: NavNode; address: string }[] = [];
  const walk = (nodes: NavNode[], prefix: string, depth: number) => {
    for (const n of nodes) {
      const address = prefix ? `${prefix}/${n.id}` : n.id;
      all.push({ node: n, address });
      if (depth < 3 && n.children) walk(n.children(), address, depth + 1);
    }
  };
  walk(roots, '', 1);
  const words = bare(parts[0]!).split(' ');
  let starts: Place[] = [];
  for (let i = 0; i < words.length && !starts.length; i++) {
    const tail = norm(words.slice(i).join(' '));
    if (CENTER.includes(tail)) starts = [{ node: null, address: '', children: roots }];
    else starts = all.filter((x) => norm(x.node.label) === tail).map((x) => ({ node: x.node, address: x.address, children: x.node.children?.() ?? [] }));
  }
  if (!starts.length) return `"${bare(parts[0]!)}" is no page`;
  const why = starts.map((from) => follow(from, parts.slice(1), lang));
  return why.includes(null) ? null : why[0]!;
}

/** Walks the rest of a chain from one page: each part a child, the last one a child or a setting on that page. */
function follow(from: Place, rest: string[], lang: Lang): string | null {
  let at = from;
  for (let j = 0; j < rest.length; j++) {
    const last = j === rest.length - 1;
    const part = last ? bare(rest[j]!.split(',')[0]!) : rest[j]!.trim();
    const forms = last ? lastForms(part) : [norm(part)];
    const child: NavNode | undefined = at.children.find((c) => forms.includes(norm(c.label)));
    if (child) {
      const address: string = at.address ? `${at.address}/${child.id}` : child.id;
      at = { node: child, address, children: child.children?.() ?? [] };
      continue;
    }
    const here: string = at.address;
    const setting = last && allSettingPaths().find((p) => settingOf(p)!.def.page === here && forms.includes(norm(nameOf(p, lang))));
    if (setting) return null;
    return `"${part}" is not under ${here || 'the control center'}`;
  }
  return null;
}

for (const [lang, dict] of [
  ['en', en],
  ['tr', tr],
] as const) {
  test(`every "A › B" a message names is a real place (${lang})`, () => {
    const roots = buildTree(new FakeData(lang, { view: 'detailed' }), lang, NOW);
    const broken: string[] = [];
    let seen = 0;
    for (const k of Object.keys(dict) as MessageKey[])
      for (const r of references(dict[k])) {
        seen++;
        const why = resolveChain(roots, r.parts, lang);
        if (why) broken.push(`${k}: ${r.whole}: ${why}`);
      }
    assert.ok(seen >= 10, `only ${seen} references found: the reader of references is broken`);
    assert.deepEqual(broken, []);
  });
}

test('the reader of references finds a broken one, and a setting named as the last part', () => {
  const roots = buildTree(new FakeData('en', { view: 'detailed' }), 'en', NOW);
  const one = (text: string) => resolveChain(roots, references(text)[0]!.parts, 'en');
  assert.equal(one('Pick it under Working › Modes and ways of working.'), null);
  assert.equal(one('Turn them on in the cockpit (/0) or under Working › Parallel agents.'), null);
  assert.equal(one('With it on (control center › Working › Parallel agents), a number can be set.'), null);
  assert.equal(one('The daily check is off: Settings › Language and view › Check for updates daily.'), null);
  assert.match(one('Modes are off (Settings › Moods).') ?? '', /"Moods" is not under settings/);
  assert.match(one('See Nowhere › Modes.') ?? '', /is no page/);
  // A last part is the whole name, not the start of one: "Memory folders" is no page because "Memory" is.
  assert.match(one('Add one under Settings › Memory folders.') ?? '', /"Memory folders" is not under settings/);
  const trRoots = buildTree(new FakeData('tr', { view: 'detailed' }), 'tr', NOW);
  const bir = (text: string) => resolveChain(trRoots, references(text)[0]!.parts, 'tr');
  assert.equal(bir("Çalışma › Paralel ajanlar'da verilen sayı kadar açar."), null);
  assert.equal(bir('Çalışma › Paralel ajanlar altında aç, sonra yaz.'), null);
  assert.equal(bir("Bak: Claude Code › Hook'lar."), null);
});

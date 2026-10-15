// SPDX-License-Identifier: Apache-2.0
/**
 * Every line the plugin shows as a toast fits the toast: Claude Code draws it in a small box over the
 * transcript's corner, about 40 columns wide, and cuts it with "…" after three lines (measured on the
 * person's screen, 2026-10-15). A text that is cut loses its end, often the part that says what to do.
 *
 * The lines are found in the plugin's source: what `$.ui.toast` is given, and the first line of what a
 * control answers (a press on the strip shows that line as a toast). Each is filled with sample values,
 * wrapped as the box wraps, in both languages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { cells } from '../../src/core/controls.js';
import { APP_ID, APP_NAME } from '../../src/core/app.js';

/** The toast box: columns of text (a little under what was measured, for the frame) and lines before the cut. */
const COLUMNS = 38;
const LINES = 3;

const source = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'mod', 'register.ts'), 'utf8');
const keys = Object.keys(en) as (keyof typeof en)[];

/** The arguments of each call to `callee(`, as written (balanced brackets, strings skipped). */
function callArgs(text: string, callee: RegExp): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(callee)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let start = i;
    const args: string[] = [];
    for (; i < text.length; i++) {
      const ch = text[i]!;
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '/' && text[i + 1] === '/') i = text.indexOf('\n', i);
      else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) {
        args.push(text.slice(start, i));
        start = i + 1;
      }
    }
    args.push(text.slice(start, i));
    out.push(args);
  }
  return out;
}

/** The message keys an argument names: each literal key, and every key a template's prefix can build. */
function keysIn(arg: string): string[] {
  const found = new Set<string>();
  for (const m of arg.matchAll(/'([a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)) if (m[1]! in en) found.add(m[1]!);
  for (const m of arg.matchAll(/`([a-zA-Z]+(?:\.[a-zA-Z]+)*\.)\$\{/g)) for (const k of keys) if (k.startsWith(m[1]!)) found.add(k);
  return [...found];
}

/** A control's body: from its signature to the next top-level function. */
const controlBody = source.slice(source.indexOf('async function control('), source.indexOf('async function closeSession('));

/** Keys reached another way: the line bypass ends with, the first line of the menu (both shown as toasts). */
const INDIRECT = ['bypass.summary', 'ctl.menu.now', 'ctl.center.tab', 'ctl.center.window'];

/** `$.ui.toast(text, …)`; a control's `say(text, notes, toast)`: its text (the first line is the toast) and its toast. */
const TOAST_KEYS = [
  ...new Set([
    ...callArgs(source, /\$\.ui\.toast\(/g).flatMap((a) => keysIn(a[0] ?? '')),
    ...callArgs(controlBody, /\bsay\(/g).flatMap((a) => [...keysIn(a[0] ?? ''), ...keysIn(a[2] ?? '')]),
    ...INDIRECT,
  ]),
].sort();

/**
 * The tool's names as long as they ship (nine letters each), written as letters a rename does not rewrite: a
 * renamed copy (the rename rehearsal) measures the same texts, not a longer name in them.
 */
const SHIPPED_ID = 'i'.repeat(9);
const SHIPPED_NAME = 'N'.repeat(9);

/** Sample values: the longest a parameter usually is; anything else a word of eight letters. */
const SAMPLE: Record<string, string> = {
  controls: '🔍 araştırma · otonom · akış 2/4 · ⚡ bypass · 12',
  steps: 'araştırma → plan → onay → kod',
  quota: 'hafta %77 · 5s %10',
  until: '16:12',
  hours: '2',
  minutes: '120',
  count: '12',
  n: '12',
  of: '12',
  week: '%77',
  target: '%99',
  budget: '+10',
  checks: 'Güvenlik ağı, Proje',
  cmd: `${SHIPPED_ID} sync`,
};

/** `text` with its parameters filled and the tool's names as long as they ship. */
function filled(text: string): string {
  return text
    .split(APP_ID)
    .join(SHIPPED_ID)
    .split(APP_NAME)
    .join(SHIPPED_NAME)
    .replace(/\{(\w+)\}/g, (_, p: string) => SAMPLE[p] ?? 'xxxxxxxx');
}

/** Lines the box takes for `text`, wrapped at word boundaries as a terminal box wraps. */
function wrapped(text: string): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    const w = cells(word);
    if (used === 0) used = w;
    else if (used + 1 + w <= COLUMNS) used += 1 + w;
    else {
      lines++;
      used = w;
    }
    while (used > COLUMNS) {
      lines++;
      used -= COLUMNS;
    }
  }
  return lines;
}

test('the toast lines are found: the plugin shows these, and each is a message', () => {
  for (const k of ['ctl.auto.refusedToast', 'ctl.bypass.started', 'bypass.summary', 'auto.toast.starting', 'flow.toast.start', 'mod.memory.auth'])
    assert.ok(TOAST_KEYS.includes(k), k);
  assert.ok(TOAST_KEYS.length > 60, String(TOAST_KEYS.length));
});

test('an error text of any length comes last in a toast: what to do is never the part cut', () => {
  const free = (k: string) => (k === 'ctl.close.failed' ? '{reason}' : '{detail}');
  for (const k of TOAST_KEYS)
    for (const table of [en, tr]) {
      const text = table[k as keyof typeof en];
      if (text.includes(free(k))) assert.ok(/^\W*$/.test(text.slice(text.lastIndexOf(free(k)) + free(k).length)), `${k}: ${text}`);
    }
});

test('every toast is one line that fits the box, in both languages', () => {
  const problems: string[] = [];
  for (const k of TOAST_KEYS)
    for (const [lang, table] of [
      ['en', en],
      ['tr', tr],
    ] as const) {
      const text = filled(table[k as keyof typeof en]);
      if (text.includes('\n')) problems.push(`${lang} ${k}: a line break (the box shows it as a mark)`);
      else if (wrapped(text) > LINES) problems.push(`${lang} ${k}: ${wrapped(text)} lines: ${text}`);
    }
  assert.deepEqual(problems, []);
});

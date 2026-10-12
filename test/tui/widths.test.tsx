// SPDX-License-Identifier: Apache-2.0
/**
 * Every screen of the control center, in both languages, at narrow, usual and wide terminals, with and
 * without the plain (accessible) mode: no drawn line is wider than the terminal. A line that is too wide
 * wraps or is cut by the terminal and garbles the layout, and Turkish labels run longer than English ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allEntries } from '../../src/tui/nav.js';
import { buildTree } from '../../src/tui/tree.js';
import { textWidth } from '../../src/node/width.js';
import { setLanguage, type Lang } from '../../src/core/i18n/index.js';
import { draw, FakeData, NOW } from './harness.js';

const WIDTHS = [60, 84, 132];

for (const lang of ['en', 'tr'] as Lang[]) {
  test(`every screen fits the terminal width (${lang})`, { timeout: 300_000 }, async () => {
    setLanguage(lang);
    const data = new FakeData(lang, { view: 'detailed' });
    const addresses = allEntries(buildTree(data, lang, NOW), 'detailed', 3, 6).map((e) => e.address);
    assert.ok(addresses.length >= 30, `only ${addresses.length} screens`);
    const too: string[] = [];
    for (const columns of WIDTHS)
      for (const plain of [false, true]) {
        if (plain && columns !== 84) continue;
        // A few screens at a time: each draws in its own fake terminal.
        for (let i = 0; i < addresses.length; i += 6) {
          await Promise.all(
            addresses.slice(i, i + 6).map(async (address) => {
              const s = await draw(new FakeData(lang, { view: 'detailed' }), { columns, rows: 40, address, plain });
              try {
                for (const line of s.text().split('\n'))
                  if (textWidth(line) > columns)
                    too.push(`${columns}${plain ? ' plain' : ''} ${address}: ${textWidth(line)} > ${columns}: ${line.trim().slice(0, 60)}`);
              } finally {
                s.close();
              }
            }),
          );
        }
      }
    assert.deepEqual(too.slice(0, 15), []);
  });
}

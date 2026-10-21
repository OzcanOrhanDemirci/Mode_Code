// SPDX-License-Identifier: Apache-2.0
/**
 * A list page (Settings › Projects; the memory's folders work the same way): a row is added by typing it, one in the
 * wrong form is refused with the form it needs, and a row goes only on a second press, which Esc takes back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY } from './harness.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('projects: added by typing, refused in the wrong form, removed only on the second press', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'memory/names', rows: 40 });
  try {
    assert.match(flat(s.text()), /No projects yet\./);
    await s.press('a');
    await s.type('shop: Shop, Store | C:/work/shop');
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'projects', value: [{ id: 'shop', names: ['Shop', 'Store'], path: 'C:/work/shop' }] }]);
    assert.match(flat(s.text()), /shop: Shop, Store/);

    await s.press('a');
    await s.type('no colon here');
    await s.press(KEY.enter);
    assert.equal(data.saved.length, 1);
    // Refused: said how to write it, and what was typed is still in the field.
    assert.match(flat(s.text()), /Not saved\. Write it as my-app: My App, app/);
    assert.match(flat(s.text()), /Project: no colon here/);
    await s.press(KEY.esc);

    await s.press('a');
    await s.type('blog: Blog');
    await s.press(KEY.enter, 'j', 'k', 'j');
    await s.press('x');
    assert.match(flat(s.text()), /Press x again to remove it, Esc to keep it\./);
    await s.press(KEY.esc);
    assert.doesNotMatch(flat(s.text()), /Press x again/);
    assert.equal(data.saved.length, 2);
    await s.press('x', 'x');
    assert.deepEqual(data.saved.at(-1), { path: 'projects', value: [{ id: 'shop', names: ['Shop', 'Store'], path: 'C:/work/shop' }] });
  } finally {
    s.close();
  }
});

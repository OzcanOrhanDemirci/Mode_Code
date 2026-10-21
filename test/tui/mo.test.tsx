// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW } from './harness.js';

/** Rows drawn in half blocks under the top line (where Mo's badge marks the belt): Mo's picture. */
const moRows = (text: string) =>
  text
    .split('\n')
    .slice(1)
    .filter((l) => /[▀▄]{3,}/.test(l)).length;

test('Mo leads on Now: the small Mo beside the one thing that matters most, in words', async () => {
  const s = await draw(new FakeData(), { columns: 110, rows: 44, address: null });
  try {
    assert.match(s.text(), /1 new since you last looked/);
    assert.equal(moRows(s.text()), 2, 'the small Mo');
  } finally {
    s.close();
  }
  // Nothing new since the person last looked, nothing at work: calm.
  const calm = new FakeData();
  calm.seen = NOW;
  const c = await draw(calm, { columns: 110, rows: 44, address: null });
  try {
    assert.match(c.text(), /All calm\. Start working in Claude/);
  } finally {
    c.close();
  }
});

test('Mo is on Now only, in Turkish too', async () => {
  const s = await draw(new FakeData('tr'), { columns: 110, rows: 44, address: null });
  try {
    assert.match(s.text(), /Son bakışından beri 1 yeni şey/);
    await s.press(KEY.down, KEY.right);
    assert.doesNotMatch(s.text(), /Son bakışından beri/);
    assert.equal(moRows(s.text()), 0);
  } finally {
    s.close();
  }
});

test('no picture in plain text, nor with the setting off: what Mo says stays, in words', async () => {
  const plain = await draw(new FakeData(), { columns: 110, rows: 44, address: null, plain: true });
  try {
    assert.match(plain.text(), /1 new since you last looked/);
    assert.equal(moRows(plain.text()), 0);
  } finally {
    plain.close();
  }
  const data = new FakeData();
  data.setConfig('modules.mascot', false);
  const off = await draw(data, { columns: 110, rows: 44, address: null });
  try {
    assert.match(off.text(), /1 new since you last looked/);
    assert.equal(moRows(off.text()), 0);
    // Mo turned off takes its badge too: the belt's mark is in words.
    assert.match(off.text().split('\n')[0]!, /\[belt\] working/);
  } finally {
    off.close();
  }
});

test('what Mo says follows what matters most: a quota near its limit, and a press leads there', async () => {
  const data = new FakeData();
  data.seen = NOW;
  const quota = data.quota();
  data.quota = () => ({ ...quota, assessment: { ...quota.assessment, level: 'wrapUp' } });
  const s = await draw(data, { columns: 110, rows: 44, address: 'now' });
  try {
    assert.match(s.text(), /The quota is near its limit: the work wraps up\./);
    await s.clickText('The quota is near its limit');
    assert.match(s.text(), /Address: quota\/usage/);
  } finally {
    s.close();
  }
});

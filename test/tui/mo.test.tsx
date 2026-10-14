// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY } from './harness.js';

/** Rows drawn in half blocks: Mo's picture. */
const moRows = (text: string) => text.split('\n').filter((l) => /[▀▄]{3,}/.test(l)).length;

test('Mo greets on the first screen with a line in words: its whole body where there is room, a small Mo where there is not', async () => {
  const tall = await draw(new FakeData(), { columns: 110, rows: 44, address: null });
  try {
    assert.match(tall.text(), /Mo is on watch\./);
    assert.ok(moRows(tall.text()) >= 8, 'the whole body');
  } finally {
    tall.close();
  }
  const short = await draw(new FakeData(), { columns: 100, rows: 24, address: null });
  try {
    assert.match(short.text(), /Mo is on watch\./);
    assert.equal(moRows(short.text()), 2, 'the small Mo');
  } finally {
    short.close();
  }
});

test('Mo is only on the first screen, in Turkish too', async () => {
  const s = await draw(new FakeData('tr'), { columns: 110, rows: 44, address: null });
  try {
    assert.match(s.text(), /Mo nöbette\./);
    await s.press(KEY.right);
    assert.doesNotMatch(s.text(), /Mo nöbette/);
    assert.equal(moRows(s.text()), 0);
  } finally {
    s.close();
  }
});

test('no Mo in plain text, nor with the setting off', async () => {
  const plain = await draw(new FakeData(), { columns: 110, rows: 44, address: null, plain: true });
  try {
    assert.doesNotMatch(plain.text(), /Mo is on watch/);
    assert.equal(moRows(plain.text()), 0);
  } finally {
    plain.close();
  }
  const data = new FakeData();
  data.setConfig('modules.mascot', false);
  const off = await draw(data, { columns: 110, rows: 44, address: null });
  try {
    assert.doesNotMatch(off.text(), /Mo is on watch/);
  } finally {
    off.close();
  }
});

test('what Mo says follows what the overview knows: a quota near its limit', async () => {
  const data = new FakeData();
  const quota = data.quota();
  data.quota = () => ({ ...quota, assessment: { ...quota.assessment, level: 'wrapUp' } });
  const s = await draw(data, { columns: 110, rows: 44, address: null });
  try {
    assert.match(s.text(), /Mo: the quota is near its limit\./);
  } finally {
    s.close();
  }
});

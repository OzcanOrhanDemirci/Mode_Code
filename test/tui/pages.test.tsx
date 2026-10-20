// SPDX-License-Identifier: Apache-2.0
/**
 * The pages of the control center (docs/design.md, The control center): a page of settings says what it holds now,
 * each row where it stands against its default, and a setting that matters only under another stands under it,
 * dimmed while that one keeps it from mattering; an empty page leads to where it fills; the location bar fits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAME } from '../../src/core/app.js';
import { fitCrumbs } from '../../src/tui/nav.js';
import { textWidth } from '../../src/node/width.js';
import { draw, FakeData, KEY } from './harness.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('a page of settings says what it holds now; changed, it names what differs and offers all back to the defaults', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'quota/limits', rows: 44, columns: 100 });
  try {
    assert.match(flat(s.text()), /Now Every setting on this page is at its default\./);
    assert.match(s.text(), /Quota guard\s+● on\s+default/);
    await s.press(KEY.down, KEY.down, KEY.enter, '', '');
    await s.type('80');
    await s.press(KEY.enter);
    assert.match(flat(s.text()), /Now 5-hour: wrap up at: 80% \(default: 95%\); the rest at their defaults\./);
    assert.match(s.text(), /5-hour: wrap up at\s+80%\s+• changed/);
    await s.clickText('All back to defaults');
    assert.match(flat(s.text()), /Back to its default: 5-hour: wrap up at: 80% → 95%\./);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved.at(-1), { path: 'quota.fiveHourWrapUp', value: 95 });
  } finally {
    s.close();
  }
});

test('a setting that matters only under another stands under it; while that one keeps it from mattering, it is dimmed and says so', async () => {
  const data = new FakeData('tr');
  const s = await draw(data, { address: 'settings/footer', rows: 44, columns: 100 });
  try {
    assert.match(s.text(), / {4}Satırları kim yazar/);
    assert.doesNotMatch(s.text(), /şu an etkisiz/);
    await s.press(KEY.enter); // the lines under answers off
    assert.match(s.text(), /Satırları kim yazar.*şu an etkisiz/);
    assert.match(s.text(), /Cevap altı satırları\s+○ kapalı\s+• değişti/);
  } finally {
    s.close();
  }
});

test('an empty page says what fills it, and Enter or a click opens where that is done', async () => {
  const s = await draw(new FakeData(), { address: 'work/runs', rows: 40, columns: 100 });
  try {
    assert.match(flat(s.text()), /No full-autonomy run yet\./);
    await s.press(KEY.enter);
    assert.match(s.text(), /Address: work\/full-auto/);
  } finally {
    s.close();
  }
  // Nothing new since the person last looked: the page leads to the whole activity.
  const data = new FakeData();
  data.seen = Date.now() + 86400_000;
  const empty = await draw(data, { address: 'activity/away', rows: 40, columns: 100 });
  try {
    await empty.clickText('Activity feed…');
    assert.match(empty.text(), /Address: activity\/feed/);
  } finally {
    empty.close();
  }
});

test('the location bar keeps its crumbs whole beside the protection and the quota, the middle ones giving way first', async () => {
  const m = (s: string) => textWidth(s);
  assert.deepEqual(
    fitCrumbs(['Workbench', 'Settings', 'Accessibility'], 40, 3, m).map((c) => c.label),
    ['Workbench', 'Settings', 'Accessibility'],
  );
  assert.deepEqual(
    fitCrumbs(['Workbench', 'Memory and projects', 'Sessions', 'Fix the login bug'], 44, 3, m).map((c) => [c.label, c.level]),
    [
      ['Workbench', 0],
      ['…', null],
      ['Sessions', 2],
      ['Fix the login bug', 3],
    ],
  );
  const cut = fitCrumbs(['Workbench', 'Memory and projects', 'A very long session title that goes on'], 30, 3, m);
  assert.deepEqual(
    cut.map((c) => c.label),
    ['Workbench', '…', 'A very long s…'],
  );
  assert.ok(cut.reduce((n, c, i) => n + m(c.label) + (i ? 3 : 0), 0) <= 30);
  const s = await draw(new FakeData(), { address: 'settings/accessibility', columns: 60, rows: 30 });
  try {
    // The tool's own name leads, whatever it is (the rename rehearsal draws a longer one).
    const top = s.text().split('\n')[0]!;
    assert.ok(top.startsWith(`${APP_NAME} › … › Accessi`), top);
    assert.match(top, /🛡 working {2}week 27% {2}5h 21%$/);
    await s.clickText('…');
    assert.match(s.text(), /Address: settings\/accessibility/, 'the … leads nowhere');
  } finally {
    s.close();
  }
});

// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW, SESSION } from './harness.js';
import { newModState } from '../../src/core/session.js';

test('the first screen lists the seven categories and shows protection and quota at the top', async () => {
  const s = await draw(new FakeData());
  try {
    const t = s.text();
    for (const c of ['Home', 'Projects', 'Sessions', 'Measure', 'Security', 'Claude Code', 'Settings']) assert.ok(t.includes(c), c);
    assert.match(t, /🛡 working/);
    assert.match(t, /week 27%/);
    assert.match(t, /Address: home/);
  } finally {
    s.close();
  }
});

test('→ goes in, ← comes back, digits jump to a category', async () => {
  const s = await draw(new FakeData());
  try {
    await s.press(KEY.right);
    assert.match(s.text(), /terminal-code › Home/);
    assert.match(s.text(), /Overview/);
    await s.press(KEY.left);
    assert.doesNotMatch(s.text(), /terminal-code › Home/);
    await s.press('5');
    assert.match(s.text(), /terminal-code › Security/);
    assert.match(s.text(), /Safety belt rules/);
  } finally {
    s.close();
  }
});

test('an address opens its screen directly, the same address the command line uses', async () => {
  const s = await draw(new FakeData(), { address: 'measure/quota' });
  try {
    const t = s.text();
    assert.match(t, /Measure › Quota/);
    assert.match(t, /5-hour/);
    assert.match(t, /21%/);
    assert.match(t, /Address: measure\/quota/);
    assert.match(t, /Weekly, 7 days\s+\S/);
  } finally {
    s.close();
  }
});

test('the palette finds a screen by its name in the other language too', async () => {
  const s = await draw(new FakeData('en'));
  try {
    await s.press(KEY.ctrlK);
    await s.type('kural');
    assert.match(s.text(), /▸ Security › Safety belt rules/);
    await s.press(KEY.enter);
    assert.match(s.text(), /Security › Safety belt rules/);
    assert.match(s.text(), /Force-push/);
  } finally {
    s.close();
  }
});

test('a session card shows its numbers; the list filter narrows by typing', async () => {
  const s = await draw(new FakeData(), { address: `sessions/${SESSION.id}` });
  try {
    const t = s.text();
    assert.match(t, /Fix the login bug/);
    assert.match(t, /30 calls, 2 errors/);
    await s.press(KEY.esc, '/');
    await s.type('zzz');
    assert.match(s.text(), /Nothing matches the filter/);
  } finally {
    s.close();
  }
});

test('turning a protective feature off needs a second confirmation; a plain one saves at once', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'settings/modules' });
  try {
    await s.press(KEY.enter); // keywords: not protective
    assert.deepEqual(data.saved, [{ path: 'modules.keywords', value: false }]);
    await s.press(KEY.down, KEY.down, KEY.enter); // quota guard: protective
    assert.equal(data.saved.length, 1);
    assert.match(s.text(), /lowers a protection/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved[1], { path: 'modules.quota', value: false });
  } finally {
    s.close();
  }
});

test('the belt can be tried on a command without running it', async () => {
  const s = await draw(new FakeData(), { address: 'security/test' });
  try {
    await s.type('git status');
    await s.press(KEY.enter);
    await new Promise((r) => setTimeout(r, 150));
    assert.match(s.text(), /No rule applies/);
  } finally {
    s.close();
  }
});

test('Turkish everywhere when the language is Turkish; a broken protection shows red', async () => {
  const s = await draw(new FakeData('tr', {}, 'red'));
  try {
    const t = s.text();
    assert.match(t, /Ana ekran/);
    assert.match(t, /Güvenlik/);
    assert.match(t, /🛡 bozuk/);
    assert.match(t, /hafta %27/);
  } finally {
    s.close();
  }
});

test('plain mode uses no box drawing and no emoji-only signals', async () => {
  const s = await draw(new FakeData(), { plain: true });
  try {
    const t = s.text();
    assert.doesNotMatch(t, /[╭╮│─🛡]/u);
    assert.match(t, /\[belt\] working/);
  } finally {
    s.close();
  }
});

test('the report screen sums up the day and switches to the week with p', async () => {
  const s = await draw(new FakeData(), { address: 'measure/report' });
  try {
    assert.match(s.text(), /What happened in the last day/);
    assert.match(s.text(), /1 blocked/);
    await s.press('p');
    assert.match(s.text(), /What happened in the last 7 days/);
  } finally {
    s.close();
  }
});

test('home warns when two sessions work in the same folder', async () => {
  class TwoSessions extends FakeData {
    override modStates() {
      const s = (id: string) => ({ ...newModState(id, 'dev', NOW - 60_000), cwd: 'C:/work/app' });
      return [s('one'), s('two')];
    }
  }
  const s = await draw(new TwoSessions(), { address: 'home/overview' });
  try {
    assert.match(s.text(), /2 sessions are working in the same folder: C:\/work\/app/);
  } finally {
    s.close();
  }
});

test('the help explains keys and terms and closes with Esc', async () => {
  const s = await draw(new FakeData());
  try {
    await s.press('?');
    assert.match(s.text(), /Keys work the same on every screen/);
    assert.match(s.text(), /Safety belt:/);
    await s.press(KEY.esc);
    assert.doesNotMatch(s.text(), /Keys work the same on every screen/);
  } finally {
    s.close();
  }
});

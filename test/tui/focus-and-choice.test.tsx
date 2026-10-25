// SPDX-License-Identifier: Apache-2.0
/**
 * What the usability audit of the control center found, kept found (docs/design.md): the focus stays in view on a long
 * page and a page that runs on says so; a choice of more than two is picked, not cycled and saved at each step; the
 * switches of the Modes page stand where the focus is; on Maintenance `u` still takes back, `i` installs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY } from './harness.js';

const PAGE_DOWN = '\u001B[6~';
const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

test('the focus stays in view on a long page, and a page that runs on says so; scrolling by hand is left alone', async () => {
  const s = await draw(new FakeData(), { address: 'claude-code/skills', columns: 100, rows: 24 });
  try {
    assert.match(s.text(), /More below · PgDn/);
    for (let i = 0; i < 10; i++) await s.press(KEY.down);
    assert.match(s.text(), /▸ systematic-debugging/);
    // PgDn scrolls on past the focus; it is not pulled back while the focus stays where it was.
    await s.press(PAGE_DOWN, PAGE_DOWN);
    assert.doesNotMatch(s.text(), /▸ systematic-debugging/);
    await s.press(KEY.down);
    assert.match(s.text(), /▸ verification-before-completion/);
  } finally {
    s.close();
  }
  // Opened at its address on a short terminal, the page shows its focus, also once the line saying it runs on has taken
  // a row from the view (that row hid the focus, now and then, in CI).
  const short = await draw(new FakeData(), { address: 'memory/notes', rows: 12 });
  try {
    for (let i = 0; i < 100 && !/▸ Handoff notes/.test(short.text()); i++) await new Promise((r) => setTimeout(r, 15));
    assert.match(short.text(), /▸ Handoff notes/);
    assert.match(short.text(), /More below · PgDn/);
  } finally {
    short.close();
  }
  // A page that fits says nothing.
  const fits = await draw(new FakeData(), { address: 'settings/general', columns: 100, rows: 40 });
  try {
    assert.doesNotMatch(fits.text(), /More below/);
  } finally {
    fits.close();
  }
});

test('a choice of more than two is picked: its options shown, the arrows move the mark, Enter applies, Esc keeps it', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'settings/general', columns: 100, rows: 30 });
  try {
    await s.press(KEY.down, KEY.enter);
    assert.match(flat(s.text()), /View level ○ Simple ◉ Recommended ○ Detailed/);
    assert.match(s.text(), /←→ choose {2}Enter apply {2}Esc cancel/);
    assert.doesNotMatch(s.text(), /←\/Esc back/, 'while a choice is picked, ← and Esc do not leave');
    // ← moves the mark round and does not leave the page; nothing is saved on the way.
    await s.press(KEY.left, KEY.left);
    assert.match(flat(s.text()), /○ Simple ○ Recommended ◉ Detailed/);
    assert.match(s.text(), /Address: settings\/general/);
    assert.equal(data.saved.length, 0);
    await s.press(KEY.esc);
    assert.match(flat(s.text()), /View level ‹ Recommended ›/);
    assert.equal(data.saved.length, 0);
    // Picked and applied: one change, the one marked.
    await s.press(KEY.enter, KEY.right, KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'view', value: 'detailed' }]);
    // Enter on the value it has changes nothing; ↓ leaves the choice and moves on.
    await s.press(KEY.enter, KEY.enter);
    assert.equal(data.saved.length, 1);
    await s.press(KEY.enter, KEY.down);
    assert.match(flat(s.text()), /▸ Check for updates daily/);
  } finally {
    s.close();
  }
});

test('the Modes page puts its two switches first, where the focus is, and the tables that inform after them', async () => {
  const s = await draw(new FakeData(), { address: 'work/modes', columns: 100, rows: 24 });
  try {
    const t = s.text();
    assert.match(t, /▸ Modes and flows/);
    assert.ok(t.indexOf('Modes and flows') < t.indexOf('More below'), 'the focus in view, the tables below');
  } finally {
    s.close();
  }
});

test('on Maintenance `u` takes back as everywhere; `i` installs the update', async () => {
  const left: string[] = [];
  const s = await draw(new FakeData(), { address: 'settings/maintenance', columns: 100, rows: 40, onLeave: (a) => left.push(String(a)) });
  try {
    assert.match(flat(s.text()), /i (checks and )?installs the update now/);
    await s.press('u');
    assert.deepEqual(left, []);
    await s.press('i');
    assert.deepEqual(left, ['update']);
  } finally {
    s.close();
  }
});

test('an event names its rules as the control center does, and Enter or a click opens the rule that decided it', async () => {
  const data = new FakeData();
  data.extraEvents = [
    {
      v: 1,
      at: Date.now() - 60_000,
      source: 'mod',
      session: 's',
      kind: 'belt',
      tool: 'Bash',
      verdict: 'deny',
      rules: ['git.clean'],
      reasons: ['Deletes untracked files'],
    },
  ] as never;
  const s = await draw(data, { address: 'protection/events', columns: 100, rows: 30 });
  try {
    assert.match(flat(s.text()), /Blocked a Bash call · Delete untracked files ›/);
    assert.doesNotMatch(s.text(), /git\.clean/);
    assert.match(s.text(), /Enter open its rule/);
    await s.press(KEY.enter);
    assert.match(s.text(), /Address: protection\/rules\/git\.clean/);
  } finally {
    s.close();
  }
  // Two events: ↓ selects the next, and a click on one opens its rule as Enter does; one with no rule leads nowhere.
  const two = new FakeData();
  two.extraEvents = [
    { v: 1, at: Date.now() - 60_000, source: 'mod', session: 's', kind: 'belt', tool: 'Bash', verdict: 'ask', rules: ['git.clean'], reasons: ['x'] },
    { v: 1, at: Date.now() - 120_000, source: 'mod', session: 's', kind: 'belt', tool: 'Bash', verdict: 'deny', rules: ['publish.package'], reasons: ['y'] },
    { v: 1, at: Date.now() - 180_000, source: 'mod', session: 's', kind: 'quota', level: 'stop' },
  ] as never;
  const k = await draw(two, { address: 'protection/events', columns: 100, rows: 30 });
  try {
    await k.press(KEY.down, KEY.up, KEY.down, KEY.enter);
    assert.match(k.text(), /Address: protection\/rules\/publish\.package/);
  } finally {
    k.close();
  }
  const c = await draw(two, { address: 'protection/events', columns: 100, rows: 30 });
  try {
    await c.clickText('Publish a package');
    assert.match(c.text(), /Address: protection\/rules\/publish\.package/);
  } finally {
    c.close();
  }
  const none = await draw(two, { address: 'protection/events', columns: 100, rows: 30 });
  try {
    await none.press(KEY.down, KEY.down, KEY.enter);
    assert.match(none.text(), /Address: protection\/events/);
    assert.doesNotMatch(none.text(), /Enter open its rule/);
  } finally {
    none.close();
  }
});

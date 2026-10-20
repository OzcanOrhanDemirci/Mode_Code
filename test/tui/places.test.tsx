// SPDX-License-Identifier: Apache-2.0
/**
 * The map by purpose (src/tui/nav.ts): every place of the old map still leads to its page, from the command line and
 * from the palette; the view level leaves pages out of the lists and never out of reach; and everything a click
 * presses shows it when the pointer rests on it (docs/design.md, One way to act).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import { addressOf, formerAddresses, movedTo, resolveAddress } from '../../src/tui/nav.js';
import { buildTree } from '../../src/tui/tree.js';
import { draw, FakeData, KEY, NOW } from './harness.js';

// The pointed look as a terminal that draws it: the test's own output is no terminal, and chalk would draw none.
chalk.level = 1;

/** Every address of the map before 1.2 (docs/cli.md of 1.1), as people and older plugins may still type it. */
const OLD = [
  'home',
  'home/overview',
  'home/inbox',
  'home/activity',
  'projects/flows',
  'projects/handoffs',
  'sessions',
  'measure/quota',
  'measure/report',
  'measure/tokens',
  'measure/tools',
  'measure/folders',
  'security/protection',
  'security/rules',
  'security/rules/git.clean',
  'security/events',
  'security/test',
  'security/secrets',
  'claude-code/instructions',
  'claude-code/settings',
  'claude-code/hooks',
  'claude-code/permissions',
  'claude-code/mcp',
  'claude-code/plugins',
  'claude-code/packs',
  'claude-code/skills',
  'claude-code/templates',
  'claude-code/extensions',
  'automation/full-auto',
  'automation/prompts',
  'automation/runs',
  'automation/bypass',
  'automation/bypassed',
  'automation/agents',
  'settings/general',
  'settings/modules',
  'settings/footer-quota',
  'settings/memory',
  'settings/memory/store',
  'settings/memory/handoffs',
  'settings/memory/protected',
  'settings/sync',
  'settings/projects',
  'settings/keywords',
  'settings/accessibility',
  'settings/history',
  'settings/maintenance',
  'settings/about',
];

test('every address of the old map leads to a page of the new one, wholly', () => {
  for (const view of ['simple', 'recommended', 'detailed'] as const) {
    const roots = buildTree(new FakeData('en', { view }), 'en', NOW);
    for (const old of OLD) {
      const r = resolveAddress(roots, old);
      const want = movedTo(old) ?? old;
      assert.equal(r.address, want, `${old} (${view})`);
      assert.equal(addressOf(r.chain), want);
    }
  }
  // A page that did not move is its own; one that did keeps what followed it.
  assert.equal(movedTo('claude-code/packs'), null);
  assert.equal(movedTo('security/rules/git.clean'), 'protection/rules/git.clean');
  assert.equal(movedTo('sessions/abc'), 'memory/sessions/abc');
  assert.deepEqual(formerAddresses('work/full-auto'), ['automation/full-auto']);
  // A page that is gone leads to what took its place.
  assert.equal(movedTo('work/bypass'), 'work/modes');
  assert.equal(movedTo('automation/bypassed'), 'activity/feed');
  assert.ok(formerAddresses('quota/limits').includes('settings/footer-quota'));
});

test('an old address from the command line opens the page where it went', async () => {
  const s = await draw(new FakeData(), { address: 'security/rules', opens: 'protection/rules' });
  try {
    assert.match(s.text(), /^Mode_Code › Protection/);
    assert.match(s.text(), /Force-push/);
  } finally {
    s.close();
  }
  const away = await draw(new FakeData(), { address: 'home/inbox', opens: 'activity/away' });
  try {
    assert.match(away.text(), /Activity › While you were away/);
  } finally {
    away.close();
  }
});

test('the palette finds a page by its old place, and by the old name of its category', async () => {
  const s = await draw(new FakeData('en'));
  try {
    await s.press(KEY.ctrlK);
    await s.type('automation/full-auto');
    assert.match(s.text(), /▸ Working › Full autonomy/);
    await s.press(KEY.enter);
    assert.match(s.text(), /Address: work\/full-auto/);
  } finally {
    s.close();
  }
  const tr = await draw(new FakeData('tr'));
  try {
    await tr.press(KEY.ctrlK);
    await tr.type('otomasyon');
    assert.match(tr.text(), /▸ Çalışma\s/);
  } finally {
    tr.close();
  }
});

test('the view leaves pages out of the lists, says how many, and never out of reach', async () => {
  const data = new FakeData('en', { view: 'simple' });
  const s = await draw(data, { address: 'work', columns: 110 });
  try {
    assert.doesNotMatch(s.text(), /Recent tasks/);
    assert.match(s.text(), /\+2 more in the detailed view/);
    // The palette still finds a page the view leaves out, and the list shows it once it is open.
    await s.press(KEY.ctrlK);
    await s.type('recent tasks');
    await s.press(KEY.enter);
    assert.match(s.text(), /Address: work\/prompts/);
    assert.match(s.text(), /Recent tasks/);
    // A click on the count opens where the view is changed.
    await s.press(KEY.esc);
    await s.clickText('more in the detailed view');
    assert.match(s.text(), /Address: settings\/general/);
  } finally {
    s.close();
  }
  // An address reaches it too.
  const direct = await draw(new FakeData('en', { view: 'simple' }), { address: 'claude-code/hooks' });
  try {
    assert.match(direct.text(), /Claude Code › Hooks/);
  } finally {
    direct.close();
  }
});

/** The underline marks on one row of the frame as the terminal receives it. */
const underlines = (ansi: string, y: number) => (ansi.split('\n')[y]?.match(/\u001B\[4m/g) ?? []).length;

test('everything a click presses shows the pointer resting on it, on every kind of screen', { timeout: 120_000 }, async () => {
  const screens: (string | null)[] = [
    null,
    'now',
    'activity/feed',
    'work/agents',
    'protection/rules',
    'memory/notes',
    'quota/limits',
    'claude-code/packs',
    'settings/general',
  ];
  const silent: string[] = [];
  let pointed = 0;
  for (const address of screens) {
    const s = await draw(new FakeData('en', { view: 'detailed' }), { address, columns: 120, rows: 40 });
    try {
      // The targets are read once the screen has settled: its keys join the bar a frame or two after it opens, and a
      // loaded runner (Windows, Node 22) read the bar's targets where they stood before, the pointer then resting on
      // the wrong words.
      for (let still = 0, last = s.ansi(), i = 0; still < 8 && i < 100; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const now = s.ansi();
        still = now === last ? still + 1 : 0;
        last = now;
      }
      for (const target of s.registry().pressables()) {
        if (target.y < 0 || target.y >= 40 || target.x < 0 || target.x >= 120) continue;
        const before = underlines(s.ansi(), target.y);
        await s.hover(target.x, target.y);
        // The hover's frame, not merely the next one: a screen with a clock (Now) may draw for its own reasons
        // between the move and the frame it causes, as a loaded CI runner showed (Windows, Node 22).
        let after = underlines(s.ansi(), target.y);
        for (let i = 0; i < 50 && after <= before; i++) {
          await new Promise((r) => setTimeout(r, 20));
          after = underlines(s.ansi(), target.y);
        }
        pointed++;
        if (after <= before)
          silent.push(
            `${address ?? '(start)'}: ${s
              .text()
              .split('\n')
              [target.y]!.slice(target.x, target.x + target.width)
              .trim()} (at ${target.x},${target.y}, ${target.width} wide, in "${s.text().split('\n')[target.y]!.trim()}")`,
          );
        // Off it again, onto the header's right end, which presses nothing, until its row is as it was: the next
        // target on the same row (the key bar's) is measured from there.
        await s.hover(119, 0);
        for (let i = 0; i < 50 && underlines(s.ansi(), target.y) > before; i++) await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      s.close();
    }
  }
  assert.ok(pointed >= 60, `only ${pointed} targets pointed at`);
  assert.deepEqual(silent, []);
});

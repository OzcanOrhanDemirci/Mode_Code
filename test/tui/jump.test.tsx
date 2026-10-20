// SPDX-License-Identifier: Apache-2.0
/**
 * Jump mode (src/tui/jump.ts) and what the terminal takes beyond drawing (src/tui/terminal.ts): a label beside every
 * target, typed to press it; the window's title, a job's progress and links, each only where the terminal takes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUMP_LETTERS, jumpLabels, jumpMatch } from '../../src/tui/jump.js';
import { fileUrl, linkSequence, NO_CAPS, progressSequence, terminalCaps, titleSequence } from '../../src/tui/terminal.js';
import { draw, FakeData, KEY, SESSION } from './harness.js';

const CTRL_O = '\u000F';

test('labels: one letter each while there are few, two each beyond, none the start of another', () => {
  assert.deepEqual(jumpLabels(3), ['a', 's', 'd']);
  assert.equal(jumpLabels(26).length, 26);
  const many = jumpLabels(40);
  assert.equal(many.length, 40);
  assert.equal(new Set(many).size, 40);
  assert.ok(many.every((l) => l.length === 2 && [...l].every((c) => JUMP_LETTERS.includes(c))));
  assert.ok(!many.some((a) => many.some((b) => a !== b && b.startsWith(a))));
  assert.deepEqual(jumpMatch(['as', 'ad', 'sa'], 'a'), 'more');
  assert.deepEqual(jumpMatch(['as', 'ad', 'sa'], 'ad'), { press: 1 });
  assert.equal(jumpMatch(['as', 'ad'], 'x'), 'none');
});

test('Ctrl+O labels every target; typing a label presses it, as a click would', async () => {
  const s = await draw(new FakeData(), { columns: 110, rows: 32 });
  try {
    await s.press(CTRL_O);
    assert.match(s.text(), /Type the letters beside what you want to press · Esc cancels/);
    // More targets than letters on this screen: two letters each, over the start of each target.
    const row = s
      .text()
      .split('\n')
      .find((l) => l.includes('Working'))!;
    const label = /│([a-z]{2})Working/.exec(row)![1]!;
    await s.press(...label);
    assert.match(s.text(), /^Mode_Code › Working/);
    assert.doesNotMatch(s.text(), /Type the letters beside/);
  } finally {
    s.close();
  }
});

test('in jump mode Esc cancels, a letter no label has says so, and a click acts and ends it', async () => {
  const s = await draw(new FakeData(), { columns: 110, rows: 32, address: 'settings/general' });
  try {
    await s.press(CTRL_O, KEY.esc);
    assert.doesNotMatch(s.text(), /Type the letters beside/);
    assert.match(s.text(), /^Mode_Code › Settings/);
    await s.press(CTRL_O, 'm');
    assert.match(s.text(), /No label is "m": nothing pressed\./);
    await s.press(CTRL_O);
    // The bar's keys carry labels of their own now; a click on one's words acts as always.
    await s.clickText('go to');
    assert.match(s.text(), /Go to/);
    assert.doesNotMatch(s.text(), /Type the letters beside/);
  } finally {
    s.close();
  }
});

test('what the terminal takes is read from what it says of itself; a dumb terminal or no terminal gets nothing', () => {
  assert.deepEqual(terminalCaps({ WT_SESSION: 'x' }, true), { title: true, progress: true, links: true });
  assert.deepEqual(terminalCaps({ TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' }, true), { title: true, progress: false, links: true });
  assert.deepEqual(terminalCaps({ TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' }, true), { title: true, progress: false, links: false });
  assert.deepEqual(terminalCaps({ ConEmuANSI: 'ON' }, true), { title: true, progress: true, links: false });
  assert.deepEqual(terminalCaps({ VTE_VERSION: '7200', TERM: 'xterm-256color' }, true).links, true);
  assert.deepEqual(terminalCaps({ WT_SESSION: 'x' }, false), NO_CAPS);
  assert.deepEqual(terminalCaps({ WT_SESSION: 'x', TERM: 'dumb' }, true), NO_CAPS);
  assert.deepEqual(terminalCaps({}, true), NO_CAPS);
  assert.equal(titleSequence('Mode_Code · Now\u0007x'), '\u001B]0;Mode_Code · Nowx\u0007');
  assert.equal(progressSequence(42.4), '\u001B]9;4;1;42\u0007');
  assert.equal(progressSequence(140), '\u001B]9;4;1;100\u0007');
  assert.equal(progressSequence(null), '\u001B]9;4;0;0\u0007');
  assert.equal(fileUrl('C:\\dev\\a b#1.md'), 'file:///C:/dev/a%20b%231.md');
  assert.equal(fileUrl('/home/ada/x'), 'file:///home/ada/x');
  assert.equal(linkSequence('file:///x', 'x'), '\u001B]8;;file:///x\u001B\\x\u001B]8;;\u001B\\');
});

test('the title says where the person is and goes back to the terminal at the end; paths are links where links show', async () => {
  const sent: string[] = [];
  const terminal = { caps: { title: true, progress: false, links: true }, write: (x: string) => void sent.push(x) };
  const s = await draw(new FakeData(), { columns: 110, rows: 40, address: `memory/sessions/${SESSION.id}`, terminal });
  try {
    assert.ok(sent.includes(titleSequence('Mode_Code · Memory and projects')), sent.join(' | '));
    assert.ok(s.ansi().includes(linkSequence(fileUrl('C:/work/app'), 'C:/work/app')), 'the folder is a link');
    await s.press('q', 'q');
    assert.equal(sent.at(-1), titleSequence(''));
  } finally {
    s.close();
  }
  // Without links, the path is its words alone; without a title, nothing is sent.
  const none: string[] = [];
  const plain = await draw(new FakeData(), {
    columns: 110,
    rows: 40,
    address: `memory/sessions/${SESSION.id}`,
    terminal: { caps: NO_CAPS, write: (x) => void none.push(x) },
  });
  try {
    assert.doesNotMatch(plain.ansi(), /\u001B\]8;;/);
    assert.deepEqual(none, []);
  } finally {
    plain.close();
  }
});

test('the help scrolls on a short terminal instead of squeezing its lines into one another', async () => {
  const s = await draw(new FakeData('tr'), { columns: 84, rows: 24 });
  try {
    await s.press('?');
    const first = () => s.text().split('\n')[2]!;
    assert.match(first(), /Tuşlar her ekranda aynı çalışır/);
    assert.match(s.text(), /↑↓ kaydır {2}Esc kapat/);
    await s.press(KEY.down, KEY.down);
    assert.match(first(), /↑ ↓ {2}j k/);
    // Every key the help names stands on a line of its own, whole.
    await s.press(KEY.down, KEY.down, KEY.down);
    assert.match(s.text(), /Ctrl\+O {8}Atla: basılabilen her şeyin yanında bir harf; onu yazınca basılır/);
    await s.press(KEY.esc);
    assert.doesNotMatch(s.text(), /kaydır/);
  } finally {
    s.close();
  }
});

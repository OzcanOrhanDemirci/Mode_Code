// SPDX-License-Identifier: Apache-2.0
/**
 * How the command line asks and says (src/cli/ask.ts): one yes or no for every question, never yes without a
 * terminal to answer from; prose wrapped to the terminal at word boundaries, a list item running on under itself;
 * a setup's steps said as "Step 2 of 7".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirm, say, terminalIO, typed } from '../../src/cli/ask.js';
import { setColor } from '../../src/cli/style.js';

/** What `fn` writes to stdout, with stdout as a terminal of `columns` (or none). */
async function captured(columns: number | null, fn: () => unknown): Promise<string> {
  const out = process.stdout;
  const was = { write: out.write, isTTY: out.isTTY, columns: out.columns };
  let text = '';
  out.write = ((s: string) => ((text += s), true)) as typeof out.write;
  Object.assign(out, { isTTY: columns !== null, columns: columns ?? undefined });
  try {
    await fn();
  } finally {
    Object.assign(out, was);
  }
  return text;
}

test('a long line is wrapped to the terminal at word boundaries, an indented one under itself; a short one stays', async () => {
  setColor(false);
  const long = 'The memory setup asks where your memory should live, then shows every change before it makes any.';
  const text = await captured(40, () => {
    say(long);
    say(`  • ${long}`);
    say('short');
  });
  const lines = text.trimEnd().split('\n');
  assert.ok(
    lines.every((l) => l.length <= 40),
    lines.join('\n'),
  );
  assert.ok(
    lines.every((l) => !/^\s+\S/.test(l) || l.startsWith('  ')),
    'continued lines keep the indent',
  );
  assert.ok(lines.filter((l) => l.startsWith('  ')).length >= 3, 'the list item runs on under itself');
  assert.equal(lines.at(-1), 'short');
  assert.equal(lines.join(' ').replace(/\s+/g, ' ').includes('before it makes any.'), true);
  // Without a terminal (a log, a pipe), lines are written whole.
  assert.equal(await captured(null, () => say(long)), `${long}\n`);
});

test('without a terminal to answer from, nothing is a yes: not even a question whose Enter is yes', async () => {
  const stdin = process.stdin;
  const was = stdin.isTTY;
  Object.assign(stdin, { isTTY: false });
  try {
    assert.equal(await confirm('en', 'Install?', true), false);
    assert.equal(await typed('Type mode-code to confirm:', 'mode-code'), false);
    const io = terminalIO('en');
    assert.equal(await io.confirm('Sign in now?', true), false);
    assert.equal(await io.choose('Where?', ['a', 'b'], 1), 1, 'a pick takes what Enter takes');
    assert.equal(await io.ask('Folder?', '~/x'), '~/x');
  } finally {
    Object.assign(stdin, { isTTY: was });
  }
});

test("a setup's step is said with where it stands, in the person's language, and why it is skipped", async () => {
  setColor(false);
  const en = await captured(80, () => terminalIO('en').step!(2, 7, 'The tools it needs'));
  assert.equal(en, '\nStep 2 of 7 · The tools it needs\n');
  const tr = await captured(80, () => terminalIO('tr').step!(4, 7, "GitHub'daki depo", 'bu seçimde gerekmiyor'));
  assert.equal(tr, "\nAdım 4/7 · GitHub'daki depo · bu seçimde gerekmiyor\n");
});

// SPDX-License-Identifier: Apache-2.0
/**
 * How the command line asks and says (src/cli/ask.ts): one yes or no for every question, never yes without a
 * terminal to answer from; prose wrapped to the terminal at word boundaries, a list item running on under itself;
 * a setup's steps said as "Step 2 of 7".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirm, say, terminalIO, typed } from '../../src/cli/ask.js';
import { setColor } from '../../src/cli/style.js';

/** What `fn` writes to stdout, with stdout as a terminal of `columns` (or none). */
async function captured(columns: number | null, fn: () => unknown): Promise<string> {
  const out = process.stdout;
  const was = { write: out.write, isTTY: out.isTTY, columns: out.columns };
  let text = '';
  // Text only: the test runner sends its own reports through stdout as bytes, and they must reach it.
  out.write = ((s: string | Uint8Array, ...rest: unknown[]) =>
    typeof s === 'string' ? ((text += s), true) : (was.write as (...a: unknown[]) => boolean).call(out, s, ...rest)) as typeof out.write;
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

/** Runs `fn` with a terminal behind stdin that answers `lines` one by one; what was asked, as written. */
async function answered<T>(lines: string[], fn: () => Promise<T>): Promise<{ value: T; asked: string }> {
  const real = process.stdin;
  const fake = new PassThrough() as PassThrough & { isTTY?: boolean };
  fake.isTTY = true;
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  let asked = '';
  const out = process.stdout;
  const write = out.write;
  out.write = ((s: string | Uint8Array, ...rest: unknown[]) =>
    typeof s === 'string' ? ((asked += s), true) : (write as (...a: unknown[]) => boolean).call(out, s, ...rest)) as typeof out.write;
  // Each answer once the question before it is out: readline reads a line per question.
  let i = 0;
  const timer = setInterval(() => {
    if (i < lines.length && asked.split('\n').length + (asked.endsWith(' ') ? 1 : 0) > i) fake.write(`${lines[i++]}\n`);
  }, 5);
  try {
    return { value: await fn(), asked };
  } finally {
    clearInterval(timer);
    out.write = write;
    Object.defineProperty(process, 'stdin', { value: real, configurable: true });
  }
}

test("a yes or no asks again on any other word, takes the language's own letters, and Enter as the hint says", async () => {
  setColor(false);
  const again = await answered(['maybe', 'e'], () => confirm('tr', 'Kurulsun mu?', false));
  assert.equal(again.value, true);
  assert.equal(again.asked.split('Kurulsun mu? [e/h, Enter = hayır]').length - 1, 2, 'asked twice');
  assert.equal((await answered([''], () => confirm('en', 'Install?', false))).value, false);
  assert.equal((await answered([''], () => confirm('en', 'Install?', true))).value, true);
  assert.equal((await answered(['No'], () => confirm('en', 'Install?', true))).value, false);
  assert.equal((await answered(['hayır'], () => confirm('tr', 'Kurulsun mu?', true))).value, false);
  assert.equal((await answered(['mode-code'], () => typed('Type mode-code to confirm:', 'mode-code'))).value, true);
  assert.equal((await answered(['mode'], () => typed('Type mode-code to confirm:', 'mode-code'))).value, false);
  const io = terminalIO('en');
  const pick = await answered(['9', '2'], () => io.choose('Where?', ['here', 'there', 'both'], 2));
  assert.equal(pick.value, 1, 'a number out of range asks again');
  assert.match(pick.asked, /3 {2}both \(Enter\)\nChoose 1-3 \(Enter = 3\): /, 'the option Enter takes, marked and named');
  assert.equal((await answered([''], () => io.choose('Where?', ['here', 'there'], 1))).value, 1);
  assert.equal((await answered(['~/notes'], () => io.ask('Folder?', '~/x'))).value, '~/notes');
  assert.equal((await answered([''], () => io.ask('Folder?', '~/x'))).value, '~/x');
});

test("a setup's step is said with where it stands, in the person's language, and why it is skipped", async () => {
  setColor(false);
  const en = await captured(80, () => terminalIO('en').step!(2, 7, 'The tools it needs'));
  assert.equal(en, '\nStep 2 of 7 · The tools it needs\n');
  const tr = await captured(80, () => terminalIO('tr').step!(4, 7, "GitHub'daki depo", 'bu seçimde gerekmiyor'));
  assert.equal(tr, "\nAdım 4/7 · GitHub'daki depo · bu seçimde gerekmiyor\n");
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The grid (docs/design.md, Grid and spacing) in the control center: the right edges of a block end in one column,
 * a wrapped line never starts with the space a break fell on (Ink's own wrap keeps it), and the kit draws the same in
 * plain mode and without colour, with every state still in marks and words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, Box } from 'ink';
import chalk from 'chalk';
import { tIn, type Lang } from '../../src/core/i18n/index.js';
import { SETTING_IDS, SETTINGS } from '../../src/core/ux/catalog.js';
import { action, choiceValue, confirm, meter, notice, row, switchValue } from '../../src/core/ux/kit.js';
import { inkHost } from '../../src/tui/kit.js';
import { makeTheme } from '../../src/tui/theme.js';
import { EnvContext, Muted, Note, ProseWidth, Row, defaultTheme, type Env } from '../../src/tui/ui.js';
import { draw, FakeData } from './harness.js';

// Colour as a terminal that has it: the test's own output is no terminal, and chalk would draw none at all.
chalk.level = 1;
const kit = inkHost(makeTheme());
// eslint-disable-next-line no-control-regex
const plainOf = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

test('a block of rows: the values start in one column and the trailing column ends at the block edge', () => {
  const out = plainOf(
    renderToString(
      <Box flexDirection="column" width={40}>
        {row(kit, { label: 'Language', labelWidth: 14, value: 'English', trailing: '›', width: 40 })}
        {row(kit, { label: 'Morning report', labelWidth: 14, value: 'on', trailing: '12 sec', width: 40 })}
        {row(kit, { label: 'A label far too long for its column', labelWidth: 14, value: 'x', trailing: '[ stop ]', width: 40 })}
      </Box>,
      { columns: 40 },
    ),
  ).split('\n');
  assert.equal(out.length, 3);
  for (const line of out) assert.equal(line.trimEnd().length, 40, `"${line}"`);
  assert.deepEqual(
    out.map((l) => l.indexOf(l.slice(14).trimStart()[0]!, 14)),
    [14, 14, 14],
  );
  // A label too long is cut with an ellipsis, never run into its value.
  assert.match(out[2]!, /^A label far…\s+x/);
});

/** Lines that start with the space a break fell on: text, then a line that opens with one more space than its block. */
function brokenAt(lines: string[], indent: number): string[] {
  return lines.filter((l) => l.length > indent + 1 && l.startsWith(' '.repeat(indent + 1)) && l[indent + 1] !== ' ');
}

const env = (width: number): Env => ({
  data: new FakeData(),
  theme: defaultTheme,
  lang: 'en',
  now: 0,
  go: () => {},
  place: (a) => a,
  flash: () => {},
  tick: 0,
});

test("prose in the control center wraps at word boundaries with no line opening on a space (Ink's own wrap keeps it)", () => {
  // Each break falls on a space after a word that ends exactly at the edge, where Ink leaves the space in front.
  const text = 'abcd efgh ijkl mnop qrst uvwx yzab cdef ghij klmn opqr stuv';
  for (const width of [9, 14, 19, 24]) {
    const out = plainOf(
      renderToString(
        <EnvContext.Provider value={env(width)}>
          <ProseWidth.Provider value={width}>
            <Box flexDirection="column" width={width}>
              <Muted>{text}</Muted>
              <Note kind="warn">{text}</Note>
              <Row label="Now" width={6}>
                {text}
              </Row>
            </Box>
          </ProseWidth.Provider>
        </EnvContext.Provider>,
        { columns: width },
      ),
    ).split('\n');
    assert.deepEqual(
      out.filter((l) => /^ \S/.test(l)),
      [],
      `${width}:\n${out.join('\n')}`,
    );
    assert.deepEqual(brokenAt(out, 6), [], `${width}:\n${out.join('\n')}`);
  }
});

test('every setting card, on every page, in both languages, from narrow to wide: no line of a value opens on a space', async () => {
  const pages = [...new Set(SETTING_IDS.map((id) => SETTINGS[id].page))];
  const bad: string[] = [];
  for (const lang of ['en', 'tr'] as Lang[]) {
    const labels = (['ux.q.what', 'ux.q.now', 'ux.q.change', 'ux.q.back', 'ux.q.who'] as const).map((k) => tIn(lang, k));
    const w = Math.max(...labels.map((l) => l.length)) + 2;
    for (const columns of [60, 84, 132])
      for (const page of pages) {
        const s = await draw(new FakeData(lang, { view: 'detailed' }), { address: page, columns, rows: 70 });
        try {
          // The open pane's lines, inside its border and padding.
          const pane = s
            .text()
            .split('\n')
            .map((l) => {
              const at = l.lastIndexOf('││');
              return (at >= 0 ? l.slice(at + 3) : l.slice(l.indexOf('│') + 2)).replace(/\s*│\s*$/, '');
            });
          const card = pane.slice(pane.findIndex((l) => l.startsWith(labels[0]!)));
          for (const l of brokenAt(card, w)) bad.push(`${lang} ${columns} ${page}: "${l.trim().slice(0, 50)}"`);
        } finally {
          s.close();
        }
      }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('the kit in the control center: marks and words in plain mode, no colour at all with NO_COLOR, the same words', () => {
  const draw = (theme: ReturnType<typeof makeTheme>) =>
    renderToString(
      <Box flexDirection="column" width={60}>
        {switchValue(inkHost(theme), true, 'on')}
        {switchValue(inkHost(theme), false, 'off')}
        {choiceValue(inkHost(theme), 'English')}
        {action(inkHost(theme), { id: 'a', label: 'Apply', keyName: 'Enter', onPress: () => {} })}
        {meter(inkHost(theme), { label: 'Weekly', labelWidth: 10, pct: 92, width: 20, value: '92%', threshold: 90, words: { over: 'past your budget' } })}
        {notice(inkHost(theme), { meaning: 'bad', text: 'Not saved.' })}
        {confirm(inkHost(theme), {
          text: 'This lowers a protection.',
          width: 50,
          apply: { id: 'y', label: 'apply', keyName: 'Enter', onPress: () => {} },
          cancel: { id: 'n', label: 'cancel', keyName: 'Esc', onPress: () => {} },
        })}
      </Box>,
      { columns: 60 },
    );
  const colour = draw(makeTheme());
  const none = draw(makeTheme({ noColor: true }));
  const plain = plainOf(draw(makeTheme({ plain: true })));
  // Colours are 30-37, 90-97 and their extended forms; bold and inverse may stay.
  assert.match(colour, /\u001B\[(?:3[0-7]|9[0-7])m/);
  assert.doesNotMatch(none, /\u001B\[(?:3[0-7]|9[0-7]|38;[25])/);
  assert.equal(plainOf(none), plainOf(colour));
  assert.match(plainOf(colour), /● on[\s\S]*○ off[\s\S]*‹ English ›[\s\S]*\[ Apply · Enter \][\s\S]*█+[░│]+ 92% ▲ past your budget[\s\S]*✗ Not saved\./);
  assert.match(plain, /\[on\] on[\s\S]*\[off\] off[\s\S]*< English >[\s\S]*#+[-|]+ 92% \[!!\] past your budget[\s\S]*\[x\] Not saved\./);
  assert.doesNotMatch(plain, /[●○‹›█░│▲✗]/);
});

test('NO_COLOR: the control center draws no colour, every state still in a mark and a word', async () => {
  const colour = await draw(new FakeData('en', {}, 'red'), { address: 'home/overview' });
  assert.match(colour.ansi(), /\u001B\[(?:3[0-7]|9[0-7])m/);
  colour.close();
  const s = await draw(new FakeData('en', {}, 'red'), { noColor: true, address: 'home/overview' });
  try {
    assert.doesNotMatch(s.ansi(), /\u001B\[(?:3[0-7]|9[0-7]|38;[25])/);
    assert.match(s.text(), /✗ broken/);
    assert.match(s.text(), /█+░+ 21%/);
  } finally {
    s.close();
  }
});

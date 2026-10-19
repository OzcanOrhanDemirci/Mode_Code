// SPDX-License-Identifier: Apache-2.0
/**
 * The UI kit (src/core/ux/kit.ts) in the host Claude Code draws it with: every prop it sets is one Claude Code's
 * elements take (the lists below are BoxProps, TextProps and ButtonProps of its declarations, 2.1.303; the mod's type
 * check holds the kit to the installed version's, src/mod/kit-host.ts), a pressable holds only text, and no state
 * is told by colour alone: with colour off, each meaning still reads differently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  action,
  card,
  choiceValue,
  confirm,
  empty,
  keyBar,
  markOf,
  meter,
  meterCells,
  meterLevel,
  notice,
  opener,
  row,
  switchValue,
  type KitHost,
} from '../../src/core/ux/kit.js';
import { COLORS, labelColumn, MARKS, type Meaning } from '../../src/core/ux/tokens.js';

const BOX = new Set(
  'key hover position top left right bottom flexDirection flexGrow flexShrink flexWrap alignItems alignSelf justifyContent gap columnGap rowGap width height minWidth minHeight margin marginX marginY marginTop marginBottom marginLeft marginRight padding paddingX paddingY paddingTop paddingBottom paddingLeft paddingRight borderStyle borderColor borderDimColor backgroundColor overflow display'.split(
    ' ',
  ),
);
const TEXT = new Set('hover color backgroundColor dimColor size weight mono tabular bold italic underline strikethrough inverse dir wrap'.split(' '));
const BUTTON = new Set('key label hotkey action plain dimColor variant role autoFocus hover onPress'.split(' '));

interface El {
  type: 'Box' | 'Text' | 'Button';
  props: Record<string, unknown>;
  children: (El | string)[];
}

/** A host that records what the kit asks for, as Claude Code's elements would receive it. */
function recorder(color: (m: Meaning) => string | undefined = (m) => COLORS[m].claude): KitHost<El> {
  const kids = (c: unknown[]) => c.filter((x): x is El | string => x !== null && x !== undefined && x !== false);
  return {
    box: (p, ...c) => ({ type: 'Box', props: { ...p }, children: kids(c) }),
    text: (p, ...c) => ({ type: 'Text', props: { ...p }, children: kids(c) }),
    press: (p, ...c) => ({
      type: 'Button',
      props: { key: p.id, plain: true, onPress: p.onPress, ...(p.hotkey ? { hotkey: p.hotkey } : {}), ...(p.primary ? { variant: 'primary' } : {}) },
      children: kids(c),
    }),
    color,
    plain: false,
    measure: (s) => [...s].length,
  };
}

const textOf = (e: El | string): string => (typeof e === 'string' ? e : e.children.map(textOf).join(''));

function walk(e: El | string, visit: (e: El) => void): void {
  if (typeof e === 'string') return;
  visit(e);
  for (const c of e.children) walk(c, visit);
}

function everything(h: KitHost<El>): El[] {
  const press = { id: 'p', label: 'Apply', onPress: () => {} };
  return [
    markOf(h, 'ok', 'on'),
    switchValue(h, true, 'on'),
    switchValue(h, false, 'off'),
    choiceValue(h, 'English'),
    action(h, { ...press, keyName: 'Enter', primary: true }),
    opener(h, { ...press, label: 'Agents' }),
    row(h, { label: 'Language', labelWidth: 12, value: 'English', trailing: '›', width: 40 }),
    meter(h, { label: 'Weekly', labelWidth: 10, pct: 92, width: 20, value: '92%', threshold: 90, words: { over: 'past your budget' } }),
    notice(h, { meaning: 'on', text: 'Saved.', undo: { ...press, id: 'u', label: 'undo', keyName: 'u' } }),
    confirm(h, { text: 'This lowers a protection.', width: 30, apply: press, cancel: { ...press, id: 'c', label: 'Cancel' } }),
    keyBar(h, [
      { key: 'Enter', label: 'open', onPress: () => {} },
      { key: '↑↓', label: 'move' },
    ]),
    card(h, { lines: [{ label: 'What it is', text: 'A long sentence that wraps at word boundaries.' }], width: 30 }),
    empty(h, { text: 'Nothing yet.', width: 30, action: press }),
  ];
}

test('the kit sets only the props Claude Code takes, and a button there holds only text', () => {
  for (const tree of everything(recorder())) {
    walk(tree, (e) => {
      const allowed = e.type === 'Box' ? BOX : e.type === 'Text' ? TEXT : BUTTON;
      for (const k of Object.keys(e.props)) assert.ok(allowed.has(k), `${e.type} has no prop ${k} in Claude Code`);
      if (e.type === 'Button') for (const c of e.children) assert.ok(typeof c === 'string' || c.type === 'Text', `a Button holds ${JSON.stringify(c)}`);
      if (e.type === 'Text') for (const c of e.children) assert.ok(typeof c === 'string' || c.type === 'Text', 'a Text holds only text');
    });
  }
});

test('colour never says a thing alone: with colour off, every meaning and every state still reads differently', () => {
  const none = recorder(() => undefined);
  const meanings: Meaning[] = ['on', 'off', 'ask', 'bad', 'focus', 'bypass', 'agents'];
  const notes = meanings.map((m) => textOf(notice(none, { meaning: m, text: 'x' })));
  // Bypass shares red with "blocked": its mark (⚡) sets it apart.
  assert.equal(new Set(notes).size, meanings.length, notes.join(' | '));
  assert.notEqual(textOf(switchValue(none, true, 'on')), textOf(switchValue(none, false, 'off')));
  const levels = [10, 85, 99].map((pct) =>
    textOf(meter(none, { label: 'Week', labelWidth: 6, pct, width: 10, value: `${pct}%`, threshold: 95, words: { near: 'near', over: 'over' } })),
  );
  assert.equal(new Set(levels.map((l) => l.replace(/^\S+\s+[█░│]+\s\d+%/, ''))).size, 3, levels.join(' | '));
  walk(notice(none, { meaning: 'bad', text: 'x' }), (e) => assert.equal(e.props.color, undefined));
});

test('every mark has a plain spelling in ASCII, and the marks of the switch and the meter differ from each other', () => {
  for (const [name, m] of Object.entries(MARKS)) assert.match(m.plain, /^[\x20-\x7e]+$/, name);
  assert.notEqual(MARKS.on.glyph, MARKS.off.glyph);
  assert.notEqual(MARKS.fill.glyph, MARKS.track.glyph);
  assert.notEqual(MARKS.fill.plain, MARKS.track.plain);
});

test('a meter: the fill and the track make its width, the threshold falls where its share is, the level reads in words', () => {
  const c = meterCells(27, 30, 40, false);
  assert.equal(c.fill.length + c.track.length, 30);
  assert.equal(c.fill.length, 8);
  assert.equal(c.markAt, 12);
  assert.equal(meterCells(50, 10, null, true).fill, '#####');
  assert.equal(meterCells(50, 10, 100, false).markAt, null);
  assert.deepEqual([meterLevel(10, null), meterLevel(85, null), meterLevel(100, null)], ['low', 'near', 'over']);
  assert.deepEqual([meterLevel(25, 40), meterLevel(32, 40), meterLevel(40, 40)], ['low', 'near', 'over']);
});

test('the label column: the longest label and two, at most forty', () => {
  assert.equal(labelColumn(['Now', 'What it is']), 12);
  assert.equal(labelColumn(['x'.repeat(60)]), 40);
});

test('an action shows its key; a press reaches what it was given', () => {
  let pressed = 0;
  const a = action(recorder(), { id: 'a', label: 'Apply', keyName: 'Enter', onPress: () => pressed++ });
  assert.equal(textOf(a), '[ Apply · Enter ]');
  (a.props.onPress as () => void)();
  assert.equal(pressed, 1);
});

/** The elements of a tree in document order. */
function all(e: El | string): El[] {
  const out: El[] = [];
  walk(e, (x) => out.push(x));
  return out;
}
const texts = (e: El | string) => all(e).filter((x) => x.type === 'Text');

test('a value reads as a value: bold, in its colour; an action that is the main one says so', () => {
  const h = recorder();
  assert.deepEqual(switchValue(h, true, 'on').props, { bold: true, color: 'success' });
  assert.deepEqual(switchValue(h, false, 'off').props, { bold: true, color: 'inactive' });
  assert.deepEqual(choiceValue(h, 'English').props, { bold: true, color: 'suggestion' });
  const c = confirm(h, {
    text: 'x',
    width: 20,
    apply: { id: 'y', label: 'Apply', onPress: () => {} },
    cancel: { id: 'n', label: 'Cancel', onPress: () => {} },
  });
  const buttons = all(c).filter((x) => x.type === 'Button');
  assert.deepEqual(
    buttons.map((b) => b.props.variant ?? null),
    ['primary', null],
  );
  const bar = keyBar(h, [{ key: 'Enter', label: 'open' }]);
  assert.deepEqual(
    texts(bar).map((t) => [t.props.bold ?? false, textOf(t)]),
    [
      [true, 'Enter'],
      [false, ' open'],
    ],
  );
});

test('a row: text is cut at its edge, an element goes in as it is; a label fits its column or ends in an ellipsis', () => {
  const h = recorder();
  const el = h.text({ color: 'x' }, 'mine');
  const r1 = row(h, { label: 'Lang', labelWidth: 8, value: 'English', trailing: '›' });
  assert.deepEqual(texts(r1)[1]!.props, { wrap: 'truncate-end' });
  assert.equal(textOf(texts(r1)[2]!), '›');
  assert.equal(texts(r1)[2]!.props.color, 'inactive');
  const r2 = row(h, { label: 'Lang', labelWidth: 8, value: el, trailing: el });
  assert.equal(all(r2).filter((x) => x === el).length, 2);
  // The label column holds labelWidth - 2: exactly that is kept whole, one more is cut, none leaves nothing.
  const label = (text: string, w: number) => textOf(texts(row(h, { label: text, labelWidth: w, value: 'v' }))[0]!);
  assert.equal(label('abcdef', 8), 'abcdef');
  assert.equal(label('abcdefg', 8), 'abcde…');
  assert.equal(label('abc', 2), '');
});

test('a meter: its colour and words follow its level, the threshold mark stands where it falls, the label fits', () => {
  const h = recorder();
  const fillColour = (pct: number, threshold: number | null) =>
    texts(meter(h, { label: 'W', labelWidth: 4, pct, width: 10, value: '', threshold }))[1]!.props.color;
  assert.deepEqual([fillColour(10, null), fillColour(80, null), fillColour(100, null)], ['success', 'warning', 'error']);
  assert.deepEqual([meterLevel(79, null), meterLevel(80, null), meterLevel(29, 40), meterLevel(30, 40)], ['low', 'near', 'low', 'near']);
  const m = meter(h, { label: 'Weekly', labelWidth: 5, pct: 20, width: 10, value: '20%', threshold: 50 });
  const bar = texts(m)
    .slice(1, 3)
    .map((t) => textOf(t))
    .join('');
  assert.equal(bar, '██░░░│░░░░');
  assert.equal(textOf(texts(m)[0]!), 'Wee…');
  // A threshold at the edges marks nothing; one near the end stays inside the track.
  assert.equal(meterCells(50, 10, 0, false).markAt, null);
  assert.equal(meterCells(50, 10, 99, false).markAt, 9);
});

test('a card: the label on its first line, the lines it wraps to under the value only', () => {
  const c = card(recorder(), { lines: [{ label: 'Now', text: 'one two three four five six' }], width: 15, labelWidth: 6 });
  const rows = all(c).filter((x) => x.type === 'Box' && x.props.flexDirection === 'row');
  assert.ok(rows.length >= 2);
  assert.deepEqual(
    rows.map((r) => textOf(texts(r)[0]!)),
    ['Now', ...rows.slice(1).map(() => '')],
  );
});

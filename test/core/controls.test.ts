// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionKeyword,
  cells,
  CHOICE_LINE,
  choicesText,
  commandNamed,
  COMMANDS,
  continueChoices,
  continuePhrase,
  controlsLine,
  digitOf,
  FLOW_PRESETS,
  flowPhrase,
  flowPresetLine,
  fullAutoPhrase,
  lastChoice,
  menuText,
  parseBudget,
  pickChoice,
  rowCells,
  splitBudget,
  stripRows,
  styleOf,
  type StripView,
} from '../../src/core/controls.js';
import { detectKeyword } from '../../src/core/keywords.js';
import { applyKeyword, newModState } from '../../src/core/session.js';

const view: StripView = { mode: 'plan', style: 'autonomous', flow: null, fullAutoHere: false };

test('every control has its digit, 0 to 9, and the words that take a value; each name once', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const d of '0123456789') assert.ok(commandNamed(d), d);
  assert.deepEqual(commandNamed('3'), { kind: 'mode', mode: 'plan' });
  assert.deepEqual(commandNamed('7'), { kind: 'style', style: 'autonomous' });
  assert.deepEqual([commandNamed('devam'), commandNamed('continue')], [{ kind: 'continue' }, { kind: 'continue' }]);
  assert.deepEqual([commandNamed('kota'), commandNamed('quota')], [{ kind: 'quota' }, { kind: 'quota' }]);
  assert.deepEqual([commandNamed('akis'), commandNamed('flow'), commandNamed('9')], [{ kind: 'flow' }, { kind: 'flow' }, { kind: 'flow' }]);
  assert.equal(commandNamed('10'), null);
  assert.equal(digitOf({ kind: 'mode', mode: 'chat' }), '1');
  assert.equal(digitOf({ kind: 'style', style: 'manual' }), '6');
  // Every command name is one Claude Code takes: letters, digits, "_" and "-".
  for (const n of names) assert.match(n, /^[A-Za-z0-9_-]{1,64}$/);
});

test('a command or a press stands for the keyword typed alone: the same state change', () => {
  const s = newModState('s', '1', 0);
  const plan = actionKeyword({ kind: 'mode', mode: 'plan' }, 'tr', 'command');
  assert.deepEqual([plan.kind, plan.text, plan.standalone, plan.via], ['plan', '/3', true, 'command']);
  assert.deepEqual(applyKeyword(s, plan, null), applyKeyword(s, detectKeyword('plan')!, null));
  const auto = actionKeyword({ kind: 'style', style: 'autonomous' }, 'tr', 'strip');
  assert.deepEqual([auto.kind, auto.text, auto.via], ['autonomous', 'otonom', 'strip']);
  assert.deepEqual(applyKeyword(s, auto, null), applyKeyword(s, detectKeyword('otonom')!, null));
  assert.equal(actionKeyword({ kind: 'style', style: 'manual' }, 'en', 'command').kind, 'manualStyle');
  assert.equal(actionKeyword({ kind: 'mode', mode: 'research' }, 'en', 'strip').text, 'research');
});

test('the way of working shown: the default reads as manual; a run makes it full auto', () => {
  assert.equal(styleOf('default', false), 'manual');
  assert.equal(styleOf('manual', false), 'manual');
  assert.equal(styleOf('autonomous', false), 'autonomous');
  assert.equal(styleOf('full', false), 'full');
  assert.equal(styleOf('autonomous', true), 'full');
});

test('a budget: a number, +N, with or without the word, at either end of a task', () => {
  assert.deepEqual(parseBudget('29'), { n: 29, plus: false });
  assert.deepEqual(parseBudget('+5'), { n: 5, plus: true });
  assert.deepEqual(parseBudget('kota 70'), { n: 70, plus: false });
  assert.deepEqual(parseBudget('Quota +10 %'), { n: 10, plus: true });
  assert.deepEqual(
    [parseBudget('0'), parseBudget('100')],
    [
      { n: 0, plus: false },
      { n: 100, plus: false },
    ],
    'both ends of the range',
  );
  for (const bad of ['', 'abc', '101', '-5', '1000', '5.5']) assert.equal(parseBudget(bad), null, bad);
  assert.deepEqual(splitBudget('kota +10 refactor the parser'), { budget: { n: 10, plus: true }, rest: 'refactor the parser' });
  assert.deepEqual(splitBudget('refactor the parser quota 40'), { budget: { n: 40, plus: false }, rest: 'refactor the parser' });
  assert.deepEqual(splitBudget('refactor the parser'), { budget: null, rest: 'refactor the parser' });
  assert.deepEqual(splitBudget('kota 30'), { budget: { n: 30, plus: false }, rest: '' });
});

test('what to continue: registered projects first, then every folder once, newest first', () => {
  const choices = continueChoices({
    projects: [
      { id: 'car', names: ['araba'], path: 'C:/dev/car' },
      { id: 'terminal-code', names: ['terminal'], path: 'C:/dev/terminal_code' },
      { id: 'notes', names: [], path: null },
    ],
    folders: [
      { path: 'C:/dev/car', at: 100 },
      { path: 'C:/dev/terminal_code', at: 300 },
      { path: 'c:/DEV/terminal_code', at: 50 },
      { path: 'C:/dev/collapse', at: 200 },
      { path: 'C:/Users/ada/Desktop', at: 400 },
      { path: 'C:/dev/collapse', at: 10 },
    ],
    platform: 'win32',
  });
  assert.deepEqual(
    choices.map((c) => [c.n, c.label, c.project, c.at]),
    [
      [1, 'terminal', 'terminal-code', 300],
      [2, 'araba', 'car', 100],
      [3, 'notes', 'notes', 0],
      [4, 'Desktop', null, 400],
      [5, 'collapse', null, 200],
    ],
  );
  assert.deepEqual(continueChoices({ projects: [], folders: [], platform: 'linux' }), []);
});

test('a choice by its number, its name, its folder, or the start of one; several that fit are not guessed', () => {
  const choices = continueChoices({
    projects: [{ id: 'terminal-code', names: ['terminal'], path: '/home/ada/dev/terminal_code' }],
    folders: [
      { path: '/home/ada/dev/collapse', at: 2 },
      { path: '/home/ada/dev/car', at: 1 },
      { path: '/home/ada/dev/chefol', at: 3 },
    ],
    platform: 'linux',
  });
  const pick = (t: string) => pickChoice(choices, t).choice?.label ?? null;
  assert.equal(pick('1'), 'terminal');
  assert.equal(pick('3'), 'collapse');
  assert.equal(pick('9'), null);
  assert.equal(pick('Terminal'), 'terminal');
  assert.equal(pick('terminal-code'), 'terminal', 'the id');
  assert.equal(pick('/home/ada/dev/car'), 'car', 'the path');
  assert.equal(pick('col'), 'collapse');
  assert.equal(pick('car'), 'car', 'an exact name wins over the start of another');
  const named = continueChoices({ projects: [{ id: 'car', names: ['araba'], path: '/home/ada/dev/car' }], folders: [], platform: 'linux' });
  assert.equal(pickChoice(named, 'ara', (c) => [c.label]).choice?.project, 'car', 'the start of a name alone is enough');
  assert.equal(pickChoice(named, 'ca', (c) => [c.label]).choice?.project, 'car', 'the start of the folder alone is enough');
  assert.equal(pick(''), null);
  const both = pickChoice(choices, 'c');
  assert.equal(both.choice, null);
  assert.deepEqual(
    both.matches.map((c) => c.label),
    ['chefol', 'collapse', 'car'],
  );
  assert.deepEqual(pickChoice(choices, 'zzz').matches, []);
});

test('the words a command puts at the end of a task are the keywords the detector reads back', () => {
  for (const lang of ['tr', 'en'] as const) {
    for (const v of FLOW_PRESETS) {
      const kw = detectKeyword(`Add sign-in.\n${flowPhrase(v, lang)}`);
      assert.deepEqual([kw?.kind, kw?.flow], ['flow', v], `${lang} ${v}`);
      assert.ok(flowPresetLine(v, lang).length > 3);
    }
    const auto = detectKeyword(`Refactor it.\n${fullAutoPhrase({ n: 10, plus: true }, lang)}`);
    assert.deepEqual([auto?.kind, auto?.budget], ['fullAuto', { n: 10, plus: true }], lang);
    const cont = detectKeyword(continuePhrase('terminal', { n: 29, plus: false }, lang), [{ id: 'tc', names: ['terminal'] }]);
    assert.deepEqual([cont?.kind, cont?.project, cont?.budget], ['continue', 'tc', { n: 29, plus: false }], lang);
    assert.equal(detectKeyword(continuePhrase(null, null, lang))?.kind, 'continue');
  }
  assert.equal(flowPresetLine('researchPlan', 'en'), '🔍 research ▶ 📐 plan, no code');
});

test('the strip: every control on every layout, one row when it fits, never wider than the room', () => {
  const ids = (rows: ReturnType<typeof stripRows>) =>
    rows
      .flat()
      .flatMap((s) => s.items.map((i) => i.id))
      .sort();
  for (const lang of ['tr', 'en'] as const)
    for (const columns of [40, 50, 60, 80, 100, 120, 160, 200]) {
      const rows = stripRows(view, lang, columns);
      assert.deepEqual(ids(rows), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], `${lang} ${columns}`);
      if (columns >= 50) for (const r of rows) assert.ok(rowCells(r) <= columns, `${lang} ${columns}: ${rowCells(r)}`);
    }
  assert.equal(stripRows(view, 'tr', 200).length, 1);
  assert.equal(stripRows(view, 'tr', 80).length, 2);
  // Each layout is taken exactly while it fits: at its width, not one column less.
  const one = rowCells(stripRows(view, 'tr', 400)[0]!);
  assert.deepEqual([stripRows(view, 'tr', one).length, stripRows(view, 'tr', one - 1).length], [1, 2]);
  const twoRows = stripRows(view, 'tr', one - 1);
  const two = Math.max(...twoRows.map(rowCells));
  assert.equal(stripRows(view, 'tr', two).length, 2);
  assert.match(stripRows(view, 'tr', two - 1)[0]![0]!.items[0]!.label, /^1💬/, 'one column less: numbers and icons');
  const tight = rowCells(stripRows(view, 'tr', two - 1)[0]!);
  assert.deepEqual([stripRows(view, 'tr', tight).length, stripRows(view, 'tr', tight - 1).length], [1, 2]);
  const active = stripRows(view, 'en', 200)
    .flat()
    .flatMap((s) => s.items.filter((i) => i.active).map((i) => i.id));
  assert.deepEqual(active, ['3', '7']);
  const dim = stripRows(view, 'en', 200)
    .flat()
    .flatMap((s) => s.items.filter((i) => i.dim).map((i) => i.id));
  assert.deepEqual(dim, ['8'], 'full autonomy cannot start on native Windows');
  const flowing = stripRows({ ...view, flow: '2/4', fullAutoHere: true }, 'tr', 200).flat();
  assert.ok(flowing.some((s) => s.items.some((i) => i.id === '9' && i.active && i.label === '9 akış 2/4')));
  assert.ok(!flowing.some((s) => s.items.some((i) => i.dim)));
});

test('the controls in a line and the menu', () => {
  assert.equal(controlsLine(view, 'tr'), '📐 plan · otonom');
  assert.equal(controlsLine({ ...view, mode: 'free', style: 'manual', flow: '1/3' }, 'en'), 'free · manual · flow 1/3');
  const menu = menuText(view, 'tr', 'hafta %54');
  assert.match(menu, /^Şu an: 📐 plan · otonom · hafta %54$/m);
  assert.match(menu, /^- Mod: \/1 💬 sohbet · \/2 🔍 araştırma · \*\*\/3 📐 plan\*\* · \/4 🔨 kod · \/5 serbest$/m);
  assert.match(menu, /\*\*\/7 otonom\*\*/);
  for (const c of ['/1', '/2', '/4', '/5', '/6', '/8', '/9', '/0', '/devam', '/kota']) assert.ok(menu.includes(c), c);
});

test('the list /devam prints: numbered, registered ones starred, the folder and when', () => {
  const choices = continueChoices({
    projects: [{ id: 'tc', names: ['terminal'], path: 'C:/dev/terminal_code' }],
    folders: [{ path: 'C:/dev/car', at: 5 }],
    platform: 'win32',
  });
  const text = choicesText(
    choices,
    'en',
    (p) => p.replace('C:/dev', '~d'),
    (at) => `${at}m ago`,
  );
  assert.match(text, /^What to continue \(2\)/);
  assert.match(text, /^1\. terminal ★ · ~d\/terminal_code$/m);
  assert.match(text, /^2\. car · ~d\/car · 5m ago$/m);
  assert.deepEqual(
    text
      .split('\n')
      .filter((l) => CHOICE_LINE.test(l))
      .map((l) => CHOICE_LINE.exec(l)![1]),
    ['1', '2'],
  );
  assert.match(text, /\/devam 3 kota 29/);
});

test("the folder's last choice: the newest other session there; a run comes back as autonomous", () => {
  const s = (id: string, cwd: string | undefined, at: number, mode: any, interaction: any) => ({ sessionId: id, cwd, aliveAt: at, mode, interaction });
  const states = [
    s('a', 'C:/dev/app', 10, 'plan', 'autonomous'),
    s('b', 'c:/DEV/app', 30, 'code', 'full'),
    s('c', 'C:/dev/other', 50, 'chat', 'manual'),
    s('self', 'C:/dev/app', 99, 'free', 'default'),
    s('d', undefined, 60, 'research', 'manual'),
  ];
  assert.deepEqual(lastChoice(states, 'C:/dev/app', 'win32', 'self'), { mode: 'code', interaction: 'autonomous' });
  assert.equal(lastChoice(states, 'C:/dev/app', 'linux', 'self')?.mode, 'plan', 'case matters on Linux');
  assert.equal(lastChoice(states, 'C:/dev/none', 'win32', 'self'), null);
});

test("a row's width: a title, its items a space apart, segments two apart", () => {
  const item = (label: string) => ({ id: label, label, active: false, dim: false });
  assert.equal(rowCells([{ title: 'Mod', items: [item('1 a'), item('2 b')] }]), 11);
  assert.equal(rowCells([{ title: '', items: [item('1 a'), item('2 b')] }]), 7);
  assert.equal(
    rowCells([
      { title: '', items: [item('ab')] },
      { title: 'X', items: [item('c')] },
    ]),
    2 + 2 + 1 + 1 + 1,
  );
});

test('cells: pictographs take two columns', () => {
  assert.equal(cells('3 📐 plan'), 9);
  assert.equal(cells('abc'), 3);
  assert.equal(cells('🛡️'), 2);
});

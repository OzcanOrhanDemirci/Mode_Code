// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetLabel,
  budgetProblem,
  budgetTarget,
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
  lastChoice,
  menuText,
  commandOf,
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
import { DEFAULT_AGENTS, type AgentsState } from '../../src/core/agents.js';

const view: StripView = {
  mode: 'plan',
  style: 'autonomous',
  flow: null,
};

test('every control has its number, 0 to 9 and 00, and the words that take a value or close; each name once', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const d of '0123456789') assert.ok(commandNamed(d), d);
  assert.deepEqual(commandNamed('9'), { kind: 'style', style: 'full' });
  assert.deepEqual(commandNamed('3'), { kind: 'mode', mode: 'plan' });
  assert.deepEqual(commandNamed('6'), { kind: 'flow' });
  assert.deepEqual(commandNamed('7'), { kind: 'style', style: 'manual' });
  assert.deepEqual(commandNamed('8'), { kind: 'style', style: 'autonomous' });
  // Full autonomy by the word it had before it had a number too.
  assert.deepEqual([commandNamed('tam-otonom'), commandNamed('full-auto')], [commandNamed('9'), commandNamed('9')]);
  assert.equal(commandOf({ kind: 'style', style: 'full' }, 'tr'), '9');
  assert.equal(commandOf({ kind: 'flow' }, 'tr'), '6');
  assert.deepEqual([commandNamed('devam'), commandNamed('continue')], [{ kind: 'continue' }, { kind: 'continue' }]);
  assert.deepEqual([commandNamed('kota'), commandNamed('quota')], [{ kind: 'quota' }, { kind: 'quota' }]);
  assert.deepEqual([commandNamed('akis'), commandNamed('flow')], [{ kind: 'flow' }, { kind: 'flow' }]);
  assert.deepEqual([commandNamed('00'), commandNamed('kapat'), commandNamed('close')], [{ kind: 'close' }, { kind: 'close' }, { kind: 'close' }]);
  assert.equal(commandNamed('10'), null);
  assert.equal(commandNamed('000'), null);
  assert.equal(digitOf({ kind: 'mode', mode: 'chat' }), '1');
  assert.equal(digitOf({ kind: 'style', style: 'manual' }), '7');
  assert.equal(digitOf({ kind: 'cockpit' }), '0');
  assert.equal(digitOf({ kind: 'close' }), '00', 'a number of two digits is on the strip too');
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
  // Full autonomy as its keyword typed alone starts it; the others carry no such part.
  const full = actionKeyword({ kind: 'style', style: 'full' }, 'en', 'command');
  assert.deepEqual(full, { kind: 'fullAuto', lang: 'en', text: '/9', standalone: true, via: 'command', auto: 'start' });
  assert.deepEqual(applyKeyword(s, full, null), applyKeyword(s, detectKeyword('full auto')!, null));
  assert.ok(!('auto' in auto));
});

test('a budget as its window names it: the weekly limit it sets, points above the reading, or as written', () => {
  assert.deepEqual(
    [budgetTarget('70', 40), budgetTarget('+5', 40.4), budgetTarget('+10', 95), budgetTarget('+5', null), budgetTarget('soon', 40)],
    [70, 45, 100, null, null],
  );
  assert.deepEqual(
    [budgetLabel('+10', 41, 'en'), budgetLabel('+10', 41, 'tr'), budgetLabel('70', 41, 'en'), budgetLabel('+10', null, 'en'), budgetLabel('soon', 41, 'en')],
    ['+10 → 51%', '+10 → %51', '70%', '+10', 'soon'],
  );
});

test('the way of working shown: the default reads as manual', () => {
  assert.deepEqual((['default', 'manual', 'autonomous', 'full'] as const).map(styleOf), ['manual', 'manual', 'autonomous', 'full']);
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
      { id: 'mode-code', names: ['terminal'], path: 'C:/dev/terminal_code' },
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
      [1, 'terminal', 'mode-code', 300],
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
    projects: [{ id: 'mode-code', names: ['terminal'], path: '/home/ada/dev/terminal_code' }],
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
  assert.equal(pick('mode-code'), 'terminal', 'the id');
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
      assert.deepEqual(ids(rows), ['0', '00', '1', '2', '3', '4', '5', '6', '7', '8', '9'], `${lang} ${columns}`);
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
  assert.deepEqual(active, ['3', '8']);
  // Full autonomy is a way of working like the others: always on the strip, a choice, lit when in effect.
  const items = (v: StripView, lang: 'tr' | 'en' = 'en') =>
    stripRows(v, lang, 200)
      .flat()
      .flatMap((s) => s.items);
  assert.deepEqual(
    items(view).find((i) => i.id === '9'),
    { id: '9', label: '9 full auto', active: false },
  );
  assert.equal(items(view, 'tr').find((i) => i.id === '9')?.label, '9 tam otonom');
  assert.deepEqual(
    items({ ...view, style: 'full' })
      .filter((i) => i.active)
      .map((i) => i.id),
    ['3', '9'],
  );
  // Closing comes last, after the menu, never highlighted.
  const last = (rows: ReturnType<typeof stripRows>) => rows.flat().at(-1)!.items.at(-1)!;
  assert.deepEqual(last(stripRows(view, 'tr', 200)), { id: '00', label: '00 ✕ kapat', active: false });
  // The menu and closing are no way of working: a group of their own, untitled, at the far end of the last
  // row, in every layout; the way of working's group ends with its own controls.
  for (const columns of [400, 100, 70, 50, 30]) {
    const rows = stripRows(view, 'tr', columns);
    const end = rows.at(-1)!.at(-1)!;
    assert.deepEqual([end.title, end.end, end.items.map((i) => i.id)], ['', true, ['0', '00']], String(columns));
    assert.equal(rows.flat().filter((s) => s.end).length, 1, String(columns));
    assert.deepEqual(
      rows
        .at(-1)!
        .at(-2)!
        .items.map((i) => i.id),
      ['7', '8', '9'],
      String(columns),
    );
  }
  assert.equal(stripRows(view, 'tr', 400).flat().at(-1)!.items[0]!.label, '0 ≡ kokpit ○');
  assert.equal(stripRows(view, 'tr', 50).flat().at(-1)!.items[0]!.label, '0≡○');
  assert.deepEqual(
    {
      ...stripRows({ ...view, cockpit: true }, 'en', 400)
        .flat()
        .at(-1)!.items[0]!,
    },
    { id: '0', label: '0 ≡ cockpit ●', active: true },
  );
  assert.equal(last(stripRows(view, 'en', 200)).label, '00 ✕ close');
  assert.equal(last(stripRows(view, 'tr', 50)).label, '00✕');
});

test('the controls in a line and the menu', () => {
  assert.equal(controlsLine(view, 'tr'), '📐 plan · otonom');
  assert.equal(controlsLine({ ...view, mode: 'free', style: 'manual', flow: { at: '1/3', state: 'running' } }, 'en'), 'free · manual · flow 1/3');
  const menu = menuText(view, 'tr', 'hafta %54');
  assert.match(menu, /^Şu an: 📐 plan · otonom · hafta %54$/m);
  assert.match(menu, /^- Mod: \/1 💬 sohbet · \/2 🔍 araştırma · \*\*\/3 📐 plan\*\* · \/4 🔨 kod · \/5 serbest · \/6 akış$/m);
  assert.match(menu, /\*\*\/8 otonom\*\*/);
  for (const c of ['/1', '/2', '/4', '/5', '/6', '/7', '/0', '/devam', '/kota', '/00 kapat']) assert.ok(menu.includes(c), c);
  assert.match(menu, /\*\*\/8 otonom\*\* · \/9 tam otonom$/m);
  assert.match(menuText({ ...view, flow: { at: '2/4', state: 'running' } }, 'tr', '—'), /\/5 serbest · \*\*\/6 akış 2\/4\*\*$/m);
  assert.match(menuText(view, 'en', '—'), /\/0 cockpit · \/00 close$/m);
});

test('the flow on the strip: lit while on, the mode of its working step breathing; paused it waits, marked', () => {
  const items = (v: StripView, columns = 200) =>
    stripRows(v, 'tr', columns)
      .flat()
      .flatMap((s) => s.items);
  const flowItem = (v: StripView, columns = 200) => items(v, columns).find((i) => i.id === '6')!;
  const lit = (v: StripView) =>
    items(v)
      .filter((i) => i.active)
      .map((i) => i.id);
  const running: StripView = { ...view, mode: 'research', flow: { at: '1/4', state: 'running' } };
  assert.deepEqual(lit(running), ['6', '8'], 'the flow is lit, the modes are not');
  assert.deepEqual(
    items(running)
      .filter((i) => i.pulse)
      .map((i) => i.id),
    ['2'],
    'research, its step, breathes',
  );
  assert.equal(flowItem(running).label, '6 akış 1/4');
  assert.equal(flowItem(running, 50).label, '6⇢1/4');
  const approval: StripView = { ...view, flow: { at: '3/4', state: 'approval' } };
  assert.deepEqual(
    items(approval).filter((i) => i.pulse),
    [],
    'waiting for the person, nothing breathes',
  );
  assert.deepEqual([flowItem(approval).label, flowItem(approval).active], ['6 akış · onay?', true]);
  const paused: StripView = { ...view, mode: 'chat', flow: { at: '2/4', state: 'paused' } };
  assert.deepEqual(lit(paused), ['1', '8'], 'the mode chosen is lit; the flow waits');
  assert.equal(flowItem(paused).label, '6 akış ⏸ 2/4');
  const armed: StripView = { ...view, flow: { at: '', state: 'armed' } };
  assert.deepEqual([flowItem(armed).label, flowItem(armed).active], ['6 akış ✎', true]);
  // Off, a press asks which flow and starts none: an opener's `…`. In a line of text it is the word alone.
  assert.equal(flowItem({ ...view, flow: null }).label, '6 akış…');
  assert.equal(flowItem({ ...view, flow: null }, 50).label, '6⇢…');
  assert.equal(controlsLine({ ...view, flow: { at: '', state: 'armed' } }, 'tr'), '📐 plan · otonom · akış ✎');
  assert.equal(controlsLine(paused, 'en'), '💬 chat · autonomous · flow ⏸ 2/4');
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

test("the folder's last choice: the newest other session there; a run comes back as the way of working before it", () => {
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
  // Full autonomy never comes back by itself: the folder is taken up Autonomous.
  assert.deepEqual(lastChoice([s('e', 'C:/dev/app', 40, 'code', 'full')], 'C:/dev/app', 'win32', 'self'), {
    mode: 'code',
    interaction: 'autonomous',
  });
});

test("a row's width: a title, its items a space apart, segments two apart", () => {
  const item = (label: string) => ({ id: label, label, active: false });
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

test('a freeze is on the strip and in the session line only while it holds', () => {
  const frozen = { ...view, frozen: 'feature' };
  const items = (v: typeof view, lang: 'tr' | 'en', columns: number) =>
    stripRows(v, lang, columns)
      .flat()
      .flatMap((s) => s.items);
  assert.deepEqual(
    items(frozen, 'tr', 200).find((i) => i.id === 'dondur'),
    { id: 'dondur', label: '❄ feature ●', active: true },
  );
  assert.equal(items(frozen, 'en', 40).find((i) => i.id === 'freeze')?.label, '❄●');
  assert.equal(
    items(view, 'en', 200).find((i) => i.id === 'freeze'),
    undefined,
  );
  assert.match(controlsLine(frozen, 'en'), / · ❄ feature$/);
  assert.doesNotMatch(controlsLine(view, 'en'), /❄/);
});

test('parallel agents: on the strip, in the line and the menu once turned on; lit while agents may run', () => {
  const off = { ...DEFAULT_AGENTS };
  const free = { ...off, mode: 'free' as const, n: 5 };
  const assigned = { ...off, mode: 'assigned' as const, n: 3, batch: { at: 1, started: [{ row: 0, toolUseId: 't0' }], sealed: false } };
  const shown = (state: AgentsState, running = 0, on = true): StripView => ({ ...view, agents: { shown: on, state, running } });
  const item = (v: StripView, lang: 'tr' | 'en' = 'en', columns = 200) =>
    stripRows(v, lang, columns)
      .flat()
      .flatMap((s) => s.items)
      .find((i) => i.id === commandOf({ kind: 'agents' }, lang));
  assert.equal(item(view), undefined);
  assert.equal(item(shown(free, 0, false)), undefined, 'not turned on');
  // An opener: the window opens, nothing changes until the person acts there; its state follows the mark.
  assert.deepEqual(item(shown(off)), { id: 'parallel', label: '👥 agents…', active: false });
  assert.deepEqual(item(shown(off), 'tr'), { id: 'ajan', label: '👥 ajan…', active: false });
  assert.deepEqual(item(shown(free, 2)), { id: 'parallel', label: '👥 agents… ≤5 · 2', active: true });
  assert.equal(item(shown(free, 2), 'en', 40)?.label, '👥…≤5·2');
  assert.deepEqual(item(shown(assigned, 1)), { id: 'parallel', label: '👥 agents… =3 · 1/3', active: true });
  assert.deepEqual(item(shown({ ...off, ultracode: true })), { id: 'parallel', label: '👥 agents… · ultracode', active: true });
  // Every layout still fits the room with it, and with the other optional controls beside it.
  const full = { ...shown(assigned, 1), frozen: 'feature' };
  for (const lang of ['tr', 'en'] as const)
    for (const columns of [50, 60, 80, 100, 120, 160, 200])
      for (const r of stripRows(full, lang, columns)) assert.ok(rowCells(r) <= columns, `${lang} ${columns}`);
  assert.equal(controlsLine(shown(free, 2), 'en'), '📐 plan · autonomous · 👥 agents ≤5 · 2');
  // A line is not lit: off is said in words.
  assert.equal(controlsLine(shown(off), 'tr'), '📐 plan · otonom · 👥 ajan kapalı');
  assert.equal(controlsLine(shown({ ...off, ultracode: true }), 'en'), '📐 plan · autonomous · 👥 agents · ultracode');
  assert.doesNotMatch(controlsLine(shown(free, 2, false), 'en'), /agents/);
  assert.match(menuText(shown(free), 'en', '—'), /\/8 autonomous\*\* · \/9 full auto · \*\*\/parallel\*\*$/m);
  assert.match(menuText(shown(off), 'tr', '—'), /\/8 otonom\*\* · \/9 tam otonom · \/ajan$/m);
  assert.doesNotMatch(menuText(view, 'en', '—'), /parallel/);
});

test('the look tells the kind on the strip, on every layout: an opener ends in …, a switch says ● or ○, a choice is lit', () => {
  const all: StripView = {
    ...view,
    frozen: 'feature',
    agents: { shown: true, state: { ...DEFAULT_AGENTS }, running: 0 },
  };
  for (const lang of ['tr', 'en'] as const)
    for (const columns of [40, 60, 80, 120, 200]) {
      const items = stripRows(all, lang, columns)
        .flat()
        .flatMap((s) => s.items);
      const label = (id: string) => items.find((i) => i.id === id)!.label;
      for (const id of [commandOf({ kind: 'agents' }, lang), '6']) assert.ok(label(id).includes('…'), `${lang} ${columns} ${id}: ${label(id)}`);
      // The cockpit is a switch too: shown or not.
      assert.ok(label('0').includes('○'), `${lang} ${columns} 0: ${label('0')}`);
      assert.ok(
        stripRows({ ...all, cockpit: true }, lang, columns)
          .flat()
          .flatMap((s) => s.items)
          .find((i) => i.id === '0')!
          .label.includes('●'),
      );
      assert.ok(label(commandOf({ kind: 'freeze' }, lang)).includes('●'), `${lang} ${columns} freeze`);
      // A choice and an action carry no such mark: the lit one is the choice made, closing acts at once.
      for (const id of ['1', '2', '3', '4', '5', '7', '8', '00']) assert.ok(!/[…●○]/.test(label(id)), `${lang} ${columns} ${id}: ${label(id)}`);
    }
});

test('a budget that cannot be set says why: none given, points above now with no reading, a number the week has passed', () => {
  assert.deepEqual(budgetProblem(null, 40), { key: 'ctl.quota.bad' });
  assert.deepEqual(budgetProblem({ n: 5, plus: true }, null), { key: 'ctl.quota.noReading' });
  assert.deepEqual(budgetProblem({ n: 30, plus: false }, 40), { key: 'ctl.quota.past', params: { week: 40, target: 30 } });
  assert.deepEqual(budgetProblem({ n: 40, plus: false }, 40), { key: 'ctl.quota.past', params: { week: 40, target: 40 } });
  assert.equal(budgetProblem({ n: 41, plus: false }, 40), null);
  assert.equal(budgetProblem({ n: 30, plus: false }, null), null);
  assert.equal(budgetProblem({ n: 5, plus: true }, 40), null);
});

test('the command of each control: its number, or its word in the person language for those without one', () => {
  assert.equal(commandOf({ kind: 'mode', mode: 'plan' }, 'tr'), '3');
  assert.equal(commandOf({ kind: 'cockpit' }, 'en'), '0');
  assert.equal(commandOf({ kind: 'close' }, 'tr'), '00');
  assert.deepEqual([commandOf({ kind: 'why' }, 'tr'), commandOf({ kind: 'why' }, 'en')], ['neden', 'why']);
  assert.deepEqual([commandOf({ kind: 'freeze' }, 'tr'), commandOf({ kind: 'agents' }, 'en')], ['dondur', 'parallel']);
});

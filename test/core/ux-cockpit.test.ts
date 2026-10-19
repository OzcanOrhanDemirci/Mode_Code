// SPDX-License-Identifier: Apache-2.0
// The cockpit (src/core/ux/cockpit.ts, cockpit-view.ts): what Claude may do now worked out from the settings and the
// session in every situation that changes it, each line with its reasons; what is at work, the activity, the quota and
// the quick settings in words; and the drawing, in which every element says itself and nothing runs past its column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults, setConfigValue, type Config } from '../../src/core/config.js';
import { assessQuota, type QuotaReading } from '../../src/core/quota.js';
import { newModState, type ModSessionState } from '../../src/core/session.js';
import { budgetOf } from '../../src/core/settings-view.js';
import {
  actRows,
  allowWarning,
  callLine,
  canNow,
  cockpitData,
  nowRows,
  quickRows,
  quotaView,
  sentence,
  type CanRow,
  type CockpitFacts,
} from '../../src/core/ux/cockpit.js';
import { cockpitBody, cockpitColumns, type CockpitActs, type CockpitUi } from '../../src/core/ux/cockpit-view.js';
import type { KitHost } from '../../src/core/ux/kit.js';
import { confirmText, effectOf } from '../../src/core/ux/catalog.js';
import { COLORS, type Meaning } from '../../src/core/ux/tokens.js';
import { elapsedText } from '../../src/core/ux/elapsed.js';

const NOW = Date.UTC(2026, 9, 19, 9, 0);
const set = (c: Config, path: string, v: unknown) => setConfigValue(c, path, v).config;
const state = (patch: Partial<ModSessionState> = {}): ModSessionState => ({ ...newModState('s1', 'dev', NOW), ...patch });

function facts(cfg: Record<string, unknown> = {}, session: Partial<ModSessionState> | null = {}, extra: Partial<CockpitFacts> = {}): CockpitFacts {
  let config = cloneDefaults();
  for (const [k, v] of Object.entries(cfg)) config = set(config, k, v);
  const s = session === null ? null : state(session);
  return {
    config,
    session: s,
    mode: s?.mode ?? 'free',
    modeFrom: 'session',
    style: 'manual',
    now: NOW,
    beltOff: false,
    quota: assessQuota(null, budgetOf(config, s), NOW),
    working: false,
    mo: 'idle',
    calls: [],
    agents: [],
    flow: null,
    run: null,
    events: [],
    ...extra,
  };
}

const row = (f: CockpitFacts, id: CanRow['id'], lang: 'en' | 'tr' = 'en') => canNow(f, lang).find((r) => r.id === id);
/** A line as it reads: its mark's glyph, then its words. */
const said = (f: CockpitFacts, id: CanRow['id'], lang: 'en' | 'tr' = 'en') => {
  const r = row(f, id, lang);
  return r ? `${r.mark} ${r.text}` : null;
};

const reading = (five: number, week: number, ageMin = 1): QuotaReading => ({
  windows: [
    { kind: 'five_hour', used: five, resetsAt: NOW + 2 * 3600_000 },
    { kind: 'seven_day', used: week, resetsAt: NOW + 4 * 86400_000 },
  ],
  measuredAt: NOW - ageMin * 60_000,
  source: 'mod',
});

test('Claude right now, by default: changes the project, asks before a risky step and before deleting outside it, never touches its own protection', () => {
  const f = facts();
  assert.deepEqual(
    canNow(f, 'en').map((r) => `${r.mark} ${r.text}${r.locked ? ' (locked)' : ''}`),
    [
      "ok Changes the project's files",
      'ask Asks you before a risky step',
      'ask Asks before deleting outside the project',
      'bad Cannot touch its own protection (locked)',
      'none One step, then it waits for you',
      'ok Starts helper agents as it sees fit',
    ],
  );
  // Every line carries its reasons, worked out by the why engine, and a card that says them in one breath.
  for (const r of canNow(f, 'en')) {
    assert.ok(r.why.title && r.why.now, r.id);
    assert.ok(r.why.because.length >= 1, r.id);
    assert.ok(r.card.startsWith(`${r.why.title}: `), r.id);
  }
  assert.deepEqual(row(f, 'write')!.why, {
    title: 'Mode',
    now: 'free',
    because: ['Every session starts in free mode.', 'The safety belt still checks every command and every write.'],
  });
});

// The situations that change a line: [name, facts, line, its text].
const CASES: [string, CockpitFacts, CanRow['id'], string | null][] = [
  ['chat changes nothing', facts({}, { mode: 'chat' }), 'write', 'bad Changes no file (💬 chat)'],
  ['research writes a report', facts({}, { mode: 'research' }), 'write', 'bad Writes a report only (🔍 research)'],
  ['plan writes the plan', facts({}, { mode: 'plan' }), 'write', 'bad Writes the plan only (📐 plan)'],
  ['code writes', facts({}, { mode: 'code' }), 'write', "ok Changes the project's files"],
  ['no modes: chat limits nothing', facts({ 'modules.modes': false }, { mode: 'chat' }), 'write', "ok Changes the project's files"],
  ['a flow step in research', facts({}, {}, { mode: 'research', modeFrom: 'flow' }), 'write', 'bad Writes a report only (🔍 research)'],
  ['frozen', facts({}, { frozen: '/home/ada/dev/app' }), 'write', 'ok Changes files only in app'],
  ['chat takes no risky step', facts({}, { mode: 'chat' }), 'risky', 'bad Takes no risky step in this mode'],
  [
    'bypass on',
    facts({ 'bypass.enabled': true }, { bypass: { since: NOW - 1, until: NOW + 3600_000, count: 2 } }),
    'risky',
    `bypass Risky steps unasked, until ${new Date(NOW + 3600_000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
  ],
  [
    'bypass on in the session, no longer allowed',
    facts({}, { bypass: { since: NOW - 1, until: NOW + 3600_000, count: 0 } }),
    'risky',
    'ask Asks you before a risky step',
  ],
  [
    'bypass over',
    facts({ 'bypass.enabled': true }, { bypass: { since: NOW - 7200_000, until: NOW - 1, count: 0 } }),
    'risky',
    'ask Asks you before a risky step',
  ],
  ['the belt off for development', facts({}, {}, { beltOff: true }), 'risky', 'bypass Asks nothing: the belt is off'],
  ['the belt off: delete unasked', facts({}, {}, { beltOff: true }), 'delete', 'bypass Deletes outside the project unasked'],
  ['chat cannot delete', facts({}, { mode: 'plan' }), 'delete', 'bad Cannot delete outside the project'],
  ['the delete rule off', facts({ 'belt.disabled': ['fs.delete-outside-project'] }), 'delete', 'look Deletes outside the project unasked'],
  ['the delete rule blocks', facts({ 'belt.verdicts': { 'fs.delete-outside-project': 'deny' } }), 'delete', 'bad Cannot delete outside the project'],
  ['the delete rule notes', facts({ 'belt.verdicts': { 'fs.delete-outside-project': 'warn' } }), 'delete', 'look Deletes outside the project, with a note'],
  ['autonomous', facts({}, {}, { style: 'autonomous' }), 'style', 'ok Goes on without asking you'],
  ['full autonomy', facts({}, {}, { style: 'full' }), 'style', 'ok Carries one task to its end alone'],
  ['agents set, none now, helpers free', facts({ 'agents.enabled': true }), 'agents', 'bad Only read-only helper agents'],
  ['agents set, none, helpers counted', facts({ 'agents.enabled': true, 'agents.helpers': false }), 'agents', 'bad Starts no helper agents'],
  ['agents free 3', facts({ 'agents.enabled': true }, { agents: { ...state().agents, mode: 'free', n: 3 } }), 'agents', 'ok At most 3 helper agents at once'],
  [
    'agents exactly 2',
    facts({ 'agents.enabled': true }, { agents: { ...state().agents, mode: 'assigned', n: 2 } }),
    'agents',
    'ok Exactly 2 agents for your next request',
  ],
  ['ultracode', facts({ 'agents.enabled': true }, { agents: { ...state().agents, ultracode: true } }), 'agents', "ok Claude Code's workflows run the agents"],
  ['outside content read', facts({}, { tainted: { source: 'WebFetch', at: NOW - 60_000 } }), 'taint', 'ask Asks before sending or pushing'],
  ['outside content, the belt off', facts({}, { tainted: { source: 'WebFetch', at: NOW - 60_000 } }, { beltOff: true }), 'taint', null],
  ['nothing outside read', facts(), 'taint', null],
  ['quota fine', facts({}, {}, { quota: assessQuota(reading(40, 30), budgetOf(cloneDefaults(), null), NOW) }), 'quota', null],
  [
    'quota near',
    facts({}, {}, { quota: assessQuota(reading(96, 30), budgetOf(cloneDefaults(), null), NOW) }),
    'quota',
    'danger Wraps up: the quota is near its limit',
  ],
  [
    'quota used up',
    facts({}, {}, { quota: assessQuota(reading(99, 30), budgetOf(cloneDefaults(), null), NOW) }),
    'quota',
    `bad Stopped by the quota until ${new Date(NOW + 2 * 3600_000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
  ],
  ['the quota guard off', facts({ 'modules.quota': false }, {}, { quota: assessQuota(reading(99, 30), budgetOf(cloneDefaults(), null), NOW) }), 'quota', null],
];

for (const [name, f, id, expected] of CASES)
  test(`Claude right now: ${name}`, () => {
    assert.equal(said(f, id), expected);
  });

test('the reasons follow the mode in force: a flow, a mode for this message, a run planning, Claude Code plan mode', () => {
  const why = (from: CockpitFacts['modeFrom']) => row(facts({}, {}, { mode: 'plan', modeFrom: from }), 'write')!.why;
  assert.deepEqual(why('flow').because, ["The flow's step works in 📐 plan.", 'Pick another mode on the strip, or with /1 to /5.']);
  assert.match(why('turn').because[0]!, /^You gave 📐 plan for this message only\.$/);
  assert.match(why('run').because[0]!, /^The full-autonomy run is planning: 📐 plan until its plan is accepted\.$/);
  assert.match(why('plan').because[0]!, /^Claude Code's own plan mode is on\.$/);
  assert.equal(why('flow').now, '📐 plan');
  // With no modes the why engine says so, and nothing limits the writes.
  assert.match(row(facts({ 'modules.modes': false }), 'write')!.why.now, /^no modes/);
});

test('what changes a line: ending a freeze, bypass or a run; the rule; the agents window; the budget', () => {
  const act = (f: CockpitFacts, id: CanRow['id'], lang: 'en' | 'tr' = 'en') => row(f, id, lang)!.act;
  assert.deepEqual(act(facts({}, { frozen: '/x/app' }), 'write', 'tr'), {
    kind: 'control',
    name: 'dondur',
    label: 'Dondurmayı bitir',
    card: 'Dondurma biter; yazmalar yine emniyet kemerinin izin verdiği her yere gidebilir.',
    opens: false,
  });
  assert.equal(act(facts(), 'write'), null, 'the mode is on the strip itself');
  assert.match(
    JSON.stringify(act(facts({ 'bypass.enabled': true }, { bypass: { since: NOW, until: NOW + 60_000, count: 0 } }), 'risky')),
    /"name":"bypass".*"opens":false/,
  );
  assert.deepEqual(act(facts(), 'delete'), {
    kind: 'center',
    address: 'security/rules/fs.delete-outside-project',
    label: 'The rule',
    card: 'Opens this rule in the control center (Security › Safety belt rules): what it asks, blocks or lets through, and how to change it. This session goes on.',
    opens: true,
  });
  assert.equal(act(facts({}, { mode: 'chat' }), 'delete'), null, 'no rule decides it in chat');
  assert.match(JSON.stringify(act(facts({}, {}, { style: 'full' }), 'style')), /"name":"full-auto","label":"End the run".*"opens":false/);
  // The way of working: waiting reads as rest, going on as on; only a way the strip picks says where it is picked.
  const style = (s: CockpitFacts['style']) => row(facts({}, {}, { style: s }), 'style')!;
  assert.deepEqual(
    (['manual', 'autonomous', 'full'] as const).map((s) => [style(s).meaning, style(s).why.because.at(-1)!.startsWith('Pick the other way')]),
    [
      ['off', true],
      ['on', true],
      ['on', false],
    ],
  );
  assert.match(JSON.stringify(act(facts({ 'agents.enabled': true }), 'agents')), /"name":"parallel","label":"Agents".*"opens":true/);
  assert.equal(act(facts(), 'agents'), null, 'nothing to set while Claude decides');
  const stop = facts({}, {}, { quota: assessQuota(reading(99, 30), budgetOf(cloneDefaults(), null), NOW) });
  assert.match(JSON.stringify(act(stop, 'quota', 'tr')), /"name":"kota","label":"Haftalık bütçe".*"opens":true/);
});

test('Turkish: each line in Turkish words, as short', () => {
  const f = facts({}, { mode: 'chat' });
  assert.deepEqual(
    canNow(f, 'tr').map((r) => r.text),
    [
      'Hiçbir dosyayı değiştirmez (💬 sohbet)',
      'Bu modda riskli adım atmaz',
      'Proje dışında silemez',
      'Kendi korumasına dokunamaz',
      'Bir adım yapar, seni bekler',
      'Yardımcı ajanlara kendisi karar verir',
    ],
  );
  // A line of "Claude right now" fits beside the conversation in both languages (the card says the rest).
  const every = [...CASES.map(([, f]) => f), facts()].flatMap((f) => [...canNow(f, 'en'), ...canNow(f, 'tr')]);
  for (const r of every) assert.ok([...r.text].length <= 44, `${r.text} (${[...r.text].length})`);
});

test('a call in a few words: the command, the file, the pattern; secrets masked, a long one cut', () => {
  assert.equal(callLine('Bash', { command: '\n  npm test\nnpm run lint' }), 'npm test');
  assert.equal(callLine('Read', { file_path: 'C:\\dev\\app\\src\\index.ts' }), 'index.ts');
  assert.equal(callLine('NotebookEdit', { notebook_path: '/x/y/n.ipynb' }), 'n.ipynb');
  assert.equal(callLine('Grep', { pattern: 'TODO|FIXME' }), 'TODO|FIXME');
  assert.equal(callLine('WebFetch', { url: 'https://example.com/a' }), 'https://example.com/a');
  assert.equal(callLine('Agent', { description: 'Find the slow step' }), 'Find the slow step');
  assert.equal(callLine('Mystery', {}), '');
  // A token built at run time, so no file holds one.
  const token = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
  assert.doesNotMatch(callLine('Bash', { command: `curl -H "Authorization: Bearer ${token}"` }), /abcdefghij/);
  assert.equal(callLine('Bash', { command: 'x'.repeat(30) }, 30), 'x'.repeat(30), 'exactly the room: whole');
  const long = callLine('Bash', { command: `echo ${'x'.repeat(200)}` }, 30);
  assert.equal([...long].length, 30);
  assert.ok(long.endsWith('…'));
});

test('at work now: Claude waits, a call runs with its time, more beside it, agents, a flow, a run', () => {
  assert.deepEqual(
    nowRows(facts(), 'en').map((r) => [r.id, r.text]),
    [['state', 'Claude waits for your message']],
  );
  const busy = facts(
    {},
    {},
    {
      working: true,
      mo: 'work',
      calls: [
        { tool: 'Read', what: 'a.ts', at: NOW - 9000 },
        { tool: 'Bash', what: 'npm test', at: NOW - 3000 },
      ],
      agents: [{ id: 'ag1', label: 'Find it · Explore' }],
      flow: { at: '2/4', step: '📐 plan', state: 'running' },
      run: { at: '3/7', paused: false, planning: false },
    },
  );
  const rows = nowRows(busy, 'en');
  assert.deepEqual(
    rows.map((r) => [r.id, r.mark, r.text, r.since]),
    [
      ['call', 'on', 'Bash · npm test (+1 more)', NOW - 3000],
      ['agent-ag1', 'agents', 'Find it · Explore', null],
      ['flow', 'on', 'Flow 2/4 · 📐 plan', null],
      ['run', 'action', 'Full autonomy · step 3/7', null],
    ],
  );
  assert.equal(rows[1]!.agent, 'ag1');
  const flowMeaning = (state: 'running' | 'approval' | 'paused') => nowRows(facts({}, {}, { flow: { at: '1/4', step: 'x', state } }), 'en')[1]!.meaning;
  assert.deepEqual([flowMeaning('running'), flowMeaning('approval'), flowMeaning('paused')], ['on', 'ask', 'off']);
  assert.equal(nowRows(facts({}, {}, { run: { at: '1/5', paused: false, planning: true } }), 'en')[1]!.text, 'Full autonomy · planning');
  const waiting = nowRows(
    facts({}, {}, { mo: 'wait', flow: { at: '3/4', step: 'approve', state: 'approval' }, run: { at: '1/5', paused: true, planning: false } }),
    'tr',
  );
  assert.deepEqual(
    waiting.map((r) => [r.mark, r.text]),
    [
      ['ask', 'Bir soru cevabını bekliyor'],
      ['ask', 'Plan onayını bekliyor'],
      ['off', 'Tam otonom 1/5 adımında duraklatıldı'],
    ],
  );
  // Every state Mo knows has its words and its card.
  for (const mo of ['idle', 'think', 'work', 'agent', 'wait', 'done', 'block', 'error', 'stopped', 'auto', 'low'] as const) {
    const r = nowRows(facts({}, {}, { mo }), 'en')[0]!;
    assert.ok(r.text && !r.text.startsWith('ck.') && r.card && !r.card.startsWith('ck.'), mo);
  }
});

test('the activity: what waits for you first, the routine left out, five at most, each with why and where it is changed', () => {
  const ev = (at: number, kind: string, extra: Record<string, unknown> = {}) => ({ at, kind, session: 's1', ...extra });
  const events = [
    ev(NOW - 50_000, 'belt', { verdict: 'deny', tool: 'Bash', rules: ['git.force-push'], reasons: ['Force-pushes'] }),
    ev(NOW - 40_000, 'reading', { five: 10, week: 20 }),
    ev(NOW - 30_000, 'belt', { verdict: 'ask', answer: 'deferred', tool: 'Bash', rules: ['publish.package'], reasons: ['Publishes'] }),
    ev(NOW - 20_000, 'keyword', { keyword: 'plan' }),
    ev(NOW - 10_000, 'close'),
  ];
  const a = actRows(facts({}, {}, { events }), 'en');
  assert.equal(a.waiting, 1);
  assert.equal(a.total, 4, 'the quota reading is routine');
  assert.deepEqual(
    a.rows.map((r) => [r.mark, r.text.split(':')[0], r.address]),
    [
      ['ask', 'Waits for you', 'security/rules/publish.package'],
      ['ok', 'The session was closed from the strip', null],
      ['ok', 'Keyword', 'settings/keywords'],
      ['bad', 'Blocked Bash', 'security/rules/git.force-push'],
    ],
  );
  assert.match(a.rows[3]!.card, /^Why: safety belt rule: .+\. Press: the control center opens where it is changed\.$/);
  assert.equal(a.rows[1]!.card, 'The work itself; no rule or setting behind it.');
  const many = actRows(facts({}, {}, { events: Array.from({ length: 9 }, (_, i) => ev(NOW - i * 1000, 'close')) }), 'en');
  assert.deepEqual([many.rows.length, many.total], [5, 9]);
});

test('the quota: nothing read yet, two meters with their thresholds and times, a budget, an old reading', () => {
  assert.deepEqual(quotaView(facts(), 'en'), {
    meters: [],
    budget: 'No budget: the week stops at 99%',
    note: 'No reading yet: Claude Code tells the quota with its first answer.',
  });
  const cfg = cloneDefaults();
  const q = quotaView(facts({}, { weeklyTarget: 60 }, { quota: assessQuota(reading(46, 30), budgetOf(cfg, state({ weeklyTarget: 60 })), NOW) }), 'en');
  assert.deepEqual(
    q.meters.map((m) => [m.id, m.label, Math.round(m.pct), m.value, m.threshold]),
    [
      ['five', '5-hour', 46, '46%', 95],
      ['week', 'Week', 30, '30%', 60],
    ],
  );
  assert.match(q.meters[0]!.resets, /^\d\d:\d\d(?: [AP]M)?$/);
  assert.match(q.meters[1]!.resets, /^[A-Z][a-z]{2} \d\d:\d\d(?: [AP]M)?$/, 'the week says its day');
  assert.match(q.meters[0]!.card, /^The 5-hour period: 46% used; it starts over at .+ \(in 2 h 0 min\)\. The work wraps up at 95%\.$/);
  assert.equal(q.budget, 'Weekly budget: 60%');
  assert.equal(q.note, null);
  const off = quotaView(facts({ 'modules.quota': false }, {}, { quota: assessQuota(reading(46, 30), budgetOf(cfg, null), NOW) }), 'tr');
  assert.deepEqual(
    off.meters.map((m) => [m.label, m.value, m.threshold]),
    [
      ['5 saat', '%46', null],
      ['Hafta', '%30', null],
    ],
  );
  // One period read, the other not: one meter; a period with no time to start over says it does not know.
  const fiveOnly: QuotaReading = { windows: [{ kind: 'five_hour', used: 12, resetsAt: null }], measuredAt: NOW, source: 'mod' };
  const one = quotaView(facts({}, {}, { quota: assessQuota(fiveOnly, budgetOf(cfg, null), NOW) }), 'en');
  assert.deepEqual(
    one.meters.map((m) => [m.id, m.resets]),
    [['five', '']],
  );
  assert.match(one.meters[0]!.card, /it starts over at \? \(\?\)\./);
  const old = quotaView(facts({}, {}, { quota: assessQuota(reading(46, 30, 400), budgetOf(cfg, null), NOW) }), 'en');
  assert.match(old.note ?? '', /^The last reading is .+ old: it holds nothing back until a new one comes\.$/);
});

test('quick settings: not allowed yet, a press asks to allow it; allowed, the press is the strip control; on, it ends it', () => {
  const q = (f: CockpitFacts, lang: 'en' | 'tr' = 'en') => Object.fromEntries(quickRows(f, lang).map((r) => [r.id, r]));
  const none = q(facts());
  assert.deepEqual(
    Object.values(none).map((r) => [r.id, r.value, r.press.kind, r.press.opens]),
    [
      ['bypass', 'not allowed yet', 'allow', true],
      ['agents', 'Claude decides', 'allow', true],
      ['fullAuto', 'not allowed yet', 'allow', true],
      ['freeze', 'off', 'control', false],
    ],
  );
  assert.deepEqual(none['bypass']!.press, { kind: 'allow', path: 'bypass.enabled', label: 'Allow', card: allowWarning('bypass.enabled', 'en'), opens: true });
  // A card answers the four questions: what it is, how it is now, what a press does, and, once allowed, where it is taken back.
  for (const r of Object.values(none)) assert.match(r.card, /\. Now: .+\. Press: .+\.$/, r.id);
  const allowed = q(facts({ 'bypass.enabled': true, 'agents.enabled': true, 'autonomy.enabled': true }));
  assert.deepEqual(
    Object.values(allowed).map((r) => [r.id, r.value, r.press.kind === 'control' ? r.press.name : r.press.kind, r.press.opens]),
    [
      ['bypass', 'off', 'bypass', true],
      ['agents', 'none', 'parallel', true],
      ['fullAuto', 'off', 'full-auto', true],
      ['freeze', 'off', 'freeze', false],
    ],
  );
  assert.match(
    allowed['bypass']!.card,
    /Press: Its window says what bypass lifts and until when, .+ Allowed: "Allow bypass" is on \(Automation › Bypass\); it is taken back there\.$/,
  );
  // On only where it is allowed and set: the session's agents with the setting off are Claude's to decide.
  const agentsOn = (cfg: Record<string, unknown>, mode: 'off' | 'free', ultracode = false) =>
    q(facts(cfg, { agents: { ...state().agents, mode, n: 3, ultracode } }))['agents']!.on;
  assert.deepEqual(
    [
      agentsOn({ 'agents.enabled': true }, 'off'),
      agentsOn({}, 'free'),
      agentsOn({ 'agents.enabled': true }, 'free'),
      agentsOn({ 'agents.enabled': true }, 'off', true),
    ],
    [false, false, true, true],
  );
  const on = q(
    facts(
      { 'bypass.enabled': true, 'agents.enabled': true, 'autonomy.enabled': true },
      { bypass: { since: NOW, until: NOW + 3600_000, count: 2 }, agents: { ...state().agents, mode: 'assigned', n: 2 }, frozen: '/x/app' },
      { style: 'full', run: { at: '2/5', paused: false, planning: false } },
    ),
    'tr',
  );
  assert.deepEqual(
    Object.values(on).map((r) => [r.id, r.on, r.value.replace(/\d\d:\d\d/, 'HH:MM'), r.press.opens]),
    [
      ['bypass', true, 'açık, bitiş HH:MM · 2 sorusuz', false],
      ['agents', true, 'tam 2, sonraki istek', true],
      ['fullAuto', true, 'çalışıyor, adım 2/5', false],
      ['freeze', true, 'açık: app', false],
    ],
  );
  assert.equal(on['bypass']!.meaning, 'bypass');
  assert.equal(q(facts({ 'agents.enabled': true }, { agents: { ...state().agents, mode: 'free', n: 4 } }))['agents']!.value, 'at most 4 at once');
  assert.equal(q(facts({ 'agents.enabled': true }, { agents: { ...state().agents, ultracode: true } }))['agents']!.value, 'ultracode');
});

test("a permission's warning: what allowing it means, said for a press; another setting has its catalog's", () => {
  assert.match(allowWarning('bypass.enabled', 'en'), /^Bypass lets Claude act without asking for a while: .+ only you switch it on in a session\.$/);
  assert.match(allowWarning('agents.enabled', 'tr'), /^Bundan sonra her oturum yardımcı ajanlar kapalı başlar/);
  assert.match(allowWarning('autonomy.enabled', 'en'), /only you start a run\.$/);
  for (const p of ['bypass.enabled', 'agents.enabled', 'autonomy.enabled'] as const)
    for (const lang of ['en', 'tr'] as const) assert.doesNotMatch(allowWarning(p, lang), /Enter/, `${lang} ${p}: a press, not a second Enter`);
  assert.equal(allowWarning('packs.autoUse', 'en'), `${confirmText('packs.autoUse', true, 'en')} ${effectOf('packs.autoUse', true, 'en')}`);
});

test('a fragment as a sentence, in the language: its first letter up, a stop at the end', () => {
  assert.equal(sentence('why: it', 'en'), 'Why: it.');
  assert.equal(sentence('ilk adım.', 'tr'), 'İlk adım.');
  assert.equal(sentence('  ', 'en'), '');
});

test("a call's running time in a few cells, in both languages", () => {
  assert.deepEqual(
    [0, 12_400, 59_999, 60_000, 64_000, 3_599_000, 3_600_000, 3_720_000].map((ms) => elapsedText(ms, 'en')),
    ['0 s', '12 s', '59 s', '1 min 00 s', '1 min 04 s', '59 min 59 s', '1 h 00 min', '1 h 02 min'],
  );
  assert.deepEqual(
    [12_000, 64_000, 3_720_000].map((ms) => elapsedText(ms, 'tr')),
    ['12 sn', '1 dk 04 sn', '1 sa 02 dk'],
  );
  assert.equal(elapsedText(-5, 'en'), '0 s');
});

// ── the drawing ──

interface El {
  type: 'Box' | 'Text' | 'Button';
  props: Record<string, unknown>;
  children: (El | string)[];
}

function recorder(plain = false, color: (m: Meaning) => string | undefined = (m) => COLORS[m].claude): KitHost<El> {
  const kids = (c: unknown[]) => c.filter((x): x is El | string => x !== null && x !== undefined && x !== false);
  return {
    box: (p, ...c) => ({ type: 'Box', props: { ...p }, children: kids(c) }),
    text: (p, ...c) => ({ type: 'Text', props: { ...p }, children: kids(c) }),
    press: (p, ...c) => ({ type: 'Button', props: { key: p.id, onPress: p.onPress, ...(p.scope ? { scope: p.scope } : {}) }, children: kids(c) }),
    color,
    plain,
    measure: (s) => [...s].length,
  };
}

const textOf = (e: El | string): string => (typeof e === 'string' ? e : e.children.map(textOf).join(''));
function walk(e: El | string, visit: (e: El) => void): void {
  if (typeof e === 'string') return;
  visit(e);
  for (const c of e.children) walk(c, visit);
}
const find = (root: El, key: string): El | null => {
  let found: El | null = null;
  walk(root, (e) => {
    if (!found && (e.props.key === key || e.props.scope === key)) found = e;
  });
  return found;
};

const UI: CockpitUi = { open: null, confirm: null, changed: null };
function acts(log: string[] = []): CockpitActs<El> {
  return {
    toggle: (id) => log.push(`toggle ${id}`),
    act: (a) => log.push(`act ${a.kind}${a.kind === 'control' ? ` ${a.name}${a.opens ? '…' : ''}` : ''}`),
    allow: (p) => log.push(`allow ${p}`),
    cancel: () => log.push('cancel'),
    undo: () => log.push('undo'),
    view: (id) => log.push(`view ${id}`),
    stop: (id) => log.push(`stop ${id}`),
    open: (a) => log.push(`open ${a}`),
    activity: () => log.push('activity'),
    center: () => log.push('center'),
  };
}

const BUSY = facts(
  { 'agents.enabled': true },
  { agents: { ...state().agents, mode: 'free', n: 3 } },
  {
    mo: 'work',
    working: true,
    calls: [{ tool: 'Bash', what: 'npm test', at: NOW - 3000 }],
    agents: [{ id: 'ag1', label: 'Find the slow step in the build · Explore' }],
    quota: assessQuota(reading(46, 30), budgetOf(cloneDefaults(), null), NOW),
    events: [{ at: NOW - 1000, kind: 'belt', session: 's1', verdict: 'deny', tool: 'Bash', rules: ['git.force-push'], reasons: ['Force-pushes'] }],
  },
);

test('the drawing: every pressable and every line of information says itself, under a scope with its card', () => {
  for (const lang of ['en', 'tr'] as const) {
    const d = cockpitData(BUSY, lang);
    const { body, cards } = cockpitBody(recorder(), d, UI, acts(), { width: 50 });
    const scopes: string[] = [];
    walk(body, (e) => {
      if (e.type === 'Button') assert.ok(e.props.scope, `${lang}: a pressable with no scope: ${textOf(e)}`);
      if (typeof e.props.scope === 'string') scopes.push(e.props.scope);
    });
    for (const s of scopes) assert.ok((cards[s] ?? '').length > 10, `${lang}: ${s} has no card`);
    for (const id of [
      'can-write',
      'can-self',
      'call',
      'agent-ag1',
      'view-ag1',
      'stop-ag1',
      'act-0',
      'all-activity',
      'quota-five',
      'quota-week',
      'budget',
      'quick-bypass',
      'center',
    ])
      assert.ok(scopes.includes(id), `${lang}: ${id}`);
    // No card is a message key left unfound.
    for (const [s, c] of Object.entries(cards)) assert.doesNotMatch(c, /\bck\.[a-z]/, `${lang} ${s}`);
  }
});

test('the drawing: a label longer than its column is cut, never run into the value', () => {
  const d = cockpitData(facts(), 'en');
  const long = { ...d, quick: d.quick.map((q, i) => (i === 0 ? { ...q, label: 'Something very long indeed' } : q)) };
  const { body } = cockpitBody(recorder(), long, UI, acts(), { width: 50 });
  assert.match(textOf(find(body, 'quick-bypass')!), /^Something very… ○ not allowed yet$/);
});

test('the drawing: one column beside the conversation, two or three above the prompt; nothing runs past its column', () => {
  assert.deepEqual([40, 83, 84, 131, 132, 200].map(cockpitColumns), [1, 1, 2, 2, 3, 3]);
  for (const width of [40, 50, 60, 100, 160]) {
    const cols = cockpitColumns(width);
    const cw = Math.floor((width - 3 * (cols - 1)) / cols);
    const { body } = cockpitBody(recorder(), cockpitData(BUSY, 'tr'), UI, acts(), { width });
    const laid = body.children.at(-1) as El;
    assert.equal(cols === 1 ? 1 : laid.children.filter((c) => typeof c !== 'string' && c.props.width === cw).length, cols, String(width));
    // Every pressable's words fit the column they stand in: the room was worked out, not left to the terminal.
    walk(body, (e) => {
      if (e.type === 'Button') assert.ok([...textOf(e)].length <= cw, `${width}: ${textOf(e)} (${[...textOf(e)].length} > ${cw})`);
    });
  }
});

test('the drawing: a line pressed opens its reasons and what changes it; a permission shows its warning, Allow and Cancel', () => {
  const log: string[] = [];
  const d = cockpitData(facts({}, { frozen: '/x/app' }), 'en');
  const open = cockpitBody(recorder(), d, { ...UI, open: 'write' }, acts(log), { width: 50 }).body;
  assert.match(textOf(open), /Frozen folder: every write stays inside \/x\/app\.You froze it with \/freeze; \/freeze off ends it\./);
  const end = find(open, 'can-write-act')!;
  assert.equal(textOf(end), '[ End the freeze ]', 'it acts at once: an action, no …');
  (end.props.onPress as () => void)();
  (find(open, 'can-write')!.props.onPress as () => void)();
  const rule = cockpitBody(recorder(), cockpitData(facts(), 'en'), { ...UI, open: 'delete' }, acts(log), { width: 50 }).body;
  assert.equal(textOf(find(rule, 'can-delete-act')!), 'The rule…', 'it opens a page: an opener');
  const confirm = cockpitBody(recorder(), cockpitData(facts(), 'en'), { ...UI, confirm: 'bypass.enabled' }, acts(log), { width: 50 }).body;
  assert.match(textOf(confirm), /! Bypass lets Claude act without asking/);
  // Allow is the main action: drawn as one.
  assert.equal((find(confirm, 'quick-bypass-yes')!.children[0] as El).props.bold, true);
  assert.notEqual((find(confirm, 'quick-bypass-no')!.children[0] as El).props.bold, true);
  (find(confirm, 'quick-bypass-yes')!.props.onPress as () => void)();
  (find(confirm, 'quick-bypass-no')!.props.onPress as () => void)();
  (find(confirm, 'quick-bypass')!.props.onPress as () => void)();
  const changed = cockpitBody(recorder(), cockpitData(facts(), 'en'), { ...UI, changed: 'Changed: Allow bypass: off → on' }, acts(log), { width: 50 }).body;
  assert.match(textOf(changed.children[0] as El), /^✓ Changed: Allow bypass: off → on\[ Undo \]$/);
  (find(changed, 'undo')!.props.onPress as () => void)();
  assert.deepEqual(log, ['act control freeze', 'toggle write', 'allow bypass.enabled', 'cancel', 'act allow', 'undo']);
});

test('the drawing: agents, the activity, the budget and the control center press through; a call is timed where the host can', () => {
  const log: string[] = [];
  const timed: number[] = [];
  const a = acts(log);
  const { body } = cockpitBody(
    recorder(),
    cockpitData(BUSY, 'en'),
    UI,
    { ...a, elapsed: (since) => (timed.push(since), { type: 'Text', props: {}, children: ['3 s'] } as El) },
    { width: 50 },
  );
  for (const key of ['view-ag1', 'stop-ag1', 'act-0', 'all-activity', 'budget', 'center']) (find(body, key)!.props.onPress as () => void)();
  assert.deepEqual(log, ['view ag1', 'stop ag1', 'open security/rules/git.force-push', 'activity', 'act control quota…', 'center']);
  // An agent's words fit beside its two buttons, cut where the room ends; a section's title is bold; a mark that leads on
  // is drawn quiet, as information, not as a press of its own.
  assert.match(textOf(find(body, 'agent-ag1')!), /^👥 Find the slow step in the bu…\[ Open \] \[ Stop \]$/);
  let titles = 0;
  walk(body, (e) => {
    if (e.type === 'Text' && ['Claude right now', 'At work now', 'In this session', 'Quota', 'Quick settings'].includes(textOf(e))) {
      titles++;
      assert.equal(e.props.bold, true, textOf(e));
    }
  });
  assert.equal(titles, 5);
  const press = find(body, 'can-write')!;
  let line: El | null = null;
  walk(body, (e) => {
    if (e.type === 'Box' && e.props.flexDirection === 'row' && (e.children[0] as El | undefined)?.children?.[0] === press) line = e;
  });
  const tail = ((line as El | null)?.children[1] as El | undefined)?.children[0] as El | undefined;
  assert.equal(tail?.type, 'Text');
  assert.deepEqual(tail?.props, { color: COLORS.off.claude });
  assert.equal(textOf(tail!), '›');
  // The meters' tracks leave room for the longest time to start over, so both end in one column.
  const bar = (id: string) => [...textOf(find(body, id)!)].filter((ch) => '█░│'.includes(ch)).length;
  const resets = cockpitData(BUSY, 'en').quota.meters.map((m) => [...m.resets].length);
  assert.equal(bar('quota-five'), 50 - 8 - 5 - (Math.max(...resets) + 1));
  assert.equal(bar('quota-five'), bar('quota-week'));
  assert.deepEqual(timed, [NOW - 3000]);
  assert.match(textOf(find(body, 'call')!), /^● Bash · npm test3 s$/);
  // With no host clock, no time and no room kept for it.
  assert.equal(textOf(find(cockpitBody(recorder(), cockpitData(BUSY, 'en'), UI, a, { width: 50 }).body, 'call')!), '● Bash · npm test');
});

test('the drawing without colour or Unicode: every state still reads, by its plain mark and its words', () => {
  const { body } = cockpitBody(
    recorder(true, () => undefined),
    cockpitData(BUSY, 'en'),
    UI,
    acts(),
    { width: 60 },
  );
  const all = textOf(body);
  for (const plain of ['[ok]', '[?]', '[x]', '(locked)', '[off]', '#', '|']) assert.ok(all.includes(plain), plain);
  walk(body, (e) => assert.equal(e.props.color, undefined));
});

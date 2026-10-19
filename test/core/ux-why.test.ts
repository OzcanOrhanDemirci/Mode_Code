// SPDX-License-Identifier: Apache-2.0
// "Why is it so?" (src/core/ux/why.ts): for each part, how it is now and the chain behind it, worked out from the
// settings and the session, each setting with the page it is changed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults, setConfigValue, type Config } from '../../src/core/config.js';
import { newModState, type ModSessionState } from '../../src/core/session.js';
import { why, whyAll, whyRule, whySubjectNamed, whyText, WHY_SUBJECTS, type WhyFacts, type WhySubject } from '../../src/core/ux/why.js';

const NOW = Date.UTC(2026, 9, 19, 9, 0);
const set = (c: Config, path: string, v: unknown) => setConfigValue(c, path, v).config;
const state = (patch: Partial<ModSessionState> = {}): ModSessionState => ({ ...newModState('s1', 'dev', NOW), ...patch });

function facts(cfg: Record<string, unknown> = {}, session: Partial<ModSessionState> | null = {}, extra: Partial<WhyFacts> = {}): WhyFacts {
  let config = cloneDefaults();
  for (const [k, v] of Object.entries(cfg)) config = set(config, k, v);
  return { config, session: session === null ? null : state(session), now: NOW, ...extra };
}

/** The answer's state, and the settings its reasons name. */
const ask = (s: WhySubject, f: WhyFacts) => {
  const a = why(s, f, 'en');
  return { now: a.now, settings: a.because.map((r) => r.setting ?? null), text: a.because.map((r) => r.text) };
};

const CASES: [string, WhySubject, WhyFacts, RegExp, (string | null)[]][] = [
  ['bypass not allowed', 'bypass', facts(), /^not on the strip$/, ['bypass.enabled']],
  ['bypass allowed, off now', 'bypass', facts({ 'bypass.enabled': true }), /^off in this session/, ['bypass.enabled', null]],
  [
    'bypass on',
    'bypass',
    facts({ 'bypass.enabled': true }, { bypass: { since: NOW - 1, until: NOW + 3600_000, count: 0 } }),
    /^on until /,
    [null, 'bypass.maxHours'],
  ],
  ['agents left to Claude', 'agents', facts(), /^Claude decides/, ['agents.enabled']],
  ['agents set, none yet', 'agents', facts({ 'agents.enabled': true }), /^none in this session/, ['agents.enabled', null]],
  ['agents free 3', 'agents', facts({ 'agents.enabled': true }, { agents: { ...state().agents, mode: 'free', n: 3 } }), /^at most 3 at once$/, [null]],
  ['agents exactly 2', 'agents', facts({ 'agents.enabled': true }, { agents: { ...state().agents, mode: 'assigned', n: 2 } }), /^exactly 2 /, [null]],
  ['helpers left to Claude', 'helpers', facts(), /^Claude decides/, ['agents.enabled']],
  ['helpers counted', 'helpers', facts({ 'agents.enabled': true, 'agents.helpers': false }), /^counted/, ['agents.helpers']],
  ['autonomy off', 'autonomy', facts(), /^not on the strip$/, ['autonomy.enabled']],
  ['autonomy without the strip', 'autonomy', facts({ 'autonomy.enabled': true, 'modules.modes': false }), /strip is off/, ['modules.modes']],
  ['autonomy on', 'autonomy', facts({ 'autonomy.enabled': true }), /^on the strip/, ['autonomy.enabled', 'autonomy.maxHours']],
  ['mode by default', 'mode', facts(), /^free$/, [null]],
  ['mode chosen', 'mode', facts({}, { mode: 'plan' }), /^plan$/, [null]],
  ['no modes', 'mode', facts({ 'modules.modes': false }), /^no modes/, ['modules.modes']],
  ['manual by default', 'style', facts(), /^manual/, [null]],
  ['autonomous chosen', 'style', facts({}, { interaction: 'autonomous' }), /^autonomous/, [null]],
  ['frozen', 'freeze', facts({}, { frozen: 'C:/work/app/src' }), /inside C:\/work\/app\/src$/, [null]],
  ['outside content read', 'taint', facts({}, { tainted: { source: 'WebFetch', at: NOW - 60_000 } }), /ask first$/, [null]],
  ['quota guard off', 'quota', facts({ 'modules.quota': false }), /^no budget/, ['modules.quota']],
  [
    'quota budget',
    'quota',
    facts({ 'quota.fiveHourStop': 98 }),
    /^5-hour: wraps up at 95%, stops at 98%; weekly budget 99%$/,
    ['quota.fiveHourWrapUp', 'quota.fiveHourStop', 'quota.defaultWeeklyTarget', null],
  ],
  ['footer off', 'footer', facts({ 'modules.footer': false }), /^none$/, ['modules.footer']],
  ['footer on', 'footer', facts(), /^on: /, ['modules.footer', 'footer.mode']],
  ['handoff notes off', 'handoff', facts({ 'memory.handoff.enabled': false }), /^none is written$/, ['memory.handoff.enabled']],
  ['packs automatic', 'packs', facts({ 'packs.autoUse': true }), /where a project needs them/, ['packs.autoUse']],
  ['update check off', 'update', facts({ 'update.check': false }), /^never by itself$/, ['update.check']],
  ['memory not set up', 'memory', facts(), /^not set up$/, [null]],
  [
    'belt lifted by bypass',
    'belt',
    facts({ 'bypass.enabled': true }, { bypass: { since: NOW - 1, until: NOW + 60_000, count: 0 } }),
    /^lifted until /,
    [null, 'bypass.enabled'],
  ],
  ['belt off for development', 'belt', facts({}, {}, { beltOff: true }), /development switch/, [null]],
  ['outside a session', 'agents', facts({ 'agents.enabled': true }, null), /^none in this session/, ['agents.enabled', null]],
];

for (const [name, subject, f, now, settings] of CASES)
  test(`why: ${name}`, () => {
    const a = ask(subject, f);
    assert.match(a.now, now);
    assert.deepEqual(a.settings, settings);
    for (const t of a.text) assert.doesNotMatch(t, /\{\w+\}|\bwhy\.\w/, t);
  });

test('the mode and the way of working say whether they are the start or your choice', () => {
  assert.deepEqual(ask('mode', facts()).text, ['every session starts in free mode']);
  assert.deepEqual(ask('mode', facts({}, { mode: 'plan' })).text, ['you chose it on the strip, with a keyword or a /number']);
  assert.deepEqual(ask('style', facts()).text, ['every session starts manual']);
  assert.deepEqual(ask('style', facts({}, { interaction: 'default' })).text, ['every session starts manual']);
  assert.deepEqual(ask('style', facts({}, { interaction: 'autonomous' })).text, ['you chose it on the strip or with a keyword']);
  assert.deepEqual(ask('style', facts({}, null)).text, ['every session starts manual']);
});

test('a setting as a reason names it, says its value and the page it is changed on, which is a real address', () => {
  const a = why('bypass', facts(), 'en');
  assert.equal(a.because[0]!.text, '"Allow bypass" is off (Automation › Bypass)');
  assert.equal(a.because[0]!.address, 'automation/bypass');
  assert.equal(why('bypass', facts(), 'tr').because[0]!.text, '"Bypass\'a izin ver" kapalı (Otomasyon › Bypass)');
});

test('a rule of the belt: its own verdict, the one the settings give it, off, locked, lifted by bypass', () => {
  assert.deepEqual(
    whyRule('git.clean', facts(), 'en').because.map((r) => r.text),
    ['its own verdict: ask'],
  );
  const given = facts({ 'belt.verdicts': { 'git.clean': 'deny' } });
  assert.deepEqual(
    whyRule('git.clean', given, 'en').because.map((r) => r.text),
    ['your settings give it: block'],
  );
  assert.equal(whyRule('git.clean', facts({ 'belt.disabled': ['git.clean'] }), 'en').now, 'off');
  const locked = whyRule('self.tool-files', facts({}, { bypass: { since: NOW - 1, until: NOW + 60_000, count: 0 } }), 'en');
  assert.match(locked.because[0]!.text, /^a locked rule/);
  assert.ok(!locked.because.some((r) => /bypass is on/.test(r.text)));
  const lifted = whyRule('git.clean', facts({}, { bypass: { since: NOW - 1, until: NOW + 60_000, count: 0 } }), 'en');
  assert.match(lifted.because.at(-1)!.text, /bypass is on in this session/);
});

test('every part answers in both languages; a part is found by its id, its title or the first word of it', () => {
  for (const lang of ['en', 'tr'] as const) {
    const all = whyAll(facts(), lang);
    assert.equal(all.length, WHY_SUBJECTS.length);
    for (const a of all) assert.doesNotMatch(whyText(a), /\{\w+\}|\bwhy\.\w/, whyText(a));
  }
  assert.equal(whySubjectNamed('quota'), 'quota');
  assert.equal(whySubjectNamed('kota'), 'quota');
  assert.equal(whySubjectNamed('Ajanlar'), 'agents');
  assert.equal(whySubjectNamed('Safety belt'), 'belt');
  assert.equal(whySubjectNamed('nothing'), null);
  assert.equal(whySubjectNamed(''), null);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The catalog (src/core/ux/catalog.ts) holds the four answers for every setting: each entry is complete in both
 * languages, its default is the real default, its range is the one the settings file accepts, and its gates name
 * real settings. A new setting in the defaults is either in the catalog or named below as kept out of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, type MessageKey } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { cloneDefaults, DEFAULT_CONFIG, setConfigValue } from '../../src/core/config.js';
import { PACKS } from '../../src/core/packs.js';
import { EXTERNAL_SKILLS } from '../../src/core/skills-external.js';
import { CATEGORY_IDS } from '../../src/tui/nav.js';
import {
  asksFirst,
  confirmText,
  defaultOf,
  effectOf,
  explain,
  nearestSettings,
  nextValue,
  personOnly,
  SETTING_IDS,
  SETTINGS,
  settingOf,
  valueIn,
  type SettingId,
  type SettingPath,
} from '../../src/core/ux/catalog.js';

const has = (k: string) => typeof en[k as MessageKey] === 'string' && en[k as MessageKey].trim() !== '' && tr[k as MessageKey].trim() !== '';
const pathsOf = (id: SettingId): SettingPath[] =>
  id === 'packs.items.*'
    ? PACKS.map((p) => `packs.items.${p.id}` as const)
    : id === 'skills.items.*'
      ? Object.keys(EXTERNAL_SKILLS).map((s) => `skills.items.${s}` as const)
      : [id as SettingPath];
const ALL: SettingPath[] = SETTING_IDS.flatMap(pathsOf);

/** Leaves of the settings kept out of the catalog: lists, places and names set up elsewhere, or tuned in the file only. */
const OUTSIDE = [
  /^version$/,
  /^belt\./,
  /^memory\.(?:dirs|store)$/,
  /^keywords\./,
  /^projects$/,
  /^modes\.workDir$/,
  /^quota\.(?:defaultWeeklyWrapUp|staleMinutes)$/,
  /^autonomy\.reviewModel$/,
  /^notify\.ntfy$/,
  /^packs\.items$/,
  /^skills\.items$/,
  /^sync$/,
];

function leaves(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length === 0) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

test('every setting in the defaults is in the catalog, or named as kept out of it', () => {
  const missing = leaves(DEFAULT_CONFIG).filter((p) => !OUTSIDE.some((r) => r.test(p)) && !settingOf(p));
  assert.deepEqual(missing, []);
});

test('every entry has its words in both languages', () => {
  const need: string[] = [];
  for (const id of SETTING_IDS) {
    const d = SETTINGS[id];
    if (!d.template) need.push(`ux.${id}.name`, `ux.${id}.what`);
    if (d.kind.kind === 'switch') need.push(`ux.${id}.on`, `ux.${id}.off`);
    if (d.kind.kind === 'choice')
      for (const o of d.kind.options) {
        need.push(`ux.${id}.eff.${o}`);
        if (id !== 'language') need.push(`ux.${id}.opt.${o}`);
      }
    if (d.kind.kind === 'number') need.push(`ux.${id}.eff`);
    if (d.back) need.push(`ux.${id}.back`);
    for (const k of d.confirm?.keys ?? []) need.push(k);
  }
  for (const p of PACKS) need.push(`ux.pack.${p.id}.name`, `ux.pack.${p.id}`);
  for (const s of Object.keys(EXTERNAL_SKILLS)) need.push(`skills.about.${s}`);
  assert.deepEqual(
    need.filter((k) => !has(k)),
    [],
  );
});

test("a number's effect names the value with its unit, in both languages", () => {
  for (const id of SETTING_IDS) {
    const k = SETTINGS[id].kind;
    if (k.kind !== 'number') continue;
    assert.match(en[`ux.${id}.eff` as MessageKey], /\{n\}/, id);
    assert.match(tr[`ux.${id}.eff` as MessageKey], /\{n\}/, id);
  }
  assert.match(effectOf('bypass.maxHours', 2, 'en'), /2 hours/);
  assert.match(effectOf('bypass.maxHours', 1, 'en'), /1 hour\b/);
  assert.match(effectOf('bypass.maxHours', 2, 'tr'), /2 saat/);
  assert.match(effectOf('footer.showFiveFrom', 70, 'tr'), /%70/);
  assert.match(effectOf('footer.showFiveFrom', 70, 'en'), /70%/);
});

test('each choice option and each side of a switch says something of its own', () => {
  for (const path of ALL) {
    const k = SETTINGS[settingOf(path)!.id].kind;
    const values = k.kind === 'switch' ? [true, false] : k.kind === 'choice' ? [...k.options] : [];
    for (const lang of ['en', 'tr'] as const) {
      const effects = values.map((v) => effectOf(path, v, lang));
      assert.equal(new Set(effects).size, effects.length, `${path} (${lang}): two values say the same`);
    }
  }
});

test('every default is the real default and a value the setting can take', () => {
  for (const path of ALL) {
    const { id, def } = settingOf(path)!;
    const v = defaultOf(path);
    assert.notEqual(v, undefined, path);
    if (def.kind.kind === 'switch') assert.equal(typeof v, 'boolean', path);
    if (def.kind.kind === 'choice') assert.ok(def.kind.options.includes(v as never), `${path}: ${String(v)}`);
    if (def.kind.kind === 'number') assert.ok(typeof v === 'number' && v >= def.kind.min && v <= def.kind.max, path);
    if (!def.template)
      assert.equal(
        v,
        id.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], DEFAULT_CONFIG),
        path,
      );
  }
  assert.equal(defaultOf('packs.items.flutter'), 'auto');
  assert.equal(defaultOf('skills.items.grilling'), 'off');
});

test("each number's range is the one the settings file accepts", () => {
  // Wrap-up points sit below their stops: start with room on both sides.
  let base = cloneDefaults();
  for (const [k, v] of [
    ['quota.fiveHourWrapUp', 0],
    ['quota.defaultWeeklyWrapUp', 0],
    ['quota.fiveHourStop', 100],
    ['quota.defaultWeeklyTarget', 100],
  ] as const)
    base = setConfigValue(base, k, v).config;
  for (const id of SETTING_IDS) {
    const k = SETTINGS[id].kind;
    if (k.kind !== 'number') continue;
    const ok = (n: number) => setConfigValue(base, id, n).problems.filter((p) => p.path === id).length === 0;
    assert.ok(ok(k.min), `${id}: ${k.min} refused`);
    assert.ok(ok(k.max), `${id}: ${k.max} refused`);
    assert.ok(!ok(k.min - 1), `${id}: ${k.min - 1} accepted`);
    assert.ok(!ok(k.max + 1), `${id}: ${k.max + 1} accepted`);
  }
});

test('every gate names a setting of the catalog and values it can take', () => {
  for (const id of SETTING_IDS) {
    const g = SETTINGS[id].gate;
    if (!g) continue;
    assert.ok(Object.hasOwn(SETTINGS, g.id) && !g.id.endsWith('*'), `${id}: gate ${g.id}`);
    const k = SETTINGS[g.id as SettingId].kind;
    for (const w of g.when)
      assert.ok(
        k.kind === 'switch' ? typeof w === 'boolean' : k.kind === 'choice' ? k.options.includes(w as never) : typeof w === 'number',
        `${id}: ${String(w)}`,
      );
  }
});

test('every page is under one of the eight categories', () => {
  for (const id of SETTING_IDS) assert.ok((CATEGORY_IDS as readonly string[]).includes(SETTINGS[id].page.split('/')[0]!), `${id}: ${SETTINGS[id].page}`);
});

test('the four answers, for a switch that reads backwards no more', () => {
  const c = cloneDefaults();
  const e = explain(c, 'agents.enabled', 'en');
  assert.equal(e.name, 'I set the number of agents');
  assert.equal(e.now, 'off');
  assert.ok(e.isDefault);
  assert.match(e.nowEffect, /leaves agents alone/);
  assert.deepEqual(
    e.changes.map((x) => x.value),
    [true],
  );
  assert.match(e.changes[0]!.effect, /starts with no agents/);
  assert.match(e.back, /next message/);
  assert.ok(e.personOnly);
  assert.equal(e.blocked, null);
  const t = explain(c, 'agents.enabled', 'tr');
  assert.equal(t.name, 'Ajan sayısını ben belirlerim');
  assert.match(t.changes[0]!.effect, /ajansız başlar/);
});

test('a setting another one keeps from mattering says which and where', () => {
  let c = cloneDefaults();
  const place = (page: string) => `<${page}>`;
  assert.equal(explain(c, 'agents.helpers', 'en', place).blocked, 'No effect now, because "I set the number of agents" is off (<automation/agents>).');
  c = setConfigValue(c, 'agents.enabled', true).config;
  assert.equal(explain(c, 'agents.helpers', 'en', place).blocked, null);
  // Two gates in a row: the lines are off, so how they are made and from when the quota shows do not matter.
  c = setConfigValue(c, 'modules.footer', false).config;
  assert.match(explain(c, 'footer.showFiveFrom', 'tr', place).blocked ?? '', /"Cevap altı satırları" ayarı: kapalı \(<settings\/modules>\)/);
  c = setConfigValue(setConfigValue(c, 'modules.footer', true).config, 'footer.mode', 'off').config;
  assert.match(explain(c, 'footer.showFiveFrom', 'en', place).blocked ?? '', /"Who writes the lines" is Off/);
});

test('a choice offers its other options in order, and a number its range', () => {
  const c = cloneDefaults();
  const v = explain(c, 'view', 'en');
  assert.equal(v.now, 'Recommended');
  assert.deepEqual(
    v.changes.map((x) => x.value),
    ['detailed', 'simple'],
  );
  assert.equal(nextValue('view', 'recommended'), 'detailed');
  assert.equal(nextValue('view', 'detailed'), 'simple');
  const n = explain(c, 'autonomy.stallMinutes', 'tr');
  assert.equal(n.now, '90 dakika');
  assert.deepEqual(n.range, { min: '10 dakika', max: '720 dakika' });
  assert.deepEqual(n.changes, []);
  assert.equal(nextValue('autonomy.stallMinutes', 90), null);
  const p = explain(c, 'packs.items.ffmpeg', 'tr');
  assert.equal(p.name, 'Ses ve video');
  assert.equal(p.now, 'otomatik');
  assert.equal(valueIn(c, 'skills.items.grilling'), 'off');
});

test('what asks twice: lowering a protection, and the values that say what they mean first', () => {
  assert.ok(asksFirst('modules.quota', true, false));
  assert.ok(!asksFirst('modules.quota', false, true));
  assert.ok(!asksFirst('modules.keywords', true, false));
  assert.ok(asksFirst('bypass.enabled', false, true));
  assert.ok(!asksFirst('bypass.enabled', true, false));
  assert.ok(asksFirst('packs.items.store', 'auto', 'always'));
  assert.ok(asksFirst('skills.items.grilling', 'me', 'on'));
  assert.match(confirmText('bypass.enabled', true, 'en') ?? '', /without asking/);
  assert.equal(confirmText('bypass.enabled', false, 'en'), null);
  // The full-autonomy warning is told on one line, though the command line prints it on several.
  assert.doesNotMatch(confirmText('autonomy.enabled', true, 'tr') ?? '\n', /\n/);
});

test('who may change a setting: an agent never one that lowers a protection or widens what it does unasked', () => {
  for (const p of [
    'bypass.enabled',
    'agents.enabled',
    'autonomy.maxHours',
    'modules.quota',
    'modules.secrets',
    'modules.modes',
    'packs.autoUse',
    'belt.disabled',
    'update.check',
  ])
    assert.ok(personOnly(p), p);
  for (const p of ['language', 'view', 'modules.keywords', 'footer.mode', 'accessibility.plain']) assert.ok(!personOnly(p), p);
});

test('a path names a setting only when it is one: a real pack or skill, never a template or a group', () => {
  assert.equal(settingOf('packs.items.flutter')?.item, 'flutter');
  assert.equal(settingOf('skills.items.grilling')?.id, 'skills.items.*');
  for (const p of ['packs.items.*', 'skills.items.*', 'packs.items.nope', 'skills.items.nope', 'packs.items', 'modules', 'nope', 'packs.items.flutter.x'])
    assert.equal(settingOf(p), null, p);
});

test('the nearest settings to a partial or mistyped name: those containing it first, then a typo away', () => {
  assert.deepEqual(nearestSettings('bypass'), ['bypass.enabled', 'bypass.maxHours']);
  assert.ok(nearestSettings('modules.keywrods').includes('modules.keywords'));
  assert.ok(nearestSettings('FLUTTER').includes('packs.items.flutter'));
  assert.deepEqual(nearestSettings(''), []);
  assert.deepEqual(nearestSettings('bypass.'), ['bypass.enabled', 'bypass.maxHours']);
  assert.deepEqual(nearestSettings('zzzzzzzz'), []);
  assert.ok(nearestSettings('a').length <= 5);
});

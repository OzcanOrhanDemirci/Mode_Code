// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';

import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, parseConfig, serializeConfig, setConfigValue } from '../../src/core/config.js';

test('no file or an empty file gives the defaults and no problems', () => {
  assert.deepEqual(parseConfig(null), { config: DEFAULT_CONFIG, problems: [] });
  assert.deepEqual(parseConfig('  \n').problems, []);
});

test('a setting an earlier version had reads without a problem and does nothing: bypass (1.2.0)', () => {
  const r = parseConfig(JSON.stringify({ view: 'simple', bypass: { enabled: true, maxHours: 8 } }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.config.view, 'simple');
  assert.equal(Object.hasOwn(r.config, 'bypass'), false);
  assert.equal(serializeConfig(r.config).includes('bypass'), false, 'the next write leaves it out');
});

test('invalid JSON keeps the defaults and says why', () => {
  const r = parseConfig('{ "view": ');
  assert.deepEqual(r.config, DEFAULT_CONFIG);
  assert.equal(r.problems[0]?.kind, 'invalid-json');
});

test('a wrong value falls back for that setting only', () => {
  const r = parseConfig(JSON.stringify({ view: 'huge', footer: { mode: 'check', showFiveFrom: 150 }, modules: { keywords: 'yes', quietWork: false } }));
  assert.equal(r.config.view, 'recommended');
  assert.equal(r.config.footer.mode, 'check');
  assert.equal(r.config.footer.showFiveFrom, 70);
  assert.equal(r.config.modules.keywords, true);
  assert.equal(r.config.modules.quietWork, false);
  assert.deepEqual(
    r.problems.map((p) => p.path),
    ['view', 'modules.keywords', 'footer.showFiveFrom'],
  );
});

test('a locked belt rule cannot be switched off or softened through the file', () => {
  const r = parseConfig(
    JSON.stringify({ belt: { disabled: ['self.claude-settings', 'git.clean'], verdicts: { 'self.tool-files': 'warn', 'git.force-push': 'deny' } } }),
  );
  assert.deepEqual(r.config.belt.disabled, ['git.clean']);
  assert.deepEqual(r.config.belt.verdicts, { 'git.force-push': 'deny' });
  assert.equal(r.problems.filter((p) => p.kind === 'weakened').length, 2);
});

test('unknown keys are reported, not fatal', () => {
  const r = parseConfig(JSON.stringify({ colour: 'blue', modules: { telemetry: true } }));
  assert.deepEqual(
    r.problems.map((p) => [p.path, p.kind]),
    [
      ['colour', 'unknown-key'],
      ['modules.telemetry', 'unknown-key'],
    ],
  );
});

test('projects need unique kebab-case ids; keyword phrases are kept per language', () => {
  const r = parseConfig(
    JSON.stringify({
      projects: [{ id: 'mode-code', names: ['terminal'] }, { id: 'Bad Id' }, { id: 'mode-code', names: [] }],
      keywords: { extra: { tr: { continue: ['sürdür'] }, xx: {} } },
    }),
  );
  assert.deepEqual(r.config.projects, [{ id: 'mode-code', names: ['terminal'] }]);
  assert.deepEqual(r.config.keywords.extra.tr, { continue: ['sürdür'] });
  assert.equal(r.problems.length, 3);
});

test('wrap-up thresholds never sit above their stop thresholds', () => {
  const r = parseConfig(JSON.stringify({ quota: { fiveHourWrapUp: 99, fiveHourStop: 90 } }));
  assert.equal(r.config.quota.fiveHourWrapUp, 90);
});

test('setConfigValue changes one setting and round-trips through the file text', () => {
  const r = setConfigValue(DEFAULT_CONFIG, 'footer.mode', 'off');
  assert.equal(r.config.footer.mode, 'off');
  assert.deepEqual(parseConfig(serializeConfig(r.config)).config, r.config);
  assert.equal(DEFAULT_CONFIG.footer.mode, 'draw'); // the defaults are never mutated
});

test('full autonomy is off by default; its settings keep their ranges; a project carries its own definition of done', () => {
  assert.deepEqual(parseConfig(null).config.autonomy, { enabled: false, maxHours: 12, stallMinutes: 90, atTimeLimit: 'continue', reviewModel: null });
  const { config, problems } = parseConfig(
    JSON.stringify({
      autonomy: { enabled: true, maxHours: 100, stallMinutes: 5, reviewModel: 'claude-opus-5-5[1m]', turbo: true },
      projects: [{ id: 'api', names: ['api'], path: '/home/ada/api', verify: ['npm run check', ' npm run check ', '', 'npm test'] }],
    }),
  );
  assert.deepEqual(config.autonomy, { enabled: true, maxHours: 12, stallMinutes: 90, atTimeLimit: 'continue', reviewModel: 'claude-opus-5-5[1m]' });
  assert.deepEqual(
    problems.map((p) => p.path),
    ['autonomy.turbo', 'autonomy.maxHours', 'autonomy.stallMinutes'],
  );
  assert.deepEqual(config.projects[0]!.verify, ['npm run check', 'npm test']);
  assert.equal(parseConfig(JSON.stringify({ autonomy: { enabled: 'yes', reviewModel: 'a model; rm' } })).problems.length, 2);
  assert.equal(parseConfig(JSON.stringify({ autonomy: { reviewModel: null } })).config.autonomy.reviewModel, null);
  assert.equal(parseConfig(JSON.stringify({ autonomy: 1 })).problems[0]!.path, 'autonomy');
});

test('full autonomy limits: both ends of each range are accepted', () => {
  for (const [maxHours, stallMinutes] of [
    [1, 10],
    [72, 720],
  ])
    assert.deepEqual(parseConfig(JSON.stringify({ autonomy: { maxHours, stallMinutes } })).config.autonomy, {
      enabled: false,
      maxHours,
      stallMinutes,
      atTimeLimit: 'continue',
      reviewModel: null,
    });
  assert.equal(parseConfig(JSON.stringify({ autonomy: { maxHours: 73 } })).problems[0]!.path, 'autonomy.maxHours');
  assert.equal(parseConfig(JSON.stringify({ autonomy: { stallMinutes: 9 } })).problems[0]!.path, 'autonomy.stallMinutes');
});

test('parallel agents: off unless set, the read-only helpers free unless set; anything else is a problem', () => {
  assert.deepEqual(parseConfig(null).config.agents, { enabled: false, helpers: true });
  assert.deepEqual(parseConfig(JSON.stringify({ agents: { enabled: true, helpers: false } })).config.agents, { enabled: true, helpers: false });
  const { config, problems } = parseConfig(JSON.stringify({ agents: { enabled: 'yes', helpers: 0, max: 5 } }));
  assert.deepEqual(config.agents, { enabled: false, helpers: true });
  assert.deepEqual(
    problems.map((p) => [p.path, p.kind]),
    [
      ['agents.max', 'unknown-key'],
      ['agents.enabled', 'type'],
      ['agents.helpers', 'type'],
    ],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ agents: [] })).problems.map((p) => p.path),
    ['agents'],
  );
  assert.equal(setConfigValue(parseConfig('{}').config, 'agents.enabled', true).config.agents.enabled, true);
});

test('tool packs: Automatic use on unless set; a mode per known pack, automatic kept as no entry', () => {
  const d = parseConfig(JSON.stringify({})).config.packs;
  assert.deepEqual(d, { autoUse: true, items: {} });
  const c = parseConfig(JSON.stringify({ packs: { autoUse: false, items: { typst: 'never', ffmpeg: 'auto', store: 'always' } } })).config.packs;
  assert.deepEqual(c, { autoUse: false, items: { typst: 'never', store: 'always' } });
  assert.deepEqual(
    parseConfig(JSON.stringify({ packs: { autoUse: 'yes', items: { typst: 'sometimes', rust: 'auto' }, x: 1 } })).problems.map((p) => [p.path, p.kind]),
    [
      ['packs.x', 'unknown-key'],
      ['packs.autoUse', 'type'],
      ['packs.items.typst', 'type'],
      ['packs.items.rust', 'unknown-key'],
    ],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ packs: { items: [] } })).problems.map((p) => p.path),
    ['packs.items'],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ packs: 5 })).problems.map((p) => p.path),
    ['packs'],
  );
  assert.deepEqual(setConfigValue(parseConfig('{}').config, 'packs.items.typst', 'me').config.packs.items, { typst: 'me' });
});

test('the skills of others: off unless set; a state per known skill, off kept as no entry', () => {
  assert.deepEqual(parseConfig(JSON.stringify({})).config.skills, { items: {} });
  assert.deepEqual(parseConfig(JSON.stringify({ skills: { items: { tdd: 'on', teach: 'me', humanizer: 'off' } } })).config.skills, {
    items: { tdd: 'on', teach: 'me' },
  });
  assert.deepEqual(
    parseConfig(JSON.stringify({ skills: { items: { tdd: 'always', made_up: 'on' }, x: 1 } })).problems.map((p) => [p.path, p.kind]),
    [
      ['skills.x', 'unknown-key'],
      ['skills.items.tdd', 'type'],
      ['skills.items.made_up', 'unknown-key'],
    ],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ skills: { items: 5 } })).problems.map((p) => p.path),
    ['skills.items'],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ skills: [] })).problems.map((p) => p.path),
    ['skills'],
  );
});

test('the update check: off unless set, a yes or no only', () => {
  assert.equal(parseConfig(JSON.stringify({})).config.update.check, false);
  assert.equal(parseConfig(JSON.stringify({ update: { check: true } })).config.update.check, true);
  assert.deepEqual(
    parseConfig(JSON.stringify({ update: { check: 'yes', when: 1 } })).problems.map((p) => [p.path, p.kind]),
    [
      ['update.when', 'unknown-key'],
      ['update.check', 'type'],
    ],
  );
  assert.deepEqual(
    parseConfig(JSON.stringify({ update: 5 })).problems.map((p) => p.path),
    ['update'],
  );
});

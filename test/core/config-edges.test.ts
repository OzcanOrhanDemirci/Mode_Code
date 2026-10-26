// SPDX-License-Identifier: Apache-2.0
/**
 * The settings file at its edges, where mutation testing found no test watching: every default value,
 * every range bound on both sides, every wrong type, and the rules about what may not be weakened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults, normalizeConfig, setConfigValue } from '../../src/core/config.js';
import { golden } from '../helpers/golden.js';

const problems = (raw: unknown) => normalizeConfig(raw).problems.map((p) => `${p.path} ${p.kind}`);
const config = (raw: unknown) => normalizeConfig(raw).config;

test('the defaults, all of them, as a person gets them on a fresh installation', () => {
  golden('config-defaults', JSON.stringify(cloneDefaults(), null, 2));
});

test('percentages: 0 and 100 are accepted, -1, 101, NaN and text are not, and the value is rounded', () => {
  assert.equal(config({ footer: { showFiveFrom: 0 } }).footer.showFiveFrom, 0);
  assert.equal(config({ footer: { showFiveFrom: 100 } }).footer.showFiveFrom, 100);
  assert.equal(config({ footer: { showFiveFrom: 70.6 } }).footer.showFiveFrom, 71);
  for (const bad of [-1, 101, Number.NaN, '70', null])
    assert.deepEqual(problems({ footer: { showFiveFrom: bad } }), ['footer.showFiveFrom range'], String(bad));
  assert.equal(config({ footer: { showFiveFrom: 101 } }).footer.showFiveFrom, cloneDefaults().footer.showFiveFrom);
});

test('stale readings: 5 to 1440 minutes, both ends included', () => {
  assert.equal(config({ quota: { staleMinutes: 5 } }).quota.staleMinutes, 5);
  assert.equal(config({ quota: { staleMinutes: 1440 } }).quota.staleMinutes, 1440);
  assert.equal(config({ quota: { staleMinutes: 30.4 } }).quota.staleMinutes, 30);
  for (const bad of [4, 1441, '60', true]) assert.deepEqual(problems({ quota: { staleMinutes: bad } }), ['quota.staleMinutes range'], String(bad));
  assert.deepEqual(problems({ quota: { autoResume: 'yes' } }), ['quota.autoResume type']);
  assert.equal(config({ quota: { autoResume: false } }).quota.autoResume, false);
  assert.deepEqual(problems({ quota: { clearHint: 1 } }), ['quota.clearHint type']);
  assert.equal(config({ quota: { clearHint: false } }).quota.clearHint, false);
  assert.equal(config({}).quota.clearHint, true);
  // The reset at a task boundary: on by default, from 200K; 20K to 900K, both ends included.
  assert.equal(config({}).quota.autoReset, true);
  assert.equal(config({ quota: { autoReset: false } }).quota.autoReset, false);
  assert.deepEqual(problems({ quota: { autoReset: 'no' } }), ['quota.autoReset type']);
  assert.equal(config({}).quota.resetTokens, 200_000);
  assert.equal(config({ quota: { resetTokens: 20_000 } }).quota.resetTokens, 20_000);
  assert.equal(config({ quota: { resetTokens: 900_000 } }).quota.resetTokens, 900_000);
  assert.equal(config({ quota: { resetTokens: 150_000.6 } }).quota.resetTokens, 150_001);
  for (const bad of [19_999, 900_001, Number.NaN, '200000', null])
    assert.deepEqual(problems({ quota: { resetTokens: bad } }), ['quota.resetTokens range'], String(bad));
  assert.equal(config({ quota: { resetTokens: 5 } }).quota.resetTokens, 200_000);
  // Full autonomy's old settings (1.1) read without a problem and do nothing.
  assert.deepEqual(problems({ autonomy: { atTimeLimit: 'stop', enabled: 1 } }), []);
  assert.equal(config({}).notify.ntfy, null);
  assert.equal(config({ notify: { ntfy: ' https://ntfy.sh/ada-runs ' } }).notify.ntfy, 'https://ntfy.sh/ada-runs');
  assert.equal(config({ notify: { ntfy: 'http://localhost:8080/runs' } }).notify.ntfy, 'http://localhost:8080/runs');
  for (const bad of ['http://ntfy.sh/runs', 'https://ntfy.sh/', 'https://ntfy.sh/a/b', 'ntfy.sh/runs', 'https://ntfy.sh/runs?x=1', 7])
    assert.deepEqual(problems({ notify: { ntfy: bad } }), ['notify.ntfy type'], String(bad));
  assert.equal(config({ notify: { ntfy: null } }).notify.ntfy, null);
  assert.deepEqual(problems({ notify: { email: 'x' } }), ['notify.email unknown-key']);
  assert.deepEqual(problems({ notify: 'x' }), ['notify type']);
});

test('a wrap-up level may equal its stop level but not exceed it', () => {
  assert.deepEqual(problems({ quota: { fiveHourWrapUp: 99, fiveHourStop: 99 } }), []);
  assert.deepEqual(problems({ quota: { defaultWeeklyWrapUp: 90, defaultWeeklyTarget: 90 } }), []);
  assert.deepEqual(problems({ quota: { defaultWeeklyWrapUp: 91, defaultWeeklyTarget: 90 } }), ['quota.defaultWeeklyWrapUp range']);
  assert.equal(config({ quota: { defaultWeeklyWrapUp: 91, defaultWeeklyTarget: 90 } }).quota.defaultWeeklyWrapUp, 90);
});

test('every section of the wrong type is reported by name, and the rest still applies', () => {
  for (const section of ['footer', 'quota', 'memory', 'belt', 'keywords', 'projects', 'modules', 'accessibility'])
    assert.deepEqual(problems({ [section]: 5, view: 'detailed' }), [`${section} type`], section);
  assert.equal(config({ footer: 5, view: 'detailed' }).view, 'detailed');
  assert.deepEqual(problems({ language: 'xx' }), ['language type']);
  assert.equal(config({ language: 'auto' }).language, 'auto');
  assert.equal(config({ language: 'tr' }).language, 'tr');
  for (const view of ['simple', 'recommended', 'detailed']) assert.equal(config({ view }).view, view);
  for (const mode of ['draw', 'check', 'off']) assert.equal(config({ footer: { mode } }).footer.mode, mode);
  assert.deepEqual(problems({ footer: { mode: 'loud' } }), ['footer.mode type']);
  assert.deepEqual(problems({ version: 2 }), ['version newer-version']);
  assert.deepEqual(problems({ version: 1 }), []);
  assert.deepEqual(problems({ $schema: 'x' }), [], 'a $schema line is allowed');
  assert.deepEqual(problems({ modules: { nope: true, footer: 'yes' } }), ['modules.nope unknown-key', 'modules.footer type']);
  assert.deepEqual(problems([]), [' type']);
});

test('lists: wrong items are dropped and reported; phrases and names up to 40 characters', () => {
  assert.deepEqual(problems({ memory: { dirs: ['a', 5, 'b'] } }), ['memory.dirs type']);
  assert.deepEqual(config({ memory: { dirs: ['a', 5, 'b'] } }).memory.dirs, ['a', 'b']);
  assert.deepEqual(config({ memory: { dirs: 'a' } }).memory.dirs, []);
  const phrase40 = 'a'.repeat(40);
  const extra = config({ keywords: { extra: { en: { continue: [phrase40, phrase40 + 'b', '  ', 'go on'] } } } }).keywords.extra.en!;
  assert.deepEqual(extra.continue, [phrase40, 'go on']);
  assert.deepEqual(problems({ keywords: { extra: { xx: {} } } }), ['keywords.extra.xx type']);
  assert.deepEqual(problems({ keywords: { extra: { en: { shout: [] } } } }), ['keywords.extra.en.shout unknown-key']);
  const p = config({ projects: [{ id: 'app', names: ['n'.repeat(40), 'n'.repeat(41), ' ', 'ok'], path: ' ' }] }).projects[0]!;
  assert.deepEqual(p.names, ['n'.repeat(40), 'ok']);
  assert.equal(p.path, undefined, 'a blank path is no path');
  assert.deepEqual(problems({ projects: [{ id: 'app' }, { id: 'app' }, { id: 'Not Kebab' }, 5, { id: 5 }] }), [
    'projects.1 type',
    'projects.2 type',
    'projects.3 type',
    'projects.4 type',
  ]);
});

test('the belt section: unknown rules, wrong verdicts, locked rules, lists and packs', () => {
  assert.deepEqual(problems({ belt: { disabled: ['nope', 'git.clean', 'self.tool-files'] } }), ['belt.disabled unknown-key', 'belt.disabled weakened']);
  assert.deepEqual(config({ belt: { disabled: ['nope', 'git.clean', 'self.tool-files'] } }).belt.disabled, ['git.clean']);
  assert.deepEqual(problems({ belt: { verdicts: { nope: 'ask', 'git.clean': 'maybe', 'self.tool-files': 'ask', 'git.no-verify': 'deny' } } }), [
    'belt.verdicts.nope unknown-key',
    'belt.verdicts.git.clean type',
    'belt.verdicts.self.tool-files weakened',
  ]);
  assert.deepEqual(config({ belt: { verdicts: { 'self.tool-files': 'deny', 'git.no-verify': 'deny' } } }).belt.verdicts, {
    'self.tool-files': 'deny',
    'git.no-verify': 'deny',
  });
  assert.deepEqual(problems({ belt: { verdicts: 'deny' } }), ['belt.verdicts type']);
  assert.deepEqual(config({ belt: { protectedBranches: ['main', ' ', 'dev'] } }).belt.protectedBranches, ['main', 'dev']);
  assert.deepEqual(problems({ belt: { packs: 'all' } }), ['belt.packs type']);
  assert.deepEqual(problems({ belt: { packs: { kubernetes: true, dockerVolumes: 'yes' } } }), [
    'belt.packs.kubernetes unknown-key',
    'belt.packs.dockerVolumes type',
  ]);
  assert.equal(config({ belt: { packs: { dockerVolumes: true } } }).belt.packs?.dockerVolumes, true);
});

test('setting one value by its dotted path creates what is missing and is validated like the file', () => {
  const a = setConfigValue(cloneDefaults(), 'belt.packs.dockerVolumes', true);
  assert.deepEqual(a.problems, []);
  assert.equal(a.config.belt.packs?.dockerVolumes, true);
  const b = setConfigValue(cloneDefaults(), 'quota.staleMinutes', 2);
  assert.deepEqual(
    b.problems.map((p) => p.path),
    ['quota.staleMinutes'],
  );
});

test('modes: the work folder is a path or null; anything else is reported and left at its default', () => {
  assert.equal(normalizeConfig({ modes: { workDir: '  /work/flows  ' } }).config.modes.workDir, '/work/flows');
  assert.equal(normalizeConfig({ modes: { workDir: null } }).config.modes.workDir, null);
  assert.equal(normalizeConfig({ modes: {} }).config.modes.workDir, null);
  for (const bad of [5, '', '   ', true]) {
    const r = normalizeConfig({ modes: { workDir: bad } });
    assert.equal(r.config.modes.workDir, null, String(bad));
    assert.deepEqual(
      r.problems.map((p) => [p.path, p.kind]),
      [['modes.workDir', 'type']],
      String(bad),
    );
  }
  assert.deepEqual(
    normalizeConfig({ modes: { other: 1 } }).problems.map((p) => [p.path, p.kind]),
    [['modes.other', 'unknown-key']],
  );
  assert.deepEqual(
    normalizeConfig({ modes: 'x' }).problems.map((p) => [p.path, p.kind]),
    [['modes', 'type']],
  );
});

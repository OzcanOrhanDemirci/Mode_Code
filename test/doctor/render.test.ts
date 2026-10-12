// SPDX-License-Identifier: Apache-2.0
/**
 * What the doctor prints, compared whole with golden files in both languages: a healthy machine, a broken
 * one with its repairs, the self-check, and the problem report (which must not carry the user's name).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, tally } from '../../src/app/doctor/checks.js';
import { planRepairs } from '../../src/app/doctor/doctor.js';
import { maskParams, renderChecks, renderPlan, renderReport, renderRepairs, renderSelfCheck, renderSummary, say } from '../../src/app/doctor/render.js';
import type { Lang } from '../../src/core/i18n/index.js';
import { healthyFacts } from '../helpers/facts.js';
import { golden } from '../helpers/golden.js';

const HOME = 'C:/Users/ada';

const broken = healthyFacts({
  hookProgram: { ...healthyFacts().hookProgram, exists: false, hash: null },
  hooks: healthyFacts().hooks.filter((h) => h.event !== 'Stop'),
  hookAgreement: { samples: 30, agreed: 29, differences: [{ call: 'Write C:/Users/ada/TERMIN~1/config.json', mine: 'deny', theirs: 'allow' }], error: null },
  data: { ...healthyFacts().data, staleTemp: ['config.json.4242.0a1b2c3d.tmp'] },
  git: { version: '2.55.0', projects: [{ path: 'C:/dev/app', exists: true, readable: false, error: 'fatal: detected dubious ownership', notRepo: false }] },
});

for (const lang of ['en', 'tr'] as Lang[]) {
  test(`a healthy machine reads calmly (${lang})`, () => {
    const results = runChecks(healthyFacts());
    golden(
      `doctor-healthy-${lang}`,
      [...renderChecks(results, { lang, home: HOME }), '', ...renderSummary(tally(results), results.length, 2140, lang)].join('\n'),
    );
  });

  test(`a broken machine: what is wrong, why, and the repairs (${lang})`, () => {
    const results = runChecks(broken);
    const plan = planRepairs(results, { agent: false });
    golden(
      `doctor-broken-${lang}`,
      [...renderChecks(results, { lang, home: HOME }), '', ...renderSummary(tally(results), results.length, 2140, lang), '', ...renderPlan(plan, lang)].join(
        '\n',
      ),
    );
  });

  test(`repairs: verified, unverified, failed, with backups (${lang})`, () => {
    const after = runChecks(healthyFacts());
    const lines = renderRepairs(
      {
        outcomes: [
          {
            id: 'restore-hooks',
            ok: true,
            detail: 'x',
            verified: true,
            refused: false,
            backup: 'C:/Users/ada/.terminal-code/install/backups/settings.json.doctor.1',
          },
          { id: 'restore-hook-program', ok: true, detail: 'x', verified: false, refused: false },
          { id: 'rebuild-index', ok: false, detail: 'C:/Users/ada/.terminal-code/index.db is locked', verified: false, refused: false },
          { id: 'reinstall-plugin', ok: false, detail: 'refused', verified: false, refused: true },
        ],
        after: { facts: healthyFacts(), results: after, tally: tally(after), ms: 1 },
      },
      lang,
      HOME,
    );
    golden(`doctor-repairs-${lang}`, lines.join('\n'));
  });

  test(`the self-check report (${lang})`, () => {
    const lines = renderSelfCheck(
      {
        ok: false,
        skipped: null,
        baseline: { ok: true, problems: [] },
        faults: [
          { id: 'hooks-removed', check: 'install.hooks', detected: true, repaired: true, detail: '', ms: 1 },
          { id: 'settings-broken', check: 'claude.settings', detected: true, repaired: null, detail: '', ms: 1 },
          { id: 'hook-altered', check: 'install.hookProgram', detected: false, repaired: false, detail: 'ok; restore-hook-program not planned (none)', ms: 1 },
        ],
        ms: 3900,
      },
      lang,
    );
    golden(`doctor-selfcheck-${lang}`, lines.join('\n'));
  });
}

test('an agent running the doctor is told which repairs are the person to make', () => {
  const results = runChecks(healthyFacts({ plugins: [] }));
  const lines = renderPlan(planRepairs(results, { agent: true }), 'en');
  assert.match(lines.join('\n'), /Not repaired, because an agent runs this command: Install the plugin into Claude Code again/);
});

test('the problem report hides the home folder and the user name, and carries no commands', () => {
  const results = runChecks(broken);
  const text = renderReport({ facts: broken, results, tally: tally(results), ms: 1 }, { home: HOME, user: 'ada' });
  assert.doesNotMatch(text, /ada/i);
  assert.match(text, /~\/TERMIN~1\/config\.json/);
  assert.match(text, /\| install\.hookProgram \| fail \|/);
  assert.doesNotMatch(text, /\| shell\.posix \|/, 'skipped checks are left out');
  golden('doctor-report', text);
});

test('parameters: home written as ~, the user name hidden, "@key" values translated', () => {
  assert.deepEqual(maskParams({ p: 'C:\\Users\\Ada\\x', n: 3 }, HOME), { p: '~/x', n: 3 });
  assert.deepEqual(maskParams({ p: 'D:/ada-work/x' }, HOME, 'ada'), { p: 'D:/<user>-work/x' });
  assert.equal(maskParams(undefined, HOME), undefined);
  assert.equal(
    say('tr', { key: 'doc.protect.agreement.diff', params: { call: 'Write x', mine: '@verdict.deny', theirs: '@verdict.allow' } }, HOME),
    'Write x: bu sürüm "engelle" diyor, kurulu hook "izin" diyor.',
  );
});

// SPDX-License-Identifier: Apache-2.0
// The repository's settings as code (scripts/github-settings.mjs): what its dry run reports from GitHub's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain JavaScript script, run by hand
import { securityGaps, rulesetDifferences, mainRuleset } from '../../scripts/github-settings.mjs';

const on = { status: 'enabled' };
const off = { status: 'disabled' };
const all = ['secret scanning', 'push protection', 'private vulnerability reporting'];

test('a public repository with everything on has no security gap', () => {
  assert.deepEqual(securityGaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: true }), { off: [], unknown: [] });
});

test('each setting that is off is named', () => {
  const gaps = (a: object, r: object) => securityGaps(a, r).off;
  assert.deepEqual(gaps({ secret_scanning: off, secret_scanning_push_protection: on }, { enabled: true }), ['secret scanning']);
  assert.deepEqual(gaps({ secret_scanning: on, secret_scanning_push_protection: off }, { enabled: true }), ['push protection']);
  assert.deepEqual(gaps({ secret_scanning: on, secret_scanning_push_protection: on }, { enabled: false }), ['private vulnerability reporting']);
});

test('an answer GitHub did not give is unknown, never on', () => {
  assert.deepEqual(securityGaps(undefined, null), { off: [], unknown: all });
  assert.deepEqual(securityGaps({}, {}), { off: [], unknown: all });
  assert.deepEqual(securityGaps({ secret_scanning: off }, null), { off: ['secret scanning'], unknown: all.slice(1) });
});

// A rule set as GitHub answers it: the wanted one, with `edit` applied to its required checks.
const held = (edit: (checks: string[]) => string[], enforcement = 'active') => {
  const want = mainRuleset(true);
  return {
    ...want,
    enforcement,
    rules: want.rules.map((rule: { type: string; parameters?: { required_status_checks?: { context: string }[] } }) =>
      rule.type !== 'required_status_checks'
        ? rule
        : {
            ...rule,
            parameters: {
              ...rule.parameters,
              required_status_checks: edit((rule.parameters?.required_status_checks ?? []).map((c) => c.context)).map((context) => ({ context })),
            },
          },
    ),
  };
};

test('a rule set as wanted has no difference', () => {
  assert.deepEqual(
    rulesetDifferences(
      held((c) => c),
      mainRuleset(true),
    ),
    [],
  );
});

test('the dry run sees a required check added or removed, not only the enforcement', () => {
  assert.deepEqual(
    rulesetDifferences(
      held((c) => [...c, 'macos-latest · Node 24.x']),
      mainRuleset(true),
    ),
    ['required checks not wanted: macos-latest · Node 24.x'],
  );
  assert.deepEqual(
    rulesetDifferences(
      held((c) => c.slice(1)),
      mainRuleset(true),
    ),
    [
      `required checks missing: ${mainRuleset(true).rules.find((r: { type: string }) => r.type === 'required_status_checks').parameters.required_status_checks[0].context}`,
    ],
  );
});

test('the dry run sees a rule missing and the enforcement', () => {
  const want = mainRuleset(true);
  const have = { ...want, rules: want.rules.filter((r: { type: string }) => r.type !== 'non_fast_forward') };
  assert.deepEqual(rulesetDifferences(have, want), ['rules missing: non_fast_forward']);
  assert.deepEqual(
    rulesetDifferences(
      held((c) => c, 'disabled'),
      want,
    ),
    ['enforcement is disabled'],
  );
  assert.deepEqual(rulesetDifferences(undefined, want).slice(0, 2), [
    'enforcement is unknown',
    `rules missing: ${want.rules.map((r: { type: string }) => r.type).join(', ')}`,
  ]);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in self-tests, run here exactly as `terminal-code doctor` runs them on a person's machine.
 * A failing sample is printed with what was expected and what came back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUITES, runAllSuites } from '../../src/core/selftest/suites.js';
import { runSuite } from '../../src/core/selftest/types.js';
import { BELT_SAMPLES, samplesFor } from '../../src/core/belt/samples.js';

for (const [name, run] of Object.entries(SUITES))
  test(`self-test suite "${name}" passes every sample`, async () => {
    const r = await run();
    assert.equal(r.suite, name);
    assert.ok(r.passed > 0, 'a suite with no samples proves nothing');
    assert.deepEqual(r.failures, []);
  });

test('runAllSuites runs every suite once, in order', async () => {
  const all = await runAllSuites();
  assert.deepEqual(
    all.map((r) => r.suite),
    Object.keys(SUITES),
  );
});

test('a sample that throws fails with the error, and the suite goes on', async () => {
  const r = await runSuite('demo', [
    { name: 'throws', run: () => Promise.reject(new Error('boom')) },
    { name: 'wrong', run: () => ['a', 'b'] },
    { name: 'right', run: () => ['a', 'a'] },
  ]);
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 2);
  assert.deepEqual(r.failures[0], { name: 'throws', expected: '(no error)', actual: 'error: boom' });
  assert.deepEqual(r.failures[1], { name: 'wrong', expected: 'a', actual: 'b' });
});

test('belt samples: names are unique, each platform gets the shared ones, protections come with their rule', () => {
  const names = BELT_SAMPLES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  const shared = BELT_SAMPLES.filter((s) => !s.only).length;
  assert.equal(samplesFor('linux').length, shared);
  assert.equal(samplesFor('win32').length, shared + 1);
  for (const s of BELT_SAMPLES) assert.equal(s.verdict === 'allow', s.rules.length === 0, s.name);
  assert.ok(BELT_SAMPLES.filter((s) => s.verdict === 'allow').length >= 20, 'silence is tested at least as much as protection');
});

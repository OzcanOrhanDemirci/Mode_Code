// SPDX-License-Identifier: Apache-2.0
/**
 * Full autonomy's clear request (src/core/provenance.ts requestCheck, src/core/belt/rules.ts requestAct): Claude
 * quotes the person's sentence word for word with its target; code finds it in what they typed; the step on that
 * target then goes on with a note in full autonomy, never for the approved short list, until their next prompt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../../src/core/belt/evaluate.js';
import { requestAct, RULES, RULE_IDS } from '../../src/core/belt/rules.js';
import type { Finding } from '../../src/core/belt/types.js';
import { emptyProvenance, grantedUnit, GRANTS_MAX, parseProvenance, requestCheck, withGrant, withSaid } from '../../src/core/provenance.js';

const said = (text: string) => withSaid(emptyProvenance(), text);

test("a quote is a clear request when it is the person's sentence, word for word, naming the target", () => {
  const p = said('Please delete the file named Q3 plan from the drive.\nThanks.');
  assert.equal(requestCheck('delete the file named Q3 plan from the drive', 'Q3 plan', p), 'ok');
  assert.equal(requestCheck('delete the file named  Q3 plan\nfrom the drive', 'Q3 plan', p), 'ok', 'spacing aside');
  assert.equal(requestCheck('Delete The File named Q3 plan', 'Q3 plan', p), 'not-said', 'case kept');
  assert.equal(requestCheck('delete', 'Q3 plan', p), 'short');
  assert.equal(requestCheck('delete the file named Q3 plan from the drive', 'Q4 plan', p), 'not-in-quote');
  assert.equal(requestCheck('delete the file named Q3 plan from the drive', '  ', p), 'not-in-quote');
  assert.equal(requestCheck('remove everything from the drive now', 'drive', p), 'not-said');
  // Eight characters make a sentence; the request may be in any of the person's prompts.
  const two = withSaid(withSaid(emptyProvenance(), 'remove x'), 'and then the docs');
  assert.equal(requestCheck('remove x', 'x', two), 'ok');
});

test('a request holds for what it names, until the next prompt; the record keeps the newest', () => {
  let p = withGrant(said('please delete the file named Q3 plan'), { target: ' Q3 plan ', quote: 'delete the file\n named Q3 plan', at: 5 });
  assert.deepEqual(p.granted, [{ target: 'Q3 plan', quote: 'delete the file named Q3 plan', at: 5 }]);
  assert.ok(grantedUnit({ kind: 'object', values: ['Q3 plan'] }, p));
  assert.ok(!grantedUnit({ kind: 'object', values: ['Q3 plan', 'Q4 plan'] }, p));
  assert.ok(!grantedUnit({ kind: 'object', values: [] }, p));
  assert.deepEqual(withSaid(p, 'next thing').granted, []);
  assert.deepEqual(withSaid(p, '   ').granted, []);
  assert.equal(withSaid(withSaid(emptyProvenance(), 'a'), '  ').granted.length, 0);
  for (let i = 0; i < GRANTS_MAX + 2; i++) p = withGrant(p, { target: `t${i}`, quote: `quote number ${i}`, at: i });
  assert.equal(p.granted.length, GRANTS_MAX);
  assert.deepEqual(parseProvenance(JSON.stringify(p)).granted, p.granted);
  assert.deepEqual(
    parseProvenance(JSON.stringify({ ...p, granted: [null, { target: 1 }, { target: 'x', quote: 'q' }, { target: 'x', quote: 'q', at: 1 }] })).granted,
    [{ target: 'x', quote: 'q', at: 1 }],
  );
  assert.deepEqual(parseProvenance(JSON.stringify({ v: 1, granted: 'x' })).granted, []);
});

test('only full autonomy, only where Autonomous would ask, never the short list, the protection or a verdict of the person', () => {
  assert.equal(requestAct('outbound.delete', 'full', {}), 'note');
  assert.equal(requestAct('git.force-push', 'full', {}), 'note');
  assert.equal(requestAct('outbound.delete', 'auto', {}), null);
  assert.equal(requestAct('outbound.delete', 'manual', {}), null);
  for (const id of [
    'outbound.payment',
    'fs.disk',
    'fs.delete-critical',
    'claude.config-change',
    'system.security-off',
    'self.memory-delete',
    'git.push-pr-only',
    'secrets.exfil',
    'meta.unverifiable',
  ] as const)
    assert.equal(requestAct(id, 'full', {}), null, id);
  assert.equal(requestAct('outbound.delete', 'full', { verdicts: { 'outbound.delete': 'ask' } }), null);
  assert.equal(requestAct('git.no-verify', 'full', {}), null, 'a note already');
  // Every rule a request can hand over asks in Autonomous and leaves it to the person in full autonomy.
  for (const id of RULE_IDS) if (requestAct(id, 'full', {})) assert.deepEqual([RULES[id].acts[1], RULES[id].acts[2]], ['ask', 'self'], id);
});

test('the decision: a granted target goes on with a note in full autonomy; another is left to the person', () => {
  const del: Finding = { rule: 'outbound.delete', verdict: 'allow', reason: 'deletes', unit: { kind: 'object', values: ['Q3 plan'] } };
  const p = withGrant(said('please delete the file named Q3 plan'), { target: 'Q3 plan', quote: 'delete the file named Q3 plan', at: 1 });
  assert.deepEqual(
    decide([del], [], { config: {}, level: 'full', prov: p }).findings.map((f) => f.act),
    ['note'],
  );
  assert.deepEqual(
    decide([{ ...del, unit: { kind: 'object', values: ['Q4 plan'] } }], [], { config: {}, level: 'full', prov: p }).findings.map((f) => f.act),
    ['self'],
  );
  assert.deepEqual(
    decide([del], [], { config: {}, level: 'full', prov: said('please delete the file named Q3 plan') }).findings.map((f) => f.act),
    ['self'],
  );
  assert.deepEqual(
    decide([{ ...del, unit: undefined }], [], { config: {}, level: 'full', prov: p }).findings.map((f) => f.act),
    ['self'],
  );
});

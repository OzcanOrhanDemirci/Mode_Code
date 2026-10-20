// SPDX-License-Identifier: Apache-2.0
/**
 * The belt with a safety net (src/core/belt/rules.ts `net`, src/core/net.ts): which rules let a call through once
 * what it takes away is kept, what each check names for the net to keep, and when a net changes nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decisionText, evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { netAct, RULES, RULE_IDS } from '../../src/core/belt/rules.js';
import type { Level, RuleId } from '../../src/core/belt/types.js';
import { winCtx } from '../helpers/belt.js';

/** The approved table's "with the net" columns: Manual still asks; Autonomous and full autonomy let it through. */
const WITH_NET: Partial<Record<RuleId, string>> = {
  'git.force-push': 'ask note note',
  'git.delete-remote-branch': 'ask note note',
  'git.history-rewrite': 'ask note note',
  'git.clean': 'ask pass pass',
  'git.discard-work': 'ask pass pass',
  'git.branch-force-delete': 'ask note note',
  'fs.delete-outside-project': 'ask note note',
  'fs.delete-git-dir': 'ask note note',
};

test('the rules a net makes undoable, and what each does with it; no other rule has one', () => {
  for (const id of RULE_IDS) assert.equal(RULES[id].net?.join(' '), WITH_NET[id], id);
  // A net never makes a level stricter than without it, and never touches a locked rule.
  for (const id of RULE_IDS)
    if (RULES[id].net) {
      assert.ok(!RULES[id].locked, id);
      assert.equal(RULES[id].net![0], RULES[id].acts[0], `${id}: Manual is the same with a net`);
    }
});

test('a net counts where it changes the answer, and never over the person: their own verdict, a rule turned off, Manual', () => {
  assert.equal(netAct('git.clean', 'auto', {}), 'pass');
  assert.equal(netAct('git.clean', 'full', {}), 'pass');
  assert.equal(netAct('git.force-push', 'full', {}), 'note');
  assert.equal(netAct('git.clean', 'manual', {}), null);
  assert.equal(netAct('git.clean', 'auto', { verdicts: { 'git.clean': 'ask' } }), null);
  assert.equal(netAct('git.clean', 'auto', { disabled: ['git.clean'] }), null);
  assert.equal(netAct('git.no-verify', 'auto', {}), null, 'no net for it');
  assert.equal(netAct('fs.delete-critical', 'full', {}), null);
});

test('the decision stands on the nets it names; without a net to lay it is the one without', () => {
  const plan = { kind: 'untracked' as const, repo: 'C:/dev/app', args: ['-fd'] };
  const clean = { rule: 'git.clean' as const, verdict: 'allow' as const, reason: 'clean', net: plan };
  const at = (level: Level, net: boolean, extra = [] as (typeof clean | { rule: RuleId; verdict: 'allow'; reason: string })[]) =>
    decide([clean, ...extra], [], { config: {}, level, net });
  assert.deepEqual(at('auto', true), { verdict: 'allow', findings: [], issues: [], nets: [{ rule: 'git.clean', plan }] });
  assert.deepEqual(at('auto', false), { verdict: 'ask', findings: [{ ...clean, verdict: 'ask', act: 'ask' }], issues: [] });
  assert.equal(at('full', false).verdict, 'deny');
  assert.deepEqual([at('manual', true).verdict, at('manual', true).nets], ['ask', undefined]);
  // A note with its net: the call runs, Claude is told, the net is laid.
  const push = {
    rule: 'git.force-push' as const,
    verdict: 'allow' as const,
    reason: 'push',
    net: { kind: 'remote' as const, repo: 'C:/dev/app', remote: 'origin', branch: 'f' },
  };
  const d = decide([push], [], { config: {}, level: 'full', net: true });
  assert.deepEqual([d.verdict, d.findings.map((f) => f.act), d.nets?.length], ['warn', ['note'], 1]);
  // Claude is told the net kept it; a note with no net says nothing of one.
  assert.match(
    decisionText(d, { lang: 'en', level: 'full' }),
    /\nA safety net kept what this takes away before it ran: the user can put it back with mode-code net restore\.$/,
  );
  assert.doesNotMatch(decisionText({ ...d, nets: undefined }, { lang: 'en', level: 'full' }), /safety net/);
  // Refused for another reason: nothing is kept for a call that will not run. Asked: kept, in case the person says yes.
  assert.equal(at('auto', true, [{ rule: 'self.tool-files', verdict: 'allow', reason: 'own files' }]).nets, undefined);
  assert.equal(at('auto', true, [{ rule: 'git.hooks-path', verdict: 'allow', reason: 'hooks' }]).nets?.length, 1);
  // A finding with no plan (the check could not name what to keep) is decided without a net.
  assert.equal(decide([{ ...clean, net: undefined }], [], { config: {}, level: 'auto', net: true }).verdict, 'ask');
});

test('what each check names for the net to keep', async () => {
  const plans = async (command: string, over = {}) =>
    (await evaluateToolCall('Bash', { command }, winCtx({ level: 'manual', ...over }))).findings.map((f) => [f.rule, f.net ?? null]);
  const refs = { kind: 'refs', repo: 'C:/dev/app' };
  assert.deepEqual(await plans('git reset --hard'), [['git.discard-work', refs]]);
  assert.deepEqual(await plans('git checkout -- .'), [['git.discard-work', refs]]);
  assert.deepEqual(await plans('git restore src/a.ts'), [['git.discard-work', refs]]);
  assert.deepEqual(await plans('git stash drop'), [['git.discard-work', refs]]);
  assert.deepEqual(await plans('git branch -D old'), [['git.branch-force-delete', refs]]);
  assert.deepEqual(await plans('git filter-branch --tree-filter x HEAD'), [['git.history-rewrite', refs]]);
  assert.deepEqual(await plans('git update-ref -d refs/heads/x'), [['git.history-rewrite', refs]]);
  assert.deepEqual(await plans('git -C sub clean -fdx build'), [['git.clean', { kind: 'untracked', repo: 'C:/dev/app/sub', args: ['-fdx', 'build'] }]]);
  assert.deepEqual(await plans('git push --force origin feature'), [
    ['git.force-push', { kind: 'remote', repo: 'C:/dev/app', remote: 'origin', branch: 'feature' }],
  ]);
  assert.deepEqual(await plans('git push upstream :old'), [
    ['git.delete-remote-branch', { kind: 'remote', repo: 'C:/dev/app', remote: 'upstream', branch: 'old' }],
  ]);
  // A remote given as an address has no remote-tracking branch to keep.
  assert.deepEqual(await plans('git push -f https://example.com/r.git feature'), [['git.force-push', null]]);
  assert.deepEqual(await plans('rm -rf ../other'), [['fs.delete-outside-project', { kind: 'paths', paths: ['C:/dev/other'] }]]);
  // A pattern that empties a folder keeps the folder; one still to be matched keeps nothing.
  assert.deepEqual(await plans('rm -rf ../other/*'), [['fs.delete-outside-project', { kind: 'paths', paths: ['C:/dev/other'] }]]);
  assert.deepEqual(await plans('rm -rf ../other/*.log'), [['fs.delete-outside-project', null]]);
  assert.deepEqual(await plans('rm -rf .git'), [['fs.delete-git-dir', { kind: 'paths', paths: ['C:/dev/app/.git'] }]]);
  // A git call whose arguments are known only when it runs names nothing to keep.
  assert.deepEqual(await plans('git clean -f $DIR'), [['git.clean', null]]);
});

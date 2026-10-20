// SPDX-License-Identifier: Apache-2.0
/**
 * The ways of working (src/core/belt/rules.ts): every rule's act in Manual, Autonomous and full autonomy, as the
 * person approved the table on 2026-10-20; what a setting of theirs does at each level; the decision and its words
 * at each level; what Manual promises (src/core/manual.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decisionText, evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { ACT_ORDER, effectiveAct, levelNamed, levelOf, RULES, RULE_IDS } from '../../src/core/belt/rules.js';
import type { Act, Level, RuleId } from '../../src/core/belt/types.js';
import { promisedIn } from '../../src/core/manual.js';
import { visibleText } from '../../src/core/text.js';
import { winCtx } from '../helpers/belt.js';

/** The approved table, as each rule stands until the safety net and evidence are built: Manual / Autonomous / full. */
const TABLE: Record<RuleId, string> = {
  'git.force-push-protected': 'self self self',
  'git.force-push': 'ask ask self',
  'git.delete-remote-branch-protected': 'self self self',
  'git.delete-remote-branch': 'ask ask self',
  'git.mirror-or-prune': 'ask ask self',
  'git.push-pr-only': 'self self self',
  'git.single-branch': 'self self self',
  'git.history-rewrite': 'ask ask self',
  'git.hooks-path': 'ask ask self',
  'git.no-verify': 'ask note note',
  'git.clean': 'ask ask self',
  'git.discard-work': 'ask note note',
  'git.branch-force-delete': 'ask ask self',
  'github.admin-merge': 'ask ask self',
  'github.delete': 'ask ask self',
  'fs.delete-critical': 'self self self',
  'fs.delete-outside-project': 'ask ask self',
  'fs.delete-git-dir': 'ask ask self',
  'fs.move-critical': 'self self self',
  'fs.disk': 'self self self',
  'self.claude-settings': 'self self self',
  'self.claude-settings-project': 'ask ask self',
  'self.disable-hooks': 'self self self',
  'self.tool-files': 'self self self',
  'self.plugin-cli': 'self self self',
  'self.nested-session': 'self self self',
  'claude.config-change': 'ask ask self',
  'self.memory-delete': 'ask ask self',
  'self.memory-shrink': 'ask ask self',
  'self.memory-history': 'self self self',
  'persist.scheduled-task': 'ask ask self',
  'persist.startup': 'ask ask self',
  'persist.shell-profile': 'ask ask self',
  'persist.ssh': 'self self self',
  'publish.package': 'ask ask self',
  'publish.visibility': 'ask ask self',
  'publish.deploy': 'ask ask self',
  'publish.store': 'ask ask self',
  'docker.volume-delete': 'self self self',
  'data.delete-cloud': 'self self self',
  'data.write-cloud': 'ask ask self',
  'data.reset-database': 'ask ask self',
  'system.security-off': 'self self self',
  'outbound.send': 'ask ask self',
  'outbound.delete': 'ask ask self',
  'outbound.payment': 'ask ask self',
  'secrets.stage': 'ask ask self',
  'secrets.write': 'note note note',
  'secrets.exfil': 'stop stop stop',
  'quality.check-config': 'ask ask note',
  'inject.tainted-act': 'ask ask self',
  'meta.unverifiable': 'ask ask self',
  'outbound.network': 'ask ask self',
  'persist.autorun': 'ask ask self',
};

test('every rule does in each way of working what the approved table says, and its verdict is its Manual one', () => {
  assert.deepEqual(Object.keys(TABLE).sort(), [...RULE_IDS].sort());
  for (const id of RULE_IDS) {
    assert.equal(RULES[id].acts.join(' '), TABLE[id], id);
    assert.equal(RULES[id].verdict, { pass: 'allow', note: 'warn', ask: 'ask', self: 'deny', stop: 'deny' }[RULES[id].acts[0]], id);
  }
});

test('the table never lets full autonomy ask, nor any level be looser than the one that asks more', () => {
  for (const id of RULE_IDS) {
    const [m, o, t] = RULES[id].acts;
    assert.notEqual(t, 'ask', `${id}: full autonomy asks nobody`);
    // A rule that leaves a call to the person, or stops it, does so in every way of working.
    if (m === 'self' || m === 'stop') assert.deepEqual([o, t], [m, m], id);
    // Autonomous never asks more than Manual.
    assert.ok(ACT_ORDER[o] <= ACT_ORDER[m], `${id}: Autonomous ${o} above Manual ${m}`);
  }
});

test('the way of working sets the level: a session that chose none is Manual', () => {
  assert.deepEqual(
    ['default', 'manual', 'autonomous', 'full', null, undefined, 'x'].map((i) => levelOf(i)),
    ['manual', 'manual', 'auto', 'full', 'manual', 'manual', 'manual'],
  );
  assert.deepEqual(['manual', 'manuel', 'Autonomous', 'otonom', 'auto', 'full', 'tam', 'full-auto', 'tam-otonom', undefined, 'yes'].map(levelNamed), [
    'manual',
    'manual',
    'auto',
    'auto',
    'auto',
    'full',
    'full',
    'full',
    'full',
    'manual',
    null,
  ]);
});

test("a person's setting holds at every level; full autonomy turns their question into the person's to do; a locked rule only gets stricter", () => {
  const at = (id: RuleId, verdict: 'allow' | 'warn' | 'ask' | 'deny' | null, level: Level): Act | null =>
    effectiveAct(id, level, verdict ? { verdicts: { [id]: verdict } } : {});
  const levels: Level[] = ['manual', 'auto', 'full'];
  assert.deepEqual(
    levels.map((l) => at('git.clean', null, l)),
    ['ask', 'ask', 'self'],
  );
  assert.deepEqual(
    levels.map((l) => at('git.clean', 'allow', l)),
    ['pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    levels.map((l) => at('git.clean', 'warn', l)),
    ['note', 'note', 'note'],
  );
  assert.deepEqual(
    levels.map((l) => at('git.no-verify', 'ask', l)),
    ['ask', 'ask', 'self'],
  );
  assert.deepEqual(
    levels.map((l) => at('git.no-verify', 'deny', l)),
    ['self', 'self', 'self'],
  );
  // Locked: a softer setting is ignored, a stricter one holds; a stop stays a stop.
  assert.deepEqual(
    levels.map((l) => at('self.memory-shrink', 'allow', l)),
    ['ask', 'ask', 'self'],
  );
  assert.deepEqual(
    levels.map((l) => at('self.memory-shrink', 'deny', l)),
    ['self', 'self', 'self'],
  );
  assert.deepEqual(
    levels.map((l) => at('secrets.exfil', 'deny', l)),
    ['stop', 'stop', 'stop'],
  );
  // Off, and a pack not turned on: nothing at any level; a locked rule cannot be switched off.
  assert.equal(effectiveAct('git.clean', 'full', { disabled: ['git.clean'] }), null);
  assert.equal(effectiveAct('meta.unverifiable', 'auto', { disabled: ['meta.unverifiable'] }), 'ask');
  assert.equal(effectiveAct('docker.volume-delete', 'manual', {}), null);
  assert.equal(effectiveAct('docker.volume-delete', 'auto', { packs: { dockerVolumes: true } }), 'self');
});

test('the same call at each level: Manual asks, Autonomous notes what is only the project’s, full autonomy leaves it to the person', async () => {
  const at = async (command: string, level: Level) => {
    const d = await evaluateToolCall('Bash', { command }, winCtx({ level }));
    return `${d.verdict} ${d.findings.map((f) => `${f.rule}:${f.act}`).join(',')}`;
  };
  const rows = async (command: string) => Promise.all((['manual', 'auto', 'full'] as const).map((l) => at(command, l)));
  assert.deepEqual(await rows('git clean -fdx'), ['ask git.clean:ask', 'ask git.clean:ask', 'deny git.clean:self']);
  assert.deepEqual(await rows('git reset --hard'), ['ask git.discard-work:ask', 'warn git.discard-work:note', 'warn git.discard-work:note']);
  assert.deepEqual(await rows('git commit --no-verify -m wip'), ['ask git.no-verify:ask', 'warn git.no-verify:note', 'warn git.no-verify:note']);
  assert.deepEqual(await rows('git status'), ['allow ', 'allow ', 'allow ']);
  // Without a level the belt decides as Manual.
  assert.equal((await evaluateToolCall('Bash', { command: 'git reset --hard' }, winCtx())).verdict, 'ask');
});

test('the strictest act leads a decision: a stop before a call left to the person, before a question, before a note', () => {
  const f = (rule: RuleId) => ({ rule, verdict: 'allow' as const, reason: rule });
  const d = decide([f('git.no-verify'), f('git.clean'), f('self.tool-files'), f('secrets.exfil')], [], { config: {}, level: 'auto' });
  assert.deepEqual(
    d.findings.map((x) => `${x.act} ${x.rule}`),
    ['stop secrets.exfil', 'self self.tool-files', 'ask git.clean', 'note git.no-verify'],
  );
  assert.equal(d.verdict, 'deny');
});

test('the words: a call left to the person carries its command, every character shown; full autonomy is told to go on; a stop hands nothing over', () => {
  const left = decide([{ rule: 'git.clean', verdict: 'allow', reason: 'R1' }], [], { config: {}, level: 'full' });
  const text = decisionText(left, { lang: 'en', level: 'full' }, { command: 'git clean -fdx\u200B' });
  assert.match(text, /^🛡 Blocked by the safety belt:\n• R1 \[git\.clean\]\n/);
  assert.match(text, /For the user, exactly as it would run: ! git clean -fdx<U\+200B>/);
  assert.match(text, /Full autonomy asks nobody: leave this step for the user, go on with the rest of the task/);
  // In Manual a call left to the person is said the same way, without the full-autonomy line.
  const manual = decide([{ rule: 'self.tool-files', verdict: 'allow', reason: 'R2' }], [], { config: {} });
  const m = decisionText(manual, { lang: 'tr' }, { command: 'rm x' });
  assert.match(m, /Kullanıcı için, çalışacağı hâliyle: ! rm x/);
  assert.doesNotMatch(m, /Tam otonom/);
  assert.doesNotMatch(decisionText(manual, { lang: 'en' }), /exactly as it would run/, 'no command given: none said');
  // A stop beside a call left to the person: the stop's words, nothing handed over.
  const both = decide(
    [
      { rule: 'self.tool-files', verdict: 'allow', reason: 'R4' },
      { rule: 'secrets.exfil', verdict: 'allow', reason: 'R5' },
    ],
    [],
    { config: {} },
  );
  assert.match(decisionText(both, { lang: 'en' }, { command: 'y' }), /not something to hand to the user to run/);
  assert.doesNotMatch(decisionText(both, { lang: 'en' }, { command: 'y' }), /! y/);
  // A stop: no command, no "run it yourself", in any language.
  const stop = decide([{ rule: 'secrets.exfil', verdict: 'allow', reason: 'R3' }], [], { config: {}, level: 'full' });
  for (const lang of ['en', 'tr'] as const) {
    const s = decisionText(stop, { lang, level: 'full' }, { command: 'x' });
    assert.doesNotMatch(s, /! x|run it themselves|kendisi çalıştırabilir/, lang);
    assert.match(s, lang === 'en' ? /not something to hand to the user to run/ : /verilecek bir şey değil/);
  }
});

test('a command shown to the person hides nothing: control characters, zero-width and direction marks, tags', () => {
  assert.equal(visibleText('git push'), 'git push');
  assert.equal(visibleText('a\u202Eb\u200Bc\u0007d'), 'a<U+202E>b<U+200B>c<U+0007>d');
  assert.equal(visibleText('x\u{E0041}'), 'x<U+E0041>');
  assert.equal(visibleText('line\nnext\ttab'), 'line\nnext\ttab', 'a newline and a tab read as themselves');
});

test("Manual's promise: the commits and pushes a command makes, in order, each once, however git is spelled", () => {
  const env = { platform: 'win32' as const, home: 'C:/Users/ada', cwd: 'C:/dev/app' };
  assert.deepEqual(promisedIn('git add . && git commit -m x && git push', 'bash', env), ['commit', 'push']);
  assert.deepEqual(promisedIn('git push; git commit --amend; git push', 'bash', env), ['push', 'commit']);
  assert.deepEqual(promisedIn('git -C ../lib -c core.pager=cat commit -m y', 'bash', env), ['commit']);
  assert.deepEqual(promisedIn('git push origin main', 'powershell', env), ['push']);
  assert.deepEqual(promisedIn('git status && git log -1', 'bash', env), []);
  assert.deepEqual(promisedIn('echo git commit', 'bash', env), []);
});

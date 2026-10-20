// SPDX-License-Identifier: Apache-2.0
// The activity (src/core/ux/activity.ts): every kind of event the plugin and the hook write has a line, in both
// languages, with its class, its why and where it is changed; what waits for you comes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_KINDS, activityLines, activityOf, activityText, type ActivityEvent } from '../../src/core/ux/activity.js';
import { ROOT } from '../helpers/proc.js';

/** Every kind of event the sources write: the plugin's logEvent calls, the guards' refusals, the hook's own. */
function kindsWritten(): string[] {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const mod = read('src/mod/register.ts');
  const kinds = new Set<string>();
  for (const m of mod.matchAll(/logEvent\(\$, c, \{\s*kind:\s*'(\w+)'/g)) kinds.add(m[1]!);
  if (/flowEvent\(/.test(mod)) kinds.add('flow');
  // A guard's refusal is logged with its own kind.
  const guard = /kind: ('[a-z]+'(?: \| '[a-z]+')*);/.exec(read('src/core/guard.ts'))![1]!;
  for (const m of guard.matchAll(/'(\w+)'/g)) kinds.add(m[1]!);
  for (const m of read('src/hook/main.ts').matchAll(/kind: '(\w+)'/g)) kinds.add(m[1]!);
  return [...kinds].sort();
}

test('every kind of event written has its line here', () => {
  const written = kindsWritten();
  assert.ok(written.length >= 20, written.join(', '));
  assert.deepEqual(
    written.filter((k) => !(ACTIVITY_KINDS as readonly string[]).includes(k)),
    [],
  );
});

/** One event of each kind, with the fields its writer gives it. */
const SAMPLES: ActivityEvent[] = [
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'deny', rules: ['git.clean'], reasons: ['Deletes untracked files'] },
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'ask', answer: 'deferred', rules: ['git.push-pr-only'], reasons: ['Pushes to main'] },
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'ask', answer: 'allow', rules: ['git.push-pr-only'], reasons: ['Pushes to main'] },
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'ask', answer: 'block', rules: ['git.push-pr-only'], reasons: ['Pushes to main'] },
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'warn', rules: ['git.no-verify'] },
  { at: 1, kind: 'freeze', tool: 'Write', verdict: 'deny' },
  { at: 1, kind: 'mode', tool: 'Edit', verdict: 'deny', mode: 'chat', what: 'x' },
  { at: 1, kind: 'quota', tool: 'Agent', verdict: 'deny' },
  { at: 1, kind: 'quota', level: 'wrapUp', reasons: [] },
  { at: 1, kind: 'quota', level: 'stop', reasons: [] },
  { at: 1, kind: 'modeDisagree', mode: 'plan', programs: ['x'] },
  { at: 1, kind: 'invisible', tool: 'WebFetch', removed: 3 },
  { at: 1, kind: 'startCap', before: 9000, after: 6000 },
  { at: 1, kind: 'notes', count: 2, chars: 300 },
  { at: 1, kind: 'hint', hint: 'Read' },
  { at: 1, kind: 'keyword', keyword: 'continue', project: 'app' },
  { at: 1, kind: 'reading', five: 21, week: 27 },
  { at: 1, kind: 'resume', project: 'app' },
  { at: 1, kind: 'skill', skill: 'mode-code:verify' },
  { at: 1, kind: 'mcpChanged', tools: ['db__query'] },
  { at: 1, kind: 'packs', on: ['flutter'], by: 'auto' },
  { at: 1, kind: 'packs', on: ['firebase'], by: 'claude' },
  { at: 1, kind: 'pack', pack: 'flutter', via: 'tool' },
  { at: 1, kind: 'memory', action: 'sync', trigger: 'start', commit: 'none', pull: 'ok', push: 'none', held: 0, conflicts: 0, pulled: 2 },
  { at: 1, kind: 'memory', action: 'sync', trigger: 'start', commit: 'none', pull: 'conflict', push: 'none', held: 0, conflicts: 1, pulled: 0 },
  { at: 1, kind: 'sync', trigger: 'start', written: 3, error: false },
  { at: 1, kind: 'sync', trigger: 'start', written: 0, error: true },
  { at: 1, kind: 'handoff', trigger: 'end', project: 'app' },
  { at: 1, kind: 'center', via: 'wt', ok: true },
  { at: 1, kind: 'center', via: null, ok: false },
  { at: 1, kind: 'agents', action: 'set', mode: 'free', n: 3 },
  { at: 1, kind: 'agents', action: 'deny', why: 'over', type: 'general-purpose', n: 3 },
  { at: 1, kind: 'agents', action: 'stop', stopped: 2, failed: 0 },
  { at: 1, kind: 'agents', action: 'batchDone', started: 3, of: 3 },
  { at: 1, kind: 'agents', action: 'assign', row: 1, of: 3 },
  { at: 1, kind: 'close', via: 'strip', busy: false, tab: true },
  { at: 1, kind: 'conflict', sessions: ['a', 'b'] },
  { at: 1, kind: 'flow', action: 'pause', flow: 'f1', step: 'approve', status: 'waiting' },
  { at: 1, kind: 'flow', action: 'done', flow: 'f1', step: 'code', status: 'done' },
  { at: 1, kind: 'flow', action: 'refused', flow: 'f1', step: 'plan', status: 'active' },
  { at: 1, kind: 'belt', tool: 'Bash', verdict: 'deny', left: true, rules: ['git.push-pr-only'], reasons: ['Pushes to main'] },
  { at: 1, kind: 'full', tool: 'AskUserQuestion' },
  { at: 1, kind: 'permission', tool: 'Bash', answer: 'parts' },
  { at: 1, kind: 'permission', tool: 'Edit', answer: 'auto' },
  { at: 1, kind: 'permission', tool: 'Edit', answer: 'left' },
  { at: 1, kind: 'manual', tool: 'Bash', what: ['commit', 'push'], answer: 'allow' },
  { at: 1, kind: 'manual', tool: 'Bash', what: ['push'], answer: 'block' },
  { at: 1, kind: 'flagged', category: 'cyber', model: 'Opus 5.5', via: 'refusal' },
  { at: 1, kind: 'flagged', category: null, model: null, via: 'error' },
  { at: 1, kind: 'net', tool: 'Bash', rule: 'git.clean', id: '20261020-210709-abc', what: 'git clean -fd' },
  { at: 1, kind: 'net', tool: 'Bash', id: '20261020-210709-abd', what: 'rm -rf x' },
];

test('a safety net reads as what was kept and how to put it back', () => {
  assert.equal(
    activityOf({ at: 1, kind: 'net', tool: 'Bash', rule: 'git.clean', id: '20261020-210709-abc', what: 'git clean -fd' }, 'en').text,
    'Kept first, so it can be undone: git clean -fd · mode-code net restore 20261020-210709-abc',
  );
});

test("Manual's question before a commit or a push reads as what you decided", () => {
  const said = (answer: string, lang: 'en' | 'tr') => activityOf({ at: 1, kind: 'manual', tool: 'Bash', what: ['commit', 'push'], answer }, lang).text;
  assert.equal(said('allow', 'en'), 'You approved the commit and push (Manual waits for you before one)');
  assert.equal(said('block', 'en'), 'The commit and push waited for you, and did not run');
  assert.equal(said('none', 'tr'), 'commit ve push seni bekledi ve çalışmadı');
});

test('each kind reads as a sentence in both languages: no key left, no blank, no unfilled place', () => {
  for (const kind of ACTIVITY_KINDS)
    assert.ok(
      SAMPLES.some((e) => e.kind === kind),
      `no sample of ${kind}`,
    );
  for (const lang of ['en', 'tr'] as const)
    for (const e of SAMPLES) {
      const l = activityOf(e, lang);
      for (const s of [l.text, l.why ?? '']) {
        assert.doesNotMatch(s, /\b(?:act|why|rulename|mode\.name|flow\.status|auto\.status|kw\.kind|agents\.mode)\.\w/, `${lang} ${e.kind}: ${s}`);
        assert.doesNotMatch(s, /\{\w+\}/, `${lang} ${e.kind}: ${s}`);
      }
      assert.ok(l.text.trim().length > 4);
    }
});

test('the class follows what happened: blocked, waits for you, done, a routine note', () => {
  const cls = (i: number) => activityOf(SAMPLES[i]!, 'en').cls;
  assert.deepEqual([cls(0), cls(1), cls(2), cls(3), cls(4)], ['blocked', 'waiting', 'done', 'blocked', 'note']);
  const belt = activityOf(SAMPLES[0]!, 'en');
  assert.equal(belt.address, 'protection/rules/git.clean');
  assert.match(belt.why!, /^safety belt rule: /);
  assert.equal(activityOf({ at: 1, kind: 'reading', five: 1, week: 2 }, 'en').quiet, true);
  assert.equal(activityOf({ at: 1, kind: 'packs', on: ['x'], by: 'auto' }, 'en').why, '"Automatic use" is on');
  assert.equal(activityOf({ at: 1, kind: 'brand-new' }, 'en').cls, 'note');
  assert.equal(activityOf({ at: 1, kind: 'brand-new' }, 'en').quiet, true);
  // A stopped answer: blocked, by whom, and what the classifier named when it named something.
  const flagged = activityOf({ at: 1, kind: 'flagged', category: 'cyber' }, 'tr');
  assert.equal(flagged.cls, 'blocked');
  assert.equal(flagged.text, "Anthropic'in güvenlik denetimi bir cevabı durdurdu (cyber)");
  assert.match(flagged.why!, /Mode_Code değil/);
  assert.equal(activityOf({ at: 1, kind: 'flagged', category: null }, 'en').text, "Anthropic's safeguards stopped an answer");
});

test('what waits for you comes first, then the newest; the routine work only when asked for', () => {
  const now = 10 * 3600_000;
  const events: ActivityEvent[] = [
    { at: now - 60_000, kind: 'belt', tool: 'Bash', verdict: 'deny', rules: ['git.clean'], reasons: ['x'] },
    { at: now - 3600_000, kind: 'conflict', sessions: ['a'] },
    { at: now - 30_000, kind: 'reading', five: 1, week: 2 },
    { at: now - 2 * 86_400_000, kind: 'conflict', sessions: ['b'] },
  ];
  const shown = activityLines(events, 'en', now);
  assert.deepEqual(
    shown.map((l) => [l.cls, l.at]),
    [
      ['waiting', now - 3600_000],
      ['blocked', now - 60_000],
      ['waiting', now - 2 * 86_400_000],
    ],
  );
  assert.equal(activityLines(events, 'en', now, { quiet: true }).length, 4);
  // A day old exactly is no longer first.
  const dayOld: ActivityEvent[] = [
    { at: now - 86_400_000, kind: 'conflict', sessions: ['c'] },
    { at: now - 1, kind: 'close' },
  ];
  assert.deepEqual(
    activityLines(dayOld, 'en', now).map((l) => l.cls),
    ['done', 'waiting'],
  );
  assert.match(activityText(shown[1]!, now, 'en'), /^1 min ago · Blocked Bash: x \(safety belt rule: .+\)$/);
});

test('every sample: its class, whether it is routine, where it is changed, and whether it says why', () => {
  // [class, routine, address, says why], in SAMPLES' order.
  const want: [string, boolean, string | null, boolean][] = [
    ['blocked', false, 'protection/rules/git.clean', true],
    ['waiting', false, 'protection/rules/git.push-pr-only', true],
    ['done', false, 'protection/rules/git.push-pr-only', true],
    ['blocked', false, 'protection/rules/git.push-pr-only', true],
    ['note', true, 'protection/rules/git.no-verify', true],
    ['blocked', false, null, true],
    ['blocked', false, null, true],
    ['blocked', false, 'quota/limits', true],
    ['waiting', false, 'quota/limits', true],
    ['waiting', false, 'quota/limits', true],
    ['note', true, null, false],
    ['note', false, null, false],
    ['note', true, null, false],
    ['note', true, null, false],
    ['note', true, null, false],
    ['done', false, 'work/keywords', false],
    ['note', true, 'quota/usage', false],
    ['done', false, 'quota/limits', true],
    ['done', false, 'claude-code/skills', false],
    ['waiting', false, 'claude-code/mcp', false],
    ['done', false, 'claude-code/packs', true],
    ['done', false, 'claude-code/packs', true],
    ['note', true, 'claude-code/packs', false],
    ['done', false, 'memory/store', false],
    ['blocked', false, 'memory/store', false],
    ['done', true, 'memory/sync', false],
    ['blocked', false, 'memory/sync', false],
    ['done', false, 'memory/handoffs', true],
    ['done', true, null, false],
    ['blocked', false, null, false],
    ['done', false, 'work/agents', true],
    ['blocked', false, 'work/agents', true],
    ['done', false, 'work/agents', false],
    ['done', false, 'work/agents', true],
    ['note', true, 'work/agents', true],
    ['done', false, null, false],
    ['waiting', false, 'now', false],
    ['waiting', false, 'work/flows/f1', false],
    ['done', false, 'work/flows/f1', false],
    ['blocked', false, 'work/flows/f1', false],
    ['waiting', false, 'protection/rules/git.push-pr-only', true],
    ['note', true, 'work/modes', true],
    ['done', true, 'claude-code/permissions', true],
    ['done', true, 'work/modes', true],
    ['waiting', false, 'work/modes', true],
    ['done', false, 'work/modes', true],
    ['blocked', false, 'work/modes', true],
    ['blocked', false, null, true],
    ['blocked', false, null, true],
    ['done', false, 'protection/rules/git.clean', true],
    ['done', false, 'protection/events', false],
  ];
  assert.equal(want.length, SAMPLES.length);
  SAMPLES.forEach((e, i) => {
    const l = activityOf({ ...e, session: 's1' }, 'en');
    assert.deepEqual([l.cls, l.quiet, l.address, l.why !== null], want[i], `${i} ${e.kind}: ${l.text}`);
    assert.equal(l.session, 's1');
  });
  // The quota coming back under the budget, a memory sync that pushed, a sync that wrote nothing: done.
  assert.equal(activityOf({ at: 1, kind: 'quota', level: 'ok' }, 'en').cls, 'done');
  assert.equal(activityOf({ at: 1, kind: 'memory', commit: 'ok', pulled: 0 }, 'en').quiet, false);
  assert.equal(activityOf({ at: 1, kind: 'memory', commit: 'none', pulled: 0, pull: 'diverged' }, 'en').cls, 'blocked');
  assert.equal(activityOf({ at: 1, kind: 'memory', held: 1 }, 'en').cls, 'blocked');
  // A full-autonomy run an older version recorded reads as work of a kind this version does not name.
  assert.deepEqual((({ cls, text }) => [cls, text])(activityOf({ at: 1, kind: 'run', action: 'stuck', run: 'r2', status: 'stuck' }, 'en')), [
    'note',
    'Work of a kind this version does not name: run',
  ]);
});

test('the fields read as words whatever their type: none, a number, a string where a number goes', () => {
  assert.equal(activityOf({ at: 1, kind: 'freeze' }, 'en').text, 'A write outside the frozen folder was stopped (?)');
  assert.equal(activityOf({ at: 1, kind: 'hint', hint: 5 }, 'en').text, 'A hint went to Claude: 5');
  assert.equal(activityOf({ at: 1, kind: 'hint', hint: null }, 'en').text, 'A hint went to Claude: ');
  assert.equal(activityOf({ at: 1, kind: 'invisible', tool: 'X', removed: '3' }, 'en').text, 'Hidden characters taken out of what X brought in: 0');
  assert.equal(activityOf({ at: 1, kind: 'invisible', tool: 'X', removed: Number.NaN }, 'en').text, 'Hidden characters taken out of what X brought in: 0');
  assert.equal(activityOf({ at: 1, kind: 'handoff', project: '' }, 'en').text, 'Handoff note written for ?');
  assert.equal(activityOf({ at: 1, kind: 'packs', on: 'flutter', by: 'auto' }, 'en').text, 'Tool packs turned on for this project: ');
  assert.equal(activityOf({ at: 1, kind: 'close' }, 'en').session, null);
});

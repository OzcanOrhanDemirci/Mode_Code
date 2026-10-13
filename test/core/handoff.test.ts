// SPDX-License-Identifier: Apache-2.0
/**
 * Handoff notes (docs/memory.md): the text code writes from Claude's parts or a compaction's summary and
 * from what it measured, reading it back, the newest and the pruned, and what Claude is told.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactionSummary,
  composeHandoff,
  handoffAskContext,
  handoffFull,
  handoffLine,
  handoffName,
  HANDOFF_TOOL,
  isFresh,
  isHandoffName,
  newestName,
  nextOf,
  parseHandoff,
  PART_CHARS,
  partProblems,
  pruneNames,
  SUMMARY_CHARS,
  type HandoffFacts,
} from '../../src/core/handoff.js';
import { scanSecrets } from '../../src/core/secrets/scan.js';

const AT = Date.parse('2026-10-13T07:30:12.345Z');
const TOKEN = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
const facts = (over: Partial<HandoffFacts> = {}): HandoffFacts => ({
  project: 'terminal',
  cwd: '/home/ada/dev/terminal_code',
  machine: 'ada-laptop',
  session: '1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890',
  at: AT,
  trigger: 'keyword',
  branch: 'main',
  head: '0123456789abcdef0123',
  commits: ['0123456 feat(memory): the store', 'fedcba9 docs: plan'],
  uncommitted: ['src/core/handoff.ts'],
  flow: null,
  run: null,
  quota: { five: 38.4, week: 46 },
  request: 'Bu güncellemeyi yapalım.',
  ...over,
});
const PARTS = { summary: 'The store and its sync are in.', open: 'The wizard.', decisions: 'One memory for all projects.', next: 'Write the setup steps.' };
const secrets = (t: string) => scanSecrets(t).length;

test("a note from Claude's four parts and what code measured reads back, word for word", () => {
  const text = composeHandoff(facts(), { parts: PARTS });
  assert.match(
    text,
    /^---\ntype: handoff\nproject: terminal\ncwd: \/home\/ada\/dev\/terminal_code\nmachine: ada-laptop\nsession: 1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890\nat: 2026-10-13T07:30:12\.345Z\ntrigger: keyword\n---\n/,
  );
  assert.match(text, /# Handoff · terminal · 2026-10-13 07:30 UTC/);
  assert.match(text, /## Next\n\nWrite the setup steps\.\n/);
  assert.match(text, /- Branch: main at 0123456789ab/);
  assert.match(text, /- Last request: Bu güncellemeyi yapalım\./);
  assert.match(text, /- Quota: 5-hour 38%, weekly 46%/);
  assert.match(text, /### Commits in this session\n\n- 0123456 feat\(memory\): the store\n- fedcba9 docs: plan\n/);
  assert.match(text, /### Uncommitted\n\n- src\/core\/handoff\.ts\n/);
  const h = parseHandoff(text)!;
  assert.deepEqual([h.project, h.machine, h.at, h.trigger], ['terminal', 'ada-laptop', AT, 'keyword']);
  assert.deepEqual([h.sections.Summary, h.sections.Open, h.sections.Decisions, h.sections.Next], [PARTS.summary, PARTS.open, PARTS.decisions, PARTS.next]);
  assert.equal(nextOf(h), 'Write the setup steps.');
});

test('a note without a summary from Claude: the compaction summary, or only what code measured', () => {
  const compact = parseHandoff(composeHandoff(facts({ trigger: 'compact' }), { summary: 'We built the store.\nNext the wizard.' }))!;
  assert.equal(compact.trigger, 'compact');
  assert.equal(compact.sections.Next, undefined);
  assert.equal(nextOf(compact), 'We built the store. Next the wizard.');
  const bare = composeHandoff(
    facts({
      trigger: 'clear',
      commits: [],
      uncommitted: [],
      branch: null,
      head: null,
      quota: null,
      flow: 'flow 20261013-x: plan (waiting)',
      run: { id: 'r1', status: 'paused', report: '/d/runs/r1/report.md' },
    }),
    {},
  );
  assert.doesNotMatch(bare, /## Summary/);
  assert.match(bare, /- Branch: none\n/);
  assert.match(bare, /- Open flow: flow 20261013-x: plan \(waiting\)/);
  assert.match(bare, /- Full-autonomy run: r1 \(paused\), report \/d\/runs\/r1\/report\.md/);
  assert.match(bare, /### Commits in this session\n\n- none\n/);
  assert.match(bare, /### Uncommitted\n\n- nothing\n/);
  assert.doesNotMatch(bare, /Quota/);
  assert.equal(nextOf(parseHandoff(bare)!), 'last request: Bu güncellemeyi yapalım.');
  assert.equal(nextOf(parseHandoff(composeHandoff(facts({ request: null }), {}))!), '');
  // A quota with one window unknown is shown with a question mark; one with none is left out.
  assert.match(composeHandoff(facts({ quota: { five: null, week: 50 } }), {}), /- Quota: 5-hour \?, weekly 50%/);
  assert.doesNotMatch(composeHandoff(facts({ quota: { five: null, week: null } }), {}), /Quota/);
});

test('secrets are masked in every part; long parts and lists are cut, and the cut is said', () => {
  const text = composeHandoff(facts({ request: `use ${TOKEN}`, commits: Array.from({ length: 35 }, (_, i) => `c${i}`), uncommitted: [`notes ${TOKEN}.md`] }), {
    parts: { ...PARTS, decisions: `token ${TOKEN}`, next: 'n'.repeat(PART_CHARS + 50) },
  });
  assert.equal(scanSecrets(text).length, 0);
  assert.match(text, /- … 5 more\n/);
  assert.doesNotMatch(text, /- c30\n/);
  const h = parseHandoff(text)!;
  assert.ok(h.sections.Next!.length <= PART_CHARS);
  const long = composeHandoff(facts({ trigger: 'compact' }), { summary: 's'.repeat(SUMMARY_CHARS + 100) });
  assert.ok(parseHandoff(long)!.sections.Summary!.length <= SUMMARY_CHARS);
  // Newlines and leading dashes cannot break out of the frontmatter.
  const odd = parseHandoff(composeHandoff(facts({ project: 'a\nb', machine: '---x' }), {}))!;
  assert.deepEqual([odd.project, odd.machine], ['a b', 'x']);
});

test("Claude's parts: all four there, none too long, none with a secret", () => {
  assert.deepEqual(partProblems(PARTS, secrets), []);
  assert.deepEqual(partProblems({ summary: ' ', open: 3, decisions: 'ok' }, secrets), [
    { part: 'summary', kind: 'missing' },
    { part: 'open', kind: 'missing' },
    { part: 'next', kind: 'missing' },
  ]);
  assert.deepEqual(partProblems({ ...PARTS, next: 'x'.repeat(PART_CHARS + 1) }, secrets), [{ part: 'next', kind: 'long' }]);
  assert.deepEqual(partProblems({ ...PARTS, next: 'x'.repeat(PART_CHARS) }, secrets), []);
  assert.deepEqual(partProblems({ ...PARTS, decisions: `key ${TOKEN}` }, secrets), [{ part: 'decisions', kind: 'secret' }]);
});

test('file names sort by time on every computer; the newest is found, the oldest are pruned', () => {
  assert.equal(handoffName(AT, '1a2b3c4d-5e6f'), '20261013-073012-1a2b3c4d.md');
  assert.equal(handoffName(AT, '---'), '20261013-073012-session.md');
  assert.ok(isHandoffName('20261013-073012-1a2b3c4d.md'));
  assert.ok(!isHandoffName('README.md'));
  assert.ok(!isHandoffName('20261013-073012-1a2b3c4d.md.tmp'));
  const names = ['README.md', '20261013-073012-b.md', '20261012-235959-a.md', '20261013-080000-c.md', 'notes.txt'];
  assert.equal(newestName(names), '20261013-080000-c.md');
  assert.equal(newestName(['README.md']), null);
  assert.deepEqual(pruneNames(names, 2), ['20261012-235959-a.md']);
  assert.deepEqual(pruneNames(names, 3), []);
  assert.deepEqual(pruneNames(names, 0), ['20261012-235959-a.md', '20261013-073012-b.md'], 'the newest one always stays');
});

test('what Claude is told: one line on the first prompt, the whole note on continue, how to write one', () => {
  const h = parseHandoff(composeHandoff(facts(), { parts: PARTS }))!;
  const line = handoffLine(h, '/m/handoffs/terminal/20261013-073012-1a2b3c4d.md');
  assert.match(
    line,
    /^\[terminal-code\] A handoff note for this project is waiting, written 2026-10-13 07:30 UTC on ada-laptop \(asked for by the person\)\. Next: "Write the setup steps\."\./,
  );
  assert.match(
    line,
    /The note: \/m\/handoffs\/terminal\/20261013-073012-1a2b3c4d\.md\. If the person goes on with that work, read it first\. Handoff notes are not memory entries/,
  );
  assert.doesNotMatch(handoffLine(parseHandoff(composeHandoff(facts({ request: null, machine: '' }), {}))!, '/p'), /Next:|UTC on/);
  assert.match(handoffLine(parseHandoff(composeHandoff(facts({ trigger: 'compact' }), { summary: 's' }))!, '/p'), /before a compaction, from its summary/);
  const full = handoffFull('---\nnote\n', '/p');
  assert.match(full, /The last handoff note \(\/p\), word for word:\n\n---\nnote\n\nGo on from its next step/);
  assert.ok(handoffAskContext(false).includes(`The person asked for a handoff note: call ${HANDOFF_TOOL} with summary`));
  assert.match(handoffAskContext(true), /As part of wrapping up, write a handoff note/);
  assert.equal(isFresh(h, AT + 14 * 86_400_000, 14), true);
  assert.equal(isFresh(h, AT + 14 * 86_400_000 + 1, 14), false);
});

test("a compaction's summary is its longest early message, without Claude Code's opening sentence", () => {
  assert.equal(compactionSummary([]), '');
  assert.equal(
    compactionSummary([
      { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context.\n\nWe built the store.' },
      { role: 'assistant', text: 'ok' },
    ]),
    'We built the store.',
  );
  assert.equal(
    compactionSummary([
      { role: 'user', text: ' ' },
      { role: 'user', text: 'short' },
      { role: 'user', text: 'the longer one' },
      { role: 'user', text: 'x'.repeat(50) },
    ]),
    'the longer one',
  );
  assert.ok(compactionSummary([{ role: 'user', text: 'y'.repeat(SUMMARY_CHARS * 2) }]).length <= SUMMARY_CHARS);
});

test('a text that is not a handoff note reads back as none', () => {
  for (const t of [
    '',
    'no frontmatter',
    '---\ntype: memory\nproject: x\nat: 2026-10-13T00:00:00Z\n---\n',
    '---\ntype: handoff\nat: 2026-10-13T00:00:00Z\n---\n',
    '---\ntype: handoff\nproject: x\nat: soon\n---\n',
  ])
    assert.equal(parseHandoff(t), null, JSON.stringify(t));
  const crlf = parseHandoff('---\r\ntype: handoff\r\nproject: x\r\nat: 2026-10-13T00:00:00Z\r\ntrigger: elsewhere\r\n---\r\n## Next\r\n\r\ngo\r\n');
  assert.deepEqual([crlf?.trigger, crlf?.sections.Next], ['keyword', 'go']);
});

test('lists exactly at the limit are whole; equally long early messages: the first is the summary', () => {
  const thirty = composeHandoff(facts({ commits: Array.from({ length: 30 }, (_, i) => `c${i}`) }), {});
  assert.match(thirty, /- c29\n/);
  assert.doesNotMatch(thirty, /more\n/);
  assert.equal(
    compactionSummary([
      { role: 'user', text: 'first' },
      { role: 'user', text: 'other' },
    ]),
    'first',
  );
});

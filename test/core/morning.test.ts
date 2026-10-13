// SPDX-License-Identifier: Apache-2.0
/**
 * The morning report and the notes of full-autonomy runs (docs/memory.md): when a report is due, its lines
 * and its summary line in both languages, and the decisions on notes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awayLong,
  morningLines,
  morningSummary,
  nextActivity,
  notesContext,
  parseActivity,
  parseNoteDecisions,
  pendingNotes,
  toDeliver,
  type MorningFacts,
} from '../../src/core/morning.js';

const NOW = Date.parse('2026-10-14T07:00:00Z');
const empty = (): MorningFacts => ({
  since: NOW - 10 * 3_600_000,
  now: NOW,
  runs: [],
  flows: [],
  sessions: [],
  handoffs: [],
  belt: null,
  quota: null,
  memory: null,
  notes: 0,
});

test('a report is due after a gap of the configured hours since the last prompt, never on first use', () => {
  assert.equal(awayLong(null, NOW, 6), false);
  assert.equal(awayLong(NOW - 6 * 3_600_000, NOW, 6), true);
  assert.equal(awayLong(NOW - 6 * 3_600_000 + 1, NOW, 6), false);
});

test('nothing worth saying: no lines, no summary', () => {
  assert.deepEqual(morningLines(empty(), 'en'), []);
  assert.equal(morningSummary(empty(), 'en'), null);
  assert.equal(
    morningSummary({ ...empty(), memory: { place: 'local', ahead: 3, conflicts: [], held: [], error: null } }, 'en'),
    null,
    'a local store has nowhere to send to',
  );
});

test('everything that happened, in the order it matters, with one summary line', () => {
  const f: MorningFacts = {
    ...empty(),
    runs: [
      { id: 'r1', task: 'Add rate limiting\nwith tests', status: 'done', reason: null, report: '/d/runs/r1/report.md', deferred: 2 },
      { id: 'r2', task: 'Port the parser', status: 'paused', reason: 'quota reached', report: null, deferred: 0 },
      { id: 'r3', task: 'Fix CI', status: 'stuck', reason: null, report: null, deferred: 0 },
    ],
    flows: [{ id: 'f1', title: 'Sign-in' }],
    sessions: [
      { project: 'terminal', count: 3 },
      { project: 'car', count: 1 },
    ],
    handoffs: [
      { project: 'terminal', at: NOW - 1000 },
      { project: 'terminal', at: NOW - 2000 },
      { project: 'car', at: NOW - 3000 },
    ],
    belt: { blocked: 2, asked: 1 },
    quota: { weekFrom: 41, weekTo: 47 },
    memory: { place: 'both', ahead: 2, conflicts: ['MEMORY.md'], held: ['token.md'], error: 'Could not resolve host: github.com' },
    notes: 1,
  };
  const lines = morningLines(f, 'en').map((l) => `${l.label}: ${l.text}`);
  assert.deepEqual(lines, [
    'Full autonomy: Add rate limiting · done · 2 step(s) wait for you · /d/runs/r1/report.md',
    'Full autonomy: Port the parser · paused: quota reached',
    'Full autonomy: Fix CI · stuck',
    'Flows: Sign-in: the plan waits for your approval',
    'Notes: 1 note file(s) from full-autonomy runs wait for your approval: terminal-code memory notes',
    'Memory: a pull needs you: MEMORY.md changed here and elsewhere',
    'Memory: held back, it looks like it holds a secret: token.md',
    'Memory: 2 change(s) wait to go up to GitHub',
    'Memory: the last sync failed: Could not resolve host: github.com',
    'Sessions: 4 session(s) · terminal (3) · car (1)',
    'Handoffs: terminal (2) · car (1)',
    'Safety belt: 2 blocked, 1 asked',
    'Quota: weekly 41% → 47%',
  ]);
  assert.equal(
    morningSummary(f, 'en'),
    '☀ While you were away: 1 run(s) done · 2 run(s) wait for you · 1 plan(s) wait for approval · 1 note file(s) wait for approval · the memory sync needs you · 3 handoff note(s). terminal-code morning',
  );
  assert.equal(
    morningSummary({ ...empty(), memory: { place: 'github', ahead: 2, conflicts: [], held: [], error: null } }, 'tr'),
    '☀ Sen yokken: 2 hafıza değişikliği gönderilmeyi bekliyor. terminal-code morning',
  );
  assert.ok(morningLines(f, 'tr').some((l) => l.text === 'Port the parser · duraklatıldı: quota reached'));
  // A belt that did nothing and a quota never read stay out.
  assert.deepEqual(morningLines({ ...empty(), belt: { blocked: 0, asked: 0 }, quota: { weekFrom: null, weekTo: null } }, 'en'), []);
});

test('notes from runs: pending until decided, delivered once after approval; a broken file decides nothing', () => {
  const runs = [
    { id: 'a', open: false, hasNotes: true },
    { id: 'b', open: true, hasNotes: true },
    { id: 'c', open: false, hasNotes: false },
    { id: 'd', open: false, hasNotes: true },
  ];
  const d = parseNoteDecisions(
    JSON.stringify({ d: { decision: 'approved', at: 1, delivered: null }, x: { decision: 'maybe', at: 1 }, y: 'no', z: { decision: 'discarded' } }),
  );
  assert.deepEqual(d, { d: { decision: 'approved', at: 1, delivered: null } });
  assert.deepEqual(pendingNotes(runs, d), ['a']);
  assert.deepEqual(toDeliver(d), ['d']);
  assert.deepEqual(toDeliver({ ...d, d: { decision: 'approved', at: 1, delivered: 5 } }), []);
  assert.deepEqual(toDeliver({ e: { decision: 'discarded', at: 1, delivered: null } }), []);
  for (const t of [null, '', 'not json', '[1]', 'null']) assert.deepEqual(parseNoteDecisions(t), {});
  assert.match(
    notesContext([{ id: 'd', path: '/runs/d/notes.md' }]),
    /approved notes that full-autonomy runs left for the memory: \/runs\/d\/notes\.md \(run d\)\. Read them and merge/,
  );
});

test('the activity record: the last prompt, and the last gap long enough for a morning report', () => {
  assert.deepEqual(parseActivity(null), { lastPromptAt: null, away: null });
  assert.deepEqual(parseActivity('not json'), { lastPromptAt: null, away: null });
  assert.deepEqual(parseActivity(JSON.stringify({ lastPromptAt: 5, away: { from: 1, to: 4 } })), { lastPromptAt: 5, away: { from: 1, to: 4 } });
  assert.deepEqual(
    parseActivity(JSON.stringify({ lastPromptAt: 'x', away: { from: 4, to: 1 } })),
    { lastPromptAt: null, away: null },
    'a window that ends before it starts is none',
  );
  assert.deepEqual(parseActivity(JSON.stringify({ away: { from: 1 } })), { lastPromptAt: null, away: null });
  const hour = 3_600_000;
  // The first prompt ever: no gap to speak of.
  assert.deepEqual(nextActivity({ lastPromptAt: null, away: null }, NOW, 6), { lastPromptAt: NOW, away: null });
  // A short gap keeps the old window; a long one replaces it.
  const old = { from: 1, to: 2 };
  assert.deepEqual(nextActivity({ lastPromptAt: NOW - hour, away: old }, NOW, 6), { lastPromptAt: NOW, away: old });
  assert.deepEqual(nextActivity({ lastPromptAt: NOW - 6 * hour, away: old }, NOW, 6), { lastPromptAt: NOW, away: { from: NOW - 6 * hour, to: NOW } });
});

test('the edges: a stuck run with a reason is stuck, one-sided belt counts, each memory problem alone, a local store sends nothing', () => {
  const run = (status: 'paused' | 'stuck' | 'done', reason: string | null = null) => ({ id: status, task: 't', status, reason, report: null, deferred: 0 });
  assert.deepEqual(
    morningLines({ ...empty(), runs: [run('stuck', 'why')] }, 'en').map((l) => l.text),
    ['t · stuck'],
  );
  assert.deepEqual(
    morningLines({ ...empty(), runs: [run('paused')] }, 'en').map((l) => l.text),
    ['t · paused'],
  );
  assert.equal(morningSummary({ ...empty(), runs: [run('stuck')] }, 'en'), '☀ While you were away: 1 run(s) wait for you. terminal-code morning');
  assert.equal(morningSummary({ ...empty(), runs: [run('paused')] }, 'en'), '☀ While you were away: 1 run(s) wait for you. terminal-code morning');
  assert.equal(morningSummary({ ...empty(), runs: [run('done')] }, 'en'), '☀ While you were away: 1 run(s) done. terminal-code morning');
  assert.deepEqual(
    morningLines({ ...empty(), belt: { blocked: 1, asked: 0 } }, 'en').map((l) => l.text),
    ['1 blocked, 0 asked'],
  );
  assert.deepEqual(
    morningLines({ ...empty(), belt: { blocked: 0, asked: 2 } }, 'en').map((l) => l.text),
    ['0 blocked, 2 asked'],
  );
  const mem = (over: object) => ({ ...empty(), memory: { place: 'both' as const, ahead: null, conflicts: [], held: [], error: null, ...over } });
  for (const over of [{ conflicts: ['a.md'] }, { held: ['b.md'] }, { error: 'down' }])
    assert.equal(morningSummary(mem(over), 'en'), '☀ While you were away: the memory sync needs you. terminal-code morning', JSON.stringify(over));
  assert.deepEqual(morningLines(mem({ place: 'local', ahead: 2 }), 'en'), []);
  assert.deepEqual(morningLines(mem({ ahead: 0 }), 'en'), []);
});

test('decisions: one broken entry does not lose the others; a delivered time is kept; only an object of decisions counts', () => {
  assert.deepEqual(parseNoteDecisions(JSON.stringify({ a: null, b: { decision: 'approved', at: 2, delivered: 5 } })), {
    b: { decision: 'approved', at: 2, delivered: 5 },
  });
  assert.deepEqual(parseNoteDecisions(JSON.stringify([{ decision: 'approved', at: 1 }])), {});
  assert.deepEqual(parseActivity(JSON.stringify({ lastPromptAt: 3, away: { from: 3, to: 3 } })), { lastPromptAt: 3, away: { from: 3, to: 3 } });
});

test("the other computers' news and the settings waiting from them (docs/sync.md)", () => {
  const f: MorningFacts = {
    ...empty(),
    elsewhere: [
      {
        machine: 'MacBook',
        runs: [
          { id: 'r1', task: 'Ship the release\nwith notes', status: 'done', reason: null, report: null, deferred: 0 },
          { id: 'r2', task: 'Port it', status: 'paused', reason: 'quota', report: null, deferred: 0 },
        ],
        flows: 1,
        sessions: 3,
        blocked: 2,
      },
      { machine: 'Laptop', runs: [], flows: 0, sessions: 1, blocked: 0 },
    ],
    syncPending: 2,
  };
  assert.deepEqual(morningLines(f, 'en'), [
    { label: 'Elsewhere', text: 'MacBook: 3 session(s) · Ship the release · done · Port it · paused: quota · 1 flow(s) wait · the belt stopped 2' },
    { label: 'Elsewhere', text: 'Laptop: 1 session(s)' },
    { label: 'Sync', text: '2 setting(s) from other computers wait for you (terminal-code sync)' },
  ]);
  // In the one line: only news that needs the person (a run or a flow), and what waits.
  assert.match(morningSummary(f, 'en') ?? '', /news from MacBook · 2 setting\(s\) wait/);
  assert.equal(morningSummary({ ...empty(), elsewhere: [{ machine: 'Laptop', runs: [], flows: 0, sessions: 4, blocked: 1 }] }, 'en'), null);
  assert.match(morningSummary({ ...empty(), elsewhere: [{ machine: 'Laptop', runs: [], flows: 2, sessions: 0, blocked: 0 }] }, 'en') ?? '', /news from Laptop/);
  assert.match(morningSummary({ ...empty(), syncPending: 1 }, 'en') ?? '', /1 setting\(s\) wait/);
});

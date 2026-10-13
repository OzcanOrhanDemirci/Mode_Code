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
  notesContext,
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

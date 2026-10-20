// SPDX-License-Identifier: Apache-2.0
/**
 * The morning report (docs/memory.md): when a report is due, its lines and its summary line in both languages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awayLong, morningLines, morningSummary, nextActivity, parseActivity, type MorningFacts } from '../../src/core/morning.js';

const NOW = Date.parse('2026-10-14T07:00:00Z');
const empty = (): MorningFacts => ({
  since: NOW - 10 * 3_600_000,
  now: NOW,
  flows: [],
  sessions: [],
  handoffs: [],
  belt: null,
  quota: null,
  memory: null,
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
    belt: { blocked: 2, asked: 1, left: 3 },
    quota: { weekFrom: 41, weekTo: 47 },
    memory: { place: 'both', ahead: 2, conflicts: ['MEMORY.md'], held: ['token.md'], error: 'Could not resolve host: github.com' },
  };
  const lines = morningLines(f, 'en').map((l) => `${l.label}: ${l.text}`);
  assert.deepEqual(lines, [
    'Flows: Sign-in: the plan waits for your approval',
    'Left to you: 3 step(s) full autonomy left to you, each with its command (the activity has them)',
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
    '☀ While you were away: 3 step(s) left to you · 1 plan(s) wait for approval · the memory sync needs you · 3 handoff note(s). mode-code morning',
  );
  assert.equal(
    morningSummary({ ...empty(), memory: { place: 'github', ahead: 2, conflicts: [], held: [], error: null } }, 'tr'),
    '☀ Sen yokken: 2 hafıza değişikliği gönderilmeyi bekliyor. mode-code morning',
  );
  assert.ok(morningLines(f, 'tr').some((l) => l.text === 'Tam otonomun komutuyla sana bıraktığı 3 adım (etkinlikte)'));
  // A belt that did nothing and a quota never read stay out.
  assert.deepEqual(morningLines({ ...empty(), belt: { blocked: 0, asked: 0, left: 0 }, quota: { weekFrom: null, weekTo: null } }, 'en'), []);
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

test('the edges: one-sided belt counts, steps left alone, each memory problem alone, a local store sends nothing', () => {
  assert.deepEqual(
    morningLines({ ...empty(), belt: { blocked: 1, asked: 0, left: 0 } }, 'en').map((l) => l.text),
    ['1 blocked, 0 asked'],
  );
  assert.deepEqual(
    morningLines({ ...empty(), belt: { blocked: 0, asked: 2, left: 0 } }, 'en').map((l) => l.text),
    ['0 blocked, 2 asked'],
  );
  assert.deepEqual(
    morningLines({ ...empty(), belt: { blocked: 0, asked: 0, left: 1 } }, 'en').map((l) => l.text),
    ['1 step(s) full autonomy left to you, each with its command (the activity has them)'],
  );
  assert.equal(
    morningSummary({ ...empty(), belt: { blocked: 0, asked: 0, left: 2 } }, 'en'),
    '☀ While you were away: 2 step(s) left to you. mode-code morning',
  );
  const mem = (over: object) => ({ ...empty(), memory: { place: 'both' as const, ahead: null, conflicts: [], held: [], error: null, ...over } });
  for (const over of [{ conflicts: ['a.md'] }, { held: ['b.md'] }, { error: 'down' }])
    assert.equal(morningSummary(mem(over), 'en'), '☀ While you were away: the memory sync needs you. mode-code morning', JSON.stringify(over));
  assert.deepEqual(morningLines(mem({ place: 'local', ahead: 2 }), 'en'), []);
  assert.deepEqual(morningLines(mem({ ahead: 0 }), 'en'), []);
});

test('a gap of no length is still the gap it says', () => {
  assert.deepEqual(parseActivity(JSON.stringify({ lastPromptAt: 3, away: { from: 3, to: 3 } })), { lastPromptAt: 3, away: { from: 3, to: 3 } });
});

test("the other computers' news and the settings waiting from them (docs/sync.md)", () => {
  const f: MorningFacts = {
    ...empty(),
    elsewhere: [
      {
        machine: 'MacBook',
        flows: 1,
        sessions: 3,
        blocked: 2,
      },
      { machine: 'Laptop', flows: 0, sessions: 1, blocked: 0 },
    ],
    syncPending: 2,
  };
  assert.deepEqual(morningLines(f, 'en'), [
    { label: 'Elsewhere', text: 'MacBook: 3 session(s) · 1 flow(s) wait · the belt stopped 2' },
    { label: 'Elsewhere', text: 'Laptop: 1 session(s)' },
    { label: 'Sync', text: '2 setting(s) from other computers wait for you (mode-code sync)' },
  ]);
  // In the one line: only news that needs the person (a flow), and what waits.
  assert.match(morningSummary(f, 'en') ?? '', /news from MacBook · 2 setting\(s\) wait/);
  assert.equal(morningSummary({ ...empty(), elsewhere: [{ machine: 'Laptop', flows: 0, sessions: 4, blocked: 1 }] }, 'en'), null);
  assert.match(morningSummary({ ...empty(), elsewhere: [{ machine: 'Laptop', flows: 2, sessions: 0, blocked: 0 }] }, 'en') ?? '', /news from Laptop/);
  assert.match(morningSummary({ ...empty(), syncPending: 1 }, 'en') ?? '', /1 setting\(s\) wait/);
});

test('a newer release the last check found is said in the report and its one line', () => {
  assert.deepEqual(morningLines({ ...empty(), update: '1.2.1' }, 'tr'), [{ label: 'Güncelleme', text: 'Mode_Code 1.2.1 çıktı (mode-code update)' }]);
  assert.match(morningSummary({ ...empty(), update: '1.2.1' }, 'en') ?? '', /Mode_Code 1\.2\.1 is out/);
  assert.equal(morningSummary({ ...empty(), update: null }, 'en'), null);
});

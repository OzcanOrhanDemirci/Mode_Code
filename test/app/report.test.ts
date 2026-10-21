// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportLines } from '../../src/app/report.js';
import type { ToolEvent } from '../../src/app/data.js';

const T = Date.parse('2026-10-12T09:00:00Z');
const ev = (min: number, e: Partial<ToolEvent>): ToolEvent => ({ v: 1, at: T - min * 60_000, kind: 'belt', source: 'mod', session: 's', ...e });

test('a report counts what the belt did, quota movement, stops and same-folder warnings in the period only', () => {
  const events = [
    ev(10, { verdict: 'deny', rules: ['git.clean'] }),
    ev(20, { verdict: 'ask', answer: 'allow', rules: ['git.clean'] }),
    ev(30, { verdict: 'ask', answer: 'block', rules: ['publish.package'] }),
    ev(40, { kind: 'reading', five: 30, week: 20 }),
    ev(5, { kind: 'reading', five: 60, week: 24 }),
    ev(15, { kind: 'quota', level: 'stop' }),
    ev(3, { kind: 'resume' }),
    ev(8, { kind: 'conflict' }),
    ev(3 * 24 * 60, { verdict: 'deny', rules: ['fs.disk'] }), // three days ago: outside a one-day report
  ];
  const r = buildReport(null, events, T - 86400_000, T);
  assert.equal(r.blocked, 1);
  assert.equal(r.asked, 2);
  assert.equal(r.allowedAfterAsk, 1);
  assert.deepEqual(r.topRules[0], { rule: 'git.clean', count: 2 });
  assert.deepEqual(r.quota, { weekFrom: 20, weekTo: 24, fiveMax: 60 });
  assert.equal(r.stops, 1);
  assert.equal(r.resumes, 1);
  assert.equal(r.conflicts, 1);
  const text = reportLines(r, 'en', 'C:/Users/u')
    .map((l) => `${l.label}: ${l.text}`)
    .join('\n');
  // The rules by the names the control center gives them.
  assert.match(text, /Safety belt: 1 blocked · 2 asked \(1 allowed\) · Delete untracked files \(2\), Publish a package \(1\)/);
  assert.match(text, /Quota: weekly 20% → 24% · 5-hour peak 60%/);
  assert.match(
    reportLines(r, 'tr', 'C:/Users/u')
      .map((l) => l.text)
      .join('\n'),
    /1 engel · 2 soru \(1 izin\)/,
  );
});

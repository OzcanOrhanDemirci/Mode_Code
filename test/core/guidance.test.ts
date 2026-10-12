// SPDX-License-Identifier: Apache-2.0
// What the model reads beside the person's prompt: one clear instruction per keyword and guard, tied to
// the person's own words, with the quota stated as measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictContext, footerInstruction, keywordContext, quotaLine, resumePrompt, stopContext, wrapUpContext } from '../../src/core/guidance.js';
import { detectKeyword, type KeywordMatch } from '../../src/core/keywords.js';
import { assessQuota, DEFAULT_BUDGET, type QuotaAssessment } from '../../src/core/quota.js';
import { newModState } from '../../src/core/session.js';

const NOW = Date.parse('2026-10-12T10:00:00Z');
const reading = (five: number, week: number) => ({
  measuredAt: NOW,
  source: 'mod' as const,
  windows: [
    { kind: 'five_hour', used: five, resetsAt: NOW + 3600_000 },
    { kind: 'seven_day', used: week, resetsAt: NOW + 86400_000 },
  ],
});
const q = (five = 30, week = 40): QuotaAssessment => assessQuota(reading(five, week), DEFAULT_BUDGET, NOW);
const state = newModState('s', 'dev', NOW);
const kw = (text: string, projects = [{ id: 'app', names: ['app'] }]): KeywordMatch => detectKeyword(text, projects)!;

test('the quota line: measured, stale or missing', () => {
  assert.match(quotaLine(q(30, 40)), /^Quota: 5-hour 30%, weekly 40% \(default weekly limit \d+%\)\.$/);
  assert.equal(quotaLine(assessQuota(null, DEFAULT_BUDGET, NOW)), 'No quota reading yet.');
  assert.match(quotaLine(assessQuota({ ...reading(30, 40), measuredAt: NOW - 3 * 86400_000 }, DEFAULT_BUDGET, NOW)), /stale|No quota/);
});

test('every keyword gets one instruction that quotes what the person typed', () => {
  const cases: [string, RegExp][] = [
    ['app devam', /Keyword "continue" for project "app": work autonomously/],
    ['manuel app devam', /Keyword "manual continue" for project "app": work step by step/],
    ['sohbet', /Keyword "chat": conversation only/],
    ['toparla', /Keyword "wrap up"/],
    ['dur', /Keyword "stop": stop now/],
    ['durum', /Keyword "status"/],
    ['yardım', /Keyword "help"/],
  ];
  for (const [text, re] of cases) {
    const lines = keywordContext(kw(text), state, q(), text.includes('app') ? 'app' : null);
    assert.equal(lines.length, 1, text);
    assert.match(lines[0]!, re, text);
    assert.match(lines[0]!, /^\[terminal-code\] The person's message is "/);
  }
  // At the end of a longer message the note says so.
  assert.match(keywordContext(kw('Şimdi bitti. app devam'), state, q(), 'app')[0]!, /message ends with "app devam"/);
});

test('an unknown project name: a near miss is suggested, anything else is looked up or asked about', () => {
  const near = keywordContext(kw('termnal devam', [{ id: 'terminal-code', names: ['terminal'] }]), state, q(), null)[0]!;
  assert.match(near, /"termnal", which is not a registered project; they probably meant "terminal-code"/);
  const other = keywordContext(kw('zebra devam', []), state, q(), null)[0]!;
  assert.match(other, /"zebra" is not a registered project/);
});

test('a quota keyword: the budget when there is a reading, one line saying why not when there is none', () => {
  const k = kw('kota +5');
  assert.match(keywordContext(k, { ...state, weeklyTarget: 45 }, q(), null)[0]!, /weekly budget set to 45% \(accepted 44…46\)/);
  assert.match(keywordContext(k, state, q(), null)[0]!, /no weekly reading yet/);
});

test('the guards: wrap up, stop with or without a resume time, another session in the folder', () => {
  assert.match(wrapUpContext(q(96)), /Wrap up now/);
  assert.match(stopContext(q(99.5), NOW + 3600_000), /resumes by itself after 2026-10-12T11:00:00\.000Z/);
  assert.doesNotMatch(stopContext(q(99.5), null), /resumes/);
  assert.match(conflictContext(1), /Another Claude Code session is working/);
  assert.match(conflictContext(3), /3 other Claude Code sessions are working/);
});

test('the checked footer: the exact labels in the person language, the memory line only with a memory folder', () => {
  const en = footerInstruction('en', { memory: true, showFiveFrom: 70, showWeekFrom: 85 });
  assert.match(en, /"Memory pushed: Yes" or "Memory pushed: No"/);
  assert.match(en, /at least 70/);
  const tr = footerInstruction('tr', { memory: false, showFiveFrom: 70, showWeekFrom: 85 });
  assert.match(tr, /"İşlem Yapıldı: Evet" or "İşlem Yapıldı: Hayır"/);
  assert.doesNotMatch(tr, /Hafıza İtildi/);
});

test('the resume prompt ends with the continue keyword, which the keyword layer reads as continue again', () => {
  for (const lang of ['en', 'tr'] as const)
    for (const project of ['app', null]) {
      const text = resumePrompt(project, lang);
      const k = detectKeyword(text, [{ id: 'app', names: ['app'] }]);
      assert.equal(k?.kind, 'continue', `${lang} ${project}`);
      assert.equal(k?.project ?? null, project ? 'app' : null);
    }
});

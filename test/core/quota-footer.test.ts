// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits, fromStatusLine, weeklyTargetFrom } from '../../src/core/quota.js';
import { buildFooter, checkFooter, classifyTurn, type ClassifyEnv } from '../../src/core/footer.js';

const NOW = Date.parse('2026-10-12T01:00:00Z');
const reading = (five: number, week: number, minutesOld = 0) =>
  fromModRateLimits(
    [
      { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T02:50:00Z' },
      { kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-18T06:00:00Z' },
    ],
    NOW - minutesOld * 60000,
  );

test('quota levels: 5-hour wrap up at 95 and stop at 99, weekly default 97/99', () => {
  assert.equal(assessQuota(reading(50, 50), DEFAULT_BUDGET, NOW).level, 'ok');
  assert.equal(assessQuota(reading(95, 50), DEFAULT_BUDGET, NOW).level, 'wrapUp');
  assert.equal(assessQuota(reading(99, 50), DEFAULT_BUDGET, NOW).level, 'stop');
  assert.equal(assessQuota(reading(10, 97), DEFAULT_BUDGET, NOW).level, 'wrapUp');
  assert.equal(assessQuota(reading(10, 99), DEFAULT_BUDGET, NOW).level, 'stop');
  assert.equal(assessQuota(reading(99, 50), DEFAULT_BUDGET, NOW).resumeAt, Date.parse('2026-10-12T02:50:00Z'));
});

test('an explicit weekly target accepts N-1 … N+1', () => {
  const b = { ...DEFAULT_BUDGET, weeklyTarget: 40 };
  assert.equal(assessQuota(reading(10, 38), b, NOW).level, 'ok');
  assert.equal(assessQuota(reading(10, 39), b, NOW).level, 'wrapUp');
  assert.equal(assessQuota(reading(10, 41), b, NOW).level, 'stop');
});

test('a stale or missing reading never blocks', () => {
  const a = assessQuota(reading(99, 99, 400), DEFAULT_BUDGET, NOW);
  assert.equal(a.stale, true);
  assert.equal(a.level, 'ok');
  assert.equal(assessQuota(null, DEFAULT_BUDGET, NOW).usable, false);
});

test('a window whose reset passed counts as empty', () => {
  const r = fromModRateLimits([{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-10-12T00:30:00Z' }], NOW);
  assert.equal(assessQuota(r, DEFAULT_BUDGET, NOW).level, 'ok');
});

test('status line readings and kota +N', () => {
  const r = fromStatusLine({ five_hour: { used_percentage: 12, resets_at: 1791774000 }, seven_day: { used_percentage: 23.4, resets_at: 1792303200 } }, NOW);
  assert.equal(r?.windows.length, 2);
  assert.equal(weeklyTargetFrom({ n: 8, plus: true }, r, NOW), 31);
  assert.equal(weeklyTargetFrom({ n: 40, plus: false }, null, NOW), 40);
  assert.equal(weeklyTargetFrom({ n: 8, plus: true }, null, NOW), null);
});

const env: ClassifyEnv = {
  platform: 'win32',
  home: 'C:/Users/ada',
  cwd: 'C:/dev/app',
  memoryRoots: ['C:/dev/mem'],
  ignore: ['C:/Users/ada/AppData/Local/Temp'],
};

test('classifyTurn counts distinct files, memory, git and changing commands', () => {
  const acts = classifyTurn(
    [
      { name: 'Edit', input: { file_path: 'C:/dev/app/a.ts' } },
      { name: 'Edit', input: { file_path: 'C:\\dev\\app\\a.ts' } },
      { name: 'Write', input: { file_path: 'C:/dev/mem/note.md' } },
      { name: 'Write', input: { file_path: 'C:/Users/ada/AppData/Local/Temp/x.txt' } },
      { name: 'Bash', input: { command: 'git commit -m x && git push' } },
      { name: 'Bash', input: { command: 'ls -la && cat a.ts 2>/dev/null' } },
      { name: 'Bash', input: { command: 'npm install' } },
      { name: 'Read', input: { file_path: 'C:/dev/app/a.ts' } },
    ],
    env,
  );
  assert.deepEqual(acts, { files: 1, memoryFiles: 1, settings: 0, git: 1, shell: 1, external: 0 });
});

test('the footer reads like the working rules ask, in Turkish', () => {
  const f = buildFooter(
    {
      memory: { state: 'pushed' },
      acts: { files: 2, memoryFiles: 0, settings: 0, git: 1, shell: 0, external: 0 },
      five: 72,
      week: 23,
      weeklyTarget: null,
      showFiveFrom: 70,
      showWeekFrom: 85,
    },
    'tr',
  );
  assert.deepEqual(f.lines, ['Hafıza İtildi: Evet', 'İşlem Yapıldı: Evet (2 dosya yazıldı, git commit/push)', '5 Saatlik Kota: 72']);
  const none = buildFooter(
    {
      memory: { state: 'unchanged' },
      acts: { files: 0, memoryFiles: 0, settings: 0, git: 0, shell: 0, external: 0 },
      five: 10,
      week: 30,
      weeklyTarget: 39,
      showFiveFrom: 70,
      showWeekFrom: 85,
    },
    'tr',
  );
  assert.deepEqual(none.lines, ['Hafıza İtildi: Hayır (hafıza değişmedi)', 'İşlem Yapıldı: Hayır', 'Haftalık Kota: 30/39']);
  const noGit = buildFooter(
    {
      memory: { state: null },
      acts: { files: 0, memoryFiles: 0, settings: 0, git: 0, shell: 0, external: 0 },
      five: null,
      week: null,
      weeklyTarget: null,
      showFiveFrom: 70,
      showWeekFrom: 85,
    },
    'en',
  );
  assert.deepEqual(noGit.lines, ['Changes made: No']);
});

test('checkFooter accepts right lines and names wrong ones', () => {
  const f = buildFooter(
    {
      memory: { state: 'pushed' },
      acts: { files: 1, memoryFiles: 0, settings: 0, git: 0, shell: 0, external: 0 },
      five: 80,
      week: 30,
      weeklyTarget: 39,
      showFiveFrom: 70,
      showWeekFrom: 85,
    },
    'tr',
  );
  const good = 'Özet.\n\n**Hafıza İtildi: Evet**\n\nİşlem Yapıldı: Evet (1 dosya yazıldı)\n\n5 Saatlik Kota: 81\n\nHaftalık Kota: 30/39';
  assert.deepEqual(checkFooter(f.expect, good, 'tr'), []);
  const bad = 'Özet.\n\nHafıza İtildi: Hayır\n\nİşlem Yapıldı: Hayır\n\nHaftalık Kota: 30';
  const problems = checkFooter(f.expect, bad, 'tr');
  assert.equal(problems.length, 4);
});

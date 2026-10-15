// SPDX-License-Identifier: Apache-2.0
// What the model reads beside the person's prompt: one clear instruction per keyword and guard, tied to
// the person's own words, with the quota stated as measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conflictContext,
  continueFolderContext,
  flowNote,
  flowResumeContext,
  flowStartContext,
  flowTurnContext,
  footerInstruction,
  keywordContext,
  quotaLine,
  restoredContext,
  resumePrompt,
  stepGuidance,
  stepsLine,
  stopContext,
  wrapUpContext,
} from '../../src/core/guidance.js';
import { startFlow } from '../../src/core/flow.js';
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
    ['app devam', /Keyword "continue" for project "app": pick the work up where it stopped\. Quota/],
    ['manuel app devam', /Keyword "manual continue" for project "app": pick the work up where it stopped\. Way of working, manual: work step by step/],
    ['sohbet', /Keyword "chat": chat mode: conversation only/],
    ['araştırma', /Keyword "research": research mode: read, search the web/],
    ['plan', /Keyword "plan": plan mode: read and plan/],
    ['kod', /Keyword "code": code mode: develop, test and commit/],
    ['serbest', /Keyword "free": free mode/],
    ['toparla', /Keyword "wrap up"/],
    ['dur', /Keyword "stop": stop now/],
    ['durum', /Keyword "status"/],
    ['yardım', /Keyword "help"/],
  ];
  for (const [text, re] of cases) {
    const lines = keywordContext(kw(text), state, q(), text.includes('app') ? 'app' : null);
    assert.equal(lines.length, 1, text);
    assert.match(lines[0]!, re, text);
    assert.match(lines[0]!, /^\[Mode_Code\] The person's message is "/);
  }
  // At the end of a longer message the note says so.
  assert.match(keywordContext(kw('Şimdi bitti. app devam'), state, q(), 'app')[0]!, /message ends with "app devam"/);
});

test('an unknown project name: a near miss is suggested, anything else is looked up or asked about', () => {
  const near = keywordContext(kw('termnal devam', [{ id: 'mode-code', names: ['terminal'] }]), state, q(), null)[0]!;
  assert.match(near, /"termnal", which is not a registered project; they probably meant "mode-code"/);
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

test('a mode keyword while a flow runs pauses the flow at its step; the work folder is named', () => {
  const paused = keywordContext(kw('araştırma'), state, q(), null, { flow: { step: '📐 plan', paused: true }, workDir: '/tmp/tc/flows' })[0]!;
  assert.match(paused, /switched to research mode: .*work folder \(\/tmp\/tc\/flows\).* The flow is paused at its 📐 plan step/);
  assert.deepEqual(keywordContext(kw('akış'), state, q(), null), []);
  assert.deepEqual(keywordContext(kw('onay'), state, q(), null), []);
});

test("flow guidance: the steps on one line, the rules, and the current step in the person's language", () => {
  const f = startFlow({ id: 'f1', variant: 'full', task: 'Add sign-in', project: null, cwd: '/a', sessionId: 's', workDir: '/tmp/w', now: NOW });
  const t = { copyDir: '/home/ada/.mode-code/flows/f1', nativePlan: false, approveWord: 'onay' };
  assert.equal(stepsLine(f, 'en'), '[🔍 research] ▶ 📐 plan → ⏸ approval → 🔨 code');
  const s = flowStartContext(f, 'en', t);
  assert.match(s, /started a flow: \[🔍 research\] ▶ 📐 plan → ⏸ approval → 🔨 code\. Task, in the person's words: "Add sign-in"\./);
  assert.match(s, /none is skipped.*mcp__mode-code__flow_step/);
  assert.match(s, /write the report to \/tmp\/w\/f1\/research\.md/);
  assert.match(s, /## Findings/);
  assert.match(flowStartContext(f, 'tr', t), /## Bulgular/);
  assert.match(flowTurnContext(f, 'en', t), /step 1\/4: .* call mcp__mode-code__flow_step with step "research"/);
  const plan = {
    ...f,
    current: 1,
    steps: f.steps.map((x, i) => (i === 0 ? { ...x, status: 'done' as const } : i === 1 ? { ...x, status: 'active' as const } : x)),
  };
  assert.match(stepGuidance(plan, 'en', t), /write the plan to \/tmp\/w\/f1\/plan\.md/);
  assert.match(stepGuidance(plan, 'en', { ...t, nativePlan: true }), /then call ExitPlanMode/);
  // Where the verification will run, so a plan for work in another folder says so in its commands.
  for (const native of [false, true]) {
    assert.ok(stepGuidance(plan, 'en', { ...t, nativePlan: native }).includes(`The verification commands run in ${f.cwd};`), String(native));
    assert.ok(stepGuidance(plan, 'tr', { ...t, nativePlan: native }).includes(`Doğrulama komutları ${f.cwd} klasöründe çalışır;`), String(native));
  }
  assert.equal(stepsLine(plan, 'tr'), '🔍 araştırma ✓ ▶ [📐 plan] → ⏸ onay → 🔨 kod');
  const waiting = { ...plan, current: 2, status: 'waiting' as const };
  assert.match(flowTurnContext(waiting, 'en', t), /waits for the person's approval \(they type "onay"\)/);
  const code = { ...plan, current: 3, verification: ['npm test', 'npm run lint'] };
  assert.match(stepGuidance(code, 'en', t), /implement the approved plan \(\/home\/ada\/\.mode-code\/flows\/f1\/plan\.md\).*`npm test`, `npm run lint`/);
  assert.match(flowResumeContext(plan, 'en', t), /resumed the flow f1: .* Read the drafts in \/tmp\/w\/f1 first/);
  assert.match(flowNote('canceled', f, 'en', t), /canceled the flow f1/);
});

test('the way of working: manual and autonomous alone, each said in the words the person used', () => {
  const manual = keywordContext(kw('manuel'), state, q(), null)[0]!;
  assert.match(manual, /message is "manuel"/);
  assert.match(manual, /The way of working is now manual: work step by step\. Do what the message asks, say what you did and what would come next, and wait/);
  const auto = keywordContext(kw('otonom'), state, q(), null)[0]!;
  assert.match(auto, /The way of working is now autonomous: go on without asking for approval between steps.* The mode stays as it is\./);
  assert.match(
    keywordContext(kw('manuel app devam'), state, q(), null)[0]!,
    /Keyword "manual continue": pick the work up where it stopped\. Way of working, manual: work step by step/,
  );
});

test('continue under the strip states the mode and the way of working it leaves as they are', () => {
  // The person, 2026-10-13: chat and manual on the strip, then "terminal devam" was told "work autonomously".
  const strip = { strip: true, workDir: '/tmp/w' };
  const said = (text: string, s = state) => keywordContext(kw(text), s, q(), 'app', strip)[0]!;
  const chatManual = said('app devam', { ...state, mode: 'chat', interaction: 'manual' });
  assert.match(
    chatManual,
    /Keyword "continue" for project "app": pick the work up where it stopped\. The keyword changes neither the mode nor the way of working; they stay as the strip above the prompt shows\. Mode, chat mode: conversation only\..* The safety layer enforces this until the person picks another mode\. Way of working, manual: work step by step\..* Quota/,
  );
  assert.doesNotMatch(chatManual, /autonom|continue" or/);
  const codeAuto = said('app devam', { ...state, mode: 'code', interaction: 'autonomous' });
  assert.match(
    codeAuto,
    /Mode, code mode: develop, test and commit; the safety belt and the project locks apply\. Way of working, autonomous: go on without asking/,
  );
  assert.doesNotMatch(codeAuto, /safety layer enforces/);
  // A session nobody set reads as the strip shows it: free, manual.
  assert.match(said('app devam'), /Mode, free mode: .* Way of working, manual: work step by step/);
  assert.match(said('app devam', { ...state, mode: 'research' }), /Mode, research mode: .*work folder \(\/tmp\/w\)/);
  // "manual continue" names the way of working; the mode it leaves.
  assert.match(
    said('manuel app devam', { ...state, mode: 'plan', interaction: 'manual' }),
    /pick the work up where it stopped\. The way of working is now manual; the mode stays as the strip above the prompt shows\. Mode, plan mode: .* Way of working, manual: /,
  );
  // A mode keyword no longer points at "continue" as a way out of chat.
  assert.match(keywordContext(kw('sohbet'), state, q(), null)[0]!, /The safety layer enforces this until the person picks another mode\.$/);
});

test('a command and a press are named as such, not as typed words', () => {
  const plan = { ...kw('plan'), via: 'command' as const, text: '/3' };
  assert.match(keywordContext(plan, state, q(), null)[0]!, /^\[Mode_Code\] The person ran "\/3", a command of Mode_Code/);
  const press = { ...kw('plan'), via: 'strip' as const, text: 'plan' };
  assert.match(keywordContext(press, state, q(), null)[0]!, /chose "plan" on Mode_Code's mode strip above the prompt/);
});

test("the folder's last choice, told with the first prompt; a folder to continue that is not registered", () => {
  const r = restoredContext('plan', 'autonomous', '/tmp/w');
  assert.match(
    r,
    /took up the mode and the way of working last used in this folder\. What holds now, as the strip above the prompt shows: Mode, plan mode: read and plan.*work folder \(\/tmp\/w\).* Way of working, autonomous: go on without asking/,
  );
  assert.match(r, /The person changes either with \/1 to \/8.*; "continue" changes neither\.$/);
  assert.match(
    restoredContext('chat', 'manual', '/tmp/w'),
    /chat mode: conversation only.* until the person picks another mode\. Way of working, manual: work step by step/,
  );
  assert.match(restoredContext('code', 'default', '/w'), /Way of working, manual/);
  assert.equal(
    continueFolderContext('/home/ada/dev/notes', false),
    "[Mode_Code] The project to continue is the folder /home/ada/dev/notes: not this session's folder, so work there.",
  );
  assert.equal(
    continueFolderContext('/home/ada/dev/app', true),
    "[Mode_Code] The project to continue is the folder /home/ada/dev/app, this session's own folder.",
  );
});

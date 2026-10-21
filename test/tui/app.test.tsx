// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW, SESSION } from './harness.js';
import { newModState } from '../../src/core/session.js';
import { completeStep, startFlow } from '../../src/core/flow.js';

test('the first screen lists the eight categories by purpose, Now beside them, protection and quota at the top', async () => {
  const s = await draw(new FakeData());
  try {
    const t = s.text();
    for (const c of ['Now', 'Activity', 'Working', 'Protection', 'Memory and projects', 'Quota', 'Claude Code', 'Settings']) assert.ok(t.includes(c), c);
    assert.match(t, /▀{5} working/); // Mo's badge, not the shield that covered the word
    assert.match(t, /week 27%/);
    assert.match(t, /Address: now/);
    // Now, beside the list before anything is opened: what Claude may do, and the goals.
    assert.match(t, /Claude right now/);
    assert.match(t, /› Leave Claude on a task…/);
  } finally {
    s.close();
  }
});

test('→ goes in, ← comes back, digits jump to a category', async () => {
  const s = await draw(new FakeData());
  try {
    await s.press(KEY.down, KEY.right);
    assert.match(s.text(), /Mode_Code › Activity/);
    assert.match(s.text(), /Activity feed/);
    await s.press(KEY.left);
    assert.doesNotMatch(s.text(), /Mode_Code › Activity/);
    await s.press('4');
    assert.match(s.text(), /Mode_Code › Protection/);
    assert.match(s.text(), /Safety belt rules/);
    // 1 is Now, a category that is one screen: it opens.
    await s.press('1');
    assert.match(s.text(), /Mode_Code › Now/);
    assert.match(s.text(), /Address: now/);
  } finally {
    s.close();
  }
});

test('an address opens its screen directly, the same address the command line uses', async () => {
  const s = await draw(new FakeData(), { address: 'quota/usage' });
  try {
    const t = s.text();
    assert.match(t, /Quota › Usage now/);
    assert.match(t, /5-hour/);
    assert.match(t, /21%/);
    assert.match(t, /Address: quota\/usage/);
    assert.match(t, /Weekly, 7 days\s+\S/);
  } finally {
    s.close();
  }
});

test('the palette finds a screen by its name in the other language too', async () => {
  const s = await draw(new FakeData('en'));
  try {
    await s.press(KEY.ctrlK);
    await s.type('kemeri kural');
    assert.match(s.text(), /▸ Protection › Safety belt rules/);
    await s.press(KEY.enter);
    assert.match(s.text(), /Protection › Safety belt rules/);
    assert.match(s.text(), /Force-push/);
  } finally {
    s.close();
  }
});

test('a session card shows its numbers; the list filter narrows by typing', async () => {
  const s = await draw(new FakeData(), { address: `memory/sessions/${SESSION.id}` });
  try {
    const t = s.text();
    assert.match(t, /Fix the login bug/);
    assert.match(t, /30 calls, 2 errors/);
    await s.press(KEY.esc, '/');
    await s.type('zzz');
    assert.match(s.text(), /Nothing matches the filter/);
  } finally {
    s.close();
  }
});

test('turning a protective feature off needs a second confirmation; a plain one saves at once', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'settings/modules' });
  try {
    await s.press(KEY.down, KEY.enter); // keywords: not protective
    assert.deepEqual(data.saved, [{ path: 'modules.keywords', value: false }]);
    assert.match(s.text(), /Keywords: off\. Saved\./);
    await s.press(KEY.down, KEY.down, KEY.enter); // quota guard: protective
    assert.equal(data.saved.length, 1);
    assert.match(s.text(), /lowers a protection/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved[1], { path: 'modules.quota', value: false });
  } finally {
    s.close();
  }
});

test('the belt can be tried on a command without running it', async () => {
  const s = await draw(new FakeData(), { address: 'protection/test' });
  try {
    await s.type('git status');
    await s.press(KEY.enter);
    await new Promise((r) => setTimeout(r, 150));
    assert.match(s.text(), /No rule applies/);
  } finally {
    s.close();
  }
});

test('Turkish everywhere when the language is Turkish; a broken protection shows red', async () => {
  const s = await draw(new FakeData('tr', {}, 'red'));
  try {
    const t = s.text();
    assert.match(t, /Şimdi/);
    assert.match(t, /Koruma/);
    assert.match(t, /▀{5} bozuk/);
    assert.match(t, /hafta %27/);
  } finally {
    s.close();
  }
});

test('plain mode uses no box drawing and no emoji-only signals', async () => {
  const s = await draw(new FakeData(), { plain: true });
  try {
    const t = s.text();
    assert.doesNotMatch(t, /[╭╮│─🛡▀]/u);
    assert.match(t, /\[belt\] working/);
  } finally {
    s.close();
  }
});

test('the report screen sums up the day and switches to the week with p', async () => {
  const s = await draw(new FakeData(), { address: 'activity/report' });
  try {
    assert.match(s.text(), /What happened in the last day/);
    assert.match(s.text(), /1 blocked/);
    await s.press('p');
    assert.match(s.text(), /What happened in the last 7 days/);
  } finally {
    s.close();
  }
});

test('a rule template is applied only after a second press', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'claude-code/templates' });
  try {
    assert.match(s.text(), /Public repository/);
    await s.press('a');
    assert.match(s.text(), /Press Enter \(or a\) again to apply it/);
    assert.deepEqual(data.applied, []);
    await s.press('a');
    assert.deepEqual(data.applied, ['public-repo']);
    await s.press(KEY.down, 'x');
    assert.deepEqual(data.applied, ['public-repo']); // x on a template that is not applied does nothing
  } finally {
    s.close();
  }
});

test('Now warns when two sessions work in the same folder', async () => {
  class TwoSessions extends FakeData {
    override modStates() {
      const s = (id: string) => ({ ...newModState(id, 'dev', NOW - 60_000), cwd: 'C:/work/app' });
      return [s('one'), s('two')];
    }
  }
  const s = await draw(new TwoSessions(), { address: 'now' });
  try {
    assert.match(s.text(), /2 sessions are working in the same folder: C:\/work\/app/);
  } finally {
    s.close();
  }
});

test('Now does not count a session that ended, or one closed without ending, as working', async () => {
  class Closed extends FakeData {
    override modStates() {
      const s = (id: string) => ({ ...newModState(id, 'dev', NOW - 60_000), cwd: 'C:/work/app' });
      return [s('one'), { ...s('ended'), endedAt: NOW - 30_000 }, s('shut')];
    }
    override closedSessions() {
      return new Set(['shut']);
    }
  }
  const s = await draw(new Closed(), { address: 'now' });
  try {
    assert.doesNotMatch(s.text(), /sessions are working in the same folder/);
  } finally {
    s.close();
  }
});

test('the help explains keys and terms and closes with Esc', async () => {
  const s = await draw(new FakeData());
  try {
    await s.press('?');
    assert.match(s.text(), /The keys of every screen; a page's own keys are in the bar at the bottom/);
    assert.match(s.text(), /Safety belt:/);
    await s.press(KEY.esc);
    assert.doesNotMatch(s.text(), /The keys of every screen; a page's own keys are in the bar at the bottom/);
  } finally {
    s.close();
  }
});

test('flows: Now lists a plan waiting for approval, Working › Flows shows each one, its card the steps and evidence', async () => {
  const data = new FakeData('en');
  const f = startFlow({
    id: '20261012-0900-add-sign-in',
    variant: 'full',
    task: 'Add a second sign-in factor',
    project: null,
    cwd: 'C:/work/app',
    sessionId: 's',
    workDir: 'C:/tmp/w',
    now: NOW - 600_000,
  });
  const r1 = completeStep(f, 'research', { kind: 'research', findings: 4, sources: 3 }, NOW - 300_000);
  const r2 = r1.ok ? completeStep(r1.flow, 'plan', { kind: 'plan', steps: 3, commands: 1 }, NOW - 60_000) : r1;
  assert.ok(r2.ok);
  data.flowList = [r2.flow];
  const home = await draw(data, { address: 'now' });
  try {
    assert.match(home.text(), /Flows: Add a second sign-in factor/);
    assert.match(home.text(), /A flow waits for your approval: Add a second sign-in/);
  } finally {
    home.close();
  }
  const card = await draw(data, { address: 'work/flows/20261012-0900-add-sign-in' });
  try {
    const t = card.text();
    assert.match(t, /Working › Flows › ⏸ Add a second sign-in factor/);
    assert.match(t, /✓\s+🔍 research\s+4 findings, 3 sources/);
    assert.match(t, /✓\s+📐 plan\s+3 steps, 1 verification command\b/);
    assert.match(t, /▶\s+⏸ approval\s+in progress/);
    assert.match(t, /Checked report/);
  } finally {
    card.close();
  }
});

test('Working › Flows says how to start one when there is none', async () => {
  const s = await draw(new FakeData('tr'), { address: 'work/flows' });
  try {
    assert.match(s.text(), /Henüz akış yok/);
    assert.match(s.text(), /"akış plan"/);
  } finally {
    s.close();
  }
});

test('Working › Parallel agents: turning it on says sessions start with agents off and needs a second Enter; the helpers take one', async () => {
  const data = new FakeData();
  // Narrower than 110 columns, the list of Working stays out of the way of the flattened text.
  const s = await draw(data, { address: 'work/agents', rows: 48, columns: 100 });
  try {
    const flat = () =>
      s
        .text()
        .replace(/[│╭╮╰╯─]/g, '')
        .replace(/\s+/g, ' ');
    assert.match(flat(), /I set the number of agents/);
    assert.match(flat(), /Exactly N for your next request, each with its own task, kind and model if you write one/);
    await s.press(KEY.enter);
    assert.equal(data.saved.length, 0, 'not yet');
    assert.match(flat(), /every session starts with agents off: Claude starts no agent until you set them on the strip/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'agents.enabled', value: true }]);
    await s.press(KEY.down, KEY.enter);
    assert.deepEqual(data.saved.at(-1), { path: 'agents.helpers', value: false });
    assert.match(flat(), /Claude Code sessions on this computer None running\./);
  } finally {
    s.close();
  }
  // The sessions running beside: each one's name, kind, status, age and folder; unreadable, said so.
  const busy = new FakeData();
  busy.sessionsRunning = [
    { name: 'api-fc', kind: 'interactive', status: 'busy', cwd: '/home/ada/api', startedAt: NOW - 3 * 60_000, sessionId: 'a1' },
    { name: 'tidy-up', kind: 'background', status: 'idle', cwd: null, startedAt: null, sessionId: 'b2' },
  ];
  const listed = await draw(busy, { address: 'work/agents', rows: 48, columns: 100 });
  try {
    assert.match(listed.text(), /● api-fc · interactive · busy · 3 min ago · \/home\/ada\/api/);
    assert.match(listed.text(), /○ tidy-up · background · idle/);
  } finally {
    listed.close();
  }
  const unread = new FakeData();
  unread.sessionsRunning = null;
  const none = await draw(unread, { address: 'work/agents', rows: 48, columns: 100 });
  try {
    assert.match(none.text(), /Could not be read: this Claude Code has no 'claude agents' command\./);
  } finally {
    none.close();
  }
  const automation = await draw(new FakeData('tr'), { address: 'work' });
  try {
    assert.match(automation.text(), /Paralel ajanlar\s+kapalı/);
  } finally {
    automation.close();
  }
});

test('back from a setup, the bar says how it went, and where the person was is where they are', async () => {
  const s = await draw(new FakeData(), { address: 'memory/store', notice: { text: 'Done: the memory setup.', kind: 'ok' } });
  try {
    assert.match(s.text(), /✓ Done: the memory setup\./);
    assert.match(s.text(), /Memory and projects › Memory/);
  } finally {
    s.close();
  }
});

// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, FakeData, KEY, NOW, SESSION } from './harness.js';
import { newModState } from '../../src/core/session.js';
import { completeStep, startFlow } from '../../src/core/flow.js';
import { acceptMilestone, acceptPlan, addDeferred, pauseRun, startRun } from '../../src/core/run.js';

test('the first screen lists the seven categories and shows protection and quota at the top', async () => {
  const s = await draw(new FakeData());
  try {
    const t = s.text();
    for (const c of ['Home', 'Projects', 'Sessions', 'Measure', 'Security', 'Claude Code', 'Settings']) assert.ok(t.includes(c), c);
    assert.match(t, /🛡 working/);
    assert.match(t, /week 27%/);
    assert.match(t, /Address: home/);
  } finally {
    s.close();
  }
});

test('→ goes in, ← comes back, digits jump to a category', async () => {
  const s = await draw(new FakeData());
  try {
    await s.press(KEY.right);
    assert.match(s.text(), /terminal-code › Home/);
    assert.match(s.text(), /Overview/);
    await s.press(KEY.left);
    assert.doesNotMatch(s.text(), /terminal-code › Home/);
    await s.press('5');
    assert.match(s.text(), /terminal-code › Security/);
    assert.match(s.text(), /Safety belt rules/);
  } finally {
    s.close();
  }
});

test('an address opens its screen directly, the same address the command line uses', async () => {
  const s = await draw(new FakeData(), { address: 'measure/quota' });
  try {
    const t = s.text();
    assert.match(t, /Measure › Quota/);
    assert.match(t, /5-hour/);
    assert.match(t, /21%/);
    assert.match(t, /Address: measure\/quota/);
    assert.match(t, /Weekly, 7 days\s+\S/);
  } finally {
    s.close();
  }
});

test('the palette finds a screen by its name in the other language too', async () => {
  const s = await draw(new FakeData('en'));
  try {
    await s.press(KEY.ctrlK);
    await s.type('kural');
    assert.match(s.text(), /▸ Security › Safety belt rules/);
    await s.press(KEY.enter);
    assert.match(s.text(), /Security › Safety belt rules/);
    assert.match(s.text(), /Force-push/);
  } finally {
    s.close();
  }
});

test('a session card shows its numbers; the list filter narrows by typing', async () => {
  const s = await draw(new FakeData(), { address: `sessions/${SESSION.id}` });
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
    await s.press(KEY.enter); // keywords: not protective
    assert.deepEqual(data.saved, [{ path: 'modules.keywords', value: false }]);
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
  const s = await draw(new FakeData(), { address: 'security/test' });
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
    assert.match(t, /Ana ekran/);
    assert.match(t, /Güvenlik/);
    assert.match(t, /🛡 bozuk/);
    assert.match(t, /hafta %27/);
  } finally {
    s.close();
  }
});

test('plain mode uses no box drawing and no emoji-only signals', async () => {
  const s = await draw(new FakeData(), { plain: true });
  try {
    const t = s.text();
    assert.doesNotMatch(t, /[╭╮│─🛡]/u);
    assert.match(t, /\[belt\] working/);
  } finally {
    s.close();
  }
});

test('the report screen sums up the day and switches to the week with p', async () => {
  const s = await draw(new FakeData(), { address: 'measure/report' });
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
    assert.match(s.text(), /Press a again to apply it/);
    assert.deepEqual(data.applied, []);
    await s.press('a');
    assert.deepEqual(data.applied, ['public-repo']);
    await s.press(KEY.down, 'x');
    assert.deepEqual(data.applied, ['public-repo']); // x on a template that is not applied does nothing
  } finally {
    s.close();
  }
});

test('home warns when two sessions work in the same folder', async () => {
  class TwoSessions extends FakeData {
    override modStates() {
      const s = (id: string) => ({ ...newModState(id, 'dev', NOW - 60_000), cwd: 'C:/work/app' });
      return [s('one'), s('two')];
    }
  }
  const s = await draw(new TwoSessions(), { address: 'home/overview' });
  try {
    assert.match(s.text(), /2 sessions are working in the same folder: C:\/work\/app/);
  } finally {
    s.close();
  }
});

test('home does not count a session that ended, or one closed without ending, as working', async () => {
  class Closed extends FakeData {
    override modStates() {
      const s = (id: string) => ({ ...newModState(id, 'dev', NOW - 60_000), cwd: 'C:/work/app' });
      return [s('one'), { ...s('ended'), endedAt: NOW - 30_000 }, s('shut')];
    }
    override closedSessions() {
      return new Set(['shut']);
    }
  }
  const s = await draw(new Closed(), { address: 'home/overview' });
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
    assert.match(s.text(), /Keys work the same on every screen/);
    assert.match(s.text(), /Safety belt:/);
    await s.press(KEY.esc);
    assert.doesNotMatch(s.text(), /Keys work the same on every screen/);
  } finally {
    s.close();
  }
});

test('flows: home lists a plan waiting for approval, Projects › Flows shows each one, its card the steps and evidence', async () => {
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
  const home = await draw(data, { address: 'home/overview' });
  try {
    assert.match(home.text(), /Flows/);
    assert.match(home.text(), /⏸ Add a second sign-in factor/);
    assert.match(home.text(), /waiting for approval/);
  } finally {
    home.close();
  }
  const card = await draw(data, { address: 'projects/flows/20261012-0900-add-sign-in' });
  try {
    const t = card.text();
    assert.match(t, /Projects › Flows › ⏸ Add a second sign-in factor/);
    assert.match(t, /✓\s+🔍 research\s+4 findings, 3 sources/);
    assert.match(t, /✓\s+📐 plan\s+3 steps, 1 verification command\b/);
    assert.match(t, /▶\s+⏸ approval\s+in progress/);
    assert.match(t, /Checked report/);
  } finally {
    card.close();
  }
});

test('Projects › Flows says how to start one when there is none', async () => {
  const s = await draw(new FakeData('tr'), { address: 'projects/flows' });
  try {
    assert.match(s.text(), /Henüz akış yok/);
    assert.match(s.text(), /"akış plan"/);
  } finally {
    s.close();
  }
});

test('full autonomy: turning it on shows what it means and needs a second Enter; the checks from here are listed', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'settings/autonomy' });
  try {
    assert.match(s.text(), /Start checks, measured from here/);
    assert.match(s.text(), /✗\s+Platform\s+Native Windows runs commands without a sandbox/);
    await s.press(KEY.enter);
    assert.equal(data.saved.length, 0, 'not yet');
    // The warning wraps over several lines of the pane: read it as one text.
    const flat = s
      .text()
      .replace(/[│╭╮╰╯─]/g, '')
      .replace(/\s+/g, ' ');
    assert.match(flat, /A run takes one task to its end while nobody is at the keyboard/);
    assert.match(flat, /Press Enter again to turn it on\./);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved, [{ path: 'autonomy.enabled', value: true }]);
  } finally {
    s.close();
  }
});

test('full autonomy: Projects › Runs lists each run, its card the milestones, what waits for the person and the way back', async () => {
  const data = new FakeData('en');
  let r = startRun({
    id: '20261013-1210-rate-limit',
    task: 'Add rate limiting to the API',
    project: null,
    cwd: 'C:/work/api',
    sessionId: 's',
    workDir: 'C:/tmp/w/runs',
    budget: { weeklyTarget: 52, source: '+10' },
    start: { commit: 'a'.repeat(40), branch: 'main' },
    now: NOW - 3_600_000,
  });
  const plan = acceptPlan(
    r,
    {
      steps: [
        { n: 1, title: 'Limiter', acceptance: 'tests' },
        { n: 2, title: 'Wire it in', acceptance: '429' },
      ],
      verification: ['npm test'],
    },
    [],
    NOW - 3_000_000,
  );
  assert.ok(plan.ok);
  const review = { verdict: 'concerns' as const, findings: ['reset not tested'], model: 'opus', at: NOW, signals: { deletedTests: 0, skipMarkers: 0 } };
  const m = acceptMilestone(plan.run, { n: 1, at: NOW - 600_000, commit: 'b'.repeat(40), ref: 'x', commits: 2, review, note: '' }, NOW - 600_000);
  assert.ok(m.ok);
  const d = addDeferred(m.run, { kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main' }, NOW - 300_000);
  assert.ok(d.ok);
  r = pauseRun(d.run, 'quota', NOW - 60_000).run;
  // Beside it: one running, one stuck, one done (the list's order and badges).
  const other = (id: string, task: string) =>
    startRun({ ...r, id, task, sessionId: 's', workDir: 'C:/tmp/w/runs', start: { commit: 'c'.repeat(40), branch: 'main' }, now: NOW - 7_200_000 });
  const running = other('20261013-1100-running', 'Running task');
  const stuck = { ...other('20261013-1000-stuck', 'Stuck task'), status: 'stuck' as const, runningSince: null };
  const done = { ...other('20261013-0900-done', 'Done task'), status: 'done' as const, runningSince: null };
  data.runList = [r, running, stuck, done];
  const home = await draw(data, { address: 'home/overview' });
  try {
    assert.match(home.text(), /Full-autonomy runs/);
    assert.match(home.text(), /⏸ Add rate limiting to the API/);
  } finally {
    home.close();
  }
  const card = await draw(data, { address: 'projects/runs/20261013-1210-rate-limit' });
  try {
    const t = card.text();
    assert.match(t, /Projects › Runs › ⏸ Add rate limiting to the API/);
    assert.match(t, /paused \(quota budget\) · 1\/2/);
    assert.match(t, /✓\s+1\. Limiter\s+bbbbbbbbbbbb · CONCERNS/);
    assert.match(t, /▶\s+2\. Wire it in/);
    assert.match(t, /push git push origin main/);
    assert.match(t.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' '), /terminal-code autonomy rollback 20261013-1210-rate-limit <n>/);
  } finally {
    card.close();
  }
  const empty = await draw(new FakeData('tr'), { address: 'projects/runs' });
  try {
    assert.match(empty.text(), /Henüz tam otonom koşu yok/);
  } finally {
    empty.close();
  }
});

test('full autonomy: the runs list shows how many run, and each run its state', async () => {
  const data = new FakeData('en');
  const mk = (id: string, task: string, status: 'active' | 'paused' | 'stuck' | 'done') => ({
    ...startRun({
      id,
      task,
      project: null,
      cwd: 'C:/work/api',
      sessionId: 's',
      workDir: 'C:/tmp/w/runs',
      budget: { weeklyTarget: 52, source: '+10' },
      start: { commit: 'a'.repeat(40), branch: 'main' },
      now: NOW - 3_600_000,
    }),
    status,
  });
  data.runList = [mk('20261013-1300-a', 'Running one', 'active'), mk('20261013-1200-b', 'Stuck one', 'stuck'), mk('20261013-1100-c', 'Paused one', 'paused')];
  const s = await draw(data, { address: 'projects/runs' });
  try {
    const t = s.text();
    assert.match(t, /Running one/);
    assert.match(t, /⏸ Stuck one/);
    assert.match(t, /⏸ Paused one/);
    assert.match(t, /stuck/);
  } finally {
    s.close();
  }
  const projects = await draw(data, { address: 'projects' });
  try {
    assert.match(projects.text(), /Runs\s+1 running/);
  } finally {
    projects.close();
  }
});

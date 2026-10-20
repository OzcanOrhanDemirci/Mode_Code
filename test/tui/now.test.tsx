// SPDX-License-Identifier: Apache-2.0
/** Now, the first screen (src/tui/screens/now.tsx), and Working › Modes and ways of working. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newModState } from '../../src/core/session.js';
import { draw, FakeData, KEY, NOW } from './harness.js';

const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, '').replace(/\s+/g, ' ');

class TwoAtWork extends FakeData {
  override modStates() {
    return [
      { ...newModState('aaa', 'dev', NOW - 60_000), cwd: 'C:/work/app' },
      { ...newModState('bbb', 'dev', NOW - 30_000), cwd: 'C:/work/api', mode: 'plan' as const },
    ];
  }
}

test('the keys walk every press in order; Enter on a line of Claude right now opens its reasons, w all of them', async () => {
  const s = await draw(new FakeData(), { address: 'now', rows: 48, columns: 90 });
  try {
    // Mo first (its own line, marked), then the goals, then the lines; the line under Mo shows the card of each.
    await s.press(KEY.down);
    assert.match(flat(s.text()), /1 new since you last looked/);
    await s.press(KEY.down);
    assert.match(flat(s.text()), /Full autonomy: Claude carries one task to its end alone/);
    for (let i = 0; i < 5; i++) await s.press(KEY.down);
    assert.match(flat(s.text()), /Mode: free\./);
    await s.press(KEY.enter);
    assert.match(flat(s.text()), /Changes the project's files › Mode: free\. Every session starts in free mode\./);
    await s.press('w');
    assert.match(flat(s.text()), /Asks you before a risky step › Safety belt: on/);
    assert.match(flat(s.text()), /Hide the reasons/);
  } finally {
    s.close();
  }
});

test('with two sessions at work, Claude right now names the one in this folder first, and s shows the next', async () => {
  const data = new TwoAtWork();
  data.seen = NOW;
  const s = await draw(data, { address: 'now', rows: 48, columns: 90 });
  try {
    assert.match(s.text(), /Claude right now · in C:\/work\/app/);
    assert.match(s.text(), /Session 1 of 2: next/);
    assert.match(flat(s.text()), /2 sessions are at work; the first in C:\/work\/app\./);
    await s.press('s');
    assert.match(s.text(), /Claude right now · in C:\/work\/api/);
    assert.match(s.text(), /Writes the plan only \(📐 plan\)/);
    await s.clickText('Session 2 of 2: next');
    assert.match(s.text(), /Claude right now · in C:\/work\/app/);
  } finally {
    s.close();
  }
});

test('a goal is a press: it opens its page, as Enter does on it', async () => {
  const s = await draw(new FakeData(), { address: 'now', rows: 40, columns: 90 });
  try {
    await s.clickText('Work in parallel');
    assert.match(s.text(), /Address: work\/agents/);
  } finally {
    s.close();
  }
  const why = await draw(new FakeData(), { address: 'now', rows: 48, columns: 90 });
  try {
    await why.clickText('Why is it so?');
    assert.match(flat(why.text()), /Cannot touch its own protection 🔒 Its own protection: locked, out of Claude's reach./);
  } finally {
    why.close();
  }
});

test('Activity › While you were away says each kind of thing that needed you, in words, the newest first', async () => {
  const data = new FakeData();
  const ev = (minutes: number, rest: Record<string, unknown>) => ({ v: 1, at: NOW - minutes * 60_000, source: 'mod', session: 's', ...rest });
  data.extraEvents = [
    ev(1, { kind: 'belt', tool: 'Bash', verdict: 'ask', answer: 'allow', reasons: ['Pushes to main'] }),
    ev(2, { kind: 'belt', tool: 'Write', verdict: 'ask' }),
    ev(3, { kind: 'quota', level: 'stop' }),
    ev(4, { kind: 'quota', level: 'wrapUp' }),
    ev(5, { kind: 'resume' }),
    ev(6, { kind: 'flow', status: 'waiting', action: 'done', flow: 'f1' }),
    ev(7, { kind: 'flow', status: 'done', action: 'done', flow: 'f2' }),
    ev(8, { kind: 'run', action: 'finish', run: 'r1' }),
    ev(9, { kind: 'run', action: 'pause', reason: 'quota', run: 'r2' }),
    ev(10, { kind: 'run', action: 'stuck', run: 'r3' }),
    ev(11, { kind: 'run', action: 'cancel', run: 'r4' }),
  ] as never;
  const s = await draw(data, { address: 'activity/away', rows: 48, columns: 100 });
  try {
    const t = flat(s.text());
    for (const line of [
      /Allowed a Bash call after asking/,
      /Asked about a Write call/,
      /Quota limit reached: work stopped/,
      /Quota budget reached: work wrapped up/,
      /The quota period reset: work resumed/,
      /Pushes to main/,
      /A plan waits for your approval \(f1\)/,
      /A flow is complete \(f2\)/,
      /Full-autonomy run done: r1/,
      /Full-autonomy run paused \(.+\): r2/,
      /Full-autonomy run stuck: r3/,
      /Full-autonomy run canceled: r4/,
    ])
      assert.match(t, line);
    // Opened, it counts as seen: next time, only what came after.
    assert.ok(data.seen !== null);
  } finally {
    s.close();
  }
});

test('Modes and ways of working: what each does and the key that picks it, beside the two features they need', async () => {
  const s = await draw(new FakeData('tr'), { address: 'work/modes', rows: 48, columns: 90 });
  try {
    const t = flat(s.text());
    assert.match(t, /📐 plan Claude okur ve planlar, yalnız planı yazar;/);
    assert.match(t, / \/3 /);
    assert.match(t, /manuel .* \/7/);
    assert.match(t, /\(\/tam-otonom\)/);
    assert.match(t, /Modlar ve akışlar ● açık/);
  } finally {
    s.close();
  }
});

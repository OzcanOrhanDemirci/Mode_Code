// SPDX-License-Identifier: Apache-2.0
// Quota per task (scripts/measure): calls counted once, priced and weighed, cut at commits and pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain JavaScript script, run by hand
import { boundariesOf, callsOf, costOf, jsonLines, priceOf, readingsOf, tasksOf, unitsPerPoint, windowOf } from '../../scripts/measure/quota.mjs';

type Usage = { input?: number; write5m?: number; write1h?: number; read?: number; output?: number };

/** One transcript line of an assistant message: one content block, the message's usage. */
function line(at: string, req: string, usage: Usage, extra: { model?: string; content?: unknown[]; session?: string } = {}) {
  return {
    type: 'assistant',
    timestamp: at,
    requestId: req,
    sessionId: extra.session ?? 's1',
    cwd: 'C:\\dev\\app',
    message: {
      id: `msg_${req}`,
      model: extra.model ?? 'claude-opus-5-5',
      content: extra.content ?? [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: usage.input ?? 0,
        cache_creation_input_tokens: (usage.write5m ?? 0) + (usage.write1h ?? 0),
        cache_read_input_tokens: usage.read ?? 0,
        output_tokens: usage.output ?? 0,
        cache_creation: { ephemeral_5m_input_tokens: usage.write5m ?? 0, ephemeral_1h_input_tokens: usage.write1h ?? 0 },
      },
    },
  };
}

const bash = (command: string) => [{ type: 'tool_use', name: 'Bash', input: { command } }];

test('a call written as several lines is counted once, at its first line', () => {
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', { read: 1000, output: 5 }),
    line('2026-10-17T10:00:02.000Z', 'a', { read: 1000, output: 5 }, { content: bash('ls') }),
    line('2026-10-17T10:01:00.000Z', 'b', { read: 2000, output: 7 }),
  ];
  const calls = callsOf(lines);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].at, Date.parse('2026-10-17T10:00:00.000Z'));
  assert.deepEqual(
    calls.map((c: { read: number }) => c.read),
    [1000, 2000],
  );
});

test("the engine's own answers and lines with no usage are not calls", () => {
  const synthetic = line('2026-10-17T10:00:00.000Z', 'x', { output: 3 }, { model: '<synthetic>' });
  const user = { type: 'user', timestamp: '2026-10-17T10:00:00.000Z', message: { role: 'user', content: 'hi' } };
  assert.deepEqual(callsOf([synthetic, user, null, { type: 'assistant', message: {} }]), []);
});

test('a JSONL text cut short loses only its broken line', () => {
  assert.deepEqual(jsonLines('{"a":1}\n{"b":\n\n{"c":3}\n'), [{ a: 1 }, { c: 3 }]);
});

test('a write without the five-minute/one-hour split is taken as five minutes', () => {
  const o = line('2026-10-17T10:00:00.000Z', 'a', {});
  o.message.usage = { input_tokens: 0, cache_creation_input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 0 } as never;
  const [c] = callsOf([o]);
  assert.equal(c.write5m, 500);
  assert.equal(c.write1h, 0);
});

test('prices: the model rows, longer ids, and none for an unknown model', () => {
  assert.equal(priceOf('claude-opus-5-5')?.input, 4);
  assert.equal(priceOf('claude-sonnet-5-5-20261001')?.output, 10);
  assert.equal(priceOf('claude-opus-5-5[1m]')?.read, 0.2);
  assert.equal(priceOf('gpt-x'), null);
  assert.equal(priceOf(''), null);
});

test('a call is priced by token kind and weighed by what the quota counts', () => {
  const million = { input: 1e6, write5m: 1e6, write1h: 1e6, read: 1e6, output: 1e6 };
  const [c] = callsOf([line('2026-10-17T10:00:00.000Z', 'a', million)]);
  const cost = costOf(c);
  // Opus 5.5: input 4, writes 5 and 8, read 0.2, output 20.
  assert.ok(Math.abs(cost.dollars - (4 + 5 + 8 + 0.2 + 20)) < 1e-9);
  assert.ok(Math.abs(cost.units - (4 + 13 + 0.2 * 0.76 + 20 * 1.92)) < 1e-9);
  assert.equal(costOf({ ...c, model: 'unknown' }), null);
});

test('Haiku 5.5 costs five times as much above 100K tokens of prompt', () => {
  const [short] = callsOf([line('2026-10-17T10:00:00.000Z', 'a', { input: 100_000, output: 1000 }, { model: 'claude-haiku-5-5' })]);
  const [long] = callsOf([line('2026-10-17T10:00:00.000Z', 'b', { input: 100_001, output: 1000 }, { model: 'claude-haiku-5-5' })]);
  assert.ok(Math.abs(costOf(short).dollars - (0.01 + 0.0005)) < 1e-12);
  assert.ok(Math.abs(costOf(long).dollars - ((100_001 * 0.1 + 1000 * 0.5) * 5) / 1e6) < 1e-12);
});

test('commits and pushes end tasks; other git commands and look-alikes do not', () => {
  const commands = [
    ['git commit -m "x"', 'commit'],
    ['cd app && git -C sub -c user.name=x commit -s -m y', 'commit'],
    ['git --no-pager push origin main', 'push'],
    ['git log --grep commit', null],
    ['git commit-tree abc', null],
    ['git status', null],
  ] as const;
  for (const [command, kind] of commands) {
    const found = boundariesOf([line('2026-10-17T10:00:00.000Z', 'a', {}, { content: bash(command) })]);
    assert.deepEqual(
      found.map((b: { kind: string }) => b.kind),
      kind ? [kind] : [],
      command,
    );
  }
  const read = [{ type: 'tool_use', name: 'Read', input: { file_path: 'git commit' } }];
  assert.deepEqual(boundariesOf([line('2026-10-17T10:00:00.000Z', 'a', {}, { content: read })]), []);
});

test('a session is cut into tasks at the calls that commit or push; the rest is open', () => {
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', { write1h: 1000, output: 100 }),
    line('2026-10-17T10:01:00.000Z', 'b', { read: 1000, write1h: 500, output: 50 }),
    // The command block is a later line of call b: b still ends the first task.
    line('2026-10-17T10:01:03.000Z', 'b', { read: 1000, write1h: 500, output: 50 }, { content: bash('git commit -m one') }),
    line('2026-10-17T10:02:00.000Z', 'c', { read: 1500, output: 10 }, { content: bash('git commit -m two && git push') }),
    line('2026-10-17T10:03:00.000Z', 'd', { read: 1600, output: 10 }),
    line('2026-10-17T10:04:00.000Z', 'e', { read: 10, output: 1 }, { session: 's2' }),
  ];
  const tasks = tasksOf(callsOf(lines), boundariesOf(lines));
  assert.deepEqual(
    tasks.map((t: { session: string; endedBy: string; calls: number; context: number }) => [t.session, t.endedBy, t.calls, t.context]),
    [
      ['s1', 'commit', 2, 1500],
      ['s1', 'push', 1, 1500],
      ['s1', 'open', 1, 1600],
      ['s2', 'open', 1, 10],
    ],
  );
  const units = tasks.reduce((n: number, t: { units: number }) => n + t.units, 0);
  const each = callsOf(lines).reduce((n: number, c: unknown) => n + costOf(c).units, 0);
  assert.ok(Math.abs(units - each) < 1e-12, 'every call is in one task');
});

test('readings: only quota readings, once per moment, oldest first', () => {
  const r = (at: number, week: number) => ({ kind: 'reading', at, five: 1, week, fiveResetsAt: 9, weekResetsAt: 100 });
  const got = readingsOf([r(3, 12), { kind: 'sync', at: 2 }, r(1, 10), r(3, 12), { kind: 'reading', at: 4 }]);
  assert.deepEqual(
    got.map((x: { at: number; week: number }) => [x.at, x.week]),
    [
      [1, 10],
      [3, 12],
    ],
  );
});

test('a weekly point: the units between the first and last reading of each week over the points it rose', () => {
  const t = (s: string) => Date.parse(s);
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', { output: 1e6 }), // before the first reading: left out
    line('2026-10-17T11:00:00.000Z', 'b', { output: 1e6 }),
    line('2026-10-17T12:00:00.000Z', 'c', { output: 1e6 }),
    line('2026-10-17T14:00:00.000Z', 'd', { output: 1e6 }), // after the last reading: left out
  ];
  const calls = callsOf(lines);
  const readings = [
    { at: t('2026-10-17T10:30:00.000Z'), week: 40, weekResetsAt: 1 },
    { at: t('2026-10-17T13:00:00.000Z'), week: 44, weekResetsAt: 1 },
    // A week with one reading, and one that did not rise, tell nothing.
    { at: t('2026-10-17T10:30:00.000Z'), week: 5, weekResetsAt: 2 },
    { at: t('2026-10-17T11:30:00.000Z'), week: 7, weekResetsAt: 3 },
    { at: t('2026-10-17T12:30:00.000Z'), week: 7, weekResetsAt: 3 },
  ];
  const p = unitsPerPoint(readings, calls);
  const two = 2 * 20 * 1.92;
  assert.equal(p.points, 4);
  assert.ok(Math.abs(p.units - two) < 1e-9);
  assert.ok(Math.abs(p.perPoint - two / 4) < 1e-9);
  assert.equal(unitsPerPoint(readings.slice(2), calls), null);
});

test('the days measured: calls and readings from their start, a call in two files once, as first found', () => {
  const since = Date.parse('2026-10-17T10:00:00.000Z');
  const first = callsOf([line('2026-10-17T11:00:00.000Z', 'a', { output: 1 }, { session: 'original' })]);
  const copy = callsOf([line('2026-10-17T11:00:00.000Z', 'a', { output: 1 }, { session: 'fork' })]);
  const before = callsOf([line('2026-10-17T09:59:59.000Z', 'b', { output: 1 })]);
  const readings = [
    { at: since - 1, week: 30, weekResetsAt: 1 },
    { at: since, week: 40, weekResetsAt: 1 },
  ];
  const w = windowOf([...before, ...first, ...copy], readings, since);
  assert.deepEqual(
    w.calls.map((c: { key: string; session: string }) => [c.key, c.session]),
    [['a|msg_a', 'original']],
  );
  assert.deepEqual(w.readings, [readings[1]]);
});

// SPDX-License-Identifier: Apache-2.0
// Quota per task (core/measure.ts): calls counted once, priced and weighed, cut at commits and pushes, with how the work went.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundariesOf,
  callsOf,
  costOf,
  gitSubcommands,
  jsonLines,
  modelName,
  priceOf,
  promptOf,
  readingsOf,
  rebuiltCache,
  resultsOf,
  serversUsed,
  tasksOf,
  unitsPerPoint,
  usesOf,
  windowOf,
} from '../../src/core/measure.js';

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
  assert.equal(calls[0]!.at, Date.parse('2026-10-17T10:00:00.000Z'));
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
  const c = callsOf([o])[0]!;
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
  const c = callsOf([line('2026-10-17T10:00:00.000Z', 'a', million)])[0]!;
  const cost = costOf(c)!;
  // Opus 5.5: input 4, writes 5 and 8, read 0.2, output 20.
  assert.ok(Math.abs(cost.dollars - (4 + 5 + 8 + 0.2 + 20)) < 1e-9);
  assert.ok(Math.abs(cost.units - (4 + 13 + 0.2 * 0.76 + 20 * 1.92)) < 1e-9);
  assert.equal(costOf({ ...c, model: 'unknown' }), null);
});

test('Haiku 5.5 costs five times as much above 100K tokens of prompt', () => {
  const short = callsOf([line('2026-10-17T10:00:00.000Z', 'a', { input: 100_000, output: 1000 }, { model: 'claude-haiku-5-5' })])[0]!;
  const long = callsOf([line('2026-10-17T10:00:00.000Z', 'b', { input: 100_001, output: 1000 }, { model: 'claude-haiku-5-5' })])[0]!;
  assert.ok(Math.abs(costOf(short)!.dollars - (0.01 + 0.0005)) < 1e-12);
  assert.ok(Math.abs(costOf(long)!.dollars - ((100_001 * 0.1 + 1000 * 0.5) * 5) / 1e6) < 1e-12);
});

test('commits and pushes end tasks; other git commands and look-alikes do not', () => {
  const commands = [
    ['git commit -m "x"', 'commit'],
    ['cd app && git -C sub -c user.name=x commit -s -m y', 'commit'],
    ['git --no-pager push origin main', 'push'],
    ['git -C "C:/my project" commit -m x', 'commit'],
    ["git -C '/tmp/a b' push", 'push'],
    ['npm test; git commit -am x', 'commit'],
    ['npm test\ngit push', 'push'],
    ['& git commit -m x', 'commit'],
    ['echo "git commit"', null],
    ['gh pr create --body "then git push"', null],
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

test('git subcommands: where a command starts, past git options, not inside strings; long lines stay quick', () => {
  assert.deepEqual(gitSubcommands('git -C "a; b" -c k=v --no-pager log && (git status) | { git push; }'), ['log', 'status', 'push']);
  assert.deepEqual(gitSubcommands("echo 'git commit; git push' && npm test"), []);
  assert.deepEqual(gitSubcommands('git'), []);
  assert.deepEqual(gitSubcommands('"git" commit'), ['commit']);
  // The lines CodeQL showed a nested pattern backtracking on (js/redos), long.
  const started = Date.now();
  for (const line of ['git' + ' -C --=!'.repeat(20_000), 'git -C ' + '"" -C '.repeat(20_000), 'git -' + '-- -'.repeat(20_000)]) gitSubcommands(line);
  assert.ok(Date.now() - started < 2000);
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
  const each = callsOf(lines).reduce((n: number, c) => n + costOf(c)!.units, 0);
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
  assert.equal(p!.points, 4);
  assert.ok(Math.abs(p!.units - two) < 1e-9);
  assert.ok(Math.abs(p!.perPoint - two / 4) < 1e-9);
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

/** A tool call block, and the person's line that answers it. */
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const answer = (id: string, content: unknown, error = false) => ({
  type: 'user',
  timestamp: '2026-10-17T10:00:01.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(error ? { is_error: true } : {}) }] },
});

test('tool calls and their results: each once; a refusal is an error that says so, another error is not', () => {
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', {}, { content: [use('t1', 'Read', { file_path: 'a.ts' })] }),
    line('2026-10-17T10:00:00.500Z', 'a', {}, { content: [use('t1', 'Read', { file_path: 'a.ts' })] }),
    answer('t1', 'one\ntwo'),
    answer('t2', [{ type: 'text', text: 'Blocked by the safety belt: rm -rf' }], true),
    answer('t3', 'npm ERR! missing script', true),
    answer('t4', [{ type: 'image' }]),
  ];
  assert.deepEqual(
    usesOf(lines).map((u) => [u.id, u.name, u.key]),
    [['t1', 'Read', 'a|msg_a']],
  );
  assert.deepEqual(
    resultsOf(lines).map((r) => [r.id, r.chars, r.error, r.refused]),
    [
      ['t1', 7, false, false],
      ['t2', 34, true, true],
      ['t3', 23, true, false],
      ['t4', 0, false, false],
    ],
  );
  // A block with no id still counts, named by its call.
  assert.equal(usesOf([line('2026-10-17T10:00:00.000Z', 'b', {}, { content: [{ type: 'tool_use', name: 'Bash', input: null }] })])[0]?.id, 'b|msg_b#0');
  assert.deepEqual(usesOf([{ type: 'assistant', timestamp: 'never', message: { content: [use('x', 'Read', {})] } }]), []);
});

test("a task's traces: tested, re-reads of the same part, refusals, cache rebuilt past the first call, prompts past 400k, subagents by model, output by tool", () => {
  const sub = (l: ReturnType<typeof line>) => ({ ...l, isSidechain: true });
  const lines = [
    line(
      '2026-10-17T10:00:00.000Z',
      'a',
      { write5m: 30_000, output: 10 },
      { content: [use('r1', 'Read', { file_path: 'a.ts' }), use('r2', 'Read', { file_path: 'a.ts', offset: 10, limit: 20 })] },
    ),
    answer('r1', 'x'.repeat(100)),
    answer('r2', 'y'.repeat(50)),
    line(
      '2026-10-17T10:01:00.000Z',
      'b',
      { read: 30_000, output: 10 },
      { content: [use('r3', 'Read', { file_path: 'a.ts' }), use('r4', 'Read', { file_path: 'a.ts', offset: 10, limit: 20 })] },
    ),
    line('2026-10-17T10:02:00.000Z', 'c', { read: 500, write5m: 29_000, output: 10 }, { content: [use('e1', 'Edit', { file_path: 'a.ts' })] }),
    line(
      '2026-10-17T10:03:00.000Z',
      'd',
      { read: 450_000, output: 10 },
      { content: [use('r5', 'Read', { file_path: 'a.ts' }), use('b1', 'Bash', { command: 'npm test' })] },
    ),
    answer('b1', 'z'.repeat(200)),
    sub(line('2026-10-17T10:04:00.000Z', 'e', { read: 1000, output: 1e6 }, { model: 'claude-sonnet-5-5-20261001' })),
    line(
      '2026-10-17T10:05:00.000Z',
      'f',
      { read: 1000, output: 10 },
      { content: [use('w1', 'Write', { file_path: 'b.ts' }), use('w2', 'Write', { file_path: 'c.ts' })] },
    ),
    answer('w2', 'Write refused: the project is frozen to src/ (hook)', true),
  ];
  const [t] = tasksOf(callsOf(lines), boundariesOf(lines), usesOf(lines), resultsOf(lines));
  assert.ok(t);
  const tr = t.traces;
  assert.equal(tr.tested, true);
  assert.equal(tr.rereads, 2, 'the whole file and the same range again; after the edit, none');
  assert.equal(tr.refused, 1);
  assert.equal(tr.cacheRebuilds, 1, 'the first call writes its cache by right; the third rebuilt it');
  assert.equal(tr.large, 1);
  assert.deepEqual(Object.keys(tr.subagents), ['claude-sonnet-5-5']);
  assert.ok(Math.abs(tr.subagents['claude-sonnet-5-5']! - costOf(callsOf(lines).find((c) => c.sidechain)!)!.units) < 1e-12);
  assert.deepEqual(tr.output, { Read: 150, Bash: 200, Write: 51 });
  assert.deepEqual(tr.files, ['a.ts', 'b.ts'], 'a refused write wrote nothing');
  assert.deepEqual(tr.touchedAgain, []);
});

test('a file a later task writes again within 48 hours is marked on the earlier task', () => {
  const edit = (at: string, req: string, file: string, extra: unknown[] = []) =>
    line(at, req, { read: 100, output: 1 }, { content: [use(`u${req}`, 'Edit', { file_path: file }), ...extra] });
  const lines = [
    edit('2026-10-17T10:00:00.000Z', 'a', 'x.ts', bash('git commit -m one')),
    edit('2026-10-18T09:00:00.000Z', 'b', 'x.ts', bash('git commit -m two')),
    edit('2026-10-21T09:00:00.000Z', 'c', 'x.ts'),
  ];
  const tasks = tasksOf(callsOf(lines), boundariesOf(lines), usesOf(lines), resultsOf(lines));
  assert.deepEqual(
    tasks.map((t) => t.traces.touchedAgain),
    [['x.ts'], [], []],
    'the third came three days after the second',
  );
});

test('a cache is rebuilt when most of a large prompt is written anew; a small prompt or a cache read is not', () => {
  const call = (write: number, read: number) => callsOf([line('2026-10-17T10:00:00.000Z', 'a', { write5m: write, read })])[0]!;
  assert.equal(rebuiltCache(call(25_000, 0)), true);
  assert.equal(rebuiltCache(call(15_000, 0)), false, 'small');
  assert.equal(rebuiltCache(call(10_000, 15_000)), false, 'mostly read');
  assert.equal(promptOf(call(10_000, 15_000)), 25_000);
});

test('model names without their date, and the MCP servers the calls named', () => {
  assert.equal(modelName('claude-opus-5-5-20261001'), 'claude-opus-5-5');
  assert.equal(modelName('claude-opus-5-5[1m]'), 'claude-opus-5-5');
  assert.equal(modelName('gpt-x'), 'gpt-x');
  const at = (s: string) => Date.parse(s);
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', {}, { content: [use('m1', 'mcp__dart__analyze', {}), use('m2', 'mcp__plugin_x_srv__go', {})] }),
    line('2026-10-17T11:00:00.000Z', 'b', {}, { content: [use('m3', 'mcp__dart__test', {}), use('m4', 'Read', {})] }),
  ];
  assert.deepEqual(serversUsed(usesOf(lines)), { dart: at('2026-10-17T11:00:00.000Z'), plugin_x_srv: at('2026-10-17T10:00:00.000Z') });
});

test('the edges the cuts rest on: lines that are no calls, git past an empty option, the boundaries of each measure', () => {
  const at = '2026-10-17T10:00:00.000Z';
  // An assistant line with a model and no usage, or usage and no model, is no call.
  assert.deepEqual(callsOf([{ type: 'assistant', timestamp: at, message: { model: 'claude-opus-5-5' } }]), []);
  assert.deepEqual(callsOf([{ type: 'assistant', timestamp: at, message: { usage: { output_tokens: 1 } } }]), []);
  // git with an empty option value, and git after leading space.
  assert.deepEqual(gitSubcommands('git -C "" commit -m x'), ['commit']);
  assert.deepEqual(gitSubcommands(' git push'), ['push']);
  // A tool block with no name, and a result with no id, are nothing; a block's input that is no object reads as none.
  const bad = [
    line(
      at,
      'a',
      {},
      {
        content: [
          { type: 'tool_use', id: 'n1', name: 7, input: {} },
          { type: 'tool_use', id: 'n2', name: 'Bash', input: null },
        ],
      },
    ),
    { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 9, content: 'x' }] } },
  ];
  assert.deepEqual(
    usesOf(bad).map((u) => [u.id, u.input]),
    [['n2', {}]],
  );
  assert.deepEqual(resultsOf(bad), []);
  // A cache rebuilt is past 20,000 tokens and more than half of them written: at either line, not.
  const c = (write: number, read: number) => callsOf([line(at, 'a', { write5m: write, read })])[0]!;
  assert.equal(rebuiltCache(c(20_000, 0)), false);
  assert.equal(rebuiltCache(c(15_000, 15_000)), false);
  assert.equal(rebuiltCache(c(15_001, 15_000)), true);
});

test('traces at their edges: a prompt of exactly 400k, a second rebuild, a notebook written, a test command elsewhere, two days exactly', () => {
  const lines = [
    line('2026-10-17T10:00:00.000Z', 'a', { write5m: 30_000 }, { content: [use('x1', 'mcp__srv__run', { command: 'npm test' })] }),
    line('2026-10-17T10:01:00.000Z', 'b', { write5m: 30_000 }),
    line('2026-10-17T10:02:00.000Z', 'c', { write5m: 30_000, read: 370_000 }),
    line(
      '2026-10-17T10:03:00.000Z',
      'd',
      { read: 400_000 },
      { content: [use('nb', 'NotebookEdit', { notebook_path: 'a.ipynb' }), ...bash('git commit -m one')] },
    ),
    line('2026-10-19T10:03:00.000Z', 'e', { read: 100 }, { content: [use('nb2', 'NotebookEdit', { notebook_path: 'a.ipynb' })] }),
  ];
  const [first, second] = tasksOf(callsOf(lines), boundariesOf(lines), usesOf(lines), resultsOf(lines));
  assert.ok(first && second);
  assert.equal(first.traces.tested, false, 'npm test named by a tool that is no shell');
  assert.equal(first.traces.cacheRebuilds, 1, 'the second call rebuilt; the third read most of its prompt');
  assert.equal(first.traces.large, 0, 'exactly 400k is not past it');
  assert.deepEqual(first.traces.files, ['a.ipynb']);
  assert.deepEqual(first.traces.touchedAgain, ['a.ipynb'], 'written again exactly 48 hours later');
  const two = tasksOf(callsOf([lines[0]!, lines[1]!, line('2026-10-17T10:02:00.000Z', 'c2', { write5m: 30_000 })]), []);
  assert.equal(two[0]!.traces.cacheRebuilds, 2);
});

test("the days and the readings at their edges: a call at the start is in; a call at a week's first reading is not, at its last it is", () => {
  const since = Date.parse('2026-10-17T10:00:00.000Z');
  const calls = callsOf([line('2026-10-17T10:00:00.000Z', 'a', { output: 1e6 }), line('2026-10-17T12:00:00.000Z', 'b', { output: 1e6 })]);
  assert.equal(windowOf(calls, [], since).calls.length, 2);
  const readings = [
    { at: Date.parse('2026-10-17T10:00:00.000Z'), week: 10, weekResetsAt: 1 },
    { at: Date.parse('2026-10-17T12:00:00.000Z'), week: 11, weekResetsAt: 1 },
  ];
  assert.ok(Math.abs(unitsPerPoint(readings, calls)!.units - 20 * 1.92) < 1e-9, 'only the call at the last reading');
  const r = (o: Record<string, unknown>) => ({ kind: 'reading', at: 5, week: 3, weekResetsAt: 1, ...o });
  assert.deepEqual(readingsOf([r({ kind: 'sync' }), r({ at: 'x' }), r({ week: null }), r({ weekResetsAt: undefined })]), []);
});

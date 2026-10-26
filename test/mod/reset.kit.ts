// SPDX-License-Identifier: Apache-2.0
/**
 * The reset at a task boundary inside Claude Code's engine (src/core/reset.ts, docs/quota.md): in autonomous work a
 * commit or a push with a large context arms it; the calls that finish that work pass; the next task's first call is
 * refused, a note is asked of the conversation itself, the turn ends, /clear runs, and the conversation it clears to
 * takes up the way of working, what the belt knows, the flow and the note. The world beneath is in memory (world.ts);
 * Claude Code's /clear is the test's own: the session ends and goes on under a new id.
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, PROJECT, SESSION } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const call = async ($: any, tool: string, input: Record<string, unknown>, id: string) => (await $.tool.call({ tool, ...input, tool_use_id: id } as any)) as any;
const strip = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 } } as any;
const NEXT = `${SESSION}-next`;
const NOTE = {
  summary: 'The parser is in; its tests pass.',
  open: 'The docs.',
  decisions: 'Keep the old flag (the person: "eskisi kalsın").',
  next: 'Write docs/parser.md.',
};
const forked = (note: Record<string, unknown> = NOTE) => ({
  isAnswered: true,
  text: '```json\n' + JSON.stringify(note) + '\n```',
  usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 240_000 },
});

/** Claude Code beneath: the context's size, the fork, the turn and its end, the agents, and /clear: the session ends, then goes on under a new id. */
function engine($: any, on: any, session: { id: string }, o: { tokens?: number; fork?: () => any; clearFails?: boolean; agents?: any[] } = {}) {
  const size = { tokens: o.tokens ?? 250_000 };
  const forks: string[] = [];
  const aborted: string[] = [];
  let clears = 0;
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: size.tokens, window: 1_000_000, percent: 25 }, rateLimits: [] } }));
  on('model.fork', (_$: any, e: any) => {
    forks.push(e.prompt);
    return { value: o.fork ? o.fork() : forked() };
  });
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('turn.abort', (_$: any, e: any) => {
    aborted.push(e.turnId);
    return { value: undefined };
  });
  on('agent.list', () => ({ value: o.agents ?? [] }));
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  on('command.run', { command: 'clear' }, async () => {
    clears++;
    if (o.clearFails) throw new Error('the host has ended its input');
    await $.session.end({ reason: 'clear', sessionId: session.id, resume: {} });
    session.id = NEXT;
    return { text: '' };
  });
  return {
    size,
    forks,
    aborted,
    get clears() {
      return clears;
    },
  };
}

/** The reset's steps run from a timer, one after another: the clock moves them, and every step they await settles. */
async function settle(w: ReturnType<typeof world>): Promise<void> {
  await w.clock.advance(5);
  for (let i = 0; i < 600; i++) await Promise.resolve();
}

async function band($: any): Promise<string | null> {
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: strip } as any);
  const t = (await ui.findAll({ type: 'Text' })).find((x: any) => /^✓ (?:commit|push):/.test(String(x.text)))?.text ?? null;
  await ui.unmount();
  return t;
}

const notesIn = (w: ReturnType<typeof world>) => [...w.files.keys()].filter((p) => p.startsWith(`${DATA}/handoffs/`));
const resets = (w: ReturnType<typeof world>) => w.events().filter((e: any) => e.kind === 'reset');

test("autonomous: the work's own calls pass, the next task's first call resets, and the work goes on in a new conversation", async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  const cc = engine($, on, session);
  await $.prompt.submit(typed('autonomous'));
  await $.prompt.submit(typed('Add the parser.'));
  await $.turn.start({ text: 'Add the parser.', turnId: 't1' } as any);
  expect((await call($, 'Bash', { command: 'git add -A && git commit -s -m "feat: add the parser"' }, 'b1')).deny).toBe(undefined);
  // Armed: the strip says nothing, and the calls that finish the work pass.
  expect(await band($)).toBe(null);
  for (const [tool, input] of [
    ['Bash', { command: 'git push -u origin feat/parser' }],
    ['Bash', { command: 'git status --short && git log --oneline -1' }],
    ['TodoWrite', { todos: [] }],
  ] as const)
    expect((await call($, tool, input, `f-${tool}`)).deny).toBe(undefined);
  expect(cc.forks).toEqual([]);
  // The next task's first call: refused, and the note asked of the conversation itself.
  const r = await call($, 'Read', { file_path: `${PROJECT}/src/docs.ts` }, 'r1');
  expect(r.deny).toMatch(/^\[Mode_Code\] Stop here: the piece of work is committed, and Mode_Code resets the conversation now/);
  expect(w.reached).not.toContain('Read');
  expect(cc.forks.length).toBe(1);
  expect(cc.forks[0]).toMatch(/Do not call any tool\. Reply with one JSON object only/);
  const [path] = notesIn(w);
  expect(notesIn(w).length).toBe(1);
  expect(w.read(path!)).toMatch(/trigger: reset/);
  expect(w.read(path!)).toMatch(/## Decisions\n\nKeep the old flag \(the person: "eskisi kalsın"\)\./);
  expect(w.read(path!)).toMatch(/- Last request: Add the parser\./);
  // From the timer: the turn ends, /clear runs, and the prompt goes on with the work.
  expect(cc.aborted).toEqual([]);
  await settle(w);
  expect(cc.aborted).toEqual(['t1']);
  expect(cc.clears).toBe(1);
  expect(session.id).toBe(NEXT);
  const sent = w.submitted.at(-1)!;
  expect(sent).toMatch(/^\[Mode_Code\] The conversation was reset at a task boundary to save tokens: it had 250 K of context/);
  expect(sent).toContain(`(its file: ${path})`);
  expect(sent).toMatch(/Session state, carried over: the person asked for autonomous work\./);
  expect(sent).toMatch(/## Next\n\nWrite docs\/parser\.md\./);
  // The new conversation works as the old one did; its end wrote no second note.
  expect(w.modState(NEXT)).toMatchObject({ sessionId: NEXT, interaction: 'autonomous' });
  expect(notesIn(w).length).toBe(1);
  // With the prompt: no keyword read in the note, no line pointing at the same note again.
  const told = w.contexts.at(-1)!.join('\n');
  expect(told).not.toMatch(/Keyword "|A handoff note for this project is waiting/);
  expect(w.toasts).toContain('♻ Reset at a task boundary (250 K of context): the work goes on, with a note.');
  expect(resets(w).map((e: any) => [e.phase, e.session])).toEqual([
    ['start', SESSION],
    ['carried', NEXT],
  ]);
  expect(resets(w)[0]).toMatchObject({ tokens: 250_000, tool: 'Read', fork: { in: 10, out: 200, cached: 240_000 } });
  // What it read again before its first change, logged once.
  cc.size.tokens = 60_000;
  await call($, 'Read', { file_path: `${PROJECT}/src/docs.ts` }, 'n1');
  cc.size.tokens = 75_000;
  await call($, 'Read', { file_path: `${PROJECT}/src/b.ts` }, 'n2');
  await call($, 'Write', { file_path: `${PROJECT}/docs/parser.md`, content: 'x' }, 'n3');
  await call($, 'Write', { file_path: `${PROJECT}/docs/more.md`, content: 'x' }, 'n4');
  expect(w.events().filter((e: any) => e.kind === 'resetRead')).toEqual([
    expect.objectContaining({ session: NEXT, before: 250_000, first: 60_000, ready: 75_000, calls: 3 }),
  ]);
});

test("full autonomy: the reset carries full autonomy, the outside content read, the person's words and the quota resume", async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  engine($, on, session);
  await $.prompt.submit(typed('full auto'));
  await $.prompt.submit(typed('Fix the login bug on example.org.'));
  await $.turn.start({ text: 'Fix it.', turnId: 't1' } as any);
  await call($, 'WebFetch', { url: 'https://example.com/issue/7', prompt: 'read' }, 'w1');
  expect(w.modState().tainted).toMatchObject({ source: 'WebFetch' });
  await call($, 'Bash', { command: 'git commit -s -m "fix: the login"' }, 'b1');
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r1')).deny).toMatch(/Stop here/);
  await settle(w);
  const next = w.modState(NEXT);
  expect(next).toMatchObject({ interaction: 'full', tainted: { source: 'WebFetch' }, resumeAt: null, approvals: [] });
  expect(w.json(`${DATA}/state/sessions/${NEXT}.prov.json`).said).toContain('Fix the login bug on example.org.');
  // The prompt it goes on with is no word of the person's.
  expect(w.json(`${DATA}/state/sessions/${NEXT}.prov.json`).said.some((s: string) => /reset at a task boundary/.test(s))).toBe(false);
  expect(w.submitted.at(-1)).toMatch(/Session state, carried over: the person chose full autonomy: ask nothing; list each step left to them/);
});

test('a running flow goes on in the new conversation at its step', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  engine($, on, session);
  const now = w.clock.now();
  const flow = {
    v: 1,
    id: 'f-code',
    variant: 'plan',
    task: 'Speed up the start.',
    project: null,
    cwd: PROJECT,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    current: 2,
    steps: [
      { kind: 'plan', status: 'done', startedAt: now, doneAt: now, evidence: null },
      { kind: 'approve', status: 'done', startedAt: now, doneAt: now, evidence: null },
      { kind: 'code', status: 'active', startedAt: now, doneAt: null, evidence: null },
    ],
    sessionId: SESSION,
    workDir: '/tmp/mode-code/flows/f-code',
    reportPath: '/tmp/mode-code/flows/f-code/research.md',
    planPath: '/tmp/mode-code/flows/f-code/plan.md',
    approval: { at: now, via: 'dialog' },
    verification: ['npm test'],
    history: [],
  };
  w.write(`${DATA}/flows/f-code/flow.json`, JSON.stringify(flow));
  w.write(
    `${DATA}/state/sessions/${SESSION}.mod.json`,
    JSON.stringify({ v: 1, sessionId: SESSION, aliveAt: now, cwd: PROJECT, modVersion: 'x', mode: 'free', interaction: 'autonomous', flowId: 'f-code' }),
  );
  await $.prompt.submit(typed('Next part.'));
  await $.turn.start({ text: 'Next part.', turnId: 't1' } as any);
  await call($, 'Bash', { command: 'git commit -s -m "perf: start faster"' }, 'b1');
  expect((await call($, 'Edit', { file_path: `${PROJECT}/src/b.ts`, old_string: 'a', new_string: 'b' }, 'e1')).deny).toMatch(/Stop here/);
  await settle(w);
  const f = w.json(`${DATA}/flows/f-code/flow.json`);
  expect([f.status, f.sessionId, f.current]).toEqual(['active', NEXT, 2]);
  expect(w.modState(NEXT)).toMatchObject({ flowId: 'f-code', interaction: 'autonomous' });
  expect(w.submitted.at(-1)).toMatch(/a flow runs \(f-code, task "Speed up the start\."\).*finish the code step and call mcp__mode-code__flow_step/);
});

test('no reset in manual, with the setting off, or under the threshold: the strip says /clear instead, or nothing', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session, answer: 'allow' });
  const cc = engine($, on, session);
  await $.prompt.submit(typed('manual'));
  await call($, 'Bash', { command: 'git commit -m one' }, 'b1');
  expect(await band($)).toMatch(/^✓ commit: a good moment for \/clear before the next task; every call reads the 250 K of context again\./);
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r1')).deny).toBe(undefined);
  await $.prompt.submit(typed('autonomous'));
  cc.size.tokens = 199_999;
  await call($, 'Bash', { command: 'git commit -m two' }, 'b2');
  expect(await band($)).toBe(null);
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r2')).deny).toBe(undefined);
  cc.size.tokens = 400_000;
  w.write(`${DATA}/config.json`, JSON.stringify({ language: 'en', quota: { autoReset: false } }));
  await $.prompt.submit(typed('go on'));
  await call($, 'Bash', { command: 'git commit -m three' }, 'b3');
  expect(await band($)).toMatch(/^✓ commit: /);
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r3')).deny).toBe(undefined);
  // The threshold is the setting's, for the hint as for the reset.
  w.write(`${DATA}/config.json`, JSON.stringify({ language: 'en', quota: { autoReset: false, resetTokens: 500_000 } }));
  await $.prompt.submit(typed('go on'));
  await call($, 'Bash', { command: 'git commit -m four' }, 'b4');
  expect(await band($)).toBe(null);
  expect(cc.forks).toEqual([]);
  expect(cc.clears).toBe(0);
});

test('the turn that ends by itself waits for the person: no reset, the strip says /clear', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  const cc = engine($, on, session);
  await $.prompt.submit(typed('autonomous'));
  await $.turn.start({ text: 'x', turnId: 't1' } as any);
  await call($, 'Bash', { command: 'git commit -m done' }, 'b1');
  expect(await band($)).toBe(null);
  await $.turn.complete({ answer: 'Done. Shall I go on?', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(await band($)).toMatch(/^✓ commit: /);
  await $.prompt.submit(typed('yes, the docs now'));
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r1')).deny).toBe(undefined);
  expect(cc.forks).toEqual([]);
  expect(resets(w)).toEqual([]);
});

test('agents at work, background work, a wrap-up or a reset a moment ago: no reset, said in the activity, the hint instead', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  const agents: any[] = [{ id: 'a1', status: 'running', type: 'Explore', description: 'look' }];
  const cc = engine($, on, session, { agents });
  await $.prompt.submit(typed('autonomous'));
  const boundary = async (id: string) => {
    await call($, 'Bash', { command: `git commit -m ${id}` }, `c-${id}`);
    return call($, 'Read', { file_path: `${PROJECT}/${id}.ts` }, `r-${id}`);
  };
  expect((await boundary('agents')).deny).toBe(undefined);
  expect(await band($)).toMatch(/^✓ commit: /);
  agents.length = 0;
  await call($, 'Bash', { command: 'npm run watch', run_in_background: true }, 'bg');
  expect((await boundary('background')).deny).toBe(undefined);
  // The background work reported back: the next boundary resets.
  await $.prompt.submit({ text: '<task-notification>done</task-notification>', wait: false, origin: { kind: 'task-notification' } } as any);
  await $.prompt.submit(typed('wrap up'));
  expect((await boundary('wrapUp')).deny).toBe(undefined);
  await $.prompt.submit(typed('continue'));
  expect((await boundary('goes')).deny).toMatch(/Stop here/);
  await settle(w);
  // A reset a moment ago: the next boundary in the new conversation waits.
  await $.turn.start({ text: 'x', turnId: 't2' } as any);
  expect((await boundary('recent')).deny).toBe(undefined);
  expect(resets(w).map((e: any) => (e.phase === 'skip' ? e.why : e.phase))).toEqual(['busy', 'busy', 'wrapUp', 'start', 'carried', 'recent']);
  expect(cc.clears).toBe(1);
  // A skip that is no failure is quiet: no toast says it.
  expect(w.toasts.some((t: string) => /No reset/.test(t))).toBe(false);
});

test('a note that cannot be had leaves the conversation as it is: the call goes on, a toast says why, the hint shows', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session });
  const answers = [
    { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { input_tokens: 0, output_tokens: 0 } },
    forked({ summary: 'x', open: 'y', decisions: 'z' }),
    forked({ ...NOTE, next: `push with ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}` }),
  ];
  const cc = engine($, on, session, { fork: () => answers.shift() });
  await $.prompt.submit(typed('autonomous'));
  for (const id of ['api', 'missing', 'secret']) {
    await call($, 'Bash', { command: `git commit -m ${id}` }, `c-${id}`);
    expect((await call($, 'Read', { file_path: `${PROJECT}/${id}.ts` }, `r-${id}`)).deny).toBe(undefined);
    expect(await band($)).toMatch(/^✓ commit: /);
  }
  expect(cc.forks.length).toBe(3);
  expect(cc.clears).toBe(0);
  expect(notesIn(w)).toEqual([]);
  expect(resets(w).map((e: any) => e.why)).toEqual(['fork', 'note', 'note']);
  expect(resets(w)[1].problems).toEqual(['next missing']);
  expect(resets(w)[2].problems).toEqual(['next secret']);
  expect(w.toasts.filter((t: string) => /^♻ No reset/.test(t))).toEqual([
    '♻ No reset at this task boundary (the note could not be asked for): the work goes on in this conversation.',
    '♻ No reset at this task boundary (the note came back incomplete): the work goes on in this conversation.',
    '♻ No reset at this task boundary (the note came back incomplete): the work goes on in this conversation.',
  ]);
});

test('a /clear Claude Code refuses: the turn was ended for it, so the work goes on in this conversation', async ($, on) => {
  const session = { id: SESSION };
  const w = world(on, { session, lang: 'tr' });
  const cc = engine($, on, session, { clearFails: true });
  await $.prompt.submit(typed('otonom'));
  await $.turn.start({ text: 'x', turnId: 't1' } as any);
  await call($, 'Bash', { command: 'git commit -m bir' }, 'b1');
  expect((await call($, 'Read', { file_path: `${PROJECT}/a.ts` }, 'r1')).deny).toMatch(/^\[Mode_Code\] Burada dur: iş parçası commit'lendi/);
  await settle(w);
  expect(cc.aborted).toEqual(['t1']);
  expect(session.id).toBe(SESSION);
  expect(w.submitted.at(-1)).toBe('[Mode_Code] Sıfırlama olmadı (Claude Code konuşmayı temizlemedi); bu konuşma sürüyor. Sonraki adımla devam et.');
  // Mode_Code's own words: "devam et" at its end is no keyword.
  expect(w.contexts.at(-1)!.join('\n')).not.toMatch(/Keyword|Anahtar kelime/);
  expect(w.toasts).toContain('♻ Bu görev sınırında sıfırlama olmadı (Claude Code konuşmayı temizlemedi): iş bu konuşmada sürüyor.');
  expect(resets(w).map((e: any) => e.phase + (e.why ? `:${e.why}` : ''))).toEqual(['start', 'skip:clear']);
  // Nothing carried waits: the person's own /clear later takes up the last choice, as always.
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} } as any);
  session.id = 'kit-session-3';
  await $.prompt.submit(typed('merhaba'));
  expect(w.modState('kit-session-3')).toMatchObject({ interaction: 'autonomous', tainted: null });
  expect(w.toasts.filter((t: string) => /^♻ Konuşma/.test(t))).toEqual([]);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Modes and flows inside Claude Code's engine: mode keywords and what each mode refuses, a flow from its
 * keyword to its end through the flow_step tool (checks, the approval dialog, the verification commands run
 * through the shell tool), Claude Code's plan dialog as the approval, pause and resume, cancel. The world
 * beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const WORK = '/tmp/mode-code/flows';
const STEP = 'mcp__mode-code__flow_step';
const step = (s: string) => ({ tool: STEP, step: s }) as any;

const REPORT = `# Sign-in

## Findings

- The handler is in one file [1].

## Sources

1. src/login.ts:2
`;
const PLAN = `# Plan

## Steps

### 1. Ask for the code

Acceptance: a wrong code is refused.

## Verification

- \`npm test\`
`;

function flowOf(w: ReturnType<typeof world>): any {
  const id = w.modState()?.flowId;
  return id ? w.json(`/home/ada/.mode-code/flows/${id}/flow.json`) : null;
}

test('a mode keyword sets the mode; research refuses project writes and unknown programs, allows its work folder and reads', async ($, on) => {
  const w = world(on);
  const r: any = await $.prompt.submit(typed('research'));
  expect(r.context.join('\n')).toMatch(/Keyword "research": research mode/);
  expect(w.modState().mode).toBe('research');
  const write: any = await $.tool.call({ tool: 'Write', file_path: '/home/ada/dev/app/a.ts', content: 'x' } as any);
  expect(write.deny).toMatch(/^🔍 research mode: writing \/home\/ada\/dev\/app\/a\.ts is outside/);
  const report: any = await $.tool.call({ tool: 'Write', file_path: `${WORK}/notes.md`, content: 'x' } as any);
  expect(report.deny).toBeUndefined();
  const test: any = await $.tool.call({ tool: 'Bash', command: 'npm test' } as any);
  expect(test.deny).toMatch(/`npm` may change files around the folder it runs in/);
  const read: any = await $.tool.call({ tool: 'Bash', command: 'rg -n login src | head' } as any);
  expect(read.deny).toBeUndefined();
  expect(w.events().some((e: any) => e.kind === 'mode' && e.mode === 'research' && e.what === 'file')).toBe(true);
  // "continue" keeps research (only chat is left by continue); "free" ends it.
  await $.prompt.submit(typed('continue'));
  expect(w.modState().mode).toBe('research');
  await $.prompt.submit(typed('free'));
  const after: any = await $.tool.call({ tool: 'Write', file_path: '/home/ada/dev/app/a.ts', content: 'x' } as any);
  expect(after.deny).toBeUndefined();
});

test('a full flow: research, plan, the approval dialog and the verification run, none skipped', async ($, on) => {
  const w = world(on, { answer: 'allow' });
  const r: any = await $.prompt.submit(typed('Add a second sign-in factor. flow'));
  expect(r.context.join('\n')).toMatch(
    /started a flow: \[🔍 research\] ▶ 📐 plan → ⏸ approval → 🔨 code\. Task, in the person's words: "Add a second sign-in factor\."/,
  );
  let f = flowOf(w);
  expect(f.status).toBe('active');
  expect(f.reportPath).toBe(`${WORK}/${f.id}/research.md`);
  expect(w.toasts.some((t) => /^Flow started/.test(t))).toBe(true);

  // A step that is not the current one is refused; so is a project write in the research step.
  const skip: any = await $.tool.call(step('code'));
  expect(String(skip.result)).toMatch(/The flow is at its 🔍 research step, not 🔨 code: steps run in order/);
  const early: any = await $.tool.call({ tool: 'Edit', file_path: '/home/ada/dev/app/src/login.ts', old_string: 'a', new_string: 'b' } as any);
  expect(early.deny).toMatch(/The flow is at its 🔍 research step\. Finish the step and call flow_step/);

  // No report yet, then a report that cites a file that does not exist, then a good one.
  expect(String(((await $.tool.call(step('research'))) as any).result)).toMatch(/The report .*research\.md does not exist yet/);
  w.write(f.reportPath, REPORT);
  expect(String(((await $.tool.call(step('research'))) as any).result)).toMatch(/Source 1, src\/login\.ts, does not exist/);
  w.write('/home/ada/dev/app/src/login.ts', 'line 1\nline 2\n');
  const done: any = await $.tool.call(step('research'));
  expect(String(done.result)).toMatch(/The research step is done: 1 finding and 1 source checked/);
  expect(String(done.result)).toMatch(/Next, 📐 plan: write the plan to .*plan\.md/);
  expect(w.read(`/home/ada/.mode-code/flows/${f.id}/research.md`)).toBe(REPORT);

  // The plan, checked; the dialog asks the person, who approves; the commands are the approved plan's.
  w.write(flowOf(w).planPath, PLAN);
  const planned: any = await $.tool.call(step('plan'));
  expect(w.asked.at(-1)).toMatch(/The plan is ready: 1 step, verified by `npm test`\./);
  expect(String(planned.result)).toMatch(/The person approved the plan\.\nNext, 🔨 code: implement the approved plan/);
  f = flowOf(w);
  expect([f.status, f.steps[2].status, f.approval.via, f.verification]).toEqual(['active', 'done', 'dialog', ['npm test']]);
  expect(w.read(`/home/ada/.mode-code/flows/${f.id}/plan.md`)).toBe(PLAN);

  // The code step runs the verification through the shell tool; the flow then ends and lets the session go.
  const coded: any = await $.tool.call(step('code'));
  expect(String(coded.result)).toMatch(/The code step is done: 1 verification command passed/);
  expect(w.calls.some((c: any) => c.tool === 'Bash' && c.command === 'npm test')).toBe(true);
  const final = w.json(`/home/ada/.mode-code/flows/${f.id}/flow.json`);
  expect(final.status).toBe('done');
  expect(w.modState().flowId).toBe(null);
  expect(
    w
      .events()
      .filter((e: any) => e.kind === 'flow')
      .map((e: any) => e.action),
  ).toEqual(expect.arrayContaining(['start', 'refused', 'done', 'approve']));
});

test('a failing verification keeps the code step open and shows the end of the output', async ($, on) => {
  const w = world(on, {
    answer: 'allow',
    results: {
      Bash: (e: any) =>
        e.command === 'npm test' ? { isError: true, result: 'Error: Exit code 1\n1 failing', text: 'Exit code 1\n1 failing' } : { result: 'ran' },
    },
  });
  await $.prompt.submit(typed('flow plan'));
  w.write(flowOf(w).planPath, PLAN);
  await $.tool.call(step('plan'));
  const r: any = await $.tool.call(step('code'));
  expect(String(r.result)).toMatch(
    /The code step is not done: `npm test` exited with code 1 \(it ran in \/home\/ada\/dev\/app\)\. The end of its output:\nExit code 1\n1 failing/,
  );
  expect(flowOf(w).status).toBe('active');
});

test('no one to ask: the plan waits; "approve" typed by the person approves it; the quota resume waits for it', async ($, on) => {
  const w = world(on, { answer: 'nobody' });
  await $.prompt.submit(typed('flow plan'));
  w.write(flowOf(w).planPath, PLAN);
  const r: any = await $.tool.call(step('plan'));
  expect(String(r.result)).toMatch(/The plan waits for the person's approval\. Stop here/);
  expect(flowOf(w).status).toBe('waiting');
  // Code cannot change the project while the plan waits.
  const write: any = await $.tool.call({ tool: 'Write', file_path: '/home/ada/dev/app/a.ts', content: 'x' } as any);
  expect(write.deny).toMatch(/^📐 plan mode/);
  // "approve" inside a sentence is not an approval.
  await $.prompt.submit(typed('I read it. approve'));
  expect(flowOf(w).status).toBe('waiting');
  const ok: any = await $.prompt.submit(typed('approve'));
  expect(ok.context.join('\n')).toMatch(/The person approved the plan by typing\. Next, 🔨 code/);
  expect(flowOf(w).approval.via).toBe('keyword');
});

test("changes asked in the dialog send the plan back to its step with the person's words", async ($, on) => {
  const w = world(on, { answer: { typed: 'Split step 1 in two' } });
  await $.prompt.submit(typed('flow plan'));
  w.write(flowOf(w).planPath, PLAN);
  const r: any = await $.tool.call(step('plan'));
  expect(String(r.result)).toMatch(/The person wants changes to the plan: "Split step 1 in two"/);
  expect(flowOf(w).steps[0].status).toBe('active');
});

test('pausing in the dialog pauses the flow at the approval', async ($, on) => {
  const w = world(on, { answer: 'third' });
  await $.prompt.submit(typed('flow plan'));
  w.write(flowOf(w).planPath, PLAN);
  const r: any = await $.tool.call(step('plan'));
  expect(String(r.result)).toMatch(/The person paused the flow at the approval/);
  expect(flowOf(w).status).toBe('paused');
});

test('stop pauses the flow, continue resumes it at its step; a mode keyword alone pauses it, at a message end it is a word', async ($, on) => {
  const w = world(on);
  await $.prompt.submit(typed('flow'));
  await $.prompt.submit(typed('stop'));
  expect(flowOf(w).status).toBe('paused');
  const paused: any = await $.tool.call(step('research'));
  expect(String(paused.result)).toMatch(/The flow is paused at its 🔍 research step/);
  const back: any = await $.prompt.submit(typed('continue'));
  expect(back.context.join('\n')).toMatch(/The person resumed the flow/);
  expect(flowOf(w).status).toBe('active');

  // A mode word at the end of a longer message is a word (2026-10-13): the flow and its step's mode stay.
  const turn: any = await $.prompt.submit(typed('Fix the typo in the README.\ncode'));
  expect(turn.context.join('\n')).not.toMatch(/code mode/);
  expect(((await $.tool.call({ tool: 'Write', file_path: '/home/ada/dev/app/README.md', content: 'x' } as any)) as any).deny).toMatch(/research mode/);

  // "chat" alone: the flow pauses and chat mode holds.
  const chat: any = await $.prompt.submit(typed('chat'));
  expect(chat.context.join('\n')).toMatch(/switched to chat mode: .* The flow is paused at its 🔍 research step/);
  expect([flowOf(w).status, w.modState().mode]).toEqual(['paused', 'chat']);
});

test('flow cancel ends the flow and frees the session; a second flow is refused while one runs', async ($, on) => {
  const w = world(on);
  await $.prompt.submit(typed('flow'));
  const id = w.modState().flowId;
  await $.prompt.submit(typed('flow plan'));
  expect(w.toasts.some((t) => /A flow is already running here/.test(t))).toBe(true);
  expect(w.modState().flowId).toBe(id);
  await $.prompt.submit(typed('flow cancel'));
  expect(w.json(`/home/ada/.mode-code/flows/${id}/flow.json`).status).toBe('canceled');
  expect(w.modState().flowId).toBe(null);
});

test("Claude Code's plan mode: its notes put the session in plan mode, its plan dialog approves the flow's plan after the check", async ($, on) => {
  const w = world(on);
  on('prompt.attachment', (_$: any, e: any) => ({ text: e.text }));
  await $.prompt.submit(typed('flow plan'));
  await $.prompt.attachment({
    type: 'plan_mode',
    origin: { kind: 'engine' },
    text: 'plan mode',
    detail: { reminder: 'full', planFilePath: '/home/ada/.claude/plans/p.md', hasPlan: false },
  } as any);
  expect(w.modState().nativePlan).toMatchObject({ on: true, planFile: '/home/ada/.claude/plans/p.md' });
  // A plan that fails its check never reaches the dialog.
  w.write('/home/ada/.claude/plans/p.md', '# Plan\n\nJust do it.\n');
  const bad: any = await $.tool.call({ tool: 'ExitPlanMode' } as any);
  expect(bad.deny).toMatch(/There is no Steps section/);
  expect(w.reached.includes('ExitPlanMode')).toBe(false);
  w.write('/home/ada/.claude/plans/p.md', PLAN);
  const good: any = await $.tool.call({ tool: 'ExitPlanMode' } as any);
  expect(good.deny).toBeUndefined();
  expect((good.context ?? []).join('\n')).toMatch(/The person approved the plan\.\nNext, 🔨 code/);
  expect(flowOf(w).approval.via).toBe('plan-mode');
});

test('the flow survives a compaction: its step is restated', async ($, on) => {
  const w = world(on);
  let instructions = '';
  on('session.compact', (_$: any, e: any) => {
    instructions = e.instructions ?? '';
    return { messages: e.messages };
  });
  await $.prompt.submit(typed('flow'));
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'so far', toolUses: [] }] } as any);
  expect(instructions).toMatch(/a flow runs \(.*\): \[🔍 research\] ▶ 📐 plan → ⏸ approval → 🔨 code; finish the research step/);
  void w;
});

test('the flow_step tool is registered at the start of a session', async ($, on) => {
  const w = world(on);
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: '/home/ada/dev/app' } as any);
  expect(w.registered.map((r: any) => r.name)).toContain('flow_step');
  expect(w.registered[0].isDeferred).toBe(false);
});

test("a plan written to the flow's own file is found while Claude Code's plan mode is on (it may have been switched on later)", async ($, on) => {
  const w = world(on);
  on('prompt.attachment', (_$: any, e: any) => ({ text: e.text }));
  await $.prompt.submit(typed('flow plan'));
  await $.prompt.attachment({
    type: 'plan_mode',
    origin: { kind: 'engine' },
    text: 'plan mode',
    detail: { reminder: 'full', planFilePath: '/home/ada/.claude/plans/q.md', hasPlan: false },
  } as any);
  w.write(flowOf(w).planPath, PLAN);
  const r: any = await $.tool.call({ tool: 'ExitPlanMode' } as any);
  expect(r.deny).toBeUndefined();
  expect(flowOf(w).approval.via).toBe('plan-mode');
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Full autonomy inside Claude Code's engine (docs/autonomy.md): the start checks and the live sandbox probe,
 * a run from its keyword to its finish through the autonomy tool (the plan's check, milestones on commits
 * with a rollback reference and an independent review, the verification through the shell tool, the
 * report), what waits for the person, what a run never does, Claude Code's own permission questions,
 * pause and resume, a stop the safety-net hook let through. The world beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { DATA, PROJECT, SESSION, world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const TOOL = 'mcp__terminal-code__autonomy';
const auto = (action: string, more: Record<string, unknown> = {}) => ({ tool: TOOL, action, ...more }) as any;
const NOW = Date.parse('2026-10-12T10:00:00Z');
const PROBE_REFUSED = "touch: cannot touch '/home/ada/.terminal-code-sandbox-probe': Read-only file system";
const STRICT = { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false } };
const PLAN = `# Rate limiting

## Steps

### 1. The limiter

A token bucket in src/limiter.ts.
Acceptance: unit tests for the limiter pass.

### 2. Wire it in

Acceptance: the API answers 429 past the limit.

## Verification

- \`npm test\`
`;
const DRAFT = '# Rate limiting\n\n## Summary\n\nAdded a token bucket and wired it in.\n\n## Decisions\n\n- 100 requests a minute.\n';

/** A git work tree in memory: commits move HEAD, edits make the status dirty. */
function repo() {
  const st = { head: 'a'.repeat(40), status: '', refs: new Map<string, string>(), n: 0 };
  const git = (args: string[]) => {
    const a = args.join(' ');
    if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${PROJECT}\n` };
    if (a === 'rev-parse HEAD') return { exitCode: 0, stdout: `${st.head}\n` };
    if (a === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'run/limits\n' };
    if (args[0] === 'status') return { exitCode: 0, stdout: st.status };
    if (args[0] === 'update-ref') {
      st.refs.set(args[1]!, args[2]!);
      return { exitCode: 0, stdout: '' };
    }
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '1\n' };
    if (args[0] === 'log') return { exitCode: 0, stdout: `${st.head.slice(0, 7)} feat: a step\n` };
    if (args[0] === 'diff' && args[1] === '--stat') return { exitCode: 0, stdout: ' src/limiter.ts | 3 +++\n' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/limiter.ts b/src/limiter.ts\n+export const limit = 100;\n' };
    return undefined;
  };
  return {
    st,
    git,
    commit: () => {
      st.n++;
      st.head = String(st.n).padStart(40, String(st.n));
      st.status = '';
    },
    edit: () => {
      st.status = ' M src/limiter.ts\n';
    },
  };
}

type Opts = Parameters<typeof world>[1];

/** The distribution set up as docs/autonomy.md says, a quota reading, the hook's state, and a clean repository. */
function ready(on: any, extra: Opts = {}, config: Record<string, unknown> = {}) {
  const g = repo();
  const w = world(on, {
    env: { WSL_DISTRO_NAME: 'terminal-code' },
    settings: STRICT,
    git: g.git,
    config: { autonomy: { enabled: true }, projects: [{ id: 'app', names: ['app'], path: PROJECT, verify: ['npm run check'] }], ...config },
    ...extra,
    results: {
      Bash: (e: any) => (String(e.command).startsWith('touch ') ? { isError: true, result: PROBE_REFUSED, text: PROBE_REFUSED } : { result: 'ran' }),
      ...(extra.results ?? {}),
    },
  });
  w.write('/proc/sys/kernel/osrelease', '6.6.87.2-microsoft-standard-WSL2\n');
  w.write('/proc/mounts', '/dev/sdd / ext4 rw,relatime 0 0\ntmpfs /run tmpfs rw 0 0\n');
  w.write(
    `${DATA}/state/sessions/${SESSION}.hook.json`,
    JSON.stringify({ v: 1, sessionId: SESSION, lastRunAt: NOW, blocks: {}, permissionMode: 'bypassPermissions', permissionModeAt: NOW }),
  );
  w.write(
    `${DATA}/state/quota.json`,
    JSON.stringify({
      windows: [
        { kind: 'five_hour', used: 10, resetsAt: NOW + 3_600_000 },
        { kind: 'seven_day', used: 41, resetsAt: NOW + 4 * 86_400_000 },
      ],
      measuredAt: NOW,
      source: 'mod',
    }),
  );
  const run = () => {
    const id = w.modState()?.runId;
    return id ? w.json(`${DATA}/runs/${id}/run.json`) : null;
  };
  return { w, g, run };
}

test('nothing starts while a start check fails; each failed check is named for the person', async ($, on) => {
  const w = world(on, { config: {} });
  const r: any = await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  const said = r.context.join('\n');
  expect(said).toMatch(/asked for full autonomy, but \d+ start check\(s\) failed, so no run started/);
  expect(said).toMatch(/- Turned on: Full autonomy is off\. Turn it on in your own terminal: terminal-code autonomy enable\./);
  expect(said).toMatch(/- Project: The session does not run in a git work tree/);
  expect(w.toasts.some((t) => /Full autonomy did not start/.test(t))).toBe(true);
  expect(w.modState().runId).toBe(null);
  // Nothing was written outside the project to probe a sandbox that the other checks already ruled out.
  expect(w.calls.some((c: any) => c.tool === 'Bash')).toBe(false);
});

test('a budget is required; a write outside the project that goes through fails the probe and is cleaned up', async ($, on) => {
  const { w } = ready(on, {
    results: {
      Bash: (e: any) => {
        if (String(e.command).startsWith('touch ')) w.write('/home/ada/.terminal-code-sandbox-probe', '');
        return { result: '' };
      },
    },
  });
  const none: any = await $.prompt.submit(typed('Add rate limiting. app full auto'));
  expect(none.context.join('\n')).toMatch(/- Budget: No budget: end the message with a quota label/);
  const wrote: any = await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  expect(wrote.context.join('\n')).toMatch(/- Sandbox probe: A write outside the project went through/);
  expect(w.modState().runId).toBe(null);
});

test('a whole run: start, plan, milestones on commits with reviews, what waits for the person, finish and its report', async ($, on) => {
  let verdict = 'VERDICT: PASS';
  const { w, g, run } = ready(on, { review: () => ({ isAnswered: true, text: verdict, usage: { input_tokens: 1, output_tokens: 1 } }) });
  const r: any = await $.prompt.submit(typed('Add rate limiting to the API. app full auto quota +10'));
  const start = r.context.join('\n');
  expect(start).toMatch(/The person started full autonomy \(run \d{8}-\d{4}-add-rate-limiting-to-the, weekly budget 51%\)/);
  expect(start).toMatch(/"Add rate limiting to the API\."/);
  expect(start).toMatch(/`npm run check`/);
  expect(w.calls.find((c: any) => c.tool === 'Bash')?.command).toBe("touch '/home/ada/.terminal-code-sandbox-probe'");
  expect(w.registered.map((t: any) => t.name)).toContain('autonomy');
  let x = run();
  expect([x.status, x.phase, x.budget, x.start.commit, x.start.branch]).toEqual([
    'active',
    'plan',
    { weeklyTarget: 51, source: '+10' },
    'a'.repeat(40),
    'run/limits',
  ]);
  expect(g.st.refs.get(`refs/terminal-code/runs/${x.id}/0`)).toBe('a'.repeat(40));
  expect(w.modState().interaction).toBe('full');

  // Planning: the project does not change; the plan's own file does.
  const early: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/limiter.ts`, content: 'x' } as any);
  expect(early.deny).toMatch(/The full-autonomy run is planning: write the plan at .*plan\.md and call mcp__terminal-code__autonomy with action "plan"/);
  expect(String(((await $.tool.call(auto('milestone', { step: 1 }))) as any).result)).toMatch(/The plan is not accepted yet/);
  expect(String(((await $.tool.call(auto('plan'))) as any).result)).toMatch(/The plan does not pass its check yet/);
  w.write(x.planPath, PLAN);
  const planned: any = await $.tool.call(auto('plan'));
  expect(String(planned.result)).toMatch(
    /Plan accepted: 2 steps, 2 verification commands\.\nThe person's own commands for this project are part of the verification: `npm run check`\./,
  );
  expect(String(planned.result)).toMatch(/Next: step 1\/2: The limiter\. Acceptance: unit tests for the limiter pass\./);
  x = run();
  expect([x.phase, x.plan.verification]).toEqual(['work', ['npm test', 'npm run check']]);
  expect(w.read(`${DATA}/runs/${x.id}/plan.md`)).toBe(PLAN);

  // A milestone stands on a new, clean commit; a failed review refuses it; the next review passes.
  const write: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/limiter.ts`, content: 'x' } as any);
  expect(write.deny).toBeUndefined();
  expect(String(((await $.tool.call(auto('milestone', { step: 1 }))) as any).result)).toMatch(/A milestone stands on a new commit: HEAD is still aaaaaaaaaaaa/);
  g.edit();
  expect(String(((await $.tool.call(auto('milestone', { step: 1 }))) as any).result)).toMatch(/Commit the work first: 1 tracked file/);
  g.commit();
  expect(String(((await $.tool.call(auto('milestone', { step: 2 }))) as any).result)).toMatch(/The next step is 1: The limiter/);
  verdict = 'VERDICT: FAIL\n- the limiter is never called';
  const failed: any = await $.tool.call(auto('milestone', { step: 1 }));
  expect(String(failed.result)).toMatch(/The independent review failed this step:\n• the limiter is never called/);
  verdict = 'VERDICT: CONCERNS\n- no test for the reset window';
  const m1: any = await $.tool.call(auto('milestone', { step: 1, note: 'bucket in place' }));
  expect(String(m1.result)).toMatch(
    /Milestone 1\/2 accepted on 111111111111; rollback point refs\/terminal-code\/runs\/.*\/1\. Independent review: CONCERNS\./,
  );
  expect(String(m1.result)).toMatch(/The person's request, word for word: «Add rate limiting to the API\.»/);
  expect(String(m1.result)).toMatch(/Next: step 2\/2: Wire it in/);
  expect(g.st.refs.get(`refs/terminal-code/runs/${x.id}/1`)).toBe(g.st.head);
  // The review saw the request, the step and the diff, and none of the conversation.
  const asked = w.reviews.at(-1);
  expect(asked.model).toBe('claude-opus-5-5');
  expect(asked.system).toMatch(/You did not write this change and you have not seen the conversation/);
  expect(asked.prompt).toMatch(/## Under review: step 1\. The limiter/);
  expect(asked.prompt).toMatch(/\+export const limit = 100;/);

  // What waits for the person: refused as deferred, recorded, and the run goes on.
  const push: any = await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as any);
  expect(push.deny).toMatch(/^🤖 Full autonomy: deferred: git push origin main \(pushes to the protected branch main\)/);
  const forced: any = await $.tool.call({ tool: 'Bash', command: 'git push --force origin run/limits' } as any);
  expect(forced.deny).toMatch(/^🤖 Full autonomy: deferred: git push --force origin run\/limits .*\[git\.force-push\]/);
  expect(w.asked.length).toBe(0);
  const ask: any = await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any);
  expect(ask.deny).toMatch(/AskUserQuestion puts something to the person, and nobody is there/);
  const outside: any = await $.tool.call({ tool: 'Write', file_path: '/home/ada/other/notes.txt', content: 'x' } as any);
  expect(outside.deny).toMatch(/writes stay inside the project \(\/home\/ada\/dev\/app\)/);
  const escape: any = await $.tool.call({ tool: 'Bash', command: 'npm test', dangerouslyDisableSandbox: true } as any);
  expect(escape.deny).toMatch(/dangerouslyDisableSandbox is refused/);
  x = run();
  expect(x.deferred.map((d: any) => d.kind)).toEqual(['push', 'belt']);

  // The finish: every step, a clean tree, the report draft, the verification through the shell tool, the final review.
  g.commit();
  verdict = 'VERDICT: PASS';
  await $.tool.call(auto('milestone', { step: 2 }));
  const noDraft: any = await $.tool.call(auto('finish'));
  expect(String(noDraft.result)).toMatch(/The report draft is not complete:\n• The report draft .*report\.md does not exist yet/);
  w.write(run().reportPath, DRAFT);
  const done: any = await $.tool.call(auto('finish'));
  expect(String(done.result)).toMatch(/The run is done: 2 steps with milestones, 2 verification commands passed, final review PASS/);
  expect(w.calls.filter((c: any) => c.tool === 'Bash').map((c: any) => c.command)).toEqual(expect.arrayContaining(['npm test', 'npm run check']));
  expect(w.reviews.at(-1).prompt).toMatch(/## Under review: the whole run, every step, against the request/);
  expect(w.reviews.at(-1).prompt).toMatch(/## Findings of earlier reviews\n- step 1: no test for the reset window/);
  const final = w.json(`${DATA}/runs/${x.id}/run.json`);
  expect([final.status, final.finish.verification.length, final.finish.review.verdict]).toEqual(['done', 2, 'pass']);
  const report = w.read(`${DATA}/runs/${x.id}/report.md`)!;
  expect(report.startsWith(DRAFT.trim())).toBe(true);
  expect(report).toMatch(/## What terminal-code measured/);
  expect(report).toMatch(/\*\*push\*\* · Bash: `git push origin main`/);
  expect(w.notes.some((n) => /The full-autonomy run is done: Add rate limiting to the API\./.test(n))).toBe(true);
  expect([w.modState().runId, w.modState().interaction]).toEqual([null, 'default']);
});

test("the plan cannot drop the person's commands; a milestone cannot skip a step; a subagent cannot drive the run", async ($, on) => {
  const { w, run } = ready(on);
  await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  w.write(run().planPath, PLAN.replace('- `npm test`', '- `npm run lint`'));
  await $.tool.call(auto('plan'));
  expect(run().plan.verification).toEqual(['npm run lint', 'npm run check']);
  w.write(run().planPath, PLAN);
  const revised: any = await $.tool.call(auto('plan'));
  expect(String(revised.result)).toMatch(/A revised plan cannot drop verification commands; missing: `npm run lint`/);
  const agent: any = await $.tool.call({ ...auto('status'), agentId: 'sub-1' });
  expect(String(agent.result)).toMatch(/Only the main session drives the run/);
});

test("Claude Code's own permission question during a run is answered as deferred, never left waiting", async ($, on) => {
  const { run } = ready(on);
  on('tool.check', () => ({ decision: 'ask', reason: 'Edit outside the working directory' }));
  await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  const v: any = await ($.tool as any).check({ tool: 'Edit', input: { file_path: '/etc/hosts' }, tool_use_id: 'toolu_1' });
  expect(v.decision).toBe('deny');
  expect(v.reason).toMatch(/^🤖 Full autonomy: deferred: Edit \/etc\/hosts \(Edit outside the working directory\)/);
  expect(run().deferred.map((d: any) => d.kind)).toEqual(['permission']);
  // A query carries no call: the verdict beneath stands (the plugin answers real calls only).
  const q: any = await ($.tool as any).check({ tool: 'Edit', input: { file_path: '/etc/hosts' } });
  expect(q.decision).toBe('ask');
});

test('stop pauses the run with its report; continue runs the checks again and resumes it; compaction keeps the request', async ($, on) => {
  const { w, run } = ready(on);
  let instructions = '';
  on('session.compact', (_$: any, e: any) => {
    instructions = String(e.instructions ?? '');
    return { messages: e.messages };
  });
  await $.prompt.submit(typed('Add rate limiting to the API. app full auto quota +10'));
  const id = run().id;
  await $.prompt.submit(typed('dur'));
  expect([run().status, run().pause.reason]).toEqual(['paused', 'person']);
  expect(w.read(`${DATA}/runs/${id}/report.md`)).toMatch(/- Status: paused \(by you\)/);
  const blocked: any = await $.tool.call(auto('milestone', { step: 1 }));
  expect(String(blocked.result)).toMatch(/The run is paused \(by you\)\. The person resumes it with "continue"/);
  const back: any = await $.prompt.submit(typed('app continue'));
  expect(back.context.join('\n')).toMatch(/The full-autonomy run .* resumed\. The person's request, word for word: "Add rate limiting to the API\."/);
  expect(run().status).toBe('active');
  expect(w.calls.filter((c: any) => String(c.command).startsWith('touch ')).length).toBe(2);
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'so far', toolUses: [] }] } as any);
  expect(instructions).toMatch(/a full-autonomy run runs \(.*the person's request: "Add rate limiting to the API\."\)/);
  await $.prompt.submit(typed('full auto cancel'));
  expect(w.json(`${DATA}/runs/${id}/run.json`).status).toBe('canceled');
  expect(w.modState().runId).toBe(null);
});

test('a stop the safety-net hook let through for no progress pauses the run and says so', async ($, on) => {
  const { w, run } = ready(on);
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  const id = run().id;
  w.write(
    `${DATA}/state/sessions/${SESSION}.hook.json`,
    JSON.stringify({
      v: 1,
      sessionId: SESSION,
      lastRunAt: NOW,
      blocks: {},
      permissionMode: 'bypassPermissions',
      permissionModeAt: NOW,
      autoAllowed: { runId: id, why: 'noProgress', at: NOW },
    }),
  );
  await $.turn.complete({ answer: 'I am done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect([run().status, run().pause.reason]).toEqual(['paused', 'stalled']);
  expect(w.notes.some((n) => /paused \(no measurable progress\)/.test(n))).toBe(true);
  // Paused by code: nothing more changes until the person resumes it.
  const edit: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/a.ts`, content: 'x' } as any);
  expect(edit.deny).toMatch(/no measurable progress; the run is paused/);
});

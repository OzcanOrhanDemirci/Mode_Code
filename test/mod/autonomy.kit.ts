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
const TOOL = 'mcp__mode-code__autonomy';
const auto = (action: string, more: Record<string, unknown> = {}) => ({ tool: TOOL, action, ...more }) as any;
const NOW = Date.parse('2026-10-12T10:00:00Z');

/**
 * The person's prompt, then the model's first step (the autonomy tool's "start"), where the last start checks
 * run: the permission mode the safety-net hook recorded with that prompt, and the live probe.
 */
async function begin($: any, text: string): Promise<{ prompt: string; start: string }> {
  const r: any = await $.prompt.submit(typed(text));
  const s: any = await $.tool.call(auto('start'));
  return { prompt: (r.context ?? []).join('\n'), start: String(s.result) };
}
const PROBE_REFUSED = "touch: cannot touch '/home/ada/.mode-code-sandbox-probe': Read-only file system";
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
  const st = { head: 'a'.repeat(40), status: '', untracked: [] as string[], refs: new Map<string, string>(), n: 0 };
  const git = (args: string[]) => {
    const a = args.join(' ');
    if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${PROJECT}\n` };
    if (a === 'rev-parse HEAD') return { exitCode: 0, stdout: `${st.head}\n` };
    if (a === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'run/limits\n' };
    if (args[0] === 'status') return { exitCode: 0, stdout: st.status };
    if (args[0] === 'ls-files') return { exitCode: 0, stdout: st.untracked.join('\n') };
    if (args[0] === 'update-ref') {
      st.refs.set(args[1]!, args[2]!);
      return { exitCode: 0, stdout: '' };
    }
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '1\n' };
    if (args[0] === 'log') return { exitCode: 0, stdout: `${st.head.slice(0, 7)} feat: a step\n` };
    if (args[0] === 'diff' && args[1] === '--stat') return { exitCode: 0, stdout: ' src/limiter.ts | 3 +++\n' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/limiter.ts b/src/limiter.ts\n+export const limit = 100;\n' };
    if (args[0] === 'ls-tree') return { exitCode: 0, stdout: 'package.json\nsrc/limiter.ts\n' };
    if (args[0] === 'show' && String(args[1]).endsWith(':package.json')) return { exitCode: 0, stdout: '{ "name": "app", "type": "module" }\n' };
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
    env: { WSL_DISTRO_NAME: 'mode-code' },
    settings: STRICT,
    promptMode: 'bypassPermissions',
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
  // The session started (SessionStart ran); Claude Code hands the permission mode over only with each prompt.
  w.write(`${DATA}/state/sessions/${SESSION}.hook.json`, JSON.stringify({ v: 1, sessionId: SESSION, lastRunAt: NOW, blocks: {} }));
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
  expect(said).toMatch(/- Turned on: Full autonomy is off\. Turn it on in your own terminal: mode-code autonomy enable\./);
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
        if (String(e.command).startsWith('touch ')) w.write('/home/ada/.mode-code-sandbox-probe', '');
        return { result: '' };
      },
    },
  });
  const none: any = await $.prompt.submit(typed('Add rate limiting. app full auto'));
  expect(none.context.join('\n')).toMatch(/- Budget: No budget: end the message with a quota label/);
  const wrote = await begin($, 'Add rate limiting. app full auto quota +10');
  expect(wrote.start).toMatch(/- Sandbox probe: A write outside the project went through/);
  expect(w.modState().runId).toBe(null);
});

test('a whole run: start, plan, milestones on commits with reviews, what waits for the person, finish and its report', async ($, on) => {
  let verdict = 'VERDICT: PASS';
  const { w, g, run } = ready(on, { review: () => ({ isAnswered: true, text: verdict, usage: { input_tokens: 1, output_tokens: 1 } }) });
  const { prompt, start } = await begin($, 'Add rate limiting to the API. app full auto quota +10');
  expect(prompt).toMatch(/The person asked for full autonomy\. The start checks that can be measured now passed; .* action "start"/);
  expect(start).toMatch(/^Full autonomy started: 11 start checks passed, the live sandbox probe and the permission mode \(bypassPermissions\) among them\./);
  expect(start).toMatch(/The person started full autonomy \(run \d{8}-\d{4}-add-rate-limiting-to-the, weekly budget 51%\)/);
  expect(start).toMatch(/"Add rate limiting to the API\."/);
  expect(start).toMatch(/`npm run check`/);
  expect(w.calls.find((c: any) => c.tool === 'Bash')?.command).toBe("touch '/home/ada/.mode-code-sandbox-probe'");
  expect(w.registered.map((t: any) => t.name)).toContain('autonomy');
  let x = run();
  expect([x.status, x.phase, x.budget, x.start.commit, x.start.branch]).toEqual([
    'active',
    'plan',
    { weeklyTarget: 51, source: '+10' },
    'a'.repeat(40),
    'run/limits',
  ]);
  expect(g.st.refs.get(`refs/mode-code/runs/${x.id}/0`)).toBe('a'.repeat(40));
  expect(w.modState().interaction).toBe('full');

  // Planning: the project does not change; the plan's own file does.
  const early: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/limiter.ts`, content: 'x' } as any);
  expect(early.deny).toMatch(/The full-autonomy run is planning: write the plan at .*plan\.md and call mcp__mode-code__autonomy with action "plan"/);
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
  expect(String(m1.result)).toMatch(/Milestone 1\/2 accepted on 111111111111; rollback point refs\/mode-code\/runs\/.*\/1\. Independent review: CONCERNS\./);
  expect(String(m1.result)).toMatch(/The person's request, word for word: «Add rate limiting to the API\.»/);
  expect(String(m1.result)).toMatch(/Next: step 2\/2: Wire it in/);
  expect(g.st.refs.get(`refs/mode-code/runs/${x.id}/1`)).toBe(g.st.head);
  // The review saw the request, the step and the diff, and none of the conversation.
  const asked = w.reviews.at(-1);
  expect(asked.model).toBe('claude-opus-5-5');
  expect(asked.system).toMatch(/You did not write this change and you have not seen the conversation/);
  expect(asked.prompt).toMatch(/## Under review: step 1\. The limiter/);
  expect(asked.prompt).toMatch(/\+export const limit = 100;/);
  // And the project beyond the diff at that commit: what exists, and how it builds.
  expect(asked.prompt).toMatch(/## The project at the reviewed commit\nTracked files \(2\):\npackage\.json\nsrc\/limiter\.ts\n/);
  expect(asked.prompt).toMatch(/### package\.json\n```\n\{ "name": "app", "type": "module" \}\n```/);
  expect(asked.prompt).toMatch(/\(Code runs them at the finish; they have not run for this step\.\)/);

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
  expect(w.reviews.at(-1).prompt).toMatch(
    /## Verification, run by code just before this review\n- `npm test`: passed \(exit 0\)\n```\nran\n```\n- `npm run check`: passed/,
  );
  expect(w.reviews.at(-1).prompt).toMatch(/## Findings of earlier reviews\n- step 1: no test for the reset window/);
  const final = w.json(`${DATA}/runs/${x.id}/run.json`);
  expect([final.status, final.finish.verification.length, final.finish.review.verdict]).toEqual(['done', 2, 'pass']);
  const report = w.read(`${DATA}/runs/${x.id}/report.md`)!;
  expect(report.startsWith(DRAFT.trim())).toBe(true);
  expect(report).toMatch(/## What mode-code measured/);
  expect(report).toMatch(/\*\*push\*\* · Bash: `git push origin main`/);
  expect(w.notes.some((n) => /The full-autonomy run is done: Add rate limiting to the API\./.test(n))).toBe(true);
  expect([w.modState().runId, w.modState().interaction]).toEqual([null, 'default']);
});

test("the plan cannot drop the person's commands; a milestone cannot skip a step; a subagent cannot drive the run", async ($, on) => {
  const { w, run } = ready(on);
  await begin($, 'Add rate limiting. app full auto quota +10');
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
  await begin($, 'Add rate limiting. app full auto quota +10');
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
  await begin($, 'Add rate limiting to the API. app full auto quota +10');
  const id = run().id;
  await $.prompt.submit(typed('dur'));
  expect([run().status, run().pause.reason]).toEqual(['paused', 'person']);
  expect(w.read(`${DATA}/runs/${id}/report.md`)).toMatch(/- Status: paused \(by you\)/);
  const blocked: any = await $.tool.call(auto('milestone', { step: 1 }));
  expect(String(blocked.result)).toMatch(/The run is paused \(by you\)\. The person resumes it with "continue"/);
  const back = await begin($, 'app continue');
  expect(back.prompt).toMatch(/The person asked to resume the paused full-autonomy run\. .* action "start"/);
  expect(back.start).toMatch(
    /^The run resumed at its plan phase: every start check passed again\.\n\n.*The full-autonomy run .* resumed\. The person's request, word for word: "Add rate limiting to the API\."/,
  );
  expect(run().status).toBe('active');
  expect(w.calls.filter((c: any) => String(c.command).startsWith('touch ')).length).toBe(2);
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'so far', toolUses: [] }] } as any);
  expect(instructions).toMatch(/a full-autonomy run runs \(.*the person's request: "Add rate limiting to the API\."\)/);
  // While a run is attached the way of working is the run's; the answer names the keyword that lets it go.
  const style: any = await $.command.run({ command: '7', args: '' } as any);
  expect(style.text).toBe('A full-autonomy run is attached to this session: "full auto cancel" lets it go first.');
  await $.prompt.submit(typed('full auto cancel'));
  expect(w.json(`${DATA}/runs/${id}/run.json`).status).toBe('canceled');
  expect(w.modState().runId).toBe(null);
});

test('a stop the safety-net hook let through for no progress pauses the run and says so', async ($, on) => {
  const { w, run } = ready(on);
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await begin($, 'Add rate limiting. app full auto quota +10');
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
  expect(edit.deny).toMatch(/the run is paused \(no measurable progress\)/);
  // Resumed by the person: the plugin's own probe is a start check and passes the paused run's guard.
  const back = await begin($, 'app continue');
  expect(back.start).toMatch(/^The run resumed at its plan phase: every start check passed again\./);
  expect(w.calls.filter((c: any) => String(c.command).startsWith('touch ')).length).toBe(2);
});

test("the last start checks wait for the model's first step; a call made before it is held, and the run starts there", async ($, on) => {
  const { w, run } = ready(on);
  const r: any = await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  // At the prompt the safety-net hook has not seen it yet: no probe, no run, the model is told to call "start".
  expect(r.context.join('\n')).toMatch(/the last two \(Claude Code's permission mode for this prompt, and a live probe of the sandbox\)/);
  expect(w.toasts.at(-1)).toMatch(/^🤖 Full autonomy: \d+ start checks passed; the last two run at Claude's first step\.$/);
  expect([run(), w.calls.some((c: any) => c.tool === 'Bash')]).toEqual([null, false]);
  expect(w.registered.map((t: any) => t.name)).toContain('autonomy');
  // The model went to work without it: that call is held, the last checks run, and the run starts.
  const held: any = await $.tool.call({ tool: 'Read', file_path: `${PROJECT}/README.md` } as any);
  expect(held.deny).toMatch(
    /^🤖 Full autonomy: Read was held; the last start checks ran first\. Call it again if it is still needed\.\n\nFull autonomy started:/,
  );
  expect([run().status, run().phase]).toEqual(['active', 'plan']);
  expect(w.reached).not.toContain('Read');
  const gates = w.events().filter((e: any) => e.kind === 'run' && e.action === 'gate');
  expect(gates.map((e: any) => [e.step, e.ok])).toEqual([
    ['prompt', true],
    ['first', true],
  ]);
  // From here on calls go through as the run's phase allows.
  const again: any = await $.tool.call({ tool: 'Read', file_path: `${PROJECT}/README.md` } as any);
  expect(again.deny).toBeUndefined();
});

test("the permission mode must be this prompt's: one that asks, or none recorded with it, refuses the start", async ($, on) => {
  const { w, run } = ready(on);
  w.hook.mode = 'default';
  const asks = await begin($, 'Add rate limiting. app full auto quota +10');
  expect(asks.start).toMatch(/- Asks nobody: Permission mode default stops to ask\./);
  expect(run()).toBe(null);
  // An earlier prompt came with bypassPermissions; this one reaches no safety-net hook (an old one, a broken one).
  w.hook.mode = 'bypassPermissions';
  await $.prompt.submit(typed('hello'));
  await w.clock.advance(60_000);
  w.hook.mode = null;
  const stale = await begin($, 'Add rate limiting. app full auto quota +10');
  expect(stale.start).toMatch(/- Asks nobody: Claude Code's permission mode did not reach Mode_Code with this prompt/);
  expect(run()).toBe(null);
  // Refused at the first step, the probe never ran: nothing was written outside the project for a run that cannot start.
  expect(w.calls.some((c: any) => c.tool === 'Bash')).toBe(false);
});

test('a start the model never takes up lapses with the turn, or with the next prompt', async ($, on) => {
  const { w, run } = ready(on);
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  await $.turn.complete({ answer: 'Sure.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(w.toasts.at(-1)).toBe('🤖 Full autonomy did not start: the turn ended before its first step.');
  const late: any = await $.tool.call(auto('start'));
  expect(String(late.result)).toMatch(/No full-autonomy run is attached to this session/);
  await $.prompt.submit(typed('Add rate limiting. app full auto quota +10'));
  await $.prompt.submit(typed('what time is it'));
  const lapsed: any = await $.tool.call({ tool: 'Read', file_path: `${PROJECT}/README.md` } as any);
  expect(lapsed.deny).toBeUndefined();
  expect(run()).toBe(null);
});

test("files the run left untracked hold back a milestone; the person's own untracked files do not", async ($, on) => {
  const { w, g, run } = ready(on);
  g.st.untracked = ['notes-of-the-person.txt'];
  await begin($, 'Add rate limiting. app full auto quota +10');
  w.write(run().planPath, PLAN);
  await $.tool.call(auto('plan'));
  g.commit();
  g.st.untracked = ['notes-of-the-person.txt', 'src/limiter.ts'];
  const held: any = await $.tool.call(auto('milestone', { step: 1 }));
  expect(String(held.result)).toMatch(/The run left 1 new file\(s\) untracked: src\/limiter\.ts\. Commit them/);
  g.st.untracked = ['notes-of-the-person.txt'];
  const ok: any = await $.tool.call(auto('milestone', { step: 1 }));
  expect(String(ok.result)).toMatch(/Milestone 1\/2 accepted/);
});

test('a plan whose verification would wait for the person is refused: it could never pass', async ($, on) => {
  const { w, run } = ready(on);
  await begin($, 'Add rate limiting. app full auto quota +10');
  w.write(run().planPath, PLAN.replace('- `npm test`', '- `npm test`\n- `git push origin main`'));
  const r: any = await $.tool.call(auto('plan'));
  expect(String(r.result)).toMatch(/The verification command `git push origin main` could not run during the run \(pushes to the protected branch main\)/);
  expect(run().phase).toBe('plan');
});

test('turned off in the settings while a run works, the run pauses at its next step and says why', async ($, on) => {
  // docs/autonomy.md said so; nothing did it before 1.1.0.
  const { w, run } = ready(on);
  await begin($, 'Add rate limiting. app full auto quota +10');
  expect(run().status).toBe('active');
  w.write(`${DATA}/config.json`, JSON.stringify({ version: 1, autonomy: { enabled: false }, projects: [{ id: 'app', names: ['app'], path: PROJECT }] }));
  await w.clock.advance(61_000);
  const call: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/limit.ts`, content: 'x', tool_use_id: 'toolu_w' } as any);
  expect([run().status, run().pause.reason]).toEqual(['paused', 'disabled']);
  expect(String(call.deny)).toBe('🤖 Full autonomy: the run is paused (full autonomy turned off). Report what was done and stop.');
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The memory inside Claude Code's engine (docs/memory.md): handoff notes written on the keyword, on wrap up,
 * from a compaction's summary and at a session's end, taken over by the next session; the store's sync
 * after a turn; the morning line after a long gap; approved notes from runs handed to a session once.
 */
import { test, expect } from 'claude-code/testing';
import { DATA, PROJECT, SESSION, world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const TOOL = 'mcp__terminal-code__handoff';
const NOW = Date.parse('2026-10-12T10:00:00Z');
const PARTS = { summary: 'The store is in.', open: 'The wizard.', decisions: 'One memory for all.', next: 'Write the setup.' };
const HANDOFFS = `${DATA}/handoffs`;

/** A repository at the project with its origin on GitHub, so the project key is "ada-app". */
const repoGit = (extra?: (args: string[], dir?: string) => any) => (args: string[], dir?: string) => {
  const own = extra?.(args, dir);
  if (own) return own;
  const a = args.join(' ');
  if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${PROJECT}\n` };
  if (a === 'rev-parse --is-inside-work-tree') return { exitCode: 0, stdout: 'true\n' };
  if (a === 'config --get remote.origin.url') return { exitCode: 0, stdout: 'https://github.com/ada/app.git\n' };
  if (a === 'rev-parse HEAD') return { exitCode: 0, stdout: `${'c'.repeat(40)}\n` };
  if (args[0] === 'log') return { exitCode: 0, stdout: 'ccccccc feat: the store\n' };
  if (args[0] === 'status') return { exitCode: 0, stdout: ' M src/a.ts\n' };
  return undefined;
};

const note = (session: string, at: string, next: string) =>
  `---\ntype: handoff\nproject: ada-app\ncwd: ${PROJECT}\nmachine: mac\nsession: ${session}\nat: ${at}\ntrigger: keyword\n---\n\n# Handoff\n\n## Summary\n\nDid things.\n\n## Next\n\n${next}\n`;

test('the handoff keyword: the tool is offered, Claude writes four parts, code adds what it measured and keeps the note', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  const r: any = await $.prompt.submit(typed('Bugünlük bu kadar. devir'));
  expect(r.context.join('\n')).toMatch(/The person asked for a handoff note: call mcp__terminal-code__handoff with summary/);
  expect(w.registered.map((t: any) => t.name)).toContain('handoff');
  const missing: any = await $.tool.call({ tool: TOOL, summary: 'x', open: '', decisions: 'y' } as any);
  expect(String(missing.result)).toMatch(/The handoff note is not written yet:\n• open is missing.*\n• next is missing/);
  const done: any = await $.tool.call({ tool: TOOL, ...PARTS } as any);
  expect(String(done.result)).toMatch(/The handoff note is written: .*\/handoffs\/ada-app\/20261012-100000-kitsessi\.md\. It is in terminal-code's folder/);
  const text = w.read(`${HANDOFFS}/ada-app/20261012-100000-kitsessi.md`)!;
  expect(text).toMatch(/^---\ntype: handoff\nproject: ada-app\n/);
  expect(text).toMatch(/## Next\n\nWrite the setup\.\n/);
  expect(text).toMatch(/- Last request: Bugünlük bu kadar\. devir/);
  expect(text).toMatch(/### Commits in this session\n\n- ccccccc feat: the store\n/);
  expect(text).toMatch(/### Uncommitted\n\n- src\/a\.ts\n/);
  expect(w.events().some((e: any) => e.kind === 'handoff' && e.trigger === 'keyword' && e.project === 'ada-app')).toBe(true);
  // A subagent cannot write one.
  const agent: any = await $.tool.call({ tool: TOOL, ...PARTS, agentId: 'sub-1' } as any);
  expect(String(agent.result)).toMatch(/Only the main session writes a handoff note/);
});

test('the next session takes the note over: one line on its first prompt, the whole note on continue, nothing that is its own or stale', async ($, on) => {
  const w = world(on, { config: { projects: [{ id: 'app', names: ['app'], path: PROJECT }] }, git: repoGit() });
  w.write(
    `${HANDOFFS}/app/20261011-090000-other.md`,
    note('other-session', '2026-10-11T09:00:00Z', 'Write the setup steps.').replace('project: ada-app', 'project: app'),
  );
  w.write(`${HANDOFFS}/app/20261001-090000-older.md`, note('older-session', '2026-10-01T09:00:00Z', 'Old.').replace('project: ada-app', 'project: app'));
  const first: any = await $.prompt.submit(typed('What is the state of things?'));
  expect(first.context.join('\n')).toMatch(
    /A handoff note for this project is waiting, written 2026-10-11 09:00 UTC on mac \(asked for by the person\)\. Next: "Write the setup steps\."\. The note: .*\/handoffs\/app\/20261011-090000-other\.md/,
  );
  // Only on the first prompt.
  const second: any = await $.prompt.submit(typed('And then?'));
  expect(second.context.join('\n')).not.toMatch(/handoff note/);
  // "continue" hands the whole note over.
  const cont: any = await $.prompt.submit(typed('app devam'));
  expect(cont.context.join('\n')).toMatch(/The last handoff note \(.*20261011-090000-other\.md\), word for word:\n\n---\ntype: handoff/);
  // A note older than the limit is not offered.
  const w2 = w;
  w2.write(`${DATA}/config.json`, JSON.stringify({ projects: [{ id: 'app', names: ['app'], path: PROJECT }], memory: { handoff: { maxAgeDays: 1 } } }));
  const stale: any = await $.prompt.submit(typed('app devam'));
  expect(stale.context.join('\n')).not.toMatch(/last handoff note/);
});

test('wrap up asks for the note as part of wrapping up; a compaction keeps its summary as one', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  on('session.compact', (_$: any, e: any) => ({
    messages: [
      { role: 'user', text: 'This session is being continued from a previous conversation.\n\nWe built the store; the wizard is next.', toolUses: [] },
    ],
    tokensBefore: 1,
  }));
  const r: any = await $.prompt.submit(typed('toparla'));
  expect(r.context.join('\n')).toMatch(/As part of wrapping up, write a handoff note: call mcp__terminal-code__handoff/);
  expect(w.registered.map((t: any) => t.name)).toContain('handoff');
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'so far', toolUses: [] }] } as any);
  const files = [...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/ada-app/`));
  expect(files.length).toBe(1);
  const text = w.read(files[0]!)!;
  expect(text).toMatch(/trigger: compact/);
  expect(text).toMatch(/## Summary\n\nWe built the store; the wizard is next\./);
  // A compaction only computed ahead writes nothing.
  await $.session.compact({ trigger: 'precompute', messages: [] } as any);
  expect([...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/`)).length).toBe(1);
});

test('a session that changed something leaves a note from what code measured when it clears; one that did not, none', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  await $.prompt.submit(typed('Fix the bug.'));
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} } as any);
  expect([...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/`)).length).toBe(0);
  await $.prompt.submit(typed('Fix the bug.'));
  await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/a.ts`, content: 'x' } as any);
  await $.turn.complete({ answer: 'Fixed.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} } as any);
  const files = [...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/ada-app/`));
  expect(files.length).toBe(1);
  const text = w.read(files[0]!)!;
  expect(text).toMatch(/trigger: clear/);
  expect(text).not.toMatch(/## Summary/);
  expect(text).toMatch(/- Last request: Fix the bug\./);
});

test('after a turn the store is synced: a quick look first, then commit and send; a problem is told once', async ($, on) => {
  const STORE = '/home/ada/claude-memory';
  const calls: string[] = [];
  let dirty = true;
  let ahead = 0;
  const git = repoGit((args, dir) => {
    if (dir !== STORE) return undefined;
    const a = args.join(' ');
    calls.push(a);
    if (a === 'status --porcelain=v1 --branch -- .')
      return { exitCode: 0, stdout: `## main...origin/main${ahead ? ` [ahead ${ahead}]` : ''}\n${dirty ? '?? notes.md\n' : ''}` };
    if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${STORE}\n` };
    if (args[0] === 'status') return { exitCode: 0, stdout: dirty ? '?? notes.md\0' : '' };
    if (args[0] === 'add') return { exitCode: 0, stdout: '' };
    if (args[0] === 'commit') {
      dirty = false;
      ahead = 1;
      return { exitCode: 0, stdout: '' };
    }
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 0, stdout: 'origin/main\n' };
    if (a === 'rev-list --count @{upstream}..HEAD') return { exitCode: 0, stdout: `${ahead}\n` };
    if (args[0] === 'push') {
      ahead = 0;
      return { exitCode: 0, stdout: '' };
    }
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: `0\t${ahead}\n` };
    return { exitCode: 1, stdout: '', stderr: `unexpected git ${a}` };
  });
  const w = world(on, {
    config: { memory: { store: { place: 'both', dir: STORE, remote: 'https://github.com/ada/claude-memory.git', repo: 'ada/claude-memory' } } },
    git,
  });
  w.write(`${STORE}/notes.md`, 'Prefers pnpm.\n');
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.prompt.submit(typed('Remember: pnpm.'));
  await $.turn.complete({ answer: 'Noted.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  const record = w.json(`${DATA}/state/memory-sync.mod.json`);
  expect([record.trigger, record.result.commit, record.result.committed, record.result.push]).toEqual(['turn', 'ok', 1, 'ok']);
  expect(calls.find((c) => c.startsWith('commit'))).toMatch(/^commit --quiet -m memory: 1 added \(session kit-sess\) --only -- :\(top,literal\)notes\.md$/);
  // Nothing changed since: one look, nothing more.
  calls.length = 0;
  await $.turn.complete({ answer: 'Ok.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as any);
  expect(calls).toEqual(['status --porcelain=v1 --branch -- .']);
  // A secret in a note: held back, said once.
  dirty = true;
  w.write(`${STORE}/notes.md`, `token ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}\n`);
  await $.turn.complete({ answer: 'Ok.', durationMs: 5, isAborted: false, turnId: 't3', reason: 'answer' } as any);
  await $.turn.complete({ answer: 'Ok.', durationMs: 5, isAborted: false, turnId: 't4', reason: 'answer' } as any);
  expect(w.toasts.filter((t) => /held back from GitHub, it looks like it holds a secret: notes\.md/.test(t)).length).toBe(1);
});

test('the morning line after a long gap, and approved run notes handed to the next session once', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  w.write(`${DATA}/state/activity.json`, JSON.stringify({ lastPromptAt: NOW - 10 * 3_600_000, away: null }));
  const run = (id: string, status: string) => ({
    v: 1,
    id,
    task: `Task ${id}`,
    project: null,
    cwd: PROJECT,
    sessionId: 'old',
    createdAt: NOW - 9 * 3_600_000,
    updatedAt: NOW - 3_600_000,
    aliveAt: NOW - 3_600_000,
    status,
    phase: 'finish',
    pause: null,
    budget: { weeklyTarget: 60, source: '60' },
    start: { commit: 'a', branch: 'main', ref: 'r', untracked: [] },
    workDir: `/tmp/tc/runs/${id}`,
    planPath: `/tmp/tc/runs/${id}/plan.md`,
    reportPath: `/tmp/tc/runs/${id}/report.md`,
    notesPath: `/tmp/tc/runs/${id}/notes.md`,
    plan: null,
    milestones: [],
    deferred: [],
    blockers: [],
    refusals: [],
    finish: null,
    history: [],
  });
  w.write(`${DATA}/runs/r1/run.json`, JSON.stringify(run('r1', 'done')));
  w.write(`${DATA}/runs/r2/run.json`, JSON.stringify(run('r2', 'done')));
  w.write('/tmp/tc/runs/r1/notes.md', 'Prefers small commits.\n');
  w.write('/tmp/tc/runs/r2/notes.md', 'Uses pnpm.\n');
  w.write(`${DATA}/state/notes.json`, JSON.stringify({ r2: { decision: 'approved', at: NOW, delivered: null } }));
  const first: any = await $.prompt.submit(typed('Good morning.'));
  expect(w.toasts.some((t) => /^☀ While you were away: 2 run\(s\) done · 1 note file\(s\) wait for approval\. terminal-code morning$/.test(t))).toBe(true);
  expect(first.context.join('\n')).toMatch(/The person approved notes that full-autonomy runs left for the memory: \/tmp\/tc\/runs\/r2\/notes\.md \(run r2\)/);
  expect(w.json(`${DATA}/state/activity.json`)).toEqual({ lastPromptAt: NOW, away: { from: NOW - 10 * 3_600_000, to: NOW } });
  // Once: the next session is told nothing again.
  const again: any = await $.prompt.submit(typed('And?'));
  expect(again.context.join('\n')).not.toMatch(/approved notes/);
  expect(Object.keys(w.json(`${DATA}/state/notes-delivered.json`))).toEqual(['r2']);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The memory inside Claude Code's engine (docs/memory.md): handoff notes written on the keyword, on wrap up,
 * from a compaction's summary and at a session's end, taken over by the next session; the store's sync
 * after a turn; the morning line after a long gap; approved notes from runs handed to a session once.
 */
import { test, expect } from 'claude-code/testing';
import { DATA, HOME, PROJECT, SESSION, world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const TOOL = 'mcp__mode-code__handoff';
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
  expect(r.context.join('\n')).toMatch(/The person asked for a handoff note: call mcp__mode-code__handoff with summary/);
  expect(w.registered.map((t: any) => t.name)).toContain('handoff');
  const missing: any = await $.tool.call({ tool: TOOL, summary: 'x', open: '', decisions: 'y' } as any);
  expect(String(missing.result)).toMatch(/The handoff note is not written yet:\n• open is missing.*\n• next is missing/);
  const done: any = await $.tool.call({ tool: TOOL, ...PARTS } as any);
  expect(String(done.result)).toMatch(/The handoff note is written: .*\/handoffs\/ada-app\/20261012-100000-kitsessi\.md\. It is in Mode_Code's folder/);
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
  expect(r.context.join('\n')).toMatch(/As part of wrapping up, write a handoff note: call mcp__mode-code__handoff/);
  expect(w.registered.map((t: any) => t.name)).toContain('handoff');
  expect(r.context.join('\n')).not.toMatch(/Lessons:/);
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

test('with a memory set up, wrap up also offers a lesson the person repeated, never written without their yes', async ($, on) => {
  world(on, { config: { memory: { dirs: ['/home/ada/notes'] } }, git: repoGit() });
  const r: any = await $.prompt.submit(typed('toparla'));
  expect(r.context.join('\n')).toMatch(/Lessons: if the person corrected the same thing more than once.*only after they say yes/);
  const plain: any = await $.prompt.submit(typed('what changed?'));
  expect((plain.context ?? []).join('\n')).not.toMatch(/Lessons:/);
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

test('a turn that changed something keeps what its note would be written from, should its window be shut', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.prompt.submit(typed('Look around.'));
  await $.turn.complete({ answer: 'Looked.', durationMs: 5, isAborted: false, turnId: 't0', reason: 'answer' } as any);
  expect(w.modState().work).toBe(null);
  await $.prompt.submit(typed('Fix the login.'));
  await $.tool.call({ tool: 'Read', file_path: `${PROJECT}/src/a.ts` } as any);
  expect(w.modState().work).toBe(null);
  // Kept at the change itself, not only when the turn ends: a window shut mid-turn loses nothing.
  await w.clock.advance(1000);
  await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/a.ts`, content: 'x' } as any);
  expect(w.modState().work).toEqual({ startedAt: NOW, changedAt: NOW + 1000, handoffAt: 0, project: 'ada-app', request: 'Fix the login.' });
  await w.clock.advance(1000);
  await $.turn.complete({ answer: 'Fixed.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(w.modState().work).toEqual({ startedAt: NOW, changedAt: NOW + 2000, handoffAt: 0, project: 'ada-app', request: 'Fix the login.' });
  // A note written since: the record says so, and a next session owes it nothing.
  await $.prompt.submit(typed('devir'));
  await $.tool.call({ tool: TOOL, ...PARTS } as any);
  expect(w.modState().work.handoffAt).toBe(NOW + 2000);
});

test('/00 writes the note of a session that changed something before Claude Code is asked to exit; its end does not write another', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit() });
  const notes = () => [...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/ada-app/`));
  const atExit: number[] = [];
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  on('command.run', { command: 'exit' }, () => {
    atExit.push(notes().length);
    return { text: '' };
  });
  await $.prompt.submit(typed('Fix the bug.'));
  await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/a.ts`, content: 'x' } as any);
  await $.turn.complete({ answer: 'Fixed.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  await $.command.run({ command: '00', args: '' } as any);
  await w.clock.advance(5);
  for (let i = 0; i < 400 && !atExit.length; i++) await Promise.resolve();
  // Written with no clock running, before the exit: Claude Code's end has a short one, which cut a sync before.
  expect(atExit).toEqual([1]);
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: {} } as any);
  expect(notes().length).toBe(1);
  expect(w.read(notes()[0]!)!).toMatch(/trigger: end/);
});

test('a session closed without ending still leaves its note: the next session writes it, once, and is told of it', async ($, on) => {
  const SESSIONS = `${DATA}/state/sessions`;
  // ps knows process 111 (a session still running); every other number is gone.
  const w = world(on, {
    config: {},
    git: repoGit(),
    programs: (argv) => (argv[0] === 'ps' ? (argv[4] === '111' ? { exitCode: 0, stdout: 'claude\n' } : { exitCode: 1, stdout: '' }) : undefined),
  });
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  const work = (changedAt: number, extra: Record<string, unknown> = {}) => ({
    startedAt: NOW - 3600_000,
    changedAt,
    handoffAt: 0,
    project: 'ada-app',
    request: 'Fix the login.',
    ...extra,
  });
  const other = (id: string, state: Record<string, unknown>, pid?: number) => {
    w.write(`${SESSIONS}/${id}.mod.json`, JSON.stringify({ v: 1, sessionId: id, aliveAt: NOW - 600_000, cwd: PROJECT, ...state }));
    if (pid) w.write(`${SESSIONS}/${id}.hook.json`, JSON.stringify({ v: 1, sessionId: id, lastRunAt: 0, blocks: {}, host: { pid, name: 'claude' } }));
  };
  other('shut0001', { work: work(NOW - 300_000) }, 222); // its window shut: gone
  other('running1', { work: work(NOW - 300_000) }, 111); // still running: left alone
  other('endedjus', { endedAt: NOW - 10_000, work: work(NOW - 300_000) }, 222); // its own end may still be writing
  other('endedcut', { endedAt: NOW - 120_000, work: work(NOW - 300_000) }, 222); // its end was cut short
  other('noted001', { work: work(NOW - 300_000, { handoffAt: NOW - 200_000 }) }, 222); // wrote its note
  other('neverchg', {}, 222); // changed nothing
  other('nohost01', { work: work(NOW - 300_000) }); // no record of its process: cannot tell
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const r: any = await $.prompt.submit(typed('Where were we?'));
  const notes = [...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/ada-app/`)).sort();
  expect(notes).toEqual([`${HANDOFFS}/ada-app/20261012-095500-endedcut.md`, `${HANDOFFS}/ada-app/20261012-095500-shut0001.md`]);
  const text = w.read(notes[1]!)!;
  expect(text).toMatch(/^---\ntype: handoff\nproject: ada-app\n/);
  expect(text).toMatch(/session: shut0001\nat: 2026-10-12T09:55:00\.000Z\ntrigger: closed\n/);
  expect(text).toMatch(/- Last request: Fix the login\./);
  expect(text).toMatch(/### Commits in this session\n\n- ccccccc feat: the store\n/);
  expect(text).toMatch(/### Uncommitted\n\n- src\/a\.ts\n/);
  expect(
    w
      .events()
      .filter((e: any) => e.kind === 'handoff' && e.trigger === 'closed')
      .map((e: any) => e.of)
      .sort(),
  ).toEqual(['endedcut', 'shut0001']);
  // The first prompt waits for them, and is told of the newest.
  expect(r.context.join('\n')).toMatch(
    /A handoff note for this project is waiting, written 2026-10-12 09:55 UTC .*\(after its session was closed without ending, by the next session, from what code measured\)/,
  );
  // A next session finds the notes there and writes none again.
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  await $.prompt.submit(typed('Again.'));
  expect([...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/`)).length).toBe(2);
  expect(w.events().filter((e: any) => e.kind === 'handoff' && e.trigger === 'closed').length).toBe(2);
});

test('with end notes turned off, no note is written for a closed session either', async ($, on) => {
  const w = world(on, {
    config: { memory: { handoff: { onEnd: false } } },
    git: repoGit(),
    programs: (argv) => (argv[0] === 'ps' ? { exitCode: 1, stdout: '' } : undefined),
  });
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  w.write(
    `${DATA}/state/sessions/shut0001.mod.json`,
    JSON.stringify({
      v: 1,
      sessionId: 'shut0001',
      aliveAt: NOW - 600_000,
      cwd: PROJECT,
      work: { startedAt: 0, changedAt: NOW - 300_000, handoffAt: 0, project: 'ada-app', request: null },
    }),
  );
  w.write(
    `${DATA}/state/sessions/shut0001.hook.json`,
    JSON.stringify({ v: 1, sessionId: 'shut0001', lastRunAt: 0, blocks: {}, host: { pid: 222, name: 'claude' } }),
  );
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  await $.prompt.submit(typed('Where were we?'));
  expect([...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/`)).length).toBe(0);
  expect(w.events().some((e: any) => e.kind === 'handoff')).toBe(false);
});

test('a project named in a session opened in another folder is measured in its own folder: at its end, and when it was shut', async ($, on) => {
  // The home folder the session was opened in is no repository; the project and the session's work are at PROJECT.
  const w = world(on, {
    startedAtHome: true,
    config: {
      projects: [
        { id: 'app', names: ['app'], path: PROJECT },
        { id: 'far', names: ['far'], path: `${HOME}/dev/far` },
      ],
    },
    git: repoGit((_args, dir) => (dir === PROJECT ? undefined : { exitCode: 128, stdout: '' })),
    programs: (argv) => (argv[0] === 'ps' ? { exitCode: 1, stdout: '' } : undefined),
  });
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  const notes = (project: string) => [...w.files.keys()].filter((p) => p.startsWith(`${HANDOFFS}/${project}/`)).sort();
  await $.prompt.submit(typed('app devam'));
  await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/src/a.ts`, content: 'x' } as any);
  await $.turn.complete({ answer: 'Fixed.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: {} } as any);
  expect(notes('app').length).toBe(1);
  const ended = w.read(notes('app')[0]!)!;
  expect(ended).toMatch(/^---\ntype: handoff\nproject: app\ncwd: \/home\/ada\/dev\/app\n/);
  expect(ended).toMatch(/- Folder: \/home\/ada\/dev\/app\n- Branch: feature at cccccccccccc\n/);
  expect(ended).toMatch(/### Commits in this session\n\n- ccccccc feat: the store\n/);
  expect(ended).toMatch(/### Uncommitted\n\n- src\/a\.ts\n/);
  // A named project with no repository here: the session's own folder, as before.
  await $.prompt.submit(typed('far devam'));
  await w.clock.advance(1000);
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/notes.md`, content: 'x' } as any);
  await $.turn.complete({ answer: 'Noted.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as any);
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} } as any);
  const far = w.read(notes('far')[0]!)!;
  expect(far).toMatch(/- Folder: \/home\/ada\n- Branch: none\n/);
  expect(far).toMatch(/### Commits in this session\n\n- none\n/);
  // A session shut without ending, opened at home on the same project: the next session measures the project.
  w.write(
    `${DATA}/state/sessions/shut0001.mod.json`,
    JSON.stringify({
      v: 1,
      sessionId: 'shut0001',
      aliveAt: NOW - 600_000,
      cwd: HOME,
      project: 'app',
      work: { startedAt: NOW - 3600_000, changedAt: NOW - 300_000, handoffAt: 0, project: 'app', request: 'Fix the login.' },
    }),
  );
  w.write(
    `${DATA}/state/sessions/shut0001.hook.json`,
    JSON.stringify({ v: 1, sessionId: 'shut0001', lastRunAt: 0, blocks: {}, host: { pid: 222, name: 'claude' } }),
  );
  await $.session.start({ source: 'startup', cwd: HOME } as any);
  await $.prompt.submit(typed('Where were we?'));
  const shut = w.read(`${HANDOFFS}/app/20261012-095500-shut0001.md`)!;
  expect(shut).toMatch(/trigger: closed\n/);
  expect(shut).toMatch(/- Folder: \/home\/ada\/dev\/app\n- Branch: feature at cccccccccccc\n/);
  expect(shut).toMatch(/### Commits in this session\n\n- ccccccc feat: the store\n/);
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
    if (a === 'status --ignore-submodules=dirty --porcelain=v1 --branch -- .')
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
    // What the push would send, read before it goes (A3-15): the note the commit added.
    if (a.startsWith('log -p')) return { exitCode: 0, stdout: 'diff --git a/notes.md b/notes.md\n+++ b/notes.md\n+Prefers pnpm.\n' };
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
  expect(calls).toEqual(['status --ignore-submodules=dirty --porcelain=v1 --branch -- .', 'rev-parse --verify --quiet HEAD']);
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
  expect(w.toasts.some((t) => /^☀ While you were away: 2 run\(s\) done · 1 note file\(s\) wait for approval\. mode-code morning$/.test(t))).toBe(true);
  expect(first.context.join('\n')).toMatch(/The person approved notes that full-autonomy runs left for the memory: \/tmp\/tc\/runs\/r2\/notes\.md \(run r2\)/);
  expect(w.json(`${DATA}/state/activity.json`)).toEqual({ lastPromptAt: NOW, away: { from: NOW - 10 * 3_600_000, to: NOW } });
  // Once: the next session is told nothing again.
  const again: any = await $.prompt.submit(typed('And?'));
  expect(again.context.join('\n')).not.toMatch(/approved notes/);
  expect(Object.keys(w.json(`${DATA}/state/notes-delivered.json`))).toEqual(['r2']);
});

test("what the start's pull brought in is told with the first prompt, which waits for it; once", async ($, on) => {
  const STORE = '/home/ada/claude-memory';
  const calls: string[] = [];
  let release: () => void = () => {};
  let moved = false;
  const pulled = new Promise<void>((r) => (release = r));
  const git = repoGit((args, dir) => {
    if (dir !== STORE) return undefined;
    const a = args.join(' ');
    calls.push(a);
    if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${STORE}\n` };
    if (args[0] === 'status') return { exitCode: 0, stdout: '' };
    if (a === 'rev-parse --verify --quiet HEAD') return { exitCode: 0, stdout: `${moved ? 'def' : 'abc'}\n` };
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 0, stdout: 'origin/main\n' };
    // The pull's fetch takes its time: the prompt comes in while it runs.
    if (args[0] === 'fetch') return pulled.then(() => ({ exitCode: 0, stdout: '' }));
    if (a === 'rebase --autostash --quiet') {
      moved = true;
      return { exitCode: 0, stdout: '' };
    }
    if (a === 'diff --name-only --no-renames --relative -z abc def -- .') return { exitCode: 0, stdout: 'MEMORY.md\0pnpm.md\0' };
    if (a.startsWith('diff --unified=0')) return { exitCode: 0, stdout: '@@ -1,0 +2 @@\n+- [pnpm](pnpm.md) — the package manager\n' };
    if (a === 'rev-list --count @{upstream}..HEAD') return { exitCode: 0, stdout: '0\n' };
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '0\t0\n' };
    return { exitCode: 1, stdout: '', stderr: `unexpected git ${a}` };
  });
  const w = world(on, {
    config: { memory: { store: { place: 'both', dir: STORE, remote: 'https://github.com/ada/claude-memory.git' }, handoff: { enabled: false } } },
    git,
  });
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  const started = $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const prompt = $.prompt.submit(typed('Which package manager?'));
  let answered = false;
  void prompt.then(() => (answered = true));
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(answered).toBe(false);
  release();
  await started;
  const r: any = await prompt;
  const context = r.context.join('\n');
  expect(context).toMatch(
    /The memory was brought up to date with changes made elsewhere: MEMORY\.md, pnpm\.md\. The index \(MEMORY\.md\) in your context may have been loaded before that/,
  );
  expect(context).toMatch(/\n\+ - \[pnpm\]\(pnpm\.md\) — the package manager\n/);
  expect(context).toMatch(/A file read earlier in this session may have changed/);
  const again: any = await $.prompt.submit(typed('And the next step?'));
  expect((again.context ?? []).join('\n')).not.toMatch(/brought up to date/);
  expect(calls.filter((c) => c.startsWith('fetch') || c.startsWith('rebase'))).toEqual(['fetch --quiet --no-write-fetch-head', 'rebase --autostash --quiet']);
  expect(w.events().some((e: any) => e.kind === 'memory' && e.trigger === 'start' && e.pulled === 2)).toBe(true);
});

test('a memory its owner commits: a fast-forward at the start, what arrived since the last session told, nothing committed after a turn', async ($, on) => {
  const STORE = '/home/ada/notes/hafiza';
  const calls: string[] = [];
  let head = 'bbbbbbb';
  const git = repoGit((args, dir) => {
    if (dir !== STORE) return undefined;
    const a = args.join(' ');
    calls.push(a);
    if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: '/home/ada/notes\n' };
    if (a === 'rev-parse --verify --quiet HEAD') return { exitCode: 0, stdout: `${head}\n` };
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 0, stdout: 'origin/main\n' };
    if (a === 'fetch --quiet --no-write-fetch-head') return { exitCode: 0, stdout: '' };
    if (a === 'merge --ff-only --quiet @{upstream}') {
      head = 'ccccccc';
      return { exitCode: 0, stdout: '' };
    }
    // aaaaaaa: where the last session left it; bbbbbbb: the owner's own pull since; ccccccc: this pull.
    if (a === 'merge-base --is-ancestor aaaaaaa bbbbbbb') return { exitCode: 0, stdout: '' };
    if (a === 'diff --name-only --no-renames --relative -z aaaaaaa bbbbbbb -- .') return { exitCode: 0, stdout: 'a.md\0' };
    if (a === 'diff --name-only --no-renames --relative -z bbbbbbb ccccccc -- .') return { exitCode: 0, stdout: 'b.md\0' };
    if (args[0] === 'rev-list') return { exitCode: 0, stdout: '0\t0\n' };
    return { exitCode: 1, stdout: '', stderr: `unexpected git ${a}` };
  });
  const w = world(on, {
    config: {
      memory: {
        store: { place: 'both', dir: STORE, remote: 'https://github.com/ada/notes.git', sync: 'pull', handoffs: false },
        handoff: { enabled: false },
      },
    },
    git,
  });
  w.write(`${DATA}/state/memory-seen.hook.json`, JSON.stringify({ head: 'aaaaaaa', at: 5 }));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const r: any = await $.prompt.submit(typed('Where were we?'));
  expect(r.context.join('\n')).toMatch(/changes made elsewhere: a\.md, b\.md\. A file read earlier/);
  expect(calls.some((c) => c.startsWith('commit') || c.startsWith('push') || c.startsWith('pull') || c.startsWith('rebase') || c.startsWith('status'))).toBe(
    false,
  );
  expect(w.json(`${DATA}/state/memory-seen.mod.json`).head).toBe('ccccccc');
  // After a turn: one look at where it stands, nothing else.
  calls.length = 0;
  head = 'ddddddd';
  await $.turn.complete({ answer: 'Noted.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(calls).toEqual(['rev-parse --verify --quiet HEAD']);
  expect(w.json(`${DATA}/state/memory-seen.mod.json`).head).toBe('ddddddd');
  calls.length = 0;
  await $.turn.complete({ answer: 'Ok.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as any);
  expect(calls).toEqual(['rev-parse --verify --quiet HEAD']);
});

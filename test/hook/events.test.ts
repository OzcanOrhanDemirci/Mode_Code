// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook on every event it handles, as Claude Code runs it: one process per event, the event
 * on stdin, a fresh data folder each time. Complements hook.test.ts with the quieter paths: notes, repeats,
 * the mod taking over, broken input, the checked-footer instruction at session start.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');

function run(event: string, input: object | string, home: string): { out: Record<string, any> | null; raw: string; status: number | null } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', hook, event], {
    cwd: root,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, TERMINAL_CODE_HOME: home, TERMINAL_CODE_LANG: 'en' },
    timeout: 30_000,
  });
  const raw = (r.stdout ?? '').trim();
  return { out: raw ? JSON.parse(raw) : null, raw, status: r.status };
}

function fresh(config: object = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'tc-hookev-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', ...config }));
  return home;
}

const base = (home: string, extra: object = {}) => ({
  session_id: 'ev-session',
  cwd: home,
  transcript_path: join(home, 'none.jsonl'),
  permission_mode: 'default',
  ...extra,
});
const bash = (home: string, command: string, id = 'toolu_1') => ({
  ...base(home),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_use_id: id,
  tool_input: { command },
});

test('a note: the call passes, Claude gets the note, nothing is blocked', () => {
  const home = fresh();
  try {
    const r = run('PreToolUse', bash(home, 'git reset --hard'), home);
    assert.equal(r.status, 0);
    assert.equal(r.out?.hookSpecificOutput?.permissionDecision, undefined);
    assert.match(r.out?.hookSpecificOutput?.additionalContext ?? '', /git\.discard-work/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('when the mod runs in the session it decides notes and logs; the hook still blocks on its own', () => {
  const home = fresh();
  try {
    mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'sessions', 'ev-session.mod.json'),
      JSON.stringify({
        v: 1,
        sessionId: 'ev-session',
        aliveAt: Date.now(),
        modVersion: 'x',
        mode: 'free',
        interaction: 'default',
        project: null,
        weeklyTarget: null,
        weeklyTargetSource: null,
        wrapUp: false,
        resumeAt: null,
        blocks: {},
        approvals: [],
      }),
    );
    assert.equal(run('PreToolUse', bash(home, 'git reset --hard'), home).out, null, 'the mod already told Claude');
    const deny = run(
      'PreToolUse',
      { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 't9', tool_input: { file_path: join(home, 'x'), content: '' } },
      home,
    );
    assert.equal(deny.out?.hookSpecificOutput?.permissionDecision, 'deny');
    // The hook logs a block even with the mod running (the mod may have been bypassed).
    const month = readdirSync(join(home, 'events'));
    const lines = readFileSync(join(home, 'events', month[0]!, 'ev-session.hook.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(JSON.parse(lines.at(-1)!).verdict, 'deny');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a block repeated in the session says how many times it was tried', () => {
  const home = fresh();
  try {
    const call = { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(home, 'config.json'), content: '{}' } };
    const first = run('PreToolUse', { ...call, tool_use_id: 'a' }, home).out?.hookSpecificOutput?.permissionDecisionReason as string;
    const second = run('PreToolUse', { ...call, tool_use_id: 'b' }, home).out?.hookSpecificOutput?.permissionDecisionReason as string;
    assert.doesNotMatch(first, /blocked 2 /);
    assert.match(second, /2/);
    assert.notEqual(first, second);
    const state = JSON.parse(readFileSync(join(home, 'state', 'sessions', 'ev-session.hook.json'), 'utf8'));
    assert.equal(state.blocks['self.tool-files'], 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('broken input: not JSON, no tool, an unknown event, an unsafe session id: no crash, no file outside the data folder', () => {
  const home = fresh();
  try {
    for (const [event, input] of [
      ['PreToolUse', 'this is not json'],
      ['PreToolUse', ''],
      ['PreToolUse', { tool_name: 'Read' }],
      ['NoSuchEvent', { anything: 1 }],
      ['Stop', '{"stop_hook_active": false}'],
      ['UserPromptSubmit', '[]'],
      ['SessionStart', 'null'],
    ] as const) {
      const r = run(event, input, home);
      assert.equal(r.status, 0, `${event}: ${String(input)}`);
      assert.equal(r.out, null, `${event} printed ${r.raw}`);
    }
    const unsafe = run('PreToolUse', { ...bash(home, 'git clean -fdx'), session_id: '../../escape' }, home);
    assert.equal(unsafe.out?.hookSpecificOutput?.permissionDecision, 'ask');
    assert.equal(existsSync(join(home, '..', 'escape.hook.json')), false);
    assert.ok(readdirSync(join(home, 'events')).length >= 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('session start: the checked footer is taught in the person language; otherwise nothing is said', () => {
  const check = fresh({ footer: { mode: 'check' }, memory: { dirs: ['C:/notes'] } });
  const draw = fresh({ footer: { mode: 'draw' } });
  try {
    const r = run('SessionStart', { ...base(check), hook_event_name: 'SessionStart', source: 'startup' }, check);
    assert.match(r.out?.hookSpecificOutput?.additionalContext ?? '', /End every answer with these lines[\s\S]*Memory pushed/);
    assert.ok(existsSync(join(check, 'state', 'sessions', 'ev-session.hook.json')), 'the session is marked alive');
    assert.equal(run('SessionStart', { ...base(draw), hook_event_name: 'SessionStart', source: 'startup' }, draw).out, null);
  } finally {
    rmSync(check, { recursive: true, force: true });
    rmSync(draw, { recursive: true, force: true });
  }
});

test('the process a session runs in: recorded at its start, or with a prompt where the start was missed', () => {
  const home = fresh();
  try {
    run('SessionStart', { ...base(home), hook_event_name: 'SessionStart', source: 'startup' }, home);
    const host = (id: string) => JSON.parse(readFileSync(join(home, 'state', 'sessions', `${id}.hook.json`), 'utf8')).host;
    // The hook's parent: here this test, in Claude Code the session's own process (exec form, no shell between).
    assert.equal(host('ev-session').pid, process.pid);
    assert.match(String(host('ev-session').name), /^node(\.exe)?$/i);
    run('UserPromptSubmit', { ...base(home), session_id: 'ev-late', hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, home);
    assert.deepEqual(host('ev-late'), host('ev-session'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('keywords through the hook: off when the module is off, left to the mod when it runs', () => {
  const off = fresh({ modules: { keywords: false }, projects: [{ id: 'app', names: ['app'] }] });
  const withMod = fresh({ projects: [{ id: 'app', names: ['app'] }] });
  try {
    const prompt = (home: string) => ({ ...base(home), hook_event_name: 'UserPromptSubmit', prompt: 'app devam' });
    assert.equal(run('UserPromptSubmit', prompt(off), off).out, null);
    mkdirSync(join(withMod, 'state', 'sessions'), { recursive: true });
    writeFileSync(join(withMod, 'state', 'sessions', 'ev-session.mod.json'), '{}');
    assert.equal(run('UserPromptSubmit', prompt(withMod), withMod).out, null);
  } finally {
    rmSync(off, { recursive: true, force: true });
    rmSync(withMod, { recursive: true, force: true });
  }
});

test('the footer check stays quiet outside its mode, without a transcript, and when the lines are right', () => {
  const draw = fresh({ footer: { mode: 'draw' } });
  const check = fresh({ footer: { mode: 'check' } });
  try {
    const stop = (home: string, extra: object) => ({ ...base(home), hook_event_name: 'Stop', stop_hook_active: false, ...extra });
    assert.equal(run('Stop', stop(draw, { last_assistant_message: 'Done.' }), draw).out, null);
    assert.equal(run('Stop', stop(check, { transcript_path: undefined, last_assistant_message: 'Done.' }), check).out, null);
    assert.equal(run('Stop', stop(check, {}), check).out, null, 'no reply text: nothing to check');
  } finally {
    rmSync(draw, { recursive: true, force: true });
    rmSync(check, { recursive: true, force: true });
  }
});

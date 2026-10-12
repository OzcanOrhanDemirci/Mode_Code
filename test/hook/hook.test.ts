// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook as Claude Code runs it: a process that reads one event on stdin and answers on
 * stdout. Each case uses a fresh data folder; nothing outside it is touched, and no command is executed
 * (the hook only reads tool calls, it never runs them).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');

function run(event: string, input: object, home: string): { out: Record<string, any> | null; status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', hook, event], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, TERMINAL_CODE_HOME: home, TERMINAL_CODE_LANG: 'en' },
    timeout: 30_000,
  });
  const text = (r.stdout ?? '').trim();
  return { out: text ? JSON.parse(text) : null, status: r.status, stderr: r.stderr ?? '' };
}

function fresh(config: object = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'tc-hook-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', ...config }));
  return home;
}

const base = (home: string) => ({ session_id: 'test-session', cwd: home, transcript_path: join(home, 'none.jsonl'), permission_mode: 'bypassPermissions' });

test('a write into the tool data folder is denied, with the reason in the person language', () => {
  const home = fresh();
  try {
    const r = run(
      'PreToolUse',
      {
        ...base(home),
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_use_id: 'toolu_a',
        tool_input: { file_path: join(home, 'x.txt'), content: 'hi' },
      },
      home,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(r.out?.hookSpecificOutput?.permissionDecisionReason, /safety tool's own files/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a plain read passes without a word', () => {
  const home = fresh();
  try {
    const r = run(
      'PreToolUse',
      { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_b', tool_input: { file_path: join(home, 'config.json') } },
      home,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an "ask" rule asks; the same call passes once the person approved it through the mod', () => {
  const home = fresh();
  try {
    const call = { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_c', tool_input: { command: 'git clean -f' } };
    assert.equal(run('PreToolUse', call, home).out?.hookSpecificOutput?.permissionDecision, 'ask');
    mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
    const state = {
      v: 1,
      sessionId: 'test-session',
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
      approvals: [{ toolUseId: 'toolu_c', at: Date.now(), rules: ['git.clean'] }],
    };
    writeFileSync(join(home, 'state', 'sessions', 'test-session.mod.json'), JSON.stringify(state));
    assert.equal(run('PreToolUse', call, home).out, null);
    assert.equal(run('PreToolUse', { ...call, tool_use_id: 'toolu_other' }, home).out?.hookSpecificOutput?.permissionDecision, 'ask');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a keyword adds its context when the mod is not running', () => {
  const home = fresh({ projects: [{ id: 'terminal-code', names: ['terminal'] }] });
  try {
    const r = run('UserPromptSubmit', { ...base(home), hook_event_name: 'UserPromptSubmit', prompt: 'termınal devam' }, home);
    assert.match(r.out?.hookSpecificOutput?.additionalContext ?? '', /Keyword "continue" for project "terminal"/);
    assert.equal(
      run('UserPromptSubmit', { ...base(home), hook_event_name: 'UserPromptSubmit', prompt: 'terminal devam ederken bir şey sorayım' }, home).out,
      null,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('in check mode the Stop hook sends wrong footer lines back once', () => {
  const home = fresh({ footer: { mode: 'check' } });
  try {
    const transcript = join(home, 't.jsonl');
    const lines = [
      { type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'write the file' } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(root, 'package.json'), content: '' } }] },
      },
    ];
    writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const stop = { ...base(home), transcript_path: transcript, hook_event_name: 'Stop', stop_hook_active: false };
    const wrong = run('Stop', { ...stop, last_assistant_message: 'Done.\n\nChanges made: No' }, home);
    assert.equal(wrong.out?.decision, 'block');
    assert.match(wrong.out?.reason, /Changes made: Yes \(1 file written\)/);
    assert.equal(run('Stop', { ...stop, last_assistant_message: 'Done.\n\nChanges made: Yes' }, home).out, null);
    assert.equal(run('Stop', { ...stop, stop_hook_active: true, last_assistant_message: 'Done.' }, home).out, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

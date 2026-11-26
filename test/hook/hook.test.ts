// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook as Claude Code runs it: a process that reads one event on stdin and answers on
 * stdout. Each case uses a fresh data folder; nothing outside it is touched, and no command is executed
 * (the hook only reads tool calls, it never runs them).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsFile, layout } from '../../src/core/layout.js';
import { emptyProvenance, withSaid } from '../../src/core/provenance.js';
import { newModState } from '../../src/core/session.js';
import { activityOf, type ActivityEvent } from '../../src/core/ux/activity.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');

function run(
  event: string,
  input: object | string,
  home: string,
  env: Record<string, string> = {},
  preload?: string,
): { out: Record<string, any> | null; status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', ...(preload ? ['--import', preload] : []), hook, event], {
    cwd: root,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: undefined, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en', ...env },
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

const skillEvent = 'PreSkillShellCommand';
const skillCall = (home: string, command: string, tool = 'Bash') => ({
  ...base(home),
  hook_event_name: skillEvent,
  tool_name: tool,
  tool_input: { command },
  tool_use_id: 'skill-test',
  command_name: 'example:summary',
  command_source: 'projectSettings',
  invoked_by: 'user',
});

function skillRecords(home: string): Record<string, any>[] {
  return readFileSync(eventsFile(layout(home), 'test-session', 'hook', Date.now()), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test('a skill read passes silently, a PowerShell write to the belt data is blocked, and a non-shell event is ignored', () => {
  const home = fresh();
  try {
    const allow = run(skillEvent, skillCall(home, 'printf hello'), home);
    assert.equal(allow.status, 0, allow.stderr);
    assert.equal(allow.out, null);

    const path = join(home, 'sample.txt').replace(/\\/g, '/');
    const call = { ...skillCall(home, `Write-Output hello > "${path}"`, 'PowerShell'), invoked_by: 'claude' };
    const deny = run(skillEvent, call, home);
    assert.equal(deny.status, 0, deny.stderr);
    const decision = deny.out?.hookSpecificOutput;
    assert.equal(decision.hookEventName, skillEvent);
    assert.equal(decision.permissionDecision, 'deny');
    assert.match(decision.permissionDecisionReason, /safety tool's own files/);

    const ignored = run(skillEvent, { ...call, tool_name: 'Write', tool_input: { file_path: path } }, home);
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.equal(ignored.out, null);
    const records = skillRecords(home);
    assert.deepEqual(
      records.map(({ kind, source, tool, verdict, commandName, invokedBy }) => [kind, source, tool, verdict, commandName, invokedBy]),
      [
        ['belt', 'hook', 'Bash', 'allow', 'example:summary', 'user'],
        ['belt', 'hook', 'PowerShell', 'deny', 'example:summary', 'claude'],
      ],
    );
    const state = JSON.parse(readFileSync(join(home, 'state', 'sessions', 'test-session.hook.json'), 'utf8'));
    assert.equal(state.blocks[records[1]!.rules[0]], 1);
    assert.equal(state.permissionMode, 'bypassPermissions');
    const shown = records.map((record) => activityOf(record as ActivityEvent, 'en'));
    assert.deepEqual(
      shown.map((line) => line.cls),
      ['done', 'blocked'],
    );
    assert.match(shown[0]!.text, /allowed Bash · \/example:summary \(you opened it\)/);
    assert.match(shown[1]!.text, /Blocked PowerShell · \/example:summary \(Claude opened it\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a question while a skill loads is a refusal in either language, even with an approval for the same id', () => {
  const home = fresh();
  try {
    // The command would only read status. The belt asks about the temporary change to Git's hooks path.
    const call = skillCall(home, 'git -c core.hooksPath=.git/hooks status');
    const en = run(skillEvent, call, home);
    assert.equal(en.status, 0, en.stderr);
    assert.deepEqual(en.out?.hookSpecificOutput, {
      hookEventName: skillEvent,
      permissionDecision: 'deny',
      permissionDecisionReason:
        "🛡 Not run: /example:summary runs this command as it loads, and the safety belt needs the user's approval for it, which cannot be asked while a skill loads. The rest of the skill loaded. Tell the user; if the command is needed, run it as a step of your own so they can approve it.",
    });

    const dir = join(home, 'state', 'sessions');
    writeFileSync(
      join(dir, 'test-session.mod.json'),
      JSON.stringify({
        ...newModState('test-session', 'test', Date.now()),
        interaction: 'autonomous',
        approvals: [{ toolUseId: call.tool_use_id, at: Date.now(), rules: ['git.hooks-path'] }],
      }),
    );
    assert.equal(run('PreToolUse', { ...call, hook_event_name: 'PreToolUse' }, home).out, null);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'tr' }));
    const tr = run(skillEvent, call, home);
    assert.equal(tr.status, 0, tr.stderr);
    assert.equal(tr.out?.hookSpecificOutput?.hookEventName, skillEvent);
    assert.equal(tr.out?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(
      tr.out?.hookSpecificOutput?.permissionDecisionReason,
      /^🛡 Çalıştırılmadı: \/example:summary açılırken bu komutu çalıştırıyor;.*kendi adımın olarak çalıştır\.$/,
    );

    // In Autonomous, the person's own words make the same read a note. The note is recorded even with the plugin loaded.
    writeFileSync(join(dir, 'test-session.prov.json'), JSON.stringify(withSaid(emptyProvenance(), 'Use .git/hooks as the hooks path.')));
    const note = run(skillEvent, { ...call, invoked_by: 'other' }, home);
    assert.equal(note.status, 0, note.stderr);
    assert.equal(note.out, null);
    const records = skillRecords(home);
    assert.deepEqual(
      records.map(({ verdict, rules }) => [verdict, rules]),
      [
        ['deny', ['git.hooks-path']],
        ['deny', ['git.hooks-path']],
        ['warn', ['git.hooks-path']],
      ],
    );
    assert.equal(records[2]!.invokedBy, 'other');
    const shown = activityOf(records[2] as ActivityEvent, 'tr');
    assert.equal(shown.cls, 'note');
    assert.equal(shown.quiet, false);
    assert.match(shown.text, /\/example:summary \(başka bir yolla açıldı\)/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'test-session.hook.json'), 'utf8')).blocks['git.hooks-path'], 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('unreadable input and a missing skill command fail closed', () => {
  const home = fresh();
  try {
    const call = skillCall(home, 'printf hello');
    for (const input of [JSON.stringify(call).slice(0, 80), 'null', '', { ...call, tool_input: {} }]) {
      const r = run(skillEvent, input, home);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.out?.hookSpecificOutput?.hookEventName, skillEvent);
      assert.equal(r.out?.hookSpecificOutput?.permissionDecision, 'deny');
      assert.match(r.out?.hookSpecificOutput?.permissionDecisionReason, /could not be read/);
    }
    assert.equal(skillRecords(home)[0]?.verdict, 'deny');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a skill command is refused when evaluation throws or misses the deadline', { timeout: 30_000 }, () => {
  const home = fresh();
  try {
    // Substitute only the evaluator in the child process. A missing answer reaches the hook's own timer.
    const uri = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;
    for (const [body, reason] of [
      ["throw new Error('test error');", /test error/],
      ['await new Promise(() => {});', /no answer in 8 s/],
    ] as const) {
      const evaluate = uri(`export function decisionText() {} export async function evaluateToolCall() { ${body} }`);
      const loader = uri(`export function resolve(name, context, next) {
        if (name === '../core/belt/evaluate.js' || name.includes('/core/belt/evaluate.ts'))
          return { url: ${JSON.stringify(evaluate)}, shortCircuit: true };
        return next(name, context);
      }`);
      const preload = uri(`import { register } from 'node:module'; register(${JSON.stringify(loader)});`);
      const r = run(skillEvent, skillCall(home, 'printf hello'), home, {}, preload);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.out?.hookSpecificOutput?.hookEventName, skillEvent, r.stderr);
      assert.equal(r.out?.hookSpecificOutput?.permissionDecision, 'deny');
      assert.match(r.out?.hookSpecificOutput?.permissionDecisionReason, reason);
    }
    assert.deepEqual(
      skillRecords(home).map((r) => r.verdict),
      ['deny', 'deny'],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

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

test('a Monitor script is read like a Bash command: a write into the data folder is denied, a log watch passes', () => {
  const home = fresh();
  try {
    const call = (command: string) =>
      run(
        'PreToolUse',
        { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Monitor', tool_use_id: 'toolu_m', tool_input: { command, timeout_ms: 60000 } },
        home,
      );
    const denied = call(`echo x > "${join(home, 'config.json').replace(/\\/g, '/')}"`);
    assert.equal(denied.status, 0, denied.stderr);
    assert.equal(denied.out?.hookSpecificOutput?.permissionDecision, 'deny');
    const watch = call('tail -f build.log | grep --line-buffered ERROR');
    assert.equal(watch.status, 0, watch.stderr);
    assert.equal(watch.out, null);
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

test('a tool call cut short on its way in is refused: what cannot be read is not judged as harmless', () => {
  const home = fresh();
  try {
    const whole = JSON.stringify({
      ...base(home),
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_c',
      tool_input: { command: 'rm -rf /' },
    });
    const r = spawnSync(process.execPath, ['--import', 'tsx', hook, 'PreToolUse'], {
      cwd: root,
      input: whole.slice(0, 80),
      encoding: 'utf8',
      env: { ...process.env, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en' },
      timeout: 30_000,
    });
    const out = JSON.parse((r.stdout ?? '').trim());
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /could not be read/);
    // Nothing at all is no call to judge: it passes as before.
    assert.equal(run('PreToolUse', {}, home).out, null);
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

test('a bypass an older version recorded lifts nothing: the settings and the session record are read, the call is asked', () => {
  // 1.2.0 has no bypass: a settings file and a session record written before it may still say so.
  const home = fresh({ bypass: { enabled: true } });
  try {
    const call = { ...base(home), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_b', tool_input: { command: 'git clean -f' } };
    mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
    const state = {
      v: 1,
      sessionId: 'test-session',
      aliveAt: Date.now(),
      modVersion: 'x',
      mode: 'free',
      interaction: 'default',
      blocks: {},
      approvals: [],
      bypass: { since: Date.now() - 60_000, until: Date.now() + 3_600_000, count: 0 },
    };
    writeFileSync(join(home, 'state', 'sessions', 'test-session.mod.json'), JSON.stringify(state));
    assert.equal(run('PreToolUse', call, home).out?.hookSpecificOutput?.permissionDecision, 'ask');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a keyword adds its context when the mod is not running', () => {
  const home = fresh({ projects: [{ id: 'mode-code', names: ['terminal'] }] });
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

test('in check mode the Stop hook sends a wrong answer summary back once', () => {
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

test('without the plugin a mode or flow keyword says plainly that nothing enforces it; the permission mode is recorded', () => {
  const home = fresh();
  try {
    const r = run('UserPromptSubmit', { ...base(home), hook_event_name: 'UserPromptSubmit', prompt: 'akış', permission_mode: 'plan' }, home);
    assert.match(
      r.out?.hookSpecificOutput?.additionalContext ?? '',
      /need the mode-code plugin, which is not loaded in this session, so nothing does them here/,
    );
    const state = JSON.parse(readFileSync(join(home, 'state', 'sessions', 'test-session.hook.json'), 'utf8'));
    assert.equal(state.permissionMode, 'plan');
    assert.ok(state.promptAt > 0 && state.promptAt === state.permissionModeAt);
    // The mode's time moves only when it changes; the prompt's on every prompt (a full-autonomy start reads both).
    const later = Date.now() + 1;
    while (Date.now() < later) {
      /* the next millisecond */
    }
    run('UserPromptSubmit', { ...base(home), hook_event_name: 'UserPromptSubmit', prompt: 'hello', permission_mode: 'plan' }, home);
    const again = JSON.parse(readFileSync(join(home, 'state', 'sessions', 'test-session.hook.json'), 'utf8'));
    assert.equal(again.permissionModeAt, state.permissionModeAt);
    assert.ok(again.promptAt > state.promptAt);
    // A prompt without a mode is still a prompt the hook saw; the mode on record stays.
    run('UserPromptSubmit', { ...base(home), permission_mode: undefined, hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, home);
    const bare = JSON.parse(readFileSync(join(home, 'state', 'sessions', 'test-session.hook.json'), 'utf8'));
    assert.equal(bare.permissionMode, 'plan');
    assert.ok(bare.promptAt >= again.promptAt);
    run('SessionStart', { ...base(home), hook_event_name: 'SessionStart', session_id: 'other', permission_mode: 'acceptEdits' }, home);
    assert.equal(JSON.parse(readFileSync(join(home, 'state', 'sessions', 'other.hook.json'), 'utf8')).permissionMode, 'acceptEdits');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

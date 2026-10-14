// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook's part of sync across computers (docs/sync.md), for sessions the plugin is not loaded
 * in: the first prompt sends this computer's files and offers a handoff note another computer wrote, a
 * setting from another computer that lowers a protection is said to the person (not to Claude), a turn's end
 * syncs only when due, a session's start removes history past the months kept, and the belt protects the
 * computers' folders. Run as Claude Code runs the hook: a process, the event on stdin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../../src/core/config.js';
import { nextExport, sharedValues } from '../../src/core/sync.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');
const hasGit = spawnSync('git', ['--version']).status === 0;

function run(event: string, input: object, home: string): Record<string, any> | null {
  const r = spawnSync(process.execPath, ['--import', 'tsx', hook, event], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en' },
    timeout: 60_000,
  });
  const text = (r.stdout ?? '').trim();
  return text ? JSON.parse(text) : null;
}

const fwd = (p: string) => p.replace(/\\/g, '/');

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'tc-hooksync-'));
  const home = join(tmp, 'data');
  const shared = fwd(join(tmp, 'iCloud', 'tc'));
  const project = join(tmp, 'app');
  mkdirSync(home);
  mkdirSync(project);
  if (hasGit) {
    spawnSync('git', ['init', '-q'], { cwd: project });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/ada/app.git'], { cwd: project });
  }
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', sync: { place: 'folder', dir: shared, machine: { id: 'pc-0000', name: 'PC' } } }));
  // The Mac: a softer belt rule, and a handoff note for this project.
  const mac = normalizeConfig({ belt: { verdicts: { 'git.clean': 'allow' } } }).config;
  mkdirSync(join(shared, 'machines', 'mac-0000'), { recursive: true });
  writeFileSync(
    join(shared, 'machines', 'mac-0000', 'settings.json'),
    JSON.stringify(nextExport(null, sharedValues(mac), 'mac-0000', 0, (k) => (k === 'belt.verdicts' ? 900 : 0))),
  );
  mkdirSync(join(shared, 'handoffs', 'ada-app'), { recursive: true });
  const at = new Date(Date.now() - 3_600_000).toISOString();
  writeFileSync(
    join(shared, 'handoffs', 'ada-app', '20261013-090000-macsess1.md'),
    `---\ntype: handoff\nproject: ada-app\ncwd: /Users/ada/app\nmachine: MacBook\nsession: macsess1\nat: ${at}\ntrigger: keyword\n---\n\n## Next\n\nShip the release.\n`,
  );
  const base = { session_id: 'pc-session', cwd: project, transcript_path: join(tmp, 'none.jsonl'), permission_mode: 'default' };
  return { tmp, home, shared, project, base, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

test(
  "without the plugin: the first prompt sends this computer's files, offers the note written on the other computer, and tells the person what waits",
  { skip: !hasGit && 'git is not installed' },
  () => {
    const s = setup();
    try {
      const first = run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'Where were we?' }, s.home);
      assert.match(
        first?.hookSpecificOutput?.additionalContext ?? '',
        /A handoff note for this project is waiting, .* on MacBook .* Next: "Ship the release\."/,
      );
      assert.match(first?.systemMessage ?? '', /A setting from another computer waits for you; it would lower a protection here: belt\.verdicts/);
      assert.ok(!/belt\.verdicts/.test(first?.hookSpecificOutput?.additionalContext ?? ''), "what waits is the person's, not Claude's");
      assert.ok(existsSync(join(s.shared, 'machines', 'pc-0000', 'settings.json')));
      assert.equal(JSON.parse(readFileSync(join(s.home, 'state', 'sync.hook.json'), 'utf8')).trigger, 'start');
      // A turn's end right after: not due, nothing more.
      const before = readFileSync(join(s.home, 'state', 'sync.hook.json'), 'utf8');
      run('Stop', { ...s.base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, s.home);
      assert.equal(readFileSync(join(s.home, 'state', 'sync.hook.json'), 'utf8'), before);
      // Half an hour later it is: the record says a turn.
      writeFileSync(join(s.home, 'state', 'sync.hook.json'), JSON.stringify({ ...JSON.parse(before), at: Date.now() - 31 * 60_000 }));
      run('Stop', { ...s.base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, s.home);
      assert.equal(JSON.parse(readFileSync(join(s.home, 'state', 'sync.hook.json'), 'utf8')).trigger, 'turn');
    } finally {
      s.done();
    }
  },
);

test("a session's start removes this computer's history past the months kept; the belt keeps Claude out of the computers' folders", () => {
  const s = setup();
  try {
    const old = join(s.shared, 'machines', 'pc-0000', 'events', '2020-01');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'x.mod.jsonl'), '{"at":1}\n');
    run('SessionStart', { ...s.base, hook_event_name: 'SessionStart', source: 'startup' }, s.home);
    assert.ok(!existsSync(old));
    const write = run(
      'PreToolUse',
      { ...s.base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${s.shared}/machines/mac-0000/settings.json`, content: '{}' } },
      s.home,
    );
    assert.equal(write?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(write?.hookSpecificOutput?.permissionDecisionReason ?? '', /mode-code|own files|self\.tool-files/i);
    // A handoff note in the shared place is not one of the computers' folders.
    const note = run(
      'PreToolUse',
      { ...s.base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${s.shared}/handoffs/x/notes.md`, content: 'x' } },
      s.home,
    );
    assert.notEqual(note?.hookSpecificOutput?.permissionDecision, 'deny');
  } finally {
    s.done();
  }
});

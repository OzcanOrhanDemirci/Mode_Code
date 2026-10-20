// SPDX-License-Identifier: Apache-2.0
/**
 * The safety net in the safety-net hook, as Claude Code runs it: in Autonomous a `git clean` passes once what it
 * would remove is kept, with a line in the activity; where nothing can be kept it is asked, in full autonomy left
 * to the person; Manual asks and keeps nothing. The hook keeps; it never runs the call itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');
const hasGit = spawnSync('git', ['--version']).status === 0;

function run(input: object, home: string): Record<string, any> | null {
  const r = spawnSync(process.execPath, ['--import', 'tsx', hook, 'PreToolUse'], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en' },
    timeout: 30_000,
  });
  const text = (r.stdout ?? '').trim();
  return text ? JSON.parse(text) : null;
}

function world(interaction: string) {
  const top = realpathSync.native(mkdtempSync(join(tmpdir(), 'tc-hooknet-'))).replace(/\\/g, '/');
  const home = `${top}/data`;
  const repo = `${top}/app`;
  mkdirSync(`${home}/state/sessions`, { recursive: true });
  writeFileSync(`${home}/config.json`, JSON.stringify({ language: 'en' }));
  writeFileSync(
    `${home}/state/sessions/net-session.mod.json`,
    JSON.stringify({ v: 1, sessionId: 'net-session', aliveAt: Date.now(), modVersion: 'x', mode: 'free', interaction, blocks: {}, approvals: [] }),
  );
  mkdirSync(repo);
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a]);
  git('init', '-q');
  writeFileSync(`${repo}/README.md`, '# app\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  writeFileSync(`${repo}/build.tmp`, 'left over\n');
  const call = (cwd: string, command: string) => ({
    session_id: 'net-session',
    cwd,
    transcript_path: `${top}/none.jsonl`,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'toolu_net',
    tool_input: { command },
  });
  const nets = () => (existsSync(`${home}/net`) ? readdirSync(`${home}/net`).filter((n) => /^\d{8}-/.test(n)) : []);
  const events = () =>
    existsSync(`${home}/events`)
      ? readdirSync(`${home}/events`).flatMap((m) => readdirSync(`${home}/events/${m}`).map((f) => readFileSync(`${home}/events/${m}/${f}`, 'utf8')))
      : [];
  return { top, home, repo, call, nets, events, done: () => rmSync(top, { recursive: true, force: true }) };
}

test('Autonomous: git clean passes once what it would remove is kept, with its line in the activity', { skip: !hasGit && 'git is not installed' }, () => {
  const w = world('autonomous');
  try {
    assert.equal(run(w.call(w.repo, 'git clean -fd'), w.home), null);
    const [id] = w.nets();
    assert.ok(id, 'a net was laid');
    const record = JSON.parse(readFileSync(`${w.home}/net/${id}/net.json`, 'utf8'));
    assert.deepEqual([record.rule, record.command, record.files.map((f: { from: string }) => f.from)], ['git.clean', 'git clean -fd', [`${w.repo}/build.tmp`]]);
    assert.equal(readFileSync(record.files[0].to, 'utf8'), 'left over\n');
    assert.match(w.events().join('\n'), new RegExp(`"kind":"net".*"rule":"git.clean","id":"${id}"`));
  } finally {
    w.done();
  }
});

test(
  'nothing can be kept (no repository there): Autonomous asks, full autonomy leaves it to the person; Manual asks and keeps nothing',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const auto = world('autonomous');
    try {
      // `git -C` into a folder that is no repository: git cannot say what clean would remove.
      const outside = `${auto.top}/plain`;
      mkdirSync(outside);
      assert.equal(run(auto.call(outside, 'git clean -fd'), auto.home)?.hookSpecificOutput?.permissionDecision, 'ask');
      assert.deepEqual(auto.nets(), []);
    } finally {
      auto.done();
    }
    const full = world('full');
    try {
      const outside = `${full.top}/plain`;
      mkdirSync(outside);
      const out = run(full.call(outside, 'git clean -fd'), full.home)?.hookSpecificOutput;
      assert.equal(out?.permissionDecision, 'deny');
      assert.match(out?.permissionDecisionReason ?? '', /git clean -fd/);
    } finally {
      full.done();
    }
    const manual = world('manual');
    try {
      assert.equal(run(manual.call(manual.repo, 'git clean -fd'), manual.home)?.hookSpecificOutput?.permissionDecision, 'ask');
      assert.deepEqual(manual.nets(), []);
    } finally {
      manual.done();
    }
  },
);

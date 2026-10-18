// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor's measurements on a real disk: a sandbox installation (the real installer, a stand-in
 * `claude`), then the facts the checks read, one by one. Needs the build for the installed hook program.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherFacts, hookVerdict, locateGitBash, onPath, runProgram, sha256 } from '../../src/app/doctor/facts.js';
import { buildSandbox } from '../../src/app/doctor/selfcheck.js';
import { distDir } from '../../src/node/install.js';
import { toolPath } from '../../src/node/env.js';
import { SessionIndex } from '../../src/node/index-db.js';
import { EXTERNAL_SKILLS } from '../../src/core/skills-external.js';
import { syncKeptSkills } from '../../src/node/skills.js';

const built = existsSync(join(distDir(), 'hook.mjs')) && existsSync(join(distDir(), 'plugin', '.claude-plugin', 'plugin.json'));

test('a fresh sandbox installation, measured: healthy in every fact the checks read', { timeout: 60_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const sb = buildSandbox('en');
  assert.equal(typeof sb, 'object', String(sb));
  if (typeof sb === 'string') return;
  try {
    const f = await gatherFacts({ ...sb.env, measure: { ...sb.env.measure, agreement: true } });
    assert.ok(f.manifest);
    assert.equal(f.hookProgram.exists, true);
    assert.equal(f.hookProgram.hash, f.hookProgram.shippedHash);
    assert.deepEqual(f.pluginFiles.missing, []);
    assert.deepEqual(f.pluginFiles.different, []);
    assert.equal(f.hooks.filter((h) => h.ours).length, 4);
    assert.equal(f.hookNode?.exists, true);
    assert.match(f.hookNode?.version ?? '', /^\d+\.\d+\.\d+$/);
    assert.deepEqual(
      f.plugins?.map((p) => p.enabled),
      [true],
    );
    assert.equal(f.data.writable, true);
    assert.equal(f.data.renameWorks, true);
    assert.equal(f.data.caseInsensitive, process.platform === 'linux' ? false : true);
    assert.ok((f.data.freeBytes ?? 0) > 0);
    assert.deepEqual(f.data.missingDirs, []);
    assert.equal(f.config.problems.length, 0);
    assert.ok(f.selftest && f.selftest.every((s) => s.failed === 0));
    assert.ok(f.hookAgreement, 'the installed hook was compared');
    assert.equal(f.hookAgreement.error, null);
    assert.equal(f.hookAgreement.agreed, f.hookAgreement.samples, JSON.stringify(f.hookAgreement.differences));
    assert.ok(f.hookAgreement.samples >= 25);
    assert.deepEqual(f.bypass, { enabled: false, maxHours: 2, onNow: 0, floorWeakened: [] });
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a broken settings file is reported with its line and column, and never parsed as empty', { timeout: 60_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const sb = buildSandbox('en');
  if (typeof sb === 'string') return assert.fail(sb);
  try {
    writeFileSync(sb.settingsFile, '{\n  "theme": "dark",\n}\n');
    const f = await gatherFacts(sb.env);
    const user = f.settings.find((s) => s.scope === 'user');
    assert.equal(user?.exists, true);
    assert.match(user?.error ?? '', /line 3, column 1/);
    writeFileSync(sb.settingsFile, '');
    assert.equal((await gatherFacts(sb.env)).settings.find((s) => s.scope === 'user')?.error, null, 'an empty file is no error');
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('the index, leftovers and old session state are measured, not guessed', { timeout: 60_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const sb = buildSandbox('en');
  if (typeof sb === 'string') return assert.fail(sb);
  try {
    const l = sb.layout;
    new SessionIndex(l.index).close();
    let f = await gatherFacts(sb.env);
    assert.deepEqual(f.index, { exists: true, ok: true, detail: null, sessions: 0 });
    writeFileSync(l.index, 'not a database at all '.repeat(100));
    f = await gatherFacts(sb.env);
    assert.equal(f.index.ok, false);
    const old = new Date(Date.now() - 2 * 3600_000);
    const tmp = join(l.root, 'config.json.77.deadbeef.tmp');
    writeFileSync(tmp, '{}');
    writeFileSync(join(l.root, 'config.json.78.cafebabe.tmp'), '{}'); // fresh: a write may be under way
    utimesSync(tmp, old, old);
    const state = join(l.sessionsDir, 'abc.mod.json');
    writeFileSync(state, '{}');
    const older = new Date(Date.now() - 31 * 86400_000);
    utimesSync(state, older, older);
    f = await gatherFacts(sb.env);
    assert.deepEqual(f.data.staleTemp, ['config.json.77.deadbeef.tmp']);
    assert.equal(f.data.staleStates, 1);
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('recent transcripts are read for their shape: counts, tool names, session ids', { timeout: 60_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const sb = buildSandbox('en');
  if (typeof sb === 'string') return assert.fail(sb);
  try {
    const dir = join(sb.claudeDir, 'projects', 'C--dev-app');
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    const rows = [
      { type: 'user', sessionId: 'sess-1', timestamp: ts, message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: ts,
        message: { role: 'assistant', usage: { output_tokens: 3 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
      },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: ts,
        message: { role: 'assistant', usage: {}, content: [{ type: 'tool_use', id: 't2', name: 'StrReplace', input: { file_path: 'x', new_string: 'y' } }] },
      },
      'not json at all',
    ];
    writeFileSync(join(dir, 'sess-1.jsonl'), rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
    const f = await gatherFacts({ ...sb.env, measure: { ...sb.env.measure, transcripts: true } });
    const s = f.transcripts.shape!;
    assert.equal(f.transcripts.files, 1);
    assert.equal(s.user, 1);
    assert.equal(s.assistant, 2);
    assert.equal(s.unreadable, 1);
    assert.deepEqual(s.sessionIds, ['sess-1']);
    assert.deepEqual(s.tools.StrReplace, { calls: 1, runsCommands: false, writesFiles: true });
    assert.deepEqual(s.tools.Bash, { calls: 1, runsCommands: true, writesFiles: false });
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('programs on PATH are found in PATH order, one per folder; Git Bash is found beside git', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-path-'));
  try {
    const a = join(root, 'a');
    const b = join(root, 'b');
    mkdirSync(a);
    mkdirSync(b);
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    writeFileSync(join(a, exe), '');
    writeFileSync(join(b, exe), '');
    if (process.platform === 'win32') writeFileSync(join(b, 'claude.cmd'), '');
    const sep = process.platform === 'win32' ? ';' : ':';
    const found = onPath('claude', { PATH: [a, join(root, 'missing'), b, a].join(sep) }, process.platform);
    assert.deepEqual(found, [toolPath(join(a, exe)), toolPath(join(b, exe))]);
    assert.deepEqual(onPath('claude', {}, process.platform), []);
    // Git for Windows: <Git>/cmd/git.exe on PATH, bash in <Git>/bin.
    const git = join(root, 'Git');
    mkdirSync(join(git, 'cmd'), { recursive: true });
    mkdirSync(join(git, 'bin'), { recursive: true });
    writeFileSync(join(git, 'cmd', process.platform === 'win32' ? 'git.exe' : 'git'), '');
    writeFileSync(join(git, 'bin', 'bash.exe'), '');
    assert.equal(locateGitBash({ PATH: join(git, 'cmd') }, process.platform), toolPath(join(git, 'bin', 'bash.exe')));
    assert.equal(locateGitBash({ PATH: join(git, 'cmd'), CLAUDE_CODE_GIT_BASH_PATH: join(a, exe) }, process.platform), toolPath(join(a, exe)));
    assert.equal(locateGitBash({ PATH: a }, process.platform), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('running a program: first line of output, exit status, a missing program, a time limit', () => {
  const ok = runProgram(process.execPath, ['-e', 'console.log("one\\ntwo")']);
  assert.deepEqual([ok.ok, ok.out], [true, 'one']);
  const bad = runProgram(process.execPath, ['-e', 'console.error("boom"); process.exit(3)']);
  assert.deepEqual([bad.ok, bad.error], [false, 'boom']);
  const missing = runProgram(join(tmpdir(), 'no-such-program-tc'), []);
  assert.equal(missing.ok, false);
  assert.ok(missing.error);
  const slow = runProgram(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 300 });
  assert.equal(slow.ok, false);
  assert.ok(slow.ms < 4000);
  assert.equal(sha256(join(tmpdir(), 'no-such-file-tc')), null);
});

test('a hook program that ends before it reads the call gets a verdict, and the doctor goes on', async () => {
  // The doctor's own tests put such a program in place; on macOS it now and then ended the doctor (exit 1, no
  // output). A call larger than a pipe holds keeps the write going when the program ends, every time.
  const root = mkdtempSync(join(tmpdir(), 'tc-verdict-'));
  try {
    const hook = join(root, 'hook.mjs');
    writeFileSync(hook, 'process.exit(0);\n');
    const big = { tool_name: 'Bash', tool_input: { command: 'x'.repeat(4 * 1024 * 1024) } };
    assert.equal(await hookVerdict(process.execPath, hook, big, process.env, root), 'allow');
    writeFileSync(hook, 'process.exit(2);\n');
    assert.equal(await hookVerdict(process.execPath, hook, big, process.env, root), 'exit 2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "Claude Code's setup, measured on a real project: dead, jq and model hooks, shared settings, unpinned servers, secrets, git, the memory index",
  { timeout: 60_000 },
  async (t) => {
    if (!built) return t.skip('needs the build: npm run build');
    const sb = buildSandbox('en');
    if (typeof sb === 'string') return assert.fail(sb);
    try {
      // A fresh installation in a folder git does not keep: nothing to say but that.
      let f = await gatherFacts(sb.env);
      assert.deepEqual(
        { ...f.setup, noGit: undefined },
        {
          deadHooks: [],
          jqHooks: [],
          modelHooks: [],
          loosened: [],
          unpinnedMcp: [],
          secrets: [],
          localTracked: false,
          noGit: undefined,
          memoryIndex: null,
          toolSearchOff: f.setup.toolSearchOff,
          autoMode: [],
          skillsMissing: [],
        },
      );
      const root = sb.root;
      const proj = `${root}/proj`;
      mkdirSync(`${proj}/.claude`, { recursive: true });
      mkdirSync(`${root}/hooks`);
      writeFileSync(`${root}/hooks/ok.js`, '');
      mkdirSync(`${root}/memory`);
      writeFileSync(`${root}/memory/MEMORY.md`, '- a line\n'.repeat(250));
      const user = JSON.parse(readFileSync(sb.settingsFile, 'utf8')) as { hooks: Record<string, unknown[]> };
      const hook = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] });
      user.hooks.Stop = [hook('claude -p "summarize the session"'), { hooks: [{ type: 'prompt', prompt: 'Is the work done?' }] }];
      user.hooks.SessionStart = [hook(`node "${root}/nowhere/guard.js"`), hook(`node "${root}/hooks/ok.js"`)];
      user.hooks.PostToolUse = [...(user.hooks.PostToolUse ?? []), hook('jq -r .tool_input.file_path')];
      writeFileSync(sb.settingsFile, JSON.stringify({ ...user, autoMemoryDirectory: `${root}/memory`, permissions: { defaultMode: 'auto' } }, null, 2));
      // Another plugin with hooks of its own: an observer that starts a model, and a jq hook in a file its manifest names.
      const plug = `${root}/plugins/observer`;
      mkdirSync(`${plug}/hooks`, { recursive: true });
      mkdirSync(`${plug}/.claude-plugin`, { recursive: true });
      writeFileSync(`${plug}/hooks/hooks.json`, JSON.stringify({ hooks: { PostToolUse: [hook('claude --print "note what happened"')] } }));
      writeFileSync(`${plug}/more.json`, JSON.stringify({ hooks: { PreToolUse: [hook('jq .tool_name')] } }));
      writeFileSync(`${plug}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'observer', hooks: './more.json' }));
      const off = `${root}/plugins/off`;
      mkdirSync(`${off}/hooks`, { recursive: true });
      writeFileSync(`${off}/hooks/hooks.json`, JSON.stringify({ hooks: { Stop: [hook('claude -p x')] } }));
      const listed = [
        { id: 'observer@market', enabled: true, version: '1.0.0', installPath: plug },
        { id: 'off@market', enabled: false, version: '1.0.0', installPath: off },
      ];
      const runner = {
        version: () => sb.env.claude.version(),
        run: (args: readonly string[], ms?: number) =>
          args[0] === 'plugin' && args[1] === 'list'
            ? { status: 0, stdout: JSON.stringify([...(JSON.parse(sb.env.claude.run(args, ms).stdout) as unknown[]), ...listed]), stderr: '' }
            : sb.env.claude.run(args, ms),
      };
      writeFileSync(
        `${proj}/.claude/settings.json`,
        JSON.stringify({
          permissions: { allow: ['Bash(*)', 'Bash(npm test)'], defaultMode: 'bypassPermissions' },
          enableAllProjectMcpServers: true,
          enabledMcpjsonServers: ['browser', 7],
          env: { ENABLE_TOOL_SEARCH: 'false' },
        }),
      );
      const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
      writeFileSync(`${proj}/.claude/settings.local.json`, JSON.stringify({ permissions: { allow: ['Bash(rm:*)'] }, env: { GITHUB_TOKEN: token } }));
      writeFileSync(
        `${proj}/.mcp.json`,
        JSON.stringify({
          mcpServers: {
            browser: { command: 'npx', args: ['-y', '@playwright/mcp'] },
            firebase: { command: 'npx', args: ['-y', 'firebase-tools@15.34.0', 'mcp'] },
          },
        }),
      );
      const noPath = Object.fromEntries(Object.entries(sb.env.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
      const env = { ...sb.env, cwd: proj, env: { ...noPath, PATH: `${root}/hooks` }, claude: runner };
      f = await gatherFacts(env);
      const s = f.setup;
      assert.deepEqual(
        s.deadHooks.map((h) => [h.event, h.missing]),
        [['SessionStart', `${root}/nowhere/guard.js`]],
      );
      assert.deepEqual(
        s.jqHooks.map((h) => h.event),
        ['PostToolUse', 'PreToolUse (observer@market)'],
        'no jq on this PATH',
      );
      assert.deepEqual(
        s.modelHooks.map((h) => [h.event, h.command]),
        [
          ['Stop', 'claude -p "summarize the session"'],
          ['Stop', 'prompt hook'],
          ['PostToolUse (observer@market)', 'claude --print "note what happened"'],
        ],
        'a plugin turned off runs nothing',
      );
      assert.deepEqual(s.autoMode, ['user']);
      assert.deepEqual(
        s.loosened.map((x) => x.what),
        ['allow Bash(*)', 'enableAllProjectMcpServers', 'enabledMcpjsonServers browser', 'defaultMode bypassPermissions'],
        "the shared file only: the local one holds the person's own answers",
      );
      assert.deepEqual(
        s.unpinnedMcp.map((x) => [x.scope, x.name]),
        [['project', 'browser']],
      );
      assert.deepEqual(
        s.secrets.map((x) => [x.path.endsWith('settings.local.json'), x.kinds, x.tracked]),
        [[true, ['github-token'], false]],
      );
      assert.equal(s.noGit, true);
      assert.equal(s.localTracked, false);
      assert.deepEqual(s.toolSearchOff, ['ENABLE_TOOL_SEARCH'], "the project's env counts as Claude Code reads it");
      assert.equal(s.memoryIndex?.lines, 250);
      assert.equal(s.memoryIndex?.maxLines, 200);
      // Git keeps the local file now, and jq is on the PATH.
      const git = (...args: string[]) => runProgram('git', ['-C', proj, ...args]);
      assert.equal(git('init', '-q').ok, true);
      assert.equal(git('add', '.claude/settings.local.json').ok, true);
      writeFileSync(`${root}/hooks/${process.platform === 'win32' ? 'jq.exe' : 'jq'}`, '');
      f = await gatherFacts(env);
      assert.equal(f.setup.noGit, false);
      assert.equal(f.setup.localTracked, true);
      assert.deepEqual(
        f.setup.secrets.map((x) => x.tracked),
        [true],
      );
      assert.deepEqual(f.setup.jqHooks, []);
      // A force in the local file wins over the project's false, as in Claude Code.
      writeFileSync(`${proj}/.claude/settings.local.json`, JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'force' } }));
      assert.deepEqual((await gatherFacts(env)).setup.toolSearchOff, []);
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  },
);

test('the skills the settings keep are measured against the plugin folder, and only when Mode_Code is installed', { timeout: 60_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const sb = buildSandbox('en');
  if (typeof sb === 'string') return assert.fail(sb);
  try {
    const id = Object.keys(EXTERNAL_SKILLS)[0]!;
    // The doctor reads the settings from disk on every measurement, as a repair may just have rewritten them.
    const config = { ...sb.env.config, skills: { items: { [id]: 'on' as const } } };
    writeFileSync(sb.layout.config, JSON.stringify(config, null, 2));
    assert.deepEqual((await gatherFacts(sb.env)).setup.skillsMissing, [id]);
    syncKeptSkills(sb.layout, config);
    assert.deepEqual((await gatherFacts(sb.env)).setup.skillsMissing, []);
    rmSync(sb.layout.manifest);
    rmSync(`${sb.layout.pluginDir}/skills/${id}`, { recursive: true, force: true });
    assert.deepEqual((await gatherFacts(sb.env)).setup.skillsMissing, [], 'not installed: nothing is kept anywhere');
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

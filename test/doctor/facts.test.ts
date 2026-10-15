// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor's measurements on a real disk: a sandbox installation (the real installer, a stand-in
 * `claude`), then the facts the checks read, one by one. Needs the build for the installed hook program.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherFacts, hookVerdict, locateGitBash, onPath, runProgram, sha256 } from '../../src/app/doctor/facts.js';
import { buildSandbox } from '../../src/app/doctor/selfcheck.js';
import { distDir } from '../../src/node/install.js';
import { toolPath } from '../../src/node/env.js';
import { SessionIndex } from '../../src/node/index-db.js';

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

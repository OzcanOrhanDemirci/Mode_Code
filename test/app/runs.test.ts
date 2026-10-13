// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autonomyCheck, endedSince, findRun, loadRuns, mergedSettings, runFiles } from '../../src/app/runs.js';
import { layout } from '../../src/core/layout.js';
import { cloneDefaults } from '../../src/core/config.js';
import { pauseRun, startRun, type Run } from '../../src/core/run.js';
import type { HookEntry, SettingsSource } from '../../src/node/claude-env.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wsl', name), 'utf8');
const src = (scope: SettingsSource['scope'], json: Record<string, unknown>): SettingsSource => ({ scope, path: `/${scope}.json`, exists: true, json });
const hook = (event: string): HookEntry => ({
  scope: 'user',
  event,
  matcher: null,
  type: 'command',
  command: 'node',
  args: [],
  timeout: 10,
  onFailure: null,
  ours: true,
});

const mk = (id: string, now: number): Run =>
  startRun({
    id,
    task: `Task ${id}`,
    project: null,
    cwd: '/p',
    sessionId: 's',
    workDir: '/w',
    budget: { weeklyTarget: 50, source: '50' },
    start: { commit: 'c', branch: null },
    now,
  });

test('runs on record: newest first, found by a unique prefix, ended ones since a moment', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-runs-'));
  try {
    const l = layout(root);
    const a = mk('20261012-0900-a', 1000);
    const b = pauseRun(mk('20261013-0900-b', 2000), 'quota', 3000).run;
    for (const r of [a, b]) {
      mkdirSync(join(l.runsDir, r.id), { recursive: true });
      writeFileSync(join(l.runsDir, r.id, 'run.json'), JSON.stringify(r));
    }
    // A folder whose record names another id, and a torn record, are not runs.
    mkdirSync(join(l.runsDir, '20261014-0900-c'), { recursive: true });
    writeFileSync(join(l.runsDir, '20261014-0900-c', 'run.json'), JSON.stringify({ ...a, id: 'other' }));
    mkdirSync(join(l.runsDir, '20261014-0901-d'), { recursive: true });
    writeFileSync(join(l.runsDir, '20261014-0901-d', 'run.json'), '{');
    const runs = loadRuns({ layout: l });
    assert.deepEqual(
      runs.map((r) => r.id),
      ['20261013-0900-b', '20261012-0900-a'],
    );
    assert.equal(findRun(runs, '20261013')?.id, '20261013-0900-b');
    assert.equal(findRun(runs, '2026101'), null, 'two runs start that way');
    assert.deepEqual(
      endedSince(runs, 2500).map((r) => r.id),
      ['20261013-0900-b'],
    );
    writeFileSync(join(l.runsDir, b.id, 'report.md'), '# r');
    const files = runFiles({ layout: l }, b);
    assert.equal(files.report, join(l.runsDir, b.id, 'report.md'));
    assert.equal(files.plan, null);
    assert.equal(loadRuns({ layout: layout(join(root, 'none')) }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude Code's settings merge as Claude Code merges them: later scopes win, managed last, lists join", () => {
  const m = mergedSettings({
    settings: [
      src('managed', { sandbox: { failIfUnavailable: true } }),
      src('user', { sandbox: { enabled: true, allowUnsandboxedCommands: true, excludedCommands: ['a'] } }),
      src('project', { sandbox: { excludedCommands: ['b'] } }),
      src('local', { sandbox: { allowUnsandboxedCommands: false } }),
    ],
  });
  assert.deepEqual(m.sandbox, { enabled: true, allowUnsandboxedCommands: false, excludedCommands: ['a', 'b'], failIfUnavailable: true });
  assert.deepEqual(mergedSettings({ settings: [{ scope: 'user', path: '/x', exists: false, json: null }] }), {});
});

test("the checks from the person's terminal: what a session measures reads as measured at the start", () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-check-'));
  try {
    const l = layout(join(root, 'data'));
    const config = cloneDefaults();
    config.autonomy.enabled = true;
    const strict = {
      settings: [src('user', { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false } })],
      hooks: [hook('Stop'), hook('PreToolUse')],
    };
    // WSL as installed: interop on and C: mounted.
    const procs: Record<string, string> = {
      '/proc/sys/kernel/osrelease': '6.6.87.2-microsoft-standard-WSL2\n',
      '/proc/mounts': fixture('mounts-default.txt'),
      '/proc/sys/fs/binfmt_misc/WSLInterop': fixture('interop-enabled.txt'),
    };
    const g = autonomyCheck({ layout: l, config }, root, {
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'terminal-code' },
      readProc: (p) => procs[p] ?? null,
      exists: (p) => p in procs,
      claude: strict,
    });
    const by = Object.fromEntries(g.checks.map((c) => [c.id, c]));
    assert.equal(by.wsl!.key, 'auto.gate.wsl.both');
    assert.equal(by.sandbox!.ok, true);
    assert.equal(by.hook!.key, 'auto.cli.hookMissing', 'no manifest: not installed');
    assert.equal(by.project!.key, 'auto.gate.project.noGit');
    for (const id of ['budget', 'permission', 'alone'] as const) assert.deepEqual([by[id]!.ok, by[id]!.key], [null, 'auto.cli.atStart'], id);
    assert.equal(by.probe!.ok, null);
    assert.equal(g.ok, false);
    // After the setup: interop gone, no drive mounted.
    delete procs['/proc/sys/fs/binfmt_misc/WSLInterop'];
    procs['/proc/mounts'] = fixture('mounts-isolated.txt');
    const after = autonomyCheck({ layout: l, config }, root, {
      platform: 'linux',
      env: {},
      readProc: (p) => procs[p] ?? null,
      exists: (p) => p in procs,
      claude: strict,
    });
    assert.equal(after.checks.find((c) => c.id === 'wsl')!.ok, true);
    // Installed: a manifest, and hook entries that run the hook program of this data folder (wherever it is),
    // read as the doctor reads them; entries of another program do not count.
    mkdirSync(join(l.root, 'install'), { recursive: true });
    writeFileSync(l.manifest, JSON.stringify({ v: 1, app: 'terminal-code', version: 'dev', hooks: {} }));
    const program = (event: string): HookEntry => ({
      ...hook(event),
      command: '/usr/bin/node',
      args: [join(l.root, 'bin', 'hook.mjs').replace(/\\/g, '/'), event],
      ours: false,
    });
    const installed = autonomyCheck({ layout: l, config }, root, {
      platform: 'darwin',
      env: {},
      claude: { ...strict, hooks: [program('Stop'), program('PreToolUse')] },
    });
    assert.equal(installed.checks.find((c) => c.id === 'hook')!.ok, true);
    const other = autonomyCheck({ layout: l, config }, root, { platform: 'darwin', env: {}, claude: { ...strict, hooks: [hook('Stop'), hook('PreToolUse')] } });
    assert.equal(other.checks.find((c) => c.id === 'hook')!.key, 'auto.cli.hookMissing');
    // Native Windows: the platform says why, and the sandbox checks do not apply.
    const win = autonomyCheck({ layout: l, config }, root, { platform: 'win32', env: {}, claude: strict });
    assert.equal(win.checks.find((c) => c.id === 'platform')!.key, 'auto.gate.platform.windows');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

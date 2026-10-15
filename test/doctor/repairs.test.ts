// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor's repairs on a real disk, in a temporary folder: each one does exactly what it says, backs up
 * what it changes, refuses what it must not touch, and the plan runs them once each in a safe order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layout } from '../../src/core/layout.js';
import { cloneDefaults } from '../../src/core/config.js';
import { REPAIRS, type RepairEnv } from '../../src/app/doctor/repairs.js';
import { planRepairs } from '../../src/app/doctor/doctor.js';
import { standInClaude } from '../../src/app/doctor/selfcheck.js';
import { APP_VERSION } from '../../src/core/app.js';
import { toolPath } from '../../src/node/env.js';
import { hookGroups, withOurHooks } from '../../src/node/install.js';
import type { CheckResult } from '../../src/app/doctor/types.js';
import { healthyFacts } from '../helpers/facts.js';

function sandbox(): { root: string; env: RepairEnv; dist: string; done(): void } {
  const root = toolPath(mkdtempSync(join(tmpdir(), 'tc-repair-')));
  const l = layout(`${root}/data`);
  const dist = `${root}/dist`;
  mkdirSync(`${dist}/plugin/.claude-plugin`, { recursive: true });
  mkdirSync(`${dist}/plugin/hooks`, { recursive: true });
  writeFileSync(`${dist}/hook.mjs`, '// hook of this build\n');
  writeFileSync(`${dist}/plugin/.claude-plugin/plugin.json`, JSON.stringify({ name: 'mode-code', version: '9.9.9' }));
  writeFileSync(`${dist}/plugin/hooks/register.js`, '// mod\n');
  mkdirSync(`${root}/claude`, { recursive: true });
  mkdirSync(l.root, { recursive: true });
  const env: RepairEnv = {
    layout: l,
    claudeDir: `${root}/claude`,
    distDir: dist,
    node: 'C:/node/node.exe',
    runner: standInClaude(),
    config: cloneDefaults(),
    now: 1_760_000_000_000,
  };
  return { root, env, dist, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("restore-hooks keeps the person's own settings, backs the file up, and adds every hook", () => {
  const s = sandbox();
  try {
    const mine = { model: 'opus', hooks: { Notification: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    writeFileSync(`${s.env.claudeDir}/settings.json`, JSON.stringify(mine));
    const r = REPAIRS['restore-hooks'].run(s.env, healthyFacts({ hookNode: null }));
    assert.equal(r.ok, true, r.detail);
    const after = JSON.parse(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8'));
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.hooks.Notification, mine.hooks.Notification);
    for (const ev of ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart']) assert.ok(after.hooks[ev], ev);
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, 'C:/node/node.exe');
    assert.ok(r.backup && existsSync(r.backup));
    assert.deepEqual(JSON.parse(readFileSync(r.backup!, 'utf8')), mine);
  } finally {
    s.done();
  }
});

test('restore-hooks keeps a working recorded Node.js; repoint-node replaces it', () => {
  const s = sandbox();
  try {
    writeFileSync(`${s.env.claudeDir}/settings.json`, '{}');
    const facts = healthyFacts({ hookNode: { path: 'D:/recorded/node.exe', exists: true, version: '24.0.0' } });
    REPAIRS['restore-hooks'].run(s.env, facts);
    assert.equal(JSON.parse(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8')).hooks.Stop[0].hooks[0].command, 'D:/recorded/node.exe');
    REPAIRS['repoint-node'].run(s.env, facts);
    assert.equal(JSON.parse(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8')).hooks.Stop[0].hooks[0].command, 'C:/node/node.exe');
  } finally {
    s.done();
  }
});

test('restore-hooks never overwrites a settings file Claude Code cannot read', () => {
  const s = sandbox();
  try {
    writeFileSync(`${s.env.claudeDir}/settings.json`, '{ "model": "opus", ');
    const r = REPAIRS['restore-hooks'].run(s.env, healthyFacts());
    assert.equal(r.ok, false);
    assert.match(r.detail, /not valid JSON/);
    assert.equal(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8'), '{ "model": "opus", ');
    writeFileSync(`${s.env.claudeDir}/settings.json`, '[1, 2]');
    assert.equal(REPAIRS['restore-hooks'].run(s.env, healthyFacts()).ok, false);
  } finally {
    s.done();
  }
});

test('restore-hooks on settings with doubled hooks leaves exactly one copy', () => {
  const s = sandbox();
  try {
    const groups = hookGroups('C:/node/node.exe', `${s.env.layout.root}/bin/hook.mjs`);
    const once = withOurHooks({}, groups, s.env.layout.root) as { hooks: Record<string, unknown[]> };
    const twice = { hooks: Object.fromEntries(Object.entries(once.hooks).map(([k, v]) => [k, [...v, ...v]])) };
    writeFileSync(`${s.env.claudeDir}/settings.json`, JSON.stringify(twice));
    REPAIRS['remove-duplicate-hooks'].run(s.env, healthyFacts({ hookNode: null }));
    const after = JSON.parse(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8'));
    for (const v of Object.values(after.hooks) as unknown[][]) assert.equal(v.length, 1);
  } finally {
    s.done();
  }
});

test('the hook program and the plugin files are copied from this build', () => {
  const s = sandbox();
  try {
    assert.equal(REPAIRS['restore-hook-program'].run(s.env, healthyFacts()).ok, true);
    assert.equal(readFileSync(`${s.env.layout.root}/bin/hook.mjs`, 'utf8'), '// hook of this build\n');
    assert.equal(REPAIRS['restore-plugin-files'].run(s.env, healthyFacts()).ok, true);
    assert.equal(readFileSync(`${s.env.layout.pluginDir}/hooks/register.js`, 'utf8'), '// mod\n');
    const market = JSON.parse(readFileSync(`${s.env.layout.marketplace}/.claude-plugin/marketplace.json`, 'utf8'));
    assert.equal(market.plugins[0].version, '9.9.9');
    rmSync(`${s.dist}/hook.mjs`);
    assert.equal(REPAIRS['restore-hook-program'].run(s.env, healthyFacts()).ok, false);
  } finally {
    s.done();
  }
});

test("record-cli writes this build's command-line program into the record, keeping the rest; without one it changes nothing", () => {
  const s = sandbox();
  try {
    const manifest = { v: 1, app: 'mode-code', version: '0.1.0', node: 'C:/node/node.exe', hooks: {}, createdConfig: false };
    mkdirSync(`${s.env.layout.root}/install`, { recursive: true });
    writeFileSync(s.env.layout.manifest, JSON.stringify(manifest));
    assert.equal(REPAIRS['record-cli'].run(s.env, healthyFacts()).ok, false, 'a build with no command-line program');
    assert.deepEqual(JSON.parse(readFileSync(s.env.layout.manifest, 'utf8')), manifest);
    writeFileSync(`${s.dist}/cli.mjs`, '// control center\n');
    const r = REPAIRS['record-cli'].run(s.env, healthyFacts());
    assert.equal(r.ok, true, r.detail);
    assert.deepEqual(JSON.parse(readFileSync(s.env.layout.manifest, 'utf8')), { ...manifest, cli: `${s.dist}/cli.mjs` });
    assert.equal(r.detail, `/0 opens ${s.dist}/cli.mjs`);
    rmSync(s.env.layout.manifest);
    assert.equal(REPAIRS['record-cli'].run(s.env, healthyFacts()).ok, false, 'not installed');
  } finally {
    s.done();
  }
});

test('plugin repairs go through claude: install from the local marketplace, enable at user scope', () => {
  const s = sandbox();
  try {
    const claude = s.env.runner as ReturnType<typeof standInClaude>;
    assert.equal(REPAIRS['enable-plugin'].run(s.env, healthyFacts()).ok, false, 'nothing to enable before it is installed');
    assert.equal(REPAIRS['reinstall-plugin'].run(s.env, healthyFacts()).ok, true);
    assert.deepEqual(claude.calls.at(-1), ['plugin', 'install', 'mode-code', '--marketplace', s.env.layout.marketplace, '--scope', 'user']);
    claude.plugin.enabled = false;
    assert.equal(REPAIRS['enable-plugin'].run(s.env, healthyFacts()).ok, true);
    assert.equal(claude.plugin.enabled, true);
    assert.equal(REPAIRS['reinstall-plugin'].personOnly, true);
    assert.equal(REPAIRS['enable-plugin'].personOnly, true);
  } finally {
    s.done();
  }
});

test("another version in Claude Code: this version's files are copied, then Claude Code records this version", () => {
  const s = sandbox();
  try {
    const claude = s.env.runner as ReturnType<typeof standInClaude>;
    assert.equal(REPAIRS['update-plugin'].run(s.env, healthyFacts()).ok, false, 'nothing to update before it is installed');
    REPAIRS['reinstall-plugin'].run(s.env, healthyFacts());
    claude.plugin.recorded = '0.1.0';
    rmSync(`${s.env.layout.pluginDir}/hooks/register.js`);
    const r = REPAIRS['update-plugin'].run(s.env, healthyFacts());
    assert.deepEqual([r.ok, r.detail, claude.plugin.recorded], [true, 'Updated', APP_VERSION]);
    assert.deepEqual(claude.calls.at(-1), ['plugin', 'update', 'mode-code@mode-code-local', '--scope', 'user']);
    assert.equal(readFileSync(`${s.env.layout.pluginDir}/hooks/register.js`, 'utf8'), '// mod\n', 'the files came first');
    assert.equal(REPAIRS['update-plugin'].personOnly, true);
    rmSync(`${s.dist}/plugin`, { recursive: true, force: true });
    const none = REPAIRS['update-plugin'].run(s.env, healthyFacts());
    assert.deepEqual([none.ok, none.detail], [false, 'this build has no plugin files']);
  } finally {
    s.done();
  }
});

test('folders, the index, the quota reading and old session state', () => {
  const s = sandbox();
  try {
    const l = s.env.layout;
    REPAIRS['create-data-folders'].run(s.env, healthyFacts());
    for (const d of [l.stateDir, l.sessionsDir, l.eventsDir, l.installDir, l.backupsDir, `${l.root}/bin`]) assert.ok(existsSync(d), d);
    for (const f of [l.index, `${l.index}-wal`, `${l.index}-shm`, l.quota]) writeFileSync(f, 'x');
    REPAIRS['rebuild-index'].run(s.env, healthyFacts());
    REPAIRS['remove-bad-quota'].run(s.env, healthyFacts());
    for (const f of [l.index, `${l.index}-wal`, `${l.index}-shm`, l.quota]) assert.equal(existsSync(f), false, f);
    writeFileSync(`${l.sessionsDir}/old.mod.json`, '{}');
    writeFileSync(`${l.sessionsDir}/new.hook.json`, '{}');
    writeFileSync(`${l.sessionsDir}/notes.txt`, 'not ours to judge');
    const old = new Date(s.env.now - 40 * 86400_000);
    utimesSync(`${l.sessionsDir}/old.mod.json`, old, old);
    utimesSync(`${l.sessionsDir}/notes.txt`, old, old);
    const r = REPAIRS['prune-session-state'].run({ ...s.env, now: Date.now() + 0 }, healthyFacts());
    assert.equal(r.detail, '1 removed');
    assert.deepEqual(readdirSync(l.sessionsDir).sort(), ['new.hook.json', 'notes.txt']);
  } finally {
    s.done();
  }
});

test('leftover files: only the listed ones, and only inside the data folder', () => {
  const s = sandbox();
  try {
    const l = s.env.layout;
    writeFileSync(`${l.root}/config.json.1.0a1b2c3d.tmp`, '{}');
    writeFileSync(`${s.root}/outside.txt`, 'keep me');
    const r = REPAIRS['remove-stale-temp'].run(
      s.env,
      healthyFacts({ data: { ...healthyFacts().data, staleTemp: ['config.json.1.0a1b2c3d.tmp', '../outside.txt'] } }),
    );
    assert.equal(r.detail, '1 removed');
    assert.equal(existsSync(`${l.root}/config.json.1.0a1b2c3d.tmp`), false);
    assert.equal(readFileSync(`${s.root}/outside.txt`, 'utf8'), 'keep me');
  } finally {
    s.done();
  }
});

test('rewrite-config keeps the valid settings and a copy of the old file', () => {
  const s = sandbox();
  try {
    writeFileSync(s.env.layout.config, '{ "language": "tr", "view": "enormous" }');
    const r = REPAIRS['rewrite-config'].run({ ...s.env, config: { ...cloneDefaults(), language: 'tr' } }, healthyFacts());
    assert.equal(r.ok, true);
    const after = JSON.parse(readFileSync(s.env.layout.config, 'utf8'));
    assert.equal(after.language, 'tr');
    assert.notEqual(after.view, 'enormous');
    assert.equal(readFileSync(r.backup!, 'utf8'), '{ "language": "tr", "view": "enormous" }');
    assert.equal(REPAIRS['rewrite-config'].personOnly, true);
  } finally {
    s.done();
  }
});

test('tighten-permissions leaves the data folder to its owner (POSIX)', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions');
  const s = sandbox();
  try {
    const l = s.env.layout;
    mkdirSync(l.stateDir, { recursive: true });
    writeFileSync(l.config, '{}');
    chmodSync(l.config, 0o666);
    chmodSync(l.root, 0o777);
    REPAIRS['tighten-permissions'].run(s.env, healthyFacts());
    assert.equal(statSync(l.config).mode & 0o777, 0o600);
    assert.equal(statSync(l.root).mode & 0o777, 0o700);
  } finally {
    s.done();
  }
});

const r = (id: string, status: CheckResult['status'], repair?: CheckResult['repair']): CheckResult => ({
  id,
  group: 'install',
  protection: false,
  status,
  summary: { key: 'doc.line', params: { text: id } },
  ...(repair ? { repair } : {}),
});

test('the plan: each repair once, in a safe order, notes only on request, the person-only ones refused under an agent', () => {
  const results = [
    r('a', 'fail', 'restore-hooks'),
    r('b', 'warn', 'restore-hook-program'),
    r('c', 'fail', 'restore-hooks'),
    r('d', 'warn', 'reinstall-plugin'),
    r('e', 'info', 'prune-session-state'),
    r('f', 'ok', 'rebuild-index'),
    r('g', 'warn', 'create-data-folders'),
  ];
  const plan = planRepairs(results, { agent: false });
  assert.deepEqual(
    plan.map((p) => p.id),
    ['create-data-folders', 'restore-hook-program', 'restore-hooks', 'reinstall-plugin'],
  );
  assert.deepEqual(plan.find((p) => p.id === 'restore-hooks')?.checks, ['a', 'c']);
  assert.ok(planRepairs(results, { agent: false, optional: true }).some((p) => p.id === 'prune-session-state'));
  const agent = planRepairs(results, { agent: true });
  assert.equal(agent.find((p) => p.id === 'reinstall-plugin')?.refused, true);
  assert.equal(agent.find((p) => p.id === 'restore-hooks')?.refused, false, 'putting the hooks back is not refused');
  // Code that comes from the build running the doctor never goes into the protection on an agent's say-so:
  // an agent could build a weaker hook and have the doctor install it.
  assert.equal(agent.find((p) => p.id === 'restore-hook-program')?.refused, true);
  for (const id of [
    'restore-hook-program',
    'restore-plugin-files',
    'repoint-node',
    'reinstall-plugin',
    'enable-plugin',
    'rewrite-config',
    'record-cli',
  ] as const)
    assert.equal(REPAIRS[id].personOnly, true, id);
});

test('under an agent the hooks go back only with the Node.js they were installed with', () => {
  const s = sandbox();
  try {
    writeFileSync(`${s.env.claudeDir}/settings.json`, '{}');
    const gone = REPAIRS['restore-hooks'].run(
      { ...s.env, agent: true },
      healthyFacts({ hookNode: { path: 'C:/gone/node.exe', exists: false, version: null } }),
    );
    assert.equal(gone.ok, false);
    assert.match(gone.detail, /refused/);
    assert.equal(readFileSync(`${s.env.claudeDir}/settings.json`, 'utf8'), '{}', 'nothing changed');
    const recorded = REPAIRS['restore-hooks'].run(
      { ...s.env, agent: true },
      healthyFacts({ hookNode: { path: 'D:/node/node.exe', exists: true, version: '24.0.0' } }),
    );
    assert.equal(recorded.ok, true);
  } finally {
    s.done();
  }
});

test('the plan: repointing Node.js rewrites the hooks, so the other hook repairs fold into it', () => {
  const plan = planRepairs([r('x', 'fail', 'repoint-node'), r('y', 'fail', 'restore-hooks'), r('z', 'warn', 'remove-duplicate-hooks')], { agent: false });
  assert.deepEqual(
    plan.map((p) => [p.id, p.checks]),
    [['repoint-node', ['x', 'y', 'z']]],
  );
  const two = planRepairs([r('y', 'fail', 'restore-hooks'), r('z', 'warn', 'remove-duplicate-hooks')], { agent: false });
  assert.deepEqual(
    two.map((p) => [p.id, p.checks]),
    [['restore-hooks', ['y', 'z']]],
  );
});

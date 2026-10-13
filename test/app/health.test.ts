// SPDX-License-Identifier: Apache-2.0
/**
 * The feature view of health (what status and the control center's top bar show), on a real installation
 * in a temporary folder made by the real installer with a stand-in `claude`, then broken one piece at a
 * time. Protection turns red, never gray; conveniences turn gray and say why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkHealth, healthCounts, type FeatureId } from '../../src/app/health.js';
import { buildSandbox } from '../../src/app/doctor/selfcheck.js';
import { cloneDefaults, type Config } from '../../src/core/config.js';
import { hookProgram, readManifest } from '../../src/node/install.js';
import { readJson, writeJsonAtomic } from '../../src/node/fsx.js';
import { APP_VERSION } from '../../src/core/app.js';
import { built } from '../helpers/proc.js';
import type { AppContext } from '../../src/app/context.js';

function setup(t: { skip(m: string): void }) {
  if (!built()) {
    t.skip('needs the build: npm run build');
    return null;
  }
  const sb = buildSandbox('en');
  if (typeof sb === 'string') throw new Error(sb);
  process.env.CLAUDE_CONFIG_DIR = sb.claudeDir;
  const ctx = (config: Partial<Config> = {}): AppContext => ({
    layout: sb.layout,
    config: { ...cloneDefaults(), ...config },
    problems: [],
    lang: 'en',
    cwd: sb.root,
  });
  const state = (id: FeatureId, c = ctx()) => {
    const f = checkHealth(c).features.find((x) => x.id === id)!;
    return `${f.state}${f.reason ? ' ' + f.reason.key : ''}`;
  };
  return { sb, ctx, state, done: () => rmSync(sb.root, { recursive: true, force: true }) };
}

test('a fresh installation: the protections work, the self-test passes, the plugin waits for its first session', (t) => {
  const s = setup(t);
  if (!s) return;
  try {
    const h = checkHealth(s.ctx(), { selfTest: true });
    assert.equal(h.installed, true);
    assert.equal(s.state('belt'), 'ok');
    assert.equal(s.state('selfProtection'), 'ok');
    assert.equal(s.state('mod'), 'gray health.mod.neverSeen');
    // Without the plugin seen, keywords fall back to the hook; the quota and quiet work need the plugin.
    assert.equal(s.state('keywords'), 'ok health.fallback');
    assert.equal(s.state('quietWork'), 'gray health.needsMod');
    assert.equal(s.state('modes'), 'gray health.needsMod');
    assert.equal(healthCounts(h).red, 0);
  } finally {
    s.done();
  }
});

test('the plugin reporting in from a session turns the in-process features on; another version is named', (t) => {
  const s = setup(t);
  if (!s) return;
  try {
    mkdirSync(s.sb.layout.sessionsDir, { recursive: true });
    const live = {
      v: 1,
      sessionId: 'x',
      aliveAt: Date.now(),
      modVersion: APP_VERSION,
      mode: 'free',
      interaction: 'default',
      project: null,
      weeklyTarget: null,
      weeklyTargetSource: null,
      wrapUp: false,
      resumeAt: null,
      blocks: {},
      approvals: [],
    };
    writeFileSync(join(s.sb.layout.sessionsDir, 'x.mod.json'), JSON.stringify(live));
    assert.equal(s.state('mod'), 'ok');
    assert.equal(s.state('keywords'), 'ok');
    assert.equal(s.state('quota'), 'gray health.quota.noReading');
    writeFileSync(join(s.sb.layout.sessionsDir, 'x.mod.json'), JSON.stringify({ ...live, modVersion: 'older' }));
    assert.equal(s.state('mod'), 'gray health.mod.otherVersion');
    const m = readManifest(s.sb.layout)!;
    writeJsonAtomic(s.sb.layout.manifest, { ...m, plugin: { ...m.plugin, installed: false } });
    assert.equal(s.state('mod'), 'gray health.mod.notInstalled');
  } finally {
    s.done();
  }
});

test('broken protection is red with the reason: program gone, hook gone, its Node.js gone', (t) => {
  const s = setup(t);
  if (!s) return;
  try {
    rmSync(hookProgram(s.sb.layout));
    assert.equal(s.state('belt'), 'red health.belt.noProgram');
    assert.equal(s.state('selfProtection'), 'red health.belt.noProgram');
    s.sb.resetSettings();
    writeFileSync(hookProgram(s.sb.layout), '// back\n');
    const settings = readJson<{ hooks: Record<string, unknown> }>(s.sb.settingsFile)!;
    delete settings.hooks.PreToolUse;
    writeFileSync(s.sb.settingsFile, JSON.stringify(settings));
    assert.equal(s.state('belt'), 'red health.belt.noHook');
    s.sb.resetSettings();
    const text = JSON.stringify(readJson(s.sb.settingsFile))
      .split(JSON.stringify(readManifest(s.sb.layout)!.node))
      .join('"C:/gone/node.exe"');
    writeFileSync(s.sb.settingsFile, text);
    assert.equal(s.state('belt'), 'red health.belt.noNode');
  } finally {
    s.done();
  }
});

test('the conveniences: off when switched off, the memory folder states, the transcripts', (t) => {
  const s = setup(t);
  if (!s) return;
  try {
    assert.equal(s.state('footer', s.ctx({ footer: { ...cloneDefaults().footer, mode: 'off' } })), 'off');
    assert.equal(s.state('secrets', s.ctx({ modules: { ...cloneDefaults().modules, secrets: false } })), 'off');
    assert.equal(s.state('modes', s.ctx({ modules: { ...cloneDefaults().modules, modes: false } })), 'off');
    assert.equal(s.state('memory'), 'off health.memory.none');
    assert.equal(s.state('memory', s.ctx({ memory: { ...cloneDefaults().memory, dirs: [join(s.sb.root, 'nope')] } })), 'gray health.memory.missing');
    mkdirSync(join(s.sb.root, 'notes'));
    assert.equal(s.state('memory', s.ctx({ memory: { ...cloneDefaults().memory, dirs: [join(s.sb.root, 'notes')] } })), 'ok health.memory.noGit');
    assert.equal(s.state('index'), 'gray health.index.noTranscripts');
    mkdirSync(join(s.sb.claudeDir, 'projects'));
    assert.equal(s.state('index'), 'ok');
  } finally {
    s.done();
  }
});

test('not installed: every feature says so, nothing is red', (t) => {
  const s = setup(t);
  if (!s) return;
  try {
    rmSync(s.sb.layout.manifest);
    const h = checkHealth(s.ctx());
    assert.equal(h.installed, false);
    assert.ok(h.features.filter((f) => f.id !== 'memory' && f.id !== 'index' && f.id !== 'secrets').every((f) => f.state === 'absent'));
    assert.equal(healthCounts(h).red, 0);
  } finally {
    s.done();
  }
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor tested on a real installation in a temporary folder: every fault it knows is injected, and
 * each must be noticed and, where a repair exists, repaired and confirmed by a second measurement. Needs
 * the build (npm run build): the hook program it installs is the shipped one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FAULTS, SANDBOX_CHECKS, selfCheck, standInClaude } from '../../src/app/doctor/selfcheck.js';
import { distDir } from '../../src/node/install.js';
import { REPAIRS } from '../../src/app/doctor/repairs.js';
import { APP_VERSION } from '../../src/core/app.js';

const built = existsSync(join(distDir(), 'hook.mjs')) && existsSync(join(distDir(), 'plugin', '.claude-plugin', 'plugin.json'));

test('every fault is noticed, and every repairable one is repaired and confirmed', { timeout: 120_000 }, async (t) => {
  if (!built) return t.skip('needs the build: npm run build');
  const r = await selfCheck('en');
  assert.equal(r.skipped, null);
  assert.deepEqual(r.baseline, { ok: true, problems: [] }, 'a fresh installation passes');
  for (const f of r.faults) {
    assert.equal(f.detected, true, `${f.id} not noticed: ${f.detail}`);
    assert.notEqual(f.repaired, false, `${f.id} not repaired: ${f.detail}`);
  }
  assert.equal(r.ok, true);
  assert.equal(r.faults.length, FAULTS.filter((f) => !f.only || f.only.includes(process.platform)).length);
});

test('the fault list covers every repair the sandbox can exercise, and names real checks', () => {
  const repairs = new Set(FAULTS.map((f) => f.repair).filter(Boolean));
  // Repairs the sandbox does not exercise, and why: the plugin ones change Claude Code (stand-in claude
  // covers them in repairs.test.ts); pruning old state needs a clock 30 days on (covered there too).
  const elsewhere = new Set(['reinstall-plugin', 'update-plugin', 'enable-plugin', 'prune-session-state', 'remove-duplicate-hooks']);
  for (const id of Object.keys(REPAIRS)) assert.ok(repairs.has(id as never) || elsewhere.has(id), `no fault exercises ${id}`);
  for (const f of FAULTS) assert.ok(SANDBOX_CHECKS.includes(f.check) || f.check === 'files.permissions', `${f.id}: ${f.check} is not a sandbox check`);
  assert.equal(new Set(FAULTS.map((f) => f.id)).size, FAULTS.length);
});

test('the stand-in claude answers the commands the installer and the doctor use, and nothing else', () => {
  const c = standInClaude('9.9.9');
  assert.equal(c.version(), '9.9.9');
  assert.equal(c.run(['--version']).stdout, '9.9.9 (Claude Code)');
  assert.deepEqual(JSON.parse(c.run(['plugin', 'list', '--json']).stdout), []);
  assert.equal(c.run(['plugin', 'install', 'x']).status, 0);
  assert.equal(JSON.parse(c.run(['plugin', 'list', '--json']).stdout)[0].enabled, true);
  // As Claude Code does: an install over an installed plugin keeps its record, an update records anew.
  c.plugin.recorded = '0.1.0';
  assert.equal(c.run(['plugin', 'install', 'x']).status, 0);
  assert.equal(JSON.parse(c.run(['plugin', 'list', '--json']).stdout)[0].version, '0.1.0');
  assert.equal(c.run(['plugin', 'update', 'x']).status, 0);
  assert.equal(JSON.parse(c.run(['plugin', 'list', '--json']).stdout)[0].version, APP_VERSION);
  assert.equal(c.run(['plugin', 'uninstall', 'x']).status, 0);
  assert.equal(c.run(['plugin', 'update', 'x']).status, 1, 'nothing to update');
  assert.equal(c.run(['plugin', 'enable', 'x']).status, 1);
  assert.equal(c.run(['plugin', 'marketplace', 'remove', 'x']).status, 0);
  assert.equal(c.run(['mcp', 'list']).status, 1);
  assert.equal(c.calls.length, 13);
});

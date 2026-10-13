// SPDX-License-Identifier: Apache-2.0
// An installation under an earlier name of the tool, taken over by the installer (docs/release.md, "Renaming").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layout } from '../../src/core/layout.js';
import { applyInstall, hookGroups, planInstall, withOurHooks, withoutPrevious, type Manifest } from '../../src/node/install.js';
import { copyPrevious, findPrevious, previousPlugin, rebase, rebaseJson, type PreviousInstall } from '../../src/node/previous.js';
import type { ClaudeRunner } from '../../src/node/claude-env.js';
import { built } from '../helpers/proc.js';

const OLD = [{ id: 'old-name', name: 'Old Name' }];
const fwd = (p: string) => p.replace(/\\/g, '/');

function home(): { dir: string; done(): void } {
  const dir = fwd(mkdtempSync(join(tmpdir(), 'tc-previous-')));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An earlier installation's data folder: a manifest, programs, settings and records that name its own paths. */
function oldInstall(dir: string, opts: { manifest?: boolean } = {}): string {
  const root = `${dir}/.old-name`;
  mkdirSync(`${root}/bin`, { recursive: true });
  mkdirSync(`${root}/marketplace/plugins/old-name`, { recursive: true });
  mkdirSync(`${root}/install/backups`, { recursive: true });
  mkdirSync(`${root}/state/sessions`, { recursive: true });
  mkdirSync(`${root}/events/2026-10`, { recursive: true });
  mkdirSync(`${root}/memory/notes`, { recursive: true });
  writeFileSync(`${root}/bin/hook.mjs`, '// old program');
  writeFileSync(`${root}/marketplace/plugins/old-name/x.js`, '// old plugin');
  writeFileSync(`${root}/install/backups/settings.json.1`, '{}');
  if (opts.manifest !== false) {
    const m: Partial<Manifest> = {
      v: 1,
      app: 'old-name',
      version: '0.1.0',
      dataDir: root,
      plugin: { id: 'old-name@old-name-local', installed: true, marketplaceDir: `${root}/marketplace` },
    };
    writeFileSync(`${root}/install/manifest.json`, JSON.stringify(m));
  }
  writeFileSync(
    `${root}/config.json`,
    JSON.stringify({ view: 'detailed', sync: { dir: `${root}/sync` }, memory: { store: { dir: `${root}/memory/notes` } }, note: 'elsewhere' }),
  );
  writeFileSync(`${root}/state/sessions/a.mod.json`, JSON.stringify({ workDir: `${root.replace(/\//g, '\\')}\\flows\\x` }));
  writeFileSync(`${root}/events/2026-10/a.cli.jsonl`, `{"path":"${root}/config.json"}\n`);
  writeFileSync(`${root}/memory/notes/MEMORY.md`, '# Memory\n');
  writeFileSync(`${root}/memory/notes/data.json`, JSON.stringify({ path: `${root}/memory/notes` }));
  return root;
}

test('an earlier installation is found beside this data folder, newest name first; none without earlier names', () => {
  const h = home();
  try {
    const old = oldInstall(h.dir);
    const l = layout(`${h.dir}/.new-name`);
    const p = findPrevious(l, OLD);
    assert.equal(p?.root, old);
    assert.equal(p?.name, 'Old Name');
    assert.equal(p?.manifest?.app, 'old-name');
    assert.equal(p?.copy, true, 'this data folder does not exist yet');
    assert.equal(findPrevious(l, []), null);
    assert.equal(findPrevious(l, [{ id: 'never-was', name: 'x' }, ...OLD])?.id, 'old-name', 'a name with no folder is passed over');
    mkdirSync(l.root);
    assert.equal(findPrevious(l, OLD)?.copy, false, 'both exist: nothing is copied over this one');
    assert.equal(findPrevious(layout(old), OLD), null, 'a folder is not its own predecessor');
  } finally {
    h.done();
  }
});

test("a manifest of another app does not count as the earlier installation's; only its data is left", () => {
  const h = home();
  try {
    const old = oldInstall(h.dir, { manifest: false });
    writeFileSync(`${old}/install/manifest.json`, JSON.stringify({ v: 1, app: 'someone-else' }));
    const p = findPrevious(layout(`${h.dir}/.new-name`), OLD)!;
    assert.equal(p.manifest, null);
    assert.deepEqual(previousPlugin(p), { id: 'old-name@old-name-local', marketplace: 'old-name-local' });
  } finally {
    h.done();
  }
});

test('rebase moves a path from inside one folder to the same place in another, in any spelling; nothing else', () => {
  const from = 'C:/Users/ada/.old-name';
  const to = 'C:/Users/ada/.new-name';
  assert.equal(rebase('C:/Users/ada/.old-name', from, to), to);
  assert.equal(rebase('C:/Users/ada/.old-name/sync', from, to), `${to}/sync`);
  assert.equal(rebase('C:\\Users\\ada\\.old-name\\memory\\x', from, to), `${to}/memory/x`);
  assert.equal(rebase('c:/users/ADA/.Old-Name/x', from, to), `${to}/x`);
  assert.equal(rebase('C:/Users/ada/.old-name-fork/x', from, to), 'C:/Users/ada/.old-name-fork/x');
  assert.equal(rebase('see C:/Users/ada/.old-name/x', from, to), 'see C:/Users/ada/.old-name/x', 'only a string that is a path');
  assert.equal(rebase('C:/Users/ada/.old-name/x', `${from}/`, to), `${to}/x`);
  const r = rebaseJson({ a: `${from}/x`, b: [1, `${from}`, { c: 'other' }], d: null, e: true }, from, to);
  assert.deepEqual(r.value, { a: `${to}/x`, b: [1, to, { c: 'other' }], d: null, e: true });
  assert.equal(r.changed, 2);
});

test("an earlier installation's hooks leave the settings; the memory setting moves only with the data", () => {
  const old = 'C:/Users/ada/.old-name';
  const root = 'C:/Users/ada/.new-name';
  const settings = withOurHooks({ theme: 'dark', autoMemoryDirectory: `${old}/memory/notes` }, hookGroups('node', `${old}/bin/hook.mjs`), old);
  const p = (copy: boolean): PreviousInstall => ({ id: 'old-name', name: 'Old Name', root: old, manifest: null, copy });
  assert.deepEqual(withoutPrevious(settings, p(true), root), { theme: 'dark', autoMemoryDirectory: `${root}/memory/notes` });
  assert.deepEqual(withoutPrevious(settings, p(false), root), { theme: 'dark', autoMemoryDirectory: `${old}/memory/notes` });
  assert.deepEqual(withoutPrevious({ autoMemoryDirectory: 'D:/notes' }, p(true), root), { autoMemoryDirectory: 'D:/notes' });
  assert.equal(withoutPrevious(settings, null, root), settings);
});

test('copying brings the settings, records, history and memory, not the programs or the manifest; paths in the settings and records follow', () => {
  const h = home();
  try {
    const old = oldInstall(h.dir);
    const l = layout(`${h.dir}/.new-name`);
    const r = copyPrevious(findPrevious(l, OLD)!, l);
    assert.equal(existsSync(`${l.root}/bin`), false);
    assert.equal(existsSync(`${l.root}/marketplace`), false);
    assert.equal(existsSync(l.manifest), false);
    assert.equal(existsSync(`${l.root}/install/backups/settings.json.1`), true, 'the backups of the settings are kept');
    assert.equal(r.files, 6);
    const cfg = JSON.parse(readFileSync(l.config, 'utf8'));
    assert.deepEqual(cfg, { view: 'detailed', sync: { dir: `${l.root}/sync` }, memory: { store: { dir: `${l.root}/memory/notes` } }, note: 'elsewhere' });
    assert.equal(JSON.parse(readFileSync(`${l.root}/state/sessions/a.mod.json`, 'utf8')).workDir, `${l.root}/flows/x`);
    assert.equal(r.paths, 3);
    assert.equal(readFileSync(`${l.root}/events/2026-10/a.cli.jsonl`, 'utf8'), `{"path":"${old}/config.json"}\n`, 'history is kept as it was written');
    assert.deepEqual(
      JSON.parse(readFileSync(`${l.root}/memory/notes/data.json`, 'utf8')),
      { path: `${old}/memory/notes` },
      'the memory is the person’s: untouched',
    );
    assert.equal(existsSync(old), true, 'the earlier folder stays until the new installation tested itself');
  } finally {
    h.done();
  }
});

/** A stand-in for the claude command: records calls, answers like Claude Code. */
function runner(): ClaudeRunner & { calls: string[][]; fail?: string } {
  const r: ClaudeRunner & { calls: string[][]; fail?: string } = {
    calls: [],
    version: () => '2.1.296',
    run(args) {
      r.calls.push([...args]);
      if (r.fail && args.join(' ').startsWith(r.fail)) return { status: 1, stdout: '', stderr: 'boom' };
      if (args[1] === 'uninstall' && args[2] === 'gone@gone-local') return { status: 1, stdout: '', stderr: 'Plugin "gone@gone-local" is not installed' };
      return { status: 0, stdout: 'ok', stderr: '' };
    },
  };
  return r;
}

test('the installer takes an earlier installation over: data copied first, hooks swapped in one write, the rest removed once the new one works', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const h = home();
  try {
    const old = oldInstall(h.dir);
    const claudeDir = `${h.dir}/.claude`;
    mkdirSync(claudeDir);
    const settingsFile = `${claudeDir}/settings.json`;
    writeFileSync(
      settingsFile,
      JSON.stringify(withOurHooks({ theme: 'dark', autoMemoryDirectory: `${old}/memory/notes` }, hookGroups(process.execPath, `${old}/bin/hook.mjs`), old)),
    );
    const l = layout(`${h.dir}/.new-name`);
    const plan = planInstall(l, { claude: '2.1.296', claudeDir, env: {}, previousNames: OLD });
    assert.deepEqual(
      plan.steps.map((s) => s.kind),
      ['migrate', 'data-folder', 'hook-program', 'marketplace', 'plugin', 'settings-hooks', 'config', 'self-test', 'retire-previous'],
    );
    assert.equal(plan.steps.find((s) => s.kind === 'config')?.done, true, 'the earlier settings file is kept, nothing is asked again');
    assert.deepEqual(plan.steps.at(-1)?.targets, ['old-name@old-name-local', old]);
    const run = runner();
    const r = applyInstall(l, plan, { runner: run });
    assert.equal(r.ok, true, JSON.stringify(r.steps));
    assert.deepEqual(r.manifest?.previous, { id: 'old-name', root: old, removed: true });
    assert.equal(existsSync(old), false);
    const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
    assert.equal(s.theme, 'dark');
    assert.equal(s.autoMemoryDirectory, `${l.root}/memory/notes`);
    const programs = Object.values(s.hooks as Record<string, { hooks: { args: string[] }[] }[]>).flatMap((g) =>
      g.flatMap((x) => x.hooks.map((y) => fwd(y.args[0]!))),
    );
    assert.deepEqual(programs, Array(4).fill(`${l.root}/bin/hook.mjs`));
    const installed = run.calls.findIndex((c) => c[1] === 'install');
    assert.ok(installed >= 0 && installed < run.calls.findIndex((c) => c[1] === 'uninstall'), 'the new plugin is in before the old one goes');
    assert.deepEqual(run.calls.at(-2), ['plugin', 'uninstall', 'old-name@old-name-local', '--scope', 'user']);
    assert.deepEqual(run.calls.at(-1), ['plugin', 'marketplace', 'remove', 'old-name-local']);
  } finally {
    h.done();
  }
});

test('when both folders exist the earlier one is left as it is, but its hooks and plugin still go; a failed removal is reported', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const h = home();
  try {
    const old = oldInstall(h.dir);
    const claudeDir = `${h.dir}/.claude`;
    mkdirSync(claudeDir);
    writeFileSync(`${claudeDir}/settings.json`, JSON.stringify(withOurHooks({}, hookGroups(process.execPath, `${old}/bin/hook.mjs`), old)));
    const l = layout(`${h.dir}/.new-name`);
    mkdirSync(l.root);
    const plan = planInstall(l, { claude: '2.1.296', claudeDir, env: {}, previousNames: OLD });
    assert.equal(plan.steps[0]?.kind, 'data-folder', 'nothing to copy');
    const r = applyInstall(l, plan, { runner: runner() });
    assert.equal(r.ok, true, JSON.stringify(r.steps));
    assert.equal(existsSync(old), true);
    assert.match(r.steps.at(-1)?.detail ?? '', /left as it is/);
    assert.deepEqual(r.manifest?.previous, { id: 'old-name', root: old, removed: false });
    const s = JSON.parse(readFileSync(`${claudeDir}/settings.json`, 'utf8'));
    assert.equal(JSON.stringify(s).includes('.old-name'), false, 'no hook of the earlier name is left');

    const again = planInstall(l, { claude: '2.1.296', claudeDir, env: {}, previousNames: OLD });
    const failing = runner();
    failing.fail = 'plugin marketplace remove';
    const r2 = applyInstall(l, again, { runner: failing });
    assert.equal(r2.ok, false);
    assert.equal(r2.steps.at(-1)?.kind, 'retire-previous');
    assert.equal(r2.steps.at(-1)?.ok, false);
  } finally {
    h.done();
  }
});

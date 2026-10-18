// SPDX-License-Identifier: Apache-2.0
// Tool packs on this computer (src/node/packs.ts): `claude` answered by a stand-in that records each call, the
// record of what this tool turned on, the local settings Claude Code leaves behind, and the folders read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, parse } from 'node:path';
import { layout } from '../../src/core/layout.js';
import { packById } from '../../src/core/packs.js';
import type { ClaudeRunner } from '../../src/node/claude-env.js';
import { applyUninstall, writeMarketplace } from '../../src/node/install.js';
import {
  autoPacks,
  findProgram,
  listedPlugins,
  packGuide,
  packInstallArgs,
  packRows,
  readPackRecord,
  tidyLocalSettings,
  topNames,
  turnAllOff,
  turnOff,
  turnOn,
} from '../../src/node/packs.js';

function fakeClaude(listed: unknown[] = [], fail: string[] = []) {
  const calls: string[] = [];
  const runner: ClaudeRunner = {
    version: () => '2.1.302',
    run: (args) => {
      calls.push(args.join(' '));
      if (fail.some((f) => args.join(' ').includes(f))) return { status: 1, stdout: '', stderr: `failed: ${args[2]}` };
      if (args[0] === 'plugin' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(listed), stderr: '' };
      return { status: 0, stdout: `✔ done: ${args[2]}`, stderr: '' };
    },
  };
  return { runner, calls };
}

function place() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-packs-'));
  const l = layout(join(dir, 'data'));
  mkdirSync(l.stateDir, { recursive: true });
  const project = join(dir, 'app');
  mkdirSync(project, { recursive: true });
  return { dir, l, project, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a folder's top names; none for the home folder or a drive's root", () => {
  const p = place();
  try {
    writeFileSync(join(p.project, 'pubspec.yaml'), 'name: app');
    mkdirSync(join(p.project, 'lib'));
    assert.deepEqual(topNames(p.project).sort(), ['lib', 'pubspec.yaml']);
    assert.deepEqual(topNames(homedir()), []);
    assert.deepEqual(topNames(parse(p.project).root), []);
    assert.deepEqual(topNames(join(p.dir, 'missing')), []);
  } finally {
    p.done();
  }
});

test('a program on the PATH, with the extensions Windows gives it', () => {
  const p = place();
  try {
    const bin = join(p.dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'typst.exe'), '');
    writeFileSync(join(bin, 'ffmpeg'), '');
    mkdirSync(join(bin, 'dart'));
    assert.equal(findProgram('typst', { Path: bin, PATHEXT: '.COM;.EXE' }, 'win32'), join(bin, 'typst.exe'));
    assert.equal(findProgram('ffmpeg', { PATH: [join(p.dir, 'none'), bin].join(delimiter) }, process.platform), join(bin, 'ffmpeg'));
    assert.equal(findProgram('dart', { PATH: bin }, 'linux'), null, 'a folder is no program');
    assert.equal(findProgram('typst', {}, 'linux'), null);
  } finally {
    p.done();
  }
});

test('the plugins Claude Code lists: read defensively; a pack is on where its plugin is listed enabled', () => {
  const listed = [
    { id: 'mode-code-typst@mode-code-local', scope: 'local', enabled: true },
    { id: 'typescript-lsp@claude-plugins-official', scope: 'local', enabled: false },
    { name: 'no id' },
    5,
  ];
  assert.deepEqual(listedPlugins(fakeClaude(listed).runner), [
    { id: 'mode-code-typst@mode-code-local', scope: 'local', enabled: true },
    { id: 'typescript-lsp@claude-plugins-official', scope: 'local', enabled: false },
  ]);
  assert.equal(listedPlugins(fakeClaude([], ['plugin list']).runner), null);
  assert.equal(listedPlugins({ version: () => null, run: () => ({ status: 0, stdout: 'not json', stderr: '' }) }), null);
  assert.deepEqual(listedPlugins({ version: () => null, run: () => ({ status: 0, stdout: 'Warning\n[]', stderr: '' }) }), []);
  const rows = packRows(listedPlugins(fakeClaude(listed).runner)!, { typst: 'me' }, (prog) => prog === 'typst');
  const typst = rows.find((r) => r.pack.id === 'typst')!;
  assert.deepEqual([typst.on, typst.mode, typst.found], [true, 'me', ['typst']]);
  assert.equal(rows.find((r) => r.pack.id === 'typescript')!.on, false);
});

test('turning a pack on and off in a project: the command Claude Code takes, the record, the local settings left tidy', () => {
  const p = place();
  try {
    const typst = packById('typst')!;
    assert.deepEqual(packInstallArgs(typst, p.l, 'local'), ['plugin', 'install', 'mode-code-typst', '--marketplace', p.l.marketplace, '--scope', 'local']);
    assert.deepEqual(packInstallArgs(packById('python')!, p.l, 'local'), ['plugin', 'install', 'pyright-lsp@claude-plugins-official', '--scope', 'local']);
    const c = fakeClaude();
    const on = turnOn(p.l, [typst], { project: p.project, runner: c.runner }, 7);
    assert.deepEqual(on, [{ pack: 'typst', ok: true, detail: '✔ done: mode-code-typst' }]);
    assert.deepEqual(readPackRecord(p.l).on, [{ pack: 'typst', project: p.project, at: 7 }]);
    // Again: one record, the newer.
    turnOn(p.l, [typst], { project: p.project, runner: c.runner }, 9);
    assert.deepEqual(readPackRecord(p.l).on, [{ pack: 'typst', project: p.project, at: 9 }]);
    // Claude Code leaves an empty enabledPlugins behind: taken out, and the file with it when nothing else is left.
    const local = join(p.project, '.claude', 'settings.local.json');
    mkdirSync(join(p.project, '.claude'));
    writeFileSync(local, JSON.stringify({ enabledPlugins: {} }));
    const off = turnOff(p.l, typst, { project: p.project, runner: c.runner });
    assert.equal(off.ok, true);
    assert.equal(existsSync(local), false);
    assert.deepEqual(readPackRecord(p.l).on, []);
    assert.equal(c.calls.at(-1), 'plugin uninstall mode-code-typst@mode-code-local --scope local');
    // A failure changes no record.
    const bad = fakeClaude([], ['install']);
    assert.equal(turnOn(p.l, [typst], { project: p.project, runner: bad.runner })[0]!.ok, false);
    assert.deepEqual(readPackRecord(p.l).on, []);
    // Gone already counts as off.
    const gone: ClaudeRunner = { version: () => null, run: () => ({ status: 1, stdout: '', stderr: 'Plugin "x" is not installed' }) };
    assert.equal(turnOff(p.l, typst, { project: p.project, runner: gone }).ok, true);
  } finally {
    p.done();
  }
});

test('the local settings: only an empty enabledPlugins goes; other settings stay; what does not read is left alone', () => {
  const p = place();
  try {
    const f = join(p.dir, 'settings.local.json');
    writeFileSync(f, JSON.stringify({ enabledPlugins: {}, permissions: { allow: ['Bash(npm test)'] } }));
    tidyLocalSettings(f);
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { permissions: { allow: ['Bash(npm test)'] } });
    writeFileSync(f, JSON.stringify({ enabledPlugins: { 'x@y': true } }));
    tidyLocalSettings(f);
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { enabledPlugins: { 'x@y': true } });
    writeFileSync(f, '{ not json');
    tidyLocalSettings(f);
    assert.equal(readFileSync(f, 'utf8'), '{ not json');
    tidyLocalSettings(join(p.dir, 'none.json'));
  } finally {
    p.done();
  }
});

test('Automatic use in a project: its markers, the programs found, what is on already; uninstalling turns all off where each was', () => {
  const p = place();
  try {
    writeFileSync(join(p.project, 'pubspec.yaml'), 'name: app');
    writeFileSync(join(p.project, 'firebase.json'), '{}');
    writeFileSync(join(p.project, 'report.typ'), '= Report');
    const listed = [{ id: 'mode-code-typst@mode-code-local', scope: 'local', enabled: true }];
    const c = fakeClaude(listed);
    // Dart is not on this computer: Flutter's server could not start, so it waits.
    const r = autoPacks(p.l, p.project, { autoUse: true, items: {} }, c.runner, (prog) => prog === 'npx');
    assert.deepEqual(
      r.on.map((x) => x.pack),
      ['firebase'],
    );
    assert.deepEqual(r.already, ['typst']);
    assert.deepEqual(
      c.calls.filter((x) => x.startsWith('plugin install')),
      [`plugin install mode-code-firebase --marketplace ${p.l.marketplace} --scope local`],
    );
    assert.deepEqual(
      autoPacks(p.l, p.project, { autoUse: false, items: {} }, c.runner, () => true),
      { on: [], already: [] },
    );
    // Uninstalling: each where it was turned on; a project folder that is gone is skipped.
    turnOn(p.l, [packById('ffmpeg')!], { project: join(p.dir, 'gone'), runner: c.runner });
    const used: (string | null)[] = [];
    const off = turnAllOff(p.l, (project) => {
      used.push(project);
      return c.runner;
    });
    assert.deepEqual(
      off.map((x) => x.pack),
      ['firebase'],
    );
    assert.deepEqual(used, [p.project]);
  } finally {
    p.done();
  }
});

test("a pack's guide: beside the marketplace, else in a build's folder", () => {
  const p = place();
  try {
    assert.equal(packGuide(p.l, 'typst'), null);
    const dist = join(p.dir, 'dist');
    mkdirSync(join(dist, 'packs', 'guides'), { recursive: true });
    writeFileSync(join(dist, 'packs', 'guides', 'typst.md'), 'from the build');
    assert.equal(packGuide(p.l, 'typst', dist), 'from the build');
    mkdirSync(join(p.l.marketplace, 'packs', 'guides'), { recursive: true });
    writeFileSync(join(p.l.marketplace, 'packs', 'guides', 'typst.md'), 'installed');
    assert.equal(packGuide(p.l, 'typst', dist), 'installed');
  } finally {
    p.done();
  }
});

test('the marketplace carries the packs beside the plugin; uninstalling turns off what was turned on before the marketplace goes', () => {
  const p = place();
  try {
    const dist = join(p.dir, 'dist');
    mkdirSync(join(dist, 'plugin', '.claude-plugin'), { recursive: true });
    writeFileSync(join(dist, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mode-code', version: '9.9.9', description: 'the plugin' }));
    mkdirSync(join(dist, 'packs', 'plugins', 'mode-code-typst', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(dist, 'packs', 'plugins', 'mode-code-typst', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ version: '9.9.9', description: 'Typst' }),
    );
    mkdirSync(join(dist, 'packs', 'guides'), { recursive: true });
    writeFileSync(join(dist, 'packs', 'guides', 'typst.md'), 'the guide');
    writeMarketplace(p.l, dist);
    const market = JSON.parse(readFileSync(join(p.l.marketplace, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.deepEqual(
      market.plugins.map((x: { name: string; source: string }) => [x.name, x.source]),
      [
        ['mode-code', './plugins/mode-code'],
        ['mode-code-typst', './packs/plugins/mode-code-typst'],
      ],
    );
    assert.equal(packGuide(p.l, 'typst'), 'the guide');
    const c = fakeClaude();
    turnOn(p.l, [packById('typst')!], { project: p.project, runner: c.runner });
    const r = applyUninstall(p.l, { runner: c.runner, claudeDir: join(p.dir, 'claude') });
    assert.deepEqual(r.steps[0], { what: 'packs', ok: true, detail: 'typst' });
    assert.deepEqual(
      c.calls.filter((x) => x.startsWith('plugin uninstall') || x.startsWith('plugin marketplace')),
      [
        'plugin uninstall mode-code-typst@mode-code-local --scope local',
        'plugin uninstall mode-code@mode-code-local --scope user',
        'plugin marketplace remove mode-code-local',
      ],
    );
  } finally {
    p.done();
  }
});

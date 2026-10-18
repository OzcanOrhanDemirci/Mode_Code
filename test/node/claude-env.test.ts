// SPDX-License-Identifier: Apache-2.0
/**
 * Reading the setup the way Claude Code sees it for a session started in a folder. Found on the author's
 * machine: a session started in the home folder has the user's own .claude folder as its project
 * folder, and the doctor counted every hook there twice ("4 extra copies").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginHooks, pluginsVia, readClaudeEnv, type ClaudeRunner } from '../../src/node/claude-env.js';

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'tc-env-'));
  const dir = join(home, '.claude');
  mkdirSync(join(dir, 'skills', 'mine'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'mine', 'SKILL.md'), '# mine\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# user\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }));
  const read = (cwd: string) => readClaudeEnv(cwd, { dir, managed: [], version: null, globalConfig: join(home, '.claude.json') });
  return { home, dir, read, done: () => rmSync(home, { recursive: true, force: true }) };
}

test('a session in the home folder reads the user .claude folder once, as the user', () => {
  const s = sandbox();
  try {
    const env = s.read(s.home);
    assert.deepEqual(
      env.settings.map((x) => x.scope),
      ['user', 'local'],
    );
    assert.equal(env.hooks.length, 1, 'the one hook, not twice');
    assert.deepEqual(
      env.skills.map((x) => x.scope),
      ['user'],
    );
    assert.equal(env.instructions.filter((i) => i.kind === 'project-dir').length, 0);
    if (process.platform !== 'linux') assert.equal(s.read(s.home.toUpperCase()).hooks.length, 1, 'whatever the case of the spelling');
  } finally {
    s.done();
  }
});

test('a session in a project reads the project settings beside the user ones', () => {
  const s = sandbox();
  try {
    const project = join(s.home, 'app');
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo app' }] }] } }));
    const env = s.read(project);
    assert.deepEqual(
      env.settings.map((x) => x.scope),
      ['user', 'project', 'local'],
    );
    assert.deepEqual(
      env.hooks.map((h) => h.scope),
      ['user', 'project'],
    );
    assert.equal(env.instructions.filter((i) => i.kind === 'project-dir').length, 1);
  } finally {
    s.done();
  }
});

test('the plugins Claude Code lists: what loads is the folder a plugin is read from, whatever was recorded', () => {
  const answering = (stdout: string, status = 0): ClaudeRunner => ({ version: () => null, run: () => ({ status, stdout, stderr: '' }) });
  // As Claude Code 2.1.300 printed it after an install of 1.1.0 over 1.0.0 (2026-10-15), paths renamed.
  const listed = JSON.stringify([
    {
      id: 'mode-code@mode-code-local',
      version: '1.0.0',
      scope: 'user',
      enabled: true,
      installPath: 'C:\\Users\\ada\\.claude\\plugins\\cache\\mode-code-local\\mode-code\\1.0.0',
      readFromFolder: 'C:\\Users\\ada\\.mode-code\\marketplace\\plugins\\mode-code',
      folderVersion: '1.1.0',
    },
    { id: 'other@market', version: '2.0.0', scope: 'project', enabled: false, installPath: 'C:\\Users\\ada\\.claude\\plugins\\cache\\market\\other\\2.0.0' },
    { name: 'bare', folderVersion: '3.0.0' },
  ]);
  // The folder it loads from: the one read in place, else Claude Code's copy.
  assert.deepEqual(pluginsVia(answering(listed)), [
    {
      id: 'mode-code@mode-code-local',
      enabled: true,
      version: '1.0.0',
      loads: '1.1.0',
      scope: 'user',
      path: 'C:\\Users\\ada\\.mode-code\\marketplace\\plugins\\mode-code',
    },
    {
      id: 'other@market',
      enabled: false,
      version: '2.0.0',
      loads: '2.0.0',
      scope: 'project',
      path: 'C:\\Users\\ada\\.claude\\plugins\\cache\\market\\other\\2.0.0',
    },
    { id: 'bare', enabled: null, version: null, loads: null, scope: null, path: null },
  ]);
  assert.equal(pluginsVia(answering(listed, 1)), null, 'a list that failed');
  assert.equal(pluginsVia(answering('not json')), null);
  assert.equal(pluginsVia(answering('{"plugins":[]}')), null, 'not a list');
});

test('instruction files count their lines as an editor does: the final newline starts no line', () => {
  const s = sandbox();
  try {
    const lines = (text: string) => {
      writeFileSync(join(s.home, 'CLAUDE.md'), text);
      return s.read(s.home).instructions.find((i) => i.kind === 'project')?.lines;
    };
    assert.equal(lines('# user\n'), 1);
    assert.equal(lines('a\nb'), 2);
    assert.equal(lines('a\nb\n'), 2);
    assert.equal(lines('a\n\n'), 2, 'an empty last line is a line');
    assert.equal(lines(''), 0);
  } finally {
    s.done();
  }
});

test("a plugin's own hooks: hooks/hooks.json, files its manifest names, and hooks written in the manifest itself", () => {
  const s = sandbox();
  try {
    const p = join(s.home, 'plug');
    mkdirSync(join(p, 'hooks'), { recursive: true });
    mkdirSync(join(p, '.claude-plugin'), { recursive: true });
    const group = (command: string) => [{ hooks: [{ type: 'command', command }] }];
    writeFileSync(join(p, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: group('a') } }));
    writeFileSync(join(p, 'b.json'), JSON.stringify({ hooks: { PreToolUse: group('b') } }));
    writeFileSync(join(p, 'broken.json'), '{ not json');
    const manifest = (hooks: unknown) => writeFileSync(join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug', hooks }));
    const read = () => pluginHooks(p, '.mode-code').map((h) => `${h.event}:${h.command}`);
    manifest('./b.json');
    assert.deepEqual(read(), ['Stop:a', 'PreToolUse:b']);
    manifest(['./b.json', 'broken.json', 'missing.json', './hooks/hooks.json']);
    assert.deepEqual(read(), ['Stop:a', 'PreToolUse:b'], 'each file once; one that cannot be read adds nothing');
    manifest({ SessionStart: group('c') });
    assert.deepEqual(read(), ['Stop:a', 'SessionStart:c']);
    manifest({ hooks: { SessionStart: group('d') } });
    assert.deepEqual(read(), ['Stop:a', 'SessionStart:d']);
    assert.deepEqual(pluginHooks(join(s.home, 'none'), '.mode-code'), []);
  } finally {
    s.done();
  }
});

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
import { pluginsVia, readClaudeEnv, type ClaudeRunner } from '../../src/node/claude-env.js';

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
    { id: 'other@market', version: '2.0.0', scope: 'project', enabled: false },
    { name: 'bare', folderVersion: '3.0.0' },
  ]);
  assert.deepEqual(pluginsVia(answering(listed)), [
    { id: 'mode-code@mode-code-local', enabled: true, version: '1.0.0', loads: '1.1.0', scope: 'user' },
    { id: 'other@market', enabled: false, version: '2.0.0', loads: '2.0.0', scope: 'project' },
    { id: 'bare', enabled: null, version: null, loads: null, scope: null },
  ]);
  assert.equal(pluginsVia(answering(listed, 1)), null, 'a list that failed');
  assert.equal(pluginsVia(answering('not json')), null);
  assert.equal(pluginsVia(answering('{"plugins":[]}')), null, 'not a list');
});

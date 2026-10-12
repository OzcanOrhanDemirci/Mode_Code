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
import { readClaudeEnv } from '../../src/node/claude-env.js';

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

// SPDX-License-Identifier: Apache-2.0
/**
 * Protected folders behind links, measured on the real disk: a temporary folder, a link to it (a junction
 * on Windows, which needs no special rights), and the belt judging a write that reaches the folder through
 * the place the link leads to. And the memory folders the settings name, each once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDirs, protectedAliases } from '../../src/node/context.js';
import { cloneDefaults } from '../../src/core/config.js';
import { toolPath } from '../../src/node/env.js';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { winCtx, macCtx, linuxCtx, summary } from '../helpers/belt.js';

test('a protected folder that is a link is reported with the place it leads to; plain folders are not', async (t) => {
  // The long, real spelling: on some machines the temporary folder is reached through a short name
  // (C:/Users/RUNNER~1/... on CI), which would be an alias of its own.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'tc-alias-')));
  try {
    const real = join(root, 'dotfiles', 'claude');
    mkdirSync(real, { recursive: true });
    const link = join(root, 'home', '.claude');
    mkdirSync(join(root, 'home'));
    try {
      symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      t.skip(`links cannot be made here: ${(err as Error).message}`);
      return;
    }
    const plain = join(root, 'home', 'plain');
    mkdirSync(plain);
    const aliases = protectedAliases([toolPath(link), toolPath(plain), toolPath(join(root, 'missing'))]);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0]!.spelled, toolPath(link));
    // The temporary folder may itself sit behind a link (macOS: /var is /private/var): compare real paths.
    assert.match(aliases[0]!.real, /dotfiles\/claude$/);

    const home = toolPath(join(root, 'home'));
    const base = process.platform === 'win32' ? winCtx : process.platform === 'darwin' ? macCtx : linuxCtx;
    const ctx = base({ home, cwd: toolPath(root), projectDir: toolPath(root), dataDir: `${home}/.mode-code`, aliases });
    const d = await evaluateToolCall('Write', { file_path: `${aliases[0]!.real}/settings.json`, content: '{}' }, ctx);
    assert.equal(summary(d), 'deny self.claude-settings');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the protected memory folders: each once, however the settings spell it', () => {
  const config = cloneDefaults();
  const home = homedir();
  config.memory.dirs = ['~/notes/memory', `${home}/notes/memory/`, join(home, 'notes', 'memory'), '~/other'];
  const dirs = memoryDirs(config, home);
  assert.equal(dirs.length, 2, dirs.join(', '));
});

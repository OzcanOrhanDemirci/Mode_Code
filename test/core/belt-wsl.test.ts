// SPDX-License-Identifier: Apache-2.0
/**
 * Commands typed on Windows for a WSL distribution (`wsl -d <name> -- …`): judged with the distribution's
 * paths. Its home and absolute paths are its own (shown the way Windows reaches them), the Windows drives it
 * mounts under /mnt are Windows paths, and a relative path is relative to where wsl starts. Found on
 * 2026-10-13: a delete inside the distribution was reported as a delete of the Windows home folder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { analyzeCommand } from '../../src/core/shell/analyze.js';
import { linuxCtx, winCtx } from '../helpers/belt.js';

const judge = async (command: string, ctx = winCtx()) => {
  const d = await evaluateToolCall('Bash', { command }, ctx);
  return { verdict: d.verdict, rules: d.findings.map((f) => f.rule), reasons: d.findings.map((f) => f.reason).join(' ') };
};

test("the distribution, its --cd and the commands it runs are read from wsl's own options", () => {
  const a = analyzeCommand("wsl -d dev --cd /srv -- bash -c 'rm -rf x && ls'", 'bash');
  // wsl itself runs on Windows; what it starts runs in the distribution.
  assert.deepEqual(
    a.invocations.map((i) => [i.program, i.guest]),
    [
      ['wsl', undefined],
      ['bash', { distro: 'dev', cd: '/srv' }],
      ['rm', { distro: 'dev', cd: '/srv' }],
      ['ls', { distro: 'dev', cd: '/srv' }],
    ],
  );
  assert.equal(analyzeCommand('rm -rf x', 'bash').invocations[0]!.guest, undefined);
  assert.deepEqual(analyzeCommand('wsl ls', 'bash').invocations.find((i) => i.program === 'ls')!.guest, { distro: null, cd: null });
});

test("the distribution's home and folders are its own, never the Windows home folder", async () => {
  const home = await judge('wsl -d dev -- rm -rf ~/dev/old');
  assert.equal(home.verdict, 'ask');
  assert.match(home.reasons, /\/\/wsl\.localhost\/dev\/~\/dev\/old/);
  assert.doesNotMatch(home.reasons, /C:\/Users\/ada/);
  const abs = await judge('wsl -d dev -- rm -rf /home/ada/dev/old');
  assert.match(abs.reasons, /\/\/wsl\.localhost\/dev\/home\/ada\/dev\/old/);
  const env = await judge('wsl -- rm -rf $HOME/.cache/x');
  assert.match(env.reasons, /\/\/wsl\.localhost\/<default>\/~\/\.cache\/x/);
  // Its Claude Code settings are the distribution's, not this machine's protected ones.
  const own = await judge('wsl -d dev -- rm -rf ~/.claude');
  assert.deepEqual([own.verdict, own.rules], ['ask', ['fs.delete-outside-project']]);
});

test("deleting the distribution's root, home or system folders is refused", async () => {
  for (const c of [
    'wsl -d dev -- rm -rf /',
    'wsl -d dev -- rm -rf ~',
    'wsl -- rm -rf /home',
    'wsl -- rm -rf /home/ada',
    'wsl -- rm -rf /etc',
    'wsl --cd / -- rm -rf usr',
  ])
    assert.deepEqual((await judge(c)).rules, ['fs.delete-critical'], c);
});

test('the Windows drives it mounts are Windows paths, protected as on Windows; relative paths follow where wsl starts', async () => {
  const claude = await judge('wsl -d dev -- rm -rf /mnt/c/Users/ada/.claude');
  // Claude Code's own folder is self-protection, not just a critical folder: bypass never opens it.
  assert.deepEqual([claude.verdict, claude.rules], ['deny', ['self.claude-settings']]);
  assert.equal((await judge('wsl -- rm -rf build')).verdict, 'allow', 'wsl starts in the Windows folder, inside the project');
  const cd = await judge('wsl --cd ~ -- rm -rf build');
  assert.match(cd.reasons, /\/\/wsl\.localhost\/<default>\/~\/build/);
  assert.equal((await judge('wsl -- cat ~/.bashrc')).verdict, 'allow');
  assert.equal((await judge('wsl -d dev -- rm -rf /mnt/c/dev/app/dist')).verdict, 'allow', 'the project, through the mount');
});

test('on Linux and macOS nothing changes: there is no wsl to reach another machine through', async () => {
  const d = await judge('wsl -- rm -rf ~/dev/old', linuxCtx());
  assert.doesNotMatch(d.reasons, /wsl\.localhost/);
  assert.equal((await judge('rm -rf ~/dev/old')).verdict, 'ask');
});

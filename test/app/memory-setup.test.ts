// SPDX-License-Identifier: Apache-2.0
/**
 * The memory setup driven through its questions (docs/memory.md), with real git and a stand-in GitHub: a
 * folder of bare repositories that git reaches through `url.insteadOf`, and a `gh` answered in process.
 * Every path a person can take: this computer only, a new private repository, a second computer that
 * brings the memory down, a public repository refused, signing in, installing a missing GitHub CLI, a
 * secret held back, a name GitHub would not take, a settings file that is not JSON.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySetup } from '../../src/app/memory-setup.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';

import { git, machine, scripted } from '../helpers/setup.js';

const slash = (p: unknown) => String(p).replace(/\\/g, '/');

test('this computer only: a folder with its history, the setting written with a backup, the folder protected', { skip }, async () => {
  const m = machine();
  try {
    writeFileSync(join(m.claudeDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    const s = scripted([
      [/Where should your memory live/, 0],
      [/Folder for the memory/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    const dir = `${m.home}/claude-memory`;
    assert.equal(r.store?.dir, dir);
    assert.deepEqual([r.store?.place, r.store?.git, r.store?.remote], ['local', true, null]);
    for (const f of ['README.md', '.gitignore', 'handoffs/README.md']) assert.ok(existsSync(join(dir, f)), f);
    assert.equal(git(dir, 'log', '--format=%s'), 'memory: 3 added');
    assert.deepEqual([m.settings().theme, slash(m.settings().autoMemoryDirectory)], ['dark', dir]);
    assert.ok(r.config?.memory.dirs.includes(dir));
    assert.equal(m.ghCalls.length, 0, 'GitHub is not asked about a local memory');
    assert.ok(s.said.some((l) => /set Claude Code's autoMemoryDirectory to .*\(backup: .*settings\.json\.memory\.1791878400000\)/.test(l)));
    assert.equal(s.left(), 0);
  } finally {
    m.done();
  }
});

test('this computer and GitHub: a new private repository, the notes sent there; the per-project memories brought in', { skip }, async () => {
  const m = machine();
  try {
    const proj = join(m.claudeDir, 'projects', 'C--dev-app', 'memory');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 'MEMORY.md'), '- [pnpm](pnpm.md) — uses pnpm\n');
    writeFileSync(join(proj, 'pnpm.md'), 'Uses pnpm.\n');
    const s = scripted([
      [/Where should your memory live/, ''],
      [/Folder for the memory/, `${m.home}/notes/memory`],
      [/Repository name \(in ada/, ''],
      [/Bring in Claude Code's per-project memories \(1 projects, 2 files\)/, ''],
      [/Protect the memory folder/, false],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.deepEqual(r.store, {
      place: 'both',
      dir: `${m.home}/notes/memory`,
      remote: 'https://github.com/ada/claude-memory.git',
      repo: 'ada/claude-memory',
      git: true,
      sync: 'auto',
      handoffs: true,
    });
    assert.deepEqual(m.repos.get('ada/claude-memory'), { private: true });
    assert.deepEqual(m.remoteFiles('ada/claude-memory').sort(), [
      '.gitignore',
      'MEMORY.md',
      'README.md',
      'handoffs/README.md',
      'projects/c-dev-app/MEMORY.md',
      'projects/c-dev-app/pnpm.md',
    ]);
    assert.match(
      readFileSync(join(m.home, 'notes', 'memory', 'MEMORY.md'), 'utf8'),
      /^# Memory\n- \[c-dev-app\]\(projects\/c-dev-app\/MEMORY\.md\) — memories of C--dev-app/,
    );
    assert.ok(m.ghCalls.some((c) => c.join(' ') === 'auth setup-git --hostname github.com'));
    assert.equal(r.config?.memory.dirs.length, 0, 'not protected when the person said no');
    assert.ok(existsSync(join(proj, 'pnpm.md')), 'the per-project memory stays where it was');
    assert.equal(git(join(m.home, 'notes', 'memory'), 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
  } finally {
    m.done();
  }
});

test('a second computer, GitHub only: the memory comes down into the working copy, nothing is overwritten', { skip }, async () => {
  const m = machine();
  try {
    m.addRepo('ada/claude-memory', { private: true, note: '# Memory\n- written on the first computer\n' });
    const s = scripted([
      [/Where should your memory live/, 1],
      [/Repository name/, ''],
      [/exists, is private and already holds notes/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    const dir = `${m.root}/data/memory/claude-memory`;
    assert.deepEqual([r.store?.place, r.store?.dir], ['github', dir]);
    assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\r\n/g, '\n'), '# Memory\n- written on the first computer\n');
    assert.ok(m.remoteFiles('ada/claude-memory').includes('handoffs/README.md'), "terminal-code's files went up with the next commit");
    assert.ok(!m.ghCalls.some((c) => c[1] === 'create'), 'nothing is created when the repository is there');
    // Run again on the same computer: the working copy is kept as it is.
    const again = scripted([
      [/Where should your memory live/, 1],
      [/Repository name/, ''],
      [/exists, is private and already holds notes/, ''],
      [/Go ahead/, true],
    ]);
    const r2 = await memorySetup(again.io, m.env(r.config!));
    assert.equal(r2.ok, true, again.said.join('\n'));
    assert.equal(r2.plan?.adopt, true);
    assert.equal(r2.store?.dir, dir);
  } finally {
    m.done();
  }
});

test('a public repository is refused; a name GitHub would not take is explained; another name is created', { skip }, async () => {
  const m = machine();
  try {
    m.addRepo('ada/claude-memory', { private: false });
    const s = scripted([
      [/Where should your memory live/, 2],
      [/Folder for the memory/, ''],
      [/Repository name/, ''],
      [/Repository name/, 'my memory'],
      [/Repository name/, 'ada/my-memory'],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.ok(s.said.includes('ada/claude-memory is public: a memory must not be. Pick another name, or make it private on GitHub first.'));
    assert.ok(s.said.includes('Use only letters, digits, ".", "-" and "_". For example: my-memory'));
    assert.equal(r.store?.repo, 'ada/my-memory');
    assert.deepEqual(m.repos.get('ada/my-memory'), { private: true });
  } finally {
    m.done();
  }
});

test('not signed in: the setup signs in through gh auth login, in the terminal', { skip }, async () => {
  const m = machine({ signedIn: false });
  try {
    const s = scripted(
      [
        [/Where should your memory live/, ''],
        [/Sign in now\?/, ''],
        [/Folder for the memory/, ''],
        [/Repository name/, ''],
        [/Protect the memory folder/, ''],
        [/Go ahead/, true],
      ],
      (argv) => {
        if (argv.slice(1, 3).join(' ') === 'auth login') m.state.signedIn = true;
      },
    );
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.deepEqual(s.interactive, [['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']]);
    assert.ok(s.said.includes('Signed in to GitHub as ada.'));
  } finally {
    m.done();
  }
});

test('the GitHub CLI missing: winget installs it when the person says so; declined, the memory can stay on this computer', { skip }, async () => {
  const m = machine({ gh: false, winget: true });
  try {
    const s = scripted(
      [
        [/Where should your memory live/, ''],
        [/It can be installed with: winget install --id GitHub\.cli --exact --source winget/, ''],
        [/Folder for the memory/, ''],
        [/Repository name/, ''],
        [/Protect the memory folder/, ''],
        [/Go ahead/, true],
      ],
      (argv) => {
        if (argv[0] === 'winget') m.state.gh = true;
      },
    );
    const env = { ...m.env(), platform: 'win32' as const };
    const r = await memorySetup(s.io, env);
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.equal(s.interactive[0]![0], 'winget');
  } finally {
    m.done();
  }
  const m2 = machine({ gh: false, winget: false });
  try {
    const s = scripted([
      [/Where should your memory live/, ''],
      [/Without the GitHub CLI/, 1],
      [/Folder for the memory/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m2.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.equal(r.store?.place, 'local');
    assert.ok(s.said.some((l) => /Install it from https:\/\/cli\.github\.com/.test(l)));
  } finally {
    m2.done();
  }
});

test('notes brought from the old folder: a file that looks like it holds a secret stays back from GitHub', { skip }, async () => {
  const m = machine();
  try {
    const old = join(m.home, 'old-memory');
    mkdirSync(old);
    writeFileSync(join(old, 'MEMORY.md'), '- [deploy](deploy.md)\n');
    writeFileSync(join(old, 'deploy.md'), `The token is ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}\n`);
    writeFileSync(join(m.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryDirectory: old }));
    const s = scripted([
      [/Where should your memory live/, ''],
      [/Folder for the memory/, `${m.home}/memory`],
      [/Repository name/, ''],
      [/Copy the notes from .*old-memory \(2 files\)/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.deepEqual(
      r.sync?.held.map((h) => h.path),
      ['deploy.md'],
    );
    assert.ok(!m.remoteFiles('ada/claude-memory').includes('deploy.md'));
    assert.ok(m.remoteFiles('ada/claude-memory').includes('MEMORY.md'));
    assert.ok(s.said.some((l) => /Held back, they look like they hold a secret: deploy\.md/.test(l)));
    assert.ok(existsSync(join(old, 'deploy.md')), 'the old folder is left as it was');
  } finally {
    m.done();
  }
});

test("a settings file that is not JSON is the person's: the setup stops there and says what was done", { skip }, async () => {
  const m = machine();
  try {
    writeFileSync(join(m.claudeDir, 'settings.json'), '{ "theme": dark');
    const s = scripted([
      [/Where should your memory live/, 0],
      [/Folder for the memory/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, false);
    assert.ok(s.said.some((l) => /✗ set Claude Code's autoMemoryDirectory .* is not valid JSON/.test(l)));
    assert.ok(s.said.some((l) => /Stopped here: what is ticked above was done/.test(l)));
    assert.equal(readFileSync(join(m.claudeDir, 'settings.json'), 'utf8'), '{ "theme": dark');
  } finally {
    m.done();
  }
});

test('saying no to the list changes nothing', { skip }, async () => {
  const m = machine();
  try {
    const s = scripted([
      [/Where should your memory live/, ''],
      [/Folder for the memory/, ''],
      [/Repository name/, ''],
      [/Protect the memory folder/, ''],
      [/Go ahead/, ''],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, false);
    assert.equal(m.repos.size, 0);
    assert.ok(!existsSync(join(m.home, 'claude-memory')));
    assert.ok(!existsSync(join(m.claudeDir, 'settings.json')));
    assert.equal(s.said.at(-1), 'Nothing was changed.');
  } finally {
    m.done();
  }
});

test(
  'a memory its owner keeps in a repository of their own: only bringing in, nothing added to it, handoff notes kept with terminal-code',
  { skip },
  async () => {
    const m = machine();
    try {
      // The person's repository holds more than the memory: the memory is one folder of it.
      m.addRepo('ada/notes', { private: true });
      const seed = `${m.root}/seed`;
      git(m.root, 'clone', '--quiet', 'https://github.com/ada/notes.git', seed);
      mkdirSync(join(seed, 'hafiza'));
      mkdirSync(join(seed, 'tools'));
      writeFileSync(join(seed, 'hafiza', 'MEMORY.md'), '# Memory\n- first\n');
      writeFileSync(join(seed, 'tools', 'run.js'), 'console.log(1)\n');
      git(seed, 'add', '-A');
      git(seed, 'commit', '--quiet', '-m', 'start');
      git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
      const clone = `${m.home}/claude_memory`;
      git(m.root, 'clone', '--quiet', 'https://github.com/ada/notes.git', clone);
      const dir = `${clone}/hafiza`;
      writeFileSync(join(m.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryDirectory: dir }));
      // Another computer sent a note since; this one has a file of its own not committed yet.
      writeFileSync(join(seed, 'hafiza', 'MEMORY.md'), '# Memory\n- first\n- from the other computer\n');
      git(seed, 'commit', '--quiet', '-am', 'from the other computer');
      git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
      writeFileSync(join(clone, 'tools', 'draft.txt'), 'mine\n');
      const before = git(clone, 'rev-list', '--count', 'HEAD');

      const s = scripted([
        [/Where should your memory live/, 2],
        [/Folder for the memory/, ''],
        [/already has a git history of its own/, ''],
        [/Where should handoff notes go/, ''],
        [/Protect the memory folder/, false],
        [/Go ahead/, true],
      ]);
      const r = await memorySetup(s.io, m.env());
      assert.equal(r.ok, true, s.said.join('\n'));
      assert.deepEqual(r.store, {
        place: 'both',
        dir,
        remote: 'https://github.com/ada/notes.git',
        repo: 'ada/notes',
        git: true,
        sync: 'pull',
        handoffs: false,
      });
      assert.equal(r.sync?.pull, 'ok');
      // Brought in by a fast-forward; nothing of the person's committed, added or sent.
      assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\r\n/g, '\n'), '# Memory\n- first\n- from the other computer\n');
      assert.equal(git(clone, 'rev-list', '--count', 'HEAD'), String(Number(before) + 1));
      assert.equal(git(clone, 'log', '-1', '--format=%s'), 'from the other computer');
      for (const f of ['README.md', '.gitignore', 'handoffs']) assert.ok(!existsSync(join(dir, f)), f);
      assert.equal(readFileSync(join(clone, 'tools', 'draft.txt'), 'utf8'), 'mine\n');
      assert.ok(!m.ghCalls.some((c) => c[1] === 'create'));
      // The plan said so, and Claude Code's setting was already this folder.
      const plan = s.said.join('\n');
      assert.match(plan, /only bring in changes when a session starts \(a fast-forward\); recording and sending stay yours/);
      assert.match(plan, /keep handoff notes with terminal-code, not in the folder/);
      assert.doesNotMatch(plan, /add a README/);
      assert.equal(r.plan?.writeSetting, false);
      assert.equal(s.left(), 0);
    } finally {
      m.done();
    }
  },
);

test('this computer only, a folder inside a larger repository: used as it is, never given a history of its own; git left to the person', { skip }, async () => {
  const m = machine();
  try {
    const work = `${m.home}/work`;
    mkdirSync(join(work, 'notes'), { recursive: true });
    git(work, 'init', '--quiet');
    writeFileSync(join(work, 'notes', 'MEMORY.md'), '# Memory\n');
    git(work, 'add', '-A');
    git(work, 'commit', '--quiet', '-m', 'start');
    const s = scripted([
      [/Where should your memory live/, 0],
      [/Folder for the memory/, `${work}/notes`],
      [/already has a git history of its own/, ''],
      [/Where should handoff notes go/, 0],
      [/Protect the memory folder/, false],
      [/Go ahead/, true],
    ]);
    const r = await memorySetup(s.io, m.env());
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.deepEqual([r.store?.place, r.store?.sync, r.store?.handoffs, r.store?.git, r.plan?.adopt], ['local', 'manual', true, true, true]);
    assert.ok(!existsSync(join(work, 'notes', '.git')), 'no history of its own inside the larger one');
    assert.ok(existsSync(join(work, 'notes', 'handoffs', 'README.md')), 'the notes go into the folder, so their folder is there');
    for (const f of ['README.md', '.gitignore']) assert.ok(!existsSync(join(work, 'notes', f)), f);
    assert.equal(git(work, 'rev-list', '--count', 'HEAD'), '1', 'nothing committed: git is the person’s');
    assert.equal(r.sync, null);
    // Offered here: recording after each turn, or leaving git alone (bringing in needs a remote).
    assert.match(s.said.join('\n'), /leave its git to you/);
  } finally {
    m.done();
  }
});

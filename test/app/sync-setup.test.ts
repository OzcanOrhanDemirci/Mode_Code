// SPDX-License-Identifier: Apache-2.0
/**
 * The sync setup driven through its questions (app/sync-setup.ts, docs/sync.md), with real git and a
 * stand-in GitHub (test/helpers/setup.ts): a new repository named by the person; a second computer joining,
 * shown where its settings differ and taking the others'; a repository holding other files, used through a
 * folder of it and the person's own copy; a folder another service keeps in sync, with a computer there
 * before recognized; and what is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { subfolderProblem, syncSetup, type SyncSetupEnv } from '../../src/app/sync-setup.js';
import { normalizeConfig, type Config } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { git, machine, scripted } from '../helpers/setup.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';

type Machine = ReturnType<typeof machine>;
const NOW = 1_791_878_400_000;

/** A computer of the machine: its own data folder, its settings, its name. */
function computer(m: Machine, data: string, config: object = {}, host = 'ada-pc', random = '1a2b'): SyncSetupEnv {
  const base = m.env();
  return {
    lang: 'en',
    platform: base.platform,
    home: m.home,
    cwd: m.home,
    layout: layout(`${m.root}/${data}`),
    config: normalizeConfig(config).config,
    runner: base.runner,
    has: base.has,
    exists: () => false,
    now: () => NOW,
    hostname: host,
    random: () => random,
  };
}

const settingsOf = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(dir, 'machines', id, 'settings.json'), 'utf8')) as { entries: Record<string, { at: number; value?: unknown }> };

test('a new private repository named by the person: created, brought down, this computer named; what it chose goes to the others', { skip }, async () => {
  const m = machine();
  try {
    const env = computer(m, 'data', { footer: { mode: 'off' }, projects: [{ id: 'app', names: ['app'], path: `${m.home}/app` }] });
    const s = scripted([
      [/Where should the shared copy live/, 0],
      [/Repository name/, 'tc-sync'],
      [/Where should the copy on this computer be/, ''],
      [/Name of this computer/, ''],
      [/Keep handoff notes in the shared place/, ''],
      [/Go ahead/, true],
    ]);
    const r = await syncSetup(s.io, env);
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.deepEqual(m.repos.get('ada/tc-sync'), { private: true });
    const dir = `${m.root}/data/sync`;
    assert.deepEqual(r.config?.sync, {
      place: 'github',
      dir,
      remote: 'https://github.com/ada/tc-sync.git',
      repo: 'ada/tc-sync',
      machine: { id: 'ada-pc-1a2b', name: 'ada-pc' },
      everyMinutes: 30,
      keepMonths: 3,
      handoffs: true,
    });
    const files = m.remoteFiles('ada/tc-sync');
    for (const f of ['README.md', 'machines/ada-pc-1a2b/machine.json', 'machines/ada-pc-1a2b/settings.json']) assert.ok(files.includes(f), f);
    // The first computer's own choices claim their time; the defaults claim nothing.
    const sent = settingsOf(dir, 'ada-pc-1a2b').entries;
    assert.deepEqual([sent['footer.mode']!.at, sent['projects.app']!.at, sent['language']!.at], [NOW, NOW, 0]);
    assert.deepEqual(sent['projects.app']!.value, { names: ['app'] }, 'a folder of this computer is not sent');
    const plan = s.said.join('\n');
    assert.match(plan, /create the private repository ada\/tc-sync on GitHub/);
    assert.match(plan, /this computer's own folder: machines\/ada-pc-1a2b \(ada-pc\)/);
    assert.equal(s.left(), 0);
  } finally {
    m.done();
  }
});

test(
  "a second computer joins: shown where its settings differ, a lowered protection named; takes the others'; its handoff notes come along",
  { skip },
  async () => {
    const m = machine();
    try {
      const first = await syncSetup(
        scripted([
          [/Where should the shared copy live/, 0],
          [/Repository name/, 'tc-sync'],
          [/copy on this computer/, ''],
          [/Name of this computer/, 'Windows'],
          [/Keep handoff notes/, ''],
          [/Go ahead/, true],
        ]).io,
        computer(m, 'data', { footer: { mode: 'off' }, belt: { verdicts: { 'git.clean': 'warn' } } }, 'win', '0001'),
      );
      assert.equal(first.ok, true);
      // The Mac had a handoff note in mode-code's own folder.
      const mac = computer(m, 'mac-data', {}, 'MacBook.local', '0002');
      mkdirSync(join(mac.layout.handoffsDir, 'app'), { recursive: true });
      writeFileSync(join(mac.layout.handoffsDir, 'app', '20261012-090000-abcdef12.md'), '---\ntype: handoff\n---\n\n## Next\n\nGo on.\n');
      const s = scripted([
        [/Where should the shared copy live/, 0],
        [/Repository name/, 'tc-sync'],
        [/copy on this computer/, ''],
        [/Name of this computer/, 'Mac'],
        [/Keep handoff notes/, ''],
        [/Go ahead/, true],
        // A difference lowers a protection here, so Enter would keep this computer's: the person picks theirs.
        [/Which should be kept/, 0],
      ]);
      const r = await syncSetup(s.io, mac);
      assert.equal(r.ok, true, s.said.join('\n'));
      const said = s.said.join('\n');
      assert.match(said, /is used for sync already: this computer joins it/);
      assert.match(said, /differ from the other computers' in 2 place\(s\)/);
      assert.match(said, /belt\.verdicts: \{\} → \{"git\.clean":"warn"\} \(Windows\) · lowers a protection here/);
      // A setting the catalog names is said in words: its name and its values.
      assert.match(said, /Who writes the lines: Mode_Code draws them → Off \(Windows\)/);
      assert.deepEqual(
        s.steps.map((x) => x.replace(/ ·.*/, '')),
        [
          '1/6 Where the shared copy lives',
          '2/6 The tools it needs',
          '3/6 The shared copy',
          '4/6 This computer',
          '5/6 Handoff notes',
          '6/6 The list of changes',
        ],
      );
      assert.match(said, /bring the 1 kept in Mode_Code's folder there/);
      assert.deepEqual([r.config?.footer.mode, r.config?.belt.verdicts?.['git.clean']], ['off', 'warn']);
      assert.equal(r.config?.sync?.machine.id, 'mac-0002');
      const dir = `${m.root}/mac-data/sync`;
      assert.ok(existsSync(join(dir, 'handoffs', 'app', '20261012-090000-abcdef12.md')));
      assert.ok(!existsSync(mac.layout.handoffsDir), "nothing is left behind in Mode_Code's folder");
      assert.ok(m.remoteFiles('ada/tc-sync').includes('handoffs/app/20261012-090000-abcdef12.md'));
      // Taken from the others, so this computer claims nothing: its values are theirs.
      assert.equal(settingsOf(dir, 'mac-0002').entries['footer.mode']!.at, 0);
    } finally {
      m.done();
    }
  },
);

test('a computer that keeps its own: its differing settings go to the others with this time', { skip }, async () => {
  const m = machine();
  try {
    await syncSetup(
      scripted([
        [/Where should the shared copy live/, 0],
        [/Repository name/, 'tc-sync'],
        [/copy on this computer/, ''],
        [/Name of this computer/, 'Windows'],
        [/Keep handoff notes/, false],
        [/Go ahead/, true],
      ]).io,
      computer(m, 'data', { view: 'simple' }, 'win', '0001'),
    );
    const s = scripted([
      [/Where should the shared copy live/, 0],
      [/Repository name/, 'tc-sync'],
      [/copy on this computer/, ''],
      [/Name of this computer/, ''],
      [/Keep handoff notes/, false],
      [/Go ahead/, true],
      [/Which should be kept/, 1],
    ]);
    const r = await syncSetup(s.io, computer(m, 'mac-data', { view: 'detailed' }, 'mac', '0002'));
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.equal(r.config?.view, 'detailed');
    const sent = settingsOf(`${m.root}/mac-data/sync`, 'mac-0002').entries;
    assert.deepEqual([sent.view!.at, sent['footer.mode']!.at], [NOW, 0]);
    assert.equal(r.config?.sync?.handoffs, false);
  } finally {
    m.done();
  }
});

test(
  'a repository holding other files: a folder of it, named by the person, through the copy the person already has; nothing of theirs touched',
  { skip },
  async () => {
    const m = machine();
    try {
      m.addRepo('ada/notes', { private: true, note: '# Memory\n' });
      const copy = `${m.home}/notes`;
      git(m.root, 'clone', '--quiet', 'https://github.com/ada/notes.git', copy);
      writeFileSync(join(copy, 'draft.md'), 'mine, not committed\n');
      const s = scripted([
        [/Where should the shared copy live/, 0],
        [/Repository name/, 'notes'],
        [/Folder inside the repository/, '../up'],
        [/Folder inside the repository/, ''],
        [/copy on this computer/, `${m.home}/elsewhere-but-full`],
        [/copy on this computer/, copy],
        [/Name of this computer/, ''],
        [/Keep handoff notes/, false],
        [/Go ahead/, true],
      ]);
      mkdirSync(`${m.home}/elsewhere-but-full`);
      writeFileSync(`${m.home}/elsewhere-but-full/x.txt`, 'x');
      const r = await syncSetup(s.io, computer(m, 'data'));
      assert.equal(r.ok, true, s.said.join('\n'));
      const said = s.said.join('\n');
      assert.match(said, /holds other files: Mode_Code keeps its own in a folder of it/);
      assert.match(said, /"\.\.\/up" cannot be a folder there/);
      assert.match(said, /holds other files and is not a copy of that repository/);
      assert.match(said, /is a copy of that repository already: it is used as it is/);
      assert.equal(r.config?.sync?.dir, `${copy}/mode-code`);
      assert.equal(git(copy, 'status', '--porcelain'), '?? draft.md');
      assert.ok(m.remoteFiles('ada/notes').every((f) => f === 'MEMORY.md' || f.startsWith('mode-code/')));
      assert.ok(!m.ghCalls.some((c) => c[1] === 'create'));
    } finally {
      m.done();
    }
  },
);

test('a folder another service keeps in sync: no git asked about; a computer set up there before is recognized', async () => {
  const m = machine();
  try {
    const shared = `${m.home}/iCloud/mode-code`;
    mkdirSync(join(shared, 'machines', 'old-pc-0000'), { recursive: true });
    writeFileSync(
      join(shared, 'machines', 'old-pc-0000', 'machine.json'),
      JSON.stringify({ id: 'old-pc-0000', name: 'Old PC', platform: 'win32', app: '0.4.0', since: 1 }),
    );
    const env = computer(m, 'data');
    const s = scripted([
      [/Where should the shared copy live/, 1],
      [/Folder the service keeps in sync/, `${env.layout.root}/inside`],
      [/Folder the service keeps in sync/, shared],
      [/Is one of them this computer/, 0],
      [/Name of this computer/, ''],
      [/Keep handoff notes/, ''],
      [/Go ahead/, true],
    ]);
    const r = await syncSetup(s.io, env);
    assert.equal(r.ok, true, s.said.join('\n'));
    assert.match(s.said.join('\n'), /inside Mode_Code's own data folder/);
    assert.match(s.said.join('\n'), /Computers in it already: Old PC/);
    assert.deepEqual(r.config?.sync?.machine, { id: 'old-pc-0000', name: 'Old PC' });
    assert.deepEqual([r.config?.sync?.place, r.config?.sync?.remote, r.record?.result], ['folder', null, null]);
    assert.ok(existsSync(join(shared, 'machines', 'old-pc-0000', 'settings.json')));
    assert.equal(m.ghCalls.length, 0);
    assert.ok(readdirSync(shared).includes('README.md') === false, 'a place with computers in it gets no README');
  } finally {
    m.done();
  }
});

test('refused: a public repository, a folder inside the memory; saying no changes nothing', { skip }, async () => {
  const m = machine();
  try {
    m.addRepo('ada/open', { private: false });
    const memory = `${m.home}/memory`;
    mkdirSync(memory);
    const env = computer(m, 'data', { memory: { store: { place: 'local', dir: memory } } });
    const pub = scripted([
      [/Where should the shared copy live/, 0],
      [/Repository name/, 'open'],
      [/Repository name/, 'my sync'],
      [/Repository name/, 'tc-sync'],
      [/copy on this computer/, ''],
      [/Name of this computer/, ''],
      [/Go ahead/, false],
    ]);
    const no = await syncSetup(pub.io, env);
    assert.equal(no.ok, false);
    assert.match(pub.said.join('\n'), /ada\/open is public: the shared copy must not be/);
    assert.match(pub.said.join('\n'), /Use only letters, digits/);
    assert.match(pub.said.join('\n'), /Handoff notes stay in your memory/);
    assert.ok(!m.repos.has('ada/tc-sync'), 'nothing created after a no');
    assert.ok(!existsSync(`${m.root}/data/sync`));
    const folder = scripted([
      [/Where should the shared copy live/, 1],
      [/Folder the service keeps in sync/, `${memory}/sync`],
      [/Folder the service keeps in sync/, `${m.home}/elsewhere`],
      [/Name of this computer/, ''],
      [/Go ahead/, false],
    ]);
    await syncSetup(folder.io, env);
    assert.match(folder.said.join('\n'), /inside your memory folder: Claude would read it as memory/);
    assert.ok(!existsSync(`${m.home}/elsewhere`));
  } finally {
    m.done();
  }
});

test('a folder inside a repository: plain names only', () => {
  for (const ok of ['mode-code', 'a/b', 'sync 2', 'x.y']) assert.equal(subfolderProblem(ok), false, ok);
  for (const bad of ['', '/', '..', 'a/../b', '.git', 'a/.git', '/abs', 'C:/x', 'a:b', 'x'.repeat(81)]) assert.equal(subfolderProblem(bad), true, bad);
});

/** A config written by the setup reads back as the same settings. */
test('what the setup saves is a valid setting', () => {
  const c: Config = normalizeConfig({
    sync: { place: 'github', dir: '/s', remote: 'https://github.com/ada/x.git', repo: 'ada/x', machine: { id: 'a-0000', name: 'a' } },
  }).config;
  assert.equal(c.sync?.place, 'github');
});

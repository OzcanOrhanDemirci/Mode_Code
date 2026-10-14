// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store's pure parts (docs/memory.md): its settings, repository names, GitHub remotes, the
 * project key handoffs are kept under, git's change list, commit messages, imported folders' names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults, GITHUB_REPO, normalizeConfig, parseConfig } from '../../src/core/config.js';
import {
  changeCounts,
  managedByUs,
  commitMessage,
  indexChange,
  mergePulled,
  PULLED_LINES,
  pulledContext,
  githubRemote,
  githubRepoOf,
  HANDOFF_README,
  importedIndexLine,
  importedName,
  isDeletion,
  parsePorcelainZ,
  projectKey,
  repoNameProblems,
  STORE_GITIGNORE,
  storePaths,
  storeReadme,
  suggestRepoName,
} from '../../src/core/memory.js';
import { detectKeyword } from '../../src/core/keywords.js';
import { applyKeyword, newModState } from '../../src/core/session.js';

const store = (over: Record<string, unknown> = {}) =>
  normalizeConfig({
    memory: {
      store: { place: 'both', dir: '/home/ada/claude-memory', remote: 'https://github.com/ada/claude-memory.git', repo: 'ada/claude-memory', ...over },
    },
  });

test('the store setting: a place, a folder, and a remote where the place needs one', () => {
  assert.deepEqual(cloneDefaults().memory, {
    dirs: [],
    store: null,
    handoff: { enabled: true, onCompact: true, onEnd: true, keep: 20, maxAgeDays: 14 },
    morning: { enabled: true, afterHours: 6 },
  });
  const both = store();
  assert.deepEqual(both.problems, []);
  assert.deepEqual(both.config.memory.store, {
    place: 'both',
    dir: '/home/ada/claude-memory',
    remote: 'https://github.com/ada/claude-memory.git',
    repo: 'ada/claude-memory',
    git: true,
    sync: 'auto',
    handoffs: true,
  });
  // GitHub needs a remote: without one the store is not taken, and it is said.
  const noRemote = store({ place: 'github', remote: null });
  assert.equal(noRemote.config.memory.store, null);
  assert.deepEqual(
    noRemote.problems.map((p) => [p.path, p.kind]),
    [['memory.store.remote', 'range']],
  );
  // Local keeps no remote even when the file has one; git is what the file says.
  assert.deepEqual(store({ place: 'local', git: true }).config.memory.store?.remote, null);
  assert.equal(store({ place: 'local', git: true }).config.memory.store?.git, true);
  assert.equal(store({ place: 'local' }).config.memory.store?.git, false);
  assert.equal(store({ place: 'github' }).config.memory.store?.git, true, 'a remote always has a history');
  // Wrong kinds: reported, and the store is dropped where it cannot be one.
  for (const [over, path] of [
    [{ place: 'cloud' }, 'memory.store.place'],
    [{ dir: '' }, 'memory.store.dir'],
    [{ dir: 3 }, 'memory.store.dir'],
  ] as const) {
    const r = store(over);
    assert.equal(r.config.memory.store, null, path);
    assert.deepEqual(
      r.problems.map((p) => p.path),
      [path],
    );
  }
  const wrongRemote = store({ remote: 7, extra: 1 });
  assert.deepEqual(wrongRemote.problems.map((p) => p.path).sort(), ['memory.store.extra', 'memory.store.remote', 'memory.store.remote']);
  assert.equal(wrongRemote.config.memory.store, null, 'a remote of the wrong kind leaves github and both without one');
  const loose = store({ place: 'local', repo: 'not a repo', sync: 'sometimes', git: 'yes', remote: 7 });
  assert.deepEqual(loose.problems.map((p) => p.path).sort(), ['memory.store.git', 'memory.store.remote', 'memory.store.repo', 'memory.store.sync']);
  assert.deepEqual(loose.config.memory.store, {
    place: 'local',
    dir: '/home/ada/claude-memory',
    remote: null,
    repo: null,
    git: false,
    sync: 'auto',
    handoffs: true,
  });
  const manual = store({ sync: 'manual' });
  assert.equal(manual.config.memory.store?.sync, 'manual');
  // A memory its owner commits: only bringing in; handoff notes kept elsewhere.
  const owned = store({ sync: 'pull', handoffs: false });
  assert.deepEqual([owned.config.memory.store?.sync, owned.config.memory.store?.handoffs, owned.problems], ['pull', false, []]);
  const odd = store({ handoffs: 'no' });
  assert.deepEqual([odd.config.memory.store?.handoffs, odd.problems.map((p) => p.path)], [true, ['memory.store.handoffs']]);
  assert.equal(store({ dir: '  /m  ', remote: ' git@github.com:ada/m.git ' }).config.memory.store?.dir, '/m');
  assert.equal(normalizeConfig({ memory: { store: 'x' } }).config.memory.store, null);
  assert.equal(normalizeConfig({ memory: { store: null } }).problems.length, 0);
});

test('handoff and morning settings: whole numbers in range, switches, unknown keys reported', () => {
  const r = normalizeConfig({
    memory: {
      handoff: { enabled: false, onCompact: false, onEnd: 'no', keep: 0, maxAgeDays: 30.4, x: 1 },
      morning: { enabled: false, afterHours: 100, y: 2 },
      z: 3,
    },
  });
  assert.deepEqual(r.config.memory.handoff, { enabled: false, onCompact: false, onEnd: true, keep: 20, maxAgeDays: 30 });
  assert.deepEqual(r.config.memory.morning, { enabled: false, afterHours: 6 });
  assert.deepEqual(r.problems.map((p) => p.path).sort(), [
    'memory.handoff.keep',
    'memory.handoff.onEnd',
    'memory.handoff.x',
    'memory.morning.afterHours',
    'memory.morning.y',
    'memory.z',
  ]);
  assert.deepEqual(
    normalizeConfig({ memory: { handoff: 1, morning: 'x' } }).problems.map((p) => p.path),
    ['memory.handoff', 'memory.morning'],
  );
  for (const [keep, ok] of [
    [1, true],
    [500, true],
    [501, false],
  ] as const)
    assert.equal(normalizeConfig({ memory: { handoff: { keep } } }).problems.length === 0, ok, String(keep));
  assert.equal(parseConfig(JSON.stringify({ memory: { morning: { afterHours: 1 } } })).config.memory.morning.afterHours, 1);
  assert.equal(parseConfig(JSON.stringify({ memory: { morning: { afterHours: 72 } } })).config.memory.morning.afterHours, 72);
  assert.equal(parseConfig(JSON.stringify({ memory: { handoff: { maxAgeDays: 365 } } })).config.memory.handoff.maxAgeDays, 365);
  assert.equal(parseConfig(JSON.stringify({ memory: { handoff: { maxAgeDays: 0 } } })).config.memory.handoff.maxAgeDays, 14);
});

test("repository names: GitHub's rules, and what a typed name becomes", () => {
  assert.deepEqual(repoNameProblems('claude-memory'), []);
  assert.deepEqual(repoNameProblems('a.b_c-1'), []);
  assert.deepEqual(repoNameProblems(''), ['empty']);
  assert.deepEqual(repoNameProblems('my memory'), ['chars']);
  assert.deepEqual(repoNameProblems('ö'), ['chars']);
  assert.deepEqual(repoNameProblems('.'), ['dots']);
  assert.deepEqual(repoNameProblems('..'), ['dots']);
  assert.deepEqual(repoNameProblems('notes.git'), ['gitSuffix']);
  assert.deepEqual(repoNameProblems('x'.repeat(100)), []);
  assert.deepEqual(repoNameProblems('x'.repeat(101)), ['long']);
  assert.equal(suggestRepoName('  My Claude memory!  '), 'My-Claude-memory');
  assert.equal(suggestRepoName('notes.git'), 'notes');
  assert.equal(suggestRepoName('---'), 'claude-memory');
  assert.equal(suggestRepoName('a  b'), 'a-b');
  assert.equal(suggestRepoName('x'.repeat(120)).length, 100);
  assert.ok(GITHUB_REPO.test('ada/claude-memory'));
  assert.ok(!GITHUB_REPO.test('-ada/x'));
  assert.ok(!GITHUB_REPO.test(`${'a'.repeat(40)}/x`));
});

test('GitHub remotes in every form git writes them, and only GitHub', () => {
  for (const r of [
    'https://github.com/ada/claude-memory.git',
    'https://github.com/ada/claude-memory',
    'https://github.com/ada/claude-memory/',
    'https://ada@github.com/ada/claude-memory.git',
    'git@github.com:ada/claude-memory.git',
    'ssh://git@github.com/ada/claude-memory.git',
    'ssh://git@github.com:22/ada/claude-memory',
    '  https://github.com/ada/claude-memory.git\n',
  ])
    assert.equal(githubRepoOf(r), 'ada/claude-memory', r);
  assert.equal(githubRepoOf('https://gitlab.com/ada/memory.git'), null);
  assert.equal(githubRepoOf('https://github.com/ada'), null);
  assert.equal(githubRepoOf('https://github.com.evil.example/ada/x.git'), null);
  assert.equal(githubRepoOf('https://github.com/ada/my.notes.git'), 'ada/my.notes');
  assert.equal(githubRemote('ada/claude-memory'), 'https://github.com/ada/claude-memory.git');
});

test('the project key is the same on every computer: settings id, else GitHub repository, else folder name', () => {
  assert.equal(projectKey({ id: 'terminal', remote: 'https://github.com/ada/tc.git', folder: 'C:/dev/terminal_code' }), 'terminal');
  assert.equal(projectKey({ remote: 'git@github.com:Ada/Mode-Code.git', folder: '/home/ada/dev/terminal_code' }), 'ada-mode-code');
  assert.equal(projectKey({ remote: 'https://gitlab.com/team/app.git', folder: '/x/y' }), 'team-app');
  assert.equal(projectKey({ remote: null, folder: 'C:\\dev\\My Project\\' }), 'my-project');
  assert.equal(projectKey({ folder: '/' }), 'project');
  assert.equal(projectKey({ folder: '/home/ada/..' }), 'project');
  assert.equal(projectKey({ folder: '/srv/ünïcode app' }), 'n-code-app');
  assert.equal(projectKey({ id: 'x'.repeat(80), folder: '/a' }).length, 60);
});

test("git's change list with renames and odd names, the counts, and the commit message in both languages", () => {
  const out = ['?? new note.md', ' M MEMORY.md', 'R  b.md', 'a.md', ' D old.md', 'A  added.md', ''].join('\0');
  const changes = parsePorcelainZ(out);
  assert.deepEqual(
    changes.map((c) => [c.status, c.path]),
    [
      ['??', 'new note.md'],
      [' M', 'MEMORY.md'],
      ['R ', 'b.md'],
      [' D', 'old.md'],
      ['A ', 'added.md'],
    ],
  );
  assert.deepEqual(changes.map(isDeletion), [false, false, false, true, false]);
  assert.deepEqual(changeCounts(changes), { added: 2, changed: 2, removed: 1 });
  assert.deepEqual(parsePorcelainZ(''), []);
  assert.equal(commitMessage({ added: 1, changed: 2, removed: 0 }, 'abcdef123456', 'en'), 'memory: 1 added, 2 changed (session abcdef12)');
  assert.equal(commitMessage({ added: 0, changed: 0, removed: 3 }, null, 'tr'), 'hafıza: 3 silindi');
  assert.equal(commitMessage({ added: 0, changed: 0, removed: 0 }, null, 'en'), 'memory: 0 changed');
});

test("the store's layout and texts; memories brought in get short, distinct names", () => {
  assert.deepEqual(storePaths('/m'), {
    index: '/m/MEMORY.md',
    readme: '/m/README.md',
    gitignore: '/m/.gitignore',
    handoffs: '/m/handoffs',
    projects: '/m/projects',
  });
  assert.match(storeReadme('local'), /It is managed with Mode_Code\. `handoffs\/`/);
  assert.match(storeReadme('both'), /kept in sync with a private GitHub repository/);
  assert.match(HANDOFF_README, /do not add them to MEMORY\.md/);
  assert.ok(!STORE_GITIGNORE.split('\n').some((l) => /\.md|^\*$/.test(l)), 'notes are never ignored');
  assert.equal(importedName('C--Users-ada-dev-app', new Set()), 'c-users-ada-dev-app');
  assert.equal(importedName('C--Users-ada-dev-app', new Set(['c-users-ada-dev-app'])), 'c-users-ada-dev-app-2');
  assert.equal(importedName('C--Users-ada-dev-app', new Set(['c-users-ada-dev-app', 'c-users-ada-dev-app-2'])), 'c-users-ada-dev-app-3');
  assert.equal(importedName('---', new Set()), 'project');
  assert.equal(importedName(`-home-ada-${'deep-'.repeat(20)}app`, new Set()).length <= 60, true);
  assert.equal(
    importedIndexLine('app', 'C:/dev/app'),
    "- [app](projects/app/MEMORY.md) — memories of C:/dev/app, brought in from Claude Code's per-project memory",
  );
});

test('"handoff" / "devir" at the end of a message, with or without a project; inside a sentence it is a word', () => {
  const projects = [{ id: 'terminal', names: ['terminal'] }];
  assert.equal(detectKeyword('devir')?.kind, 'handoff');
  assert.equal(detectKeyword('handoff')?.kind, 'handoff');
  assert.equal(detectKeyword('Hand off')?.kind, 'handoff');
  assert.equal(detectKeyword('Bugünlük bu kadar. devir notu')?.kind, 'handoff');
  const named = detectKeyword('terminal devir', projects);
  assert.deepEqual([named?.kind, named?.project, named?.standalone], ['handoff', 'terminal', true]);
  assert.equal(detectKeyword('bu bir devir değil'), null);
  assert.equal(detectKeyword('Şirket devir oldu ve biz de devam ettik ama bu işe devir', projects), null, 'several words before it are a sentence');
  const s = applyKeyword({ ...newModState('s', 'v', 0), project: 'old' }, named!, null);
  assert.equal(s.project, 'terminal');
  assert.equal(applyKeyword(newModState('s', 'v', 0), detectKeyword('devir')!, null).project, null);
});

test("git's shortest entry, a one-letter name, is read", () => {
  assert.deepEqual(parsePorcelainZ('?? a\0'), [{ status: '??', path: 'a' }]);
  assert.deepEqual(parsePorcelainZ('?? \0'), []);
});

test("what a pull brought in: the index's changed lines read from git's diff, joined across syncs, told to Claude", () => {
  const diff = [
    'diff --git a/MEMORY.md b/MEMORY.md',
    'index 1..2 100644',
    '--- a/MEMORY.md',
    '+++ b/MEMORY.md',
    '@@ -2 +2,2 @@ # Memory',
    '-- Old line.',
    '+- New line.\r',
    '+',
    '+++ starts with pluses',
    '\\ No newline at end of file',
    '@@ -9,0 +11 @@',
    '+- Another.',
  ].join('\n');
  assert.deepEqual(indexChange(diff), { removed: ['- Old line.'], added: ['- New line.', '++ starts with pluses', '- Another.'] });
  assert.deepEqual(indexChange(''), { removed: [], added: [] });
  assert.deepEqual(indexChange('--- a/MEMORY.md\n+++ b/MEMORY.md'), { removed: [], added: [] }, 'the header is not a change');

  const one = { files: ['MEMORY.md', 'a.md'], index: { removed: [], added: ['- One.'] } };
  assert.equal(mergePulled(null, one), one);
  assert.deepEqual(mergePulled(one, { files: ['a.md', 'b.md'], index: null }), { files: ['MEMORY.md', 'a.md', 'b.md'], index: one.index });
  assert.deepEqual(mergePulled({ files: ['b.md'], index: null }, one), { files: ['b.md', 'MEMORY.md', 'a.md'], index: one.index });
  assert.deepEqual(mergePulled(one, { files: ['MEMORY.md'], index: { removed: [], added: ['- Two.'] } }), { files: ['MEMORY.md', 'a.md'], index: null });

  assert.equal(pulledContext({ files: [], index: null }, '/m'), null);
  const told = pulledContext({ files: ['MEMORY.md'], index: { removed: ['- Old.'], added: ['- The codename is PELICAN.'] } }, '/m')!;
  assert.equal(
    told,
    '[Mode_Code] The memory was brought up to date with changes made elsewhere: MEMORY.md. The index (MEMORY.md) in your context may have been loaded before that; these lines changed in it (- removed, + added):\n- - Old.\n+ - The codename is PELICAN.\n',
  );
  const other = pulledContext({ files: ['a.md'], index: null }, '/m')!;
  assert.equal(
    other,
    '[Mode_Code] The memory was brought up to date with changes made elsewhere: a.md. A file read earlier in this session may have changed: read it again when you need it.',
  );
  // The index changed but its lines are unknown, blank only, or too many: Claude is asked to read it again.
  const reread = /read \/m\/MEMORY\.md again before relying on it\./;
  assert.match(pulledContext({ files: ['MEMORY.md'], index: null }, '/m')!, reread);
  assert.match(pulledContext({ files: ['MEMORY.md'], index: { removed: [], added: [] } }, '/m')!, reread);
  const many = (n: number) => pulledContext({ files: ['MEMORY.md'], index: { removed: [], added: Array.from({ length: n }, (_, i) => `- ${i}`) } }, '/m')!;
  assert.doesNotMatch(many(PULLED_LINES), reread);
  assert.ok(many(PULLED_LINES).includes(`+ - ${PULLED_LINES - 1}`));
  assert.match(many(PULLED_LINES + 1), reread);
  // Both: the lines, then the other files.
  assert.match(pulledContext({ files: ['MEMORY.md', 'a.md'], index: { removed: [], added: ['- x'] } }, '/m')!, /\+ - x\n A file read earlier/);
  // Long lists and long lines are cut; a secret in a line is masked.
  const files = Array.from({ length: 10 }, (_, i) => `n${i}.md`);
  assert.match(pulledContext({ files, index: null }, '/m')!, /: n0\.md, n1\.md, n2\.md, n3\.md, n4\.md, n5\.md, n6\.md, n7\.md and 2 more\./);
  assert.match(pulledContext({ files: Array.from({ length: 8 }, (_, i) => `n${i}.md`), index: null }, '/m')!, /n7\.md\. A file/);
  const long = pulledContext({ files: ['MEMORY.md'], index: { removed: [], added: ['x'.repeat(400)] } }, '/m')!;
  assert.ok(!long.includes('x'.repeat(300)) && long.includes('x'.repeat(290)));
  const key = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  assert.ok(!pulledContext({ files: ['MEMORY.md'], index: { removed: [], added: [`- token ${key}`] } }, '/m')!.includes(key));
});

test("a store Mode_Code set up says so in its README; another's does not", () => {
  assert.equal(managedByUs(storeReadme('both')), true);
  assert.equal(managedByUs(storeReadme('local').replace(/\n/g, '\r\n')), true);
  assert.equal(managedByUs(null), false);
  assert.equal(managedByUs('# My notes\n'), false);
  assert.equal(managedByUs('# Claude Code memory\nkept by hand\n'), false, 'the heading alone');
  assert.equal(managedByUs('# Notes\nIt is managed with Mode_Code\n'), false, 'the sentence alone');
  assert.equal(managedByUs(' # Claude Code memory\nIt is managed with Mode_Code\n'), false);
  // Set up under an earlier name of the tool: still ours after a rename.
  const old = '# Claude Code memory\n\nIt is managed with old-name and kept in sync.\n';
  assert.equal(managedByUs(old), false);
  assert.equal(managedByUs(old, ['mode-code', 'old-name']), true);
});

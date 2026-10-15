// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook's part of the memory (docs/memory.md), for sessions the plugin is not loaded in: the
 * first prompt brings the store in and offers the waiting handoff note, a turn's end records and sends what
 * changed, a session's start prunes old notes. Where the plugin runs, the hook leaves all of it to it.
 * Real git, run as Claude Code runs the hook (a process, the event on stdin).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');
const hasGit = spawnSync('git', ['--version']).status === 0;
const gitHome = mkdtempSync(join(tmpdir(), 'tc-hookgit-'));
after(() => rmSync(gitHome, { recursive: true, force: true }));
const gitconfig = join(gitHome, 'gitconfig');
writeFileSync(gitconfig, '[user]\n\tname = Ada\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };

function run(event: string, input: object, home: string): Record<string, any> | null {
  const r = spawnSync(process.execPath, ['--import', 'tsx', hook, event], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...ENV, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en' },
    timeout: 60_000,
  });
  const text = (r.stdout ?? '').trim();
  return text ? JSON.parse(text) : null;
}

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const note = (session: string, at: string, next: string) =>
  `---\ntype: handoff\nproject: ada-app\ncwd: /x\nmachine: mac\nsession: ${session}\nat: ${at}\ntrigger: keyword\n---\n\n## Next\n\n${next}\n`;

/** A data folder, a local store with a git history, and a project folder whose origin names it "ada-app". */
function setup(keep = 20) {
  const tmp = mkdtempSync(join(tmpdir(), 'tc-hookmem-'));
  const home = join(tmp, 'data');
  const store = join(tmp, 'memory');
  const project = join(tmp, 'app');
  for (const d of [home, store, project]) mkdirSync(d);
  git(store, 'init', '-q');
  git(project, 'init', '-q');
  git(project, 'remote', 'add', 'origin', 'https://github.com/ada/app.git');
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ language: 'en', memory: { store: { place: 'local', dir: store.replace(/\\/g, '/'), git: true }, handoff: { keep } } }),
  );
  mkdirSync(join(store, 'handoffs', 'ada-app'), { recursive: true });
  const at = new Date(Date.now() - 3_600_000).toISOString();
  writeFileSync(join(store, 'handoffs', 'ada-app', '20261012-090000-other.md'), note('other-session', at, 'Write the setup steps.'));
  const base = { session_id: 'hook-session', cwd: project, transcript_path: join(tmp, 'none.jsonl'), permission_mode: 'default' };
  return { tmp, home, store, project, base, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

test(
  'without the plugin: the first prompt syncs the store and offers the waiting note; later prompts do not',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const s = setup();
    try {
      writeFileSync(join(s.store, 'MEMORY.md'), '# Memory\n');
      const first = run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'Where were we?' }, s.home);
      assert.match(
        first?.hookSpecificOutput?.additionalContext ?? '',
        /A handoff note for this project is waiting, .* Next: "Write the setup steps\."\. The note: .*handoffs\/ada-app\/20261012-090000-other\.md/,
      );
      // The start's sync recorded what was there.
      assert.match(git(s.store, 'log', '--format=%s'), /^memory: 2 added \(session hook-ses\)$/);
      const record = JSON.parse(readFileSync(join(s.home, 'state', 'memory-sync.hook.json'), 'utf8'));
      assert.deepEqual([record.trigger, record.result.commit], ['start', 'ok']);
      const second = run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'And then?' }, s.home);
      assert.equal(second, null);
      // A turn that changed the memory: recorded at Stop.
      writeFileSync(join(s.store, 'pnpm.md'), 'Uses pnpm.\n');
      run('Stop', { ...s.base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, s.home);
      assert.match(git(s.store, 'log', '-1', '--format=%s'), /^memory: 1 added/);
    } finally {
      s.done();
    }
  },
);

test('with the plugin in the session, the hook leaves the memory to it', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    mkdirSync(join(s.home, 'state', 'sessions'), { recursive: true });
    writeFileSync(join(s.home, 'state', 'sessions', 'hook-session.mod.json'), JSON.stringify({ v: 1, sessionId: 'hook-session', aliveAt: Date.now() }));
    writeFileSync(join(s.store, 'MEMORY.md'), '# Memory\n');
    assert.equal(run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'Where were we?' }, s.home), null);
    run('Stop', { ...s.base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, s.home);
    assert.equal(spawnSync('git', ['log'], { cwd: s.store, env: ENV }).status === 0, false, 'nothing committed by the hook');
    assert.ok(!existsSync(join(s.home, 'state', 'memory-sync.hook.json')));
  } finally {
    s.done();
  }
});

test('a session start prunes each project to the newest notes kept; the rest stay in the history', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup(2);
  try {
    for (const n of ['20261010-090000-a.md', '20261011-090000-b.md', '20261013-090000-d.md', 'README.md'])
      writeFileSync(join(s.store, 'handoffs', 'ada-app', n), note('x', '2026-10-10T09:00:00Z', 'n'));
    run('SessionStart', { ...s.base, hook_event_name: 'SessionStart', source: 'startup' }, s.home);
    assert.deepEqual(readdirSync(join(s.store, 'handoffs', 'ada-app')).sort(), ['20261012-090000-other.md', '20261013-090000-d.md', 'README.md']);
  } finally {
    s.done();
  }
});

test('the handoff keyword without the plugin says plainly that nothing writes the note here', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tc-hookkw-'));
  try {
    writeFileSync(join(tmp, 'config.json'), JSON.stringify({ language: 'en' }));
    const r = run(
      'UserPromptSubmit',
      { session_id: 's', cwd: tmp, transcript_path: join(tmp, 'n.jsonl'), hook_event_name: 'UserPromptSubmit', prompt: 'devir' },
      tmp,
    );
    assert.match(
      r?.hookSpecificOutput?.additionalContext ?? '',
      /"devir", a mode-code keyword for modes, flows, full autonomy or handoff notes\. They need the mode-code plugin/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test(
  'without the plugin: what the first prompt pulls in from another computer is told to Claude, whose index is older',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const s = setup();
    try {
      const remote = join(s.tmp, 'github.git');
      git(s.tmp, 'init', '-q', '--bare', remote);
      rmSync(s.store, { recursive: true, force: true });
      git(s.tmp, 'clone', '-q', remote, s.store);
      writeFileSync(join(s.store, 'MEMORY.md'), '# Memory\n');
      git(s.store, 'add', '-A');
      git(s.store, 'commit', '-q', '-m', 'start');
      git(s.store, 'push', '-q', '-u', 'origin', 'HEAD');
      const other = join(s.tmp, 'other');
      git(s.tmp, 'clone', '-q', remote, other);
      writeFileSync(join(other, 'MEMORY.md'), '# Memory\n- The codename is PELICAN.\n');
      git(other, 'commit', '-q', '-am', 'from the other computer');
      git(other, 'push', '-q');
      const fwd = (p: string) => p.replace(/\\/g, '/');
      writeFileSync(
        join(s.home, 'config.json'),
        JSON.stringify({
          language: 'en',
          memory: { store: { place: 'both', dir: fwd(s.store), remote: fwd(remote), git: true }, handoff: { enabled: false } },
        }),
      );
      const first = run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'What is the codename?' }, s.home);
      const context: string = first?.hookSpecificOutput?.additionalContext ?? '';
      assert.match(
        context,
        /brought up to date with changes made elsewhere: MEMORY\.md\. The index \(MEMORY\.md\) in your context may have been loaded before that/,
      );
      assert.match(context, /\n\+ - The codename is PELICAN\.\n/);
      assert.equal(readFileSync(join(s.store, 'MEMORY.md'), 'utf8'), '# Memory\n- The codename is PELICAN.\n');
      const record = JSON.parse(readFileSync(join(s.home, 'state', 'memory-sync.hook.json'), 'utf8'));
      assert.deepEqual(record.result.pulled, ['MEMORY.md']);
    } finally {
      s.done();
    }
  },
);

test(
  'without the plugin, a memory its owner commits: the first prompt brings in a fast-forward and tells what arrived since the last session, even by the owner’s own pull; a turn commits nothing',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const s = setup();
    try {
      const remote = join(s.tmp, 'github.git');
      git(s.tmp, 'init', '-q', '--bare', remote);
      rmSync(s.store, { recursive: true, force: true });
      git(s.tmp, 'clone', '-q', remote, s.store);
      writeFileSync(join(s.store, 'MEMORY.md'), '# Memory\n');
      git(s.store, 'add', '-A');
      git(s.store, 'commit', '-q', '-m', 'start');
      git(s.store, 'push', '-q', '-u', 'origin', 'HEAD');
      const fwd = (p: string) => p.replace(/\\/g, '/');
      writeFileSync(
        join(s.home, 'config.json'),
        JSON.stringify({
          language: 'en',
          memory: { store: { place: 'both', dir: fwd(s.store), remote: fwd(remote), git: true, sync: 'pull', handoffs: false }, handoff: { enabled: false } },
        }),
      );
      // The last session saw the store at its first commit.
      mkdirSync(join(s.home, 'state'), { recursive: true });
      writeFileSync(join(s.home, 'state', 'memory-seen.hook.json'), JSON.stringify({ head: git(s.store, 'rev-parse', 'HEAD'), at: 1 }));
      const other = join(s.tmp, 'other');
      git(s.tmp, 'clone', '-q', remote, other);
      writeFileSync(join(other, 'MEMORY.md'), '# Memory\n- Pulled by the owner.\n');
      git(other, 'commit', '-q', '-am', 'one');
      git(other, 'push', '-q');
      // The owner's own hook pulls that one…
      git(s.store, 'pull', '-q', '--ff-only');
      // …and another arrives on GitHub for this session's pull.
      writeFileSync(join(other, 'pnpm.md'), 'Uses pnpm.\n');
      git(other, 'add', '-A');
      git(other, 'commit', '-q', '-m', 'two');
      git(other, 'push', '-q');
      const commits = git(s.store, 'rev-list', '--count', 'HEAD');

      const first = run('UserPromptSubmit', { ...s.base, hook_event_name: 'UserPromptSubmit', prompt: 'What do you know?' }, s.home);
      const context: string = first?.hookSpecificOutput?.additionalContext ?? '';
      assert.match(context, /changes made elsewhere: MEMORY\.md, pnpm\.md\./);
      assert.match(context, /\n\+ - Pulled by the owner\.\n/);
      assert.ok(existsSync(join(s.store, 'pnpm.md')), 'brought in by a fast-forward');
      assert.equal(git(s.store, 'rev-list', '--count', 'HEAD'), String(Number(commits) + 1));
      const seen = JSON.parse(readFileSync(join(s.home, 'state', 'memory-seen.hook.json'), 'utf8'));
      assert.equal(seen.head, git(s.store, 'rev-parse', 'HEAD'));
      // A turn that changed the memory: nothing is committed, only where it stands is noted.
      writeFileSync(join(s.store, 'new.md'), 'Claude wrote this.\n');
      git(s.store, 'add', 'new.md');
      git(s.store, 'commit', '-q', '-m', 'the owner commits');
      run('Stop', { ...s.base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, s.home);
      assert.equal(git(s.store, 'log', '-1', '--format=%s'), 'the owner commits');
      assert.equal(git(s.store, 'status', '--porcelain'), '');
      assert.equal(JSON.parse(readFileSync(join(s.home, 'state', 'memory-seen.hook.json'), 'utf8')).head, git(s.store, 'rev-parse', 'HEAD'));
      assert.ok(!git(remote.replace(/\\/g, '/'), 'log', '--format=%s', '--all').includes('the owner commits'), 'nothing is sent');
    } finally {
      s.done();
    }
  },
);

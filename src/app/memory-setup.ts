// SPDX-License-Identifier: Apache-2.0
/**
 * The memory setup (docs/memory.md): a short conversation that decides where Claude Code's memory lives
 * (this computer, the person's GitHub, or both), shows every change, asks once, then makes them. The
 * questions go through a SetupIO, so the terminal and the tests drive the same steps; every program runs
 * through a Runner (git, the GitHub CLI), the interactive ones (installers, signing in) in the person's
 * terminal. Nothing is created or written before the person has said yes to the whole list.
 */
import type { Config, MemoryPlace, MemoryStore, MemorySyncMode } from '../core/config.js';
import { setConfigValue } from '../core/config.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { commitMessage, githubRemote, githubRepoOf, managedByUs, repoNameProblems, suggestRepoName } from '../core/memory.js';
import { syncMemory, type Runner, type SyncResult } from '../core/memory-sync.js';
import { expandHome, joinPath, pathKey, resolvePath, type Platform } from '../core/paths.js';
import { scanSecrets } from '../core/secrets/scan.js';
import { readText } from '../node/fsx.js';
import { copyNotes, folderFacts, importProjects, perProjectMemories, readMemorySetting, scaffoldStore, writeMemorySetting } from '../node/memory-store.js';
import { findTool, ghCreatePrivate, ghRepo, ghUser, installPlan, noreplyEmail, type ToolFound, type ToolName } from '../node/memory-tools.js';

/** How the setup talks to the person. */
export interface SetupIO {
  say(text?: string): void;
  /** One of the options by its index; Enter takes `def`. */
  choose(question: string, options: string[], def: number): Promise<number>;
  /** A line of text; Enter takes `def`. */
  ask(question: string, def: string): Promise<string>;
  confirm(question: string, def: boolean): Promise<boolean>;
  /** Runs a program in the person's terminal (an installer, signing in); its exit code. */
  interactive(argv: string[]): Promise<number>;
}

export interface SetupEnv {
  lang: Lang;
  platform: Platform;
  home: string;
  cwd: string;
  layout: Layout;
  claudeDir: string;
  config: Config;
  runner: Runner;
  /** Whether a program is on the PATH (winget, brew, apt-get …). */
  has: (program: string) => Promise<boolean>;
  /** Whether a file exists (the places installers put git and gh). */
  exists: (path: string) => boolean;
  now: () => number;
}

/** What the setup decided; nothing of it exists yet. */
export interface SetupPlan {
  place: MemoryPlace;
  dir: string;
  /** Keep a git history (a remote always has one; local when git is installed). */
  git: boolean;
  gitCommand: string | null;
  ghCommand: string | null;
  repo: string | null;
  remote: string | null;
  createRepo: boolean;
  /** The remote has notes already and the folder is new: clone it. */
  clone: boolean;
  /** The folder is already a clone of the remote, or already in a git history: use it as it is. */
  adopt: boolean;
  /** How terminal-code keeps it in sync (asked when the folder is someone's own git history). */
  mode: MemorySyncMode;
  /** Handoff notes are kept in the folder. */
  handoffs: boolean;
  setupGit: boolean;
  identity: { name: string; email: string } | null;
  bringFrom: string | null;
  projects: { slug: string; dir: string; files: number }[];
  protect: boolean;
  writeSetting: boolean;
}

export interface SetupOutcome {
  ok: boolean;
  plan: SetupPlan | null;
  store: MemoryStore | null;
  config: Config | null;
  sync: SyncResult | null;
}

const STOP: SetupOutcome = { ok: false, plan: null, store: null, config: null, sync: null };

/** The setup, start to end. */
export async function memorySetup(io: SetupIO, env: SetupEnv): Promise<SetupOutcome> {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(env.lang, k, p);
  const res = (p: string) => resolvePath(expandHome(p.trim(), env.home), { platform: env.platform, home: env.home, cwd: env.cwd });
  const same = (a: string, b: string) => pathKey(a, env.platform) === pathKey(b, env.platform);

  io.say(T('msetup.title'));
  io.say(T('msetup.intro'));
  io.say();

  // ── 1 · what is there now ──
  const current = readMemorySetting(env.claudeDir);
  const currentFacts = current ? folderFacts(current) : null;
  const projects = perProjectMemories(env.claudeDir);
  const store = env.config.memory.store;
  if (store) io.say(T('msetup.now.store', { place: T(`msetup.place.${store.place}` as MessageKey), dir: store.dir }));
  if (current) io.say(T('msetup.now.setting', { dir: current, n: currentFacts?.files ?? 0 }));
  else io.say(T('msetup.now.default', { dir: joinPath(env.claudeDir.replace(/\\/g, '/'), 'projects') }));
  if (projects.length) io.say(T('msetup.now.projects', { n: projects.length, files: projects.reduce((a, p) => a + p.files, 0) }));
  const gitAtCurrent = current && currentFacts?.exists ? await remoteOf(env.runner, 'git', current) : null;
  if (gitAtCurrent?.url) io.say(T('msetup.now.remote', { remote: gitAtCurrent.repo ?? gitAtCurrent.url }));
  io.say();

  // ── 2 · where ──
  const places: MemoryPlace[] = ['local', 'github', 'both'];
  const pick = await io.choose(T('msetup.ask.place'), [T('msetup.option.local'), T('msetup.option.github'), T('msetup.option.both')], 2);
  let place = places[pick]!;

  // ── 3 · tools ──
  let gitTool = await findTool(env.runner, 'git', env.platform, env.exists);
  if (!gitTool) {
    io.say(T('msetup.tool.missing', { tool: 'git' }));
    gitTool = await offerInstall(io, env, 'git', T);
    if (!gitTool && place !== 'local') return stop(io, T('msetup.stop.noGit'));
    if (!gitTool) io.say(T('msetup.local.noHistory'));
  } else io.say(T('msetup.tool.found', { tool: 'git', version: gitTool.version }));

  let ghTool: ToolFound | null = null;
  let login: { login: string; id: number } | null = null;
  if (place !== 'local') {
    ghTool = await findTool(env.runner, 'gh', env.platform, env.exists);
    if (!ghTool) {
      io.say(T('msetup.tool.missing', { tool: 'GitHub CLI (gh)' }));
      ghTool = await offerInstall(io, env, 'gh', T);
    } else io.say(T('msetup.tool.found', { tool: 'gh', version: ghTool.version }));
    if (ghTool) {
      login = await ghUser(env.runner, ghTool.command);
      if (!login) {
        io.say(T('msetup.gh.notSignedIn'));
        if (await io.confirm(T('msetup.gh.signIn'), true)) {
          await io.interactive([ghTool.command, 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
          login = await ghUser(env.runner, ghTool.command);
        }
        if (!login) io.say(T('msetup.gh.stillNot'));
      }
      if (login) io.say(T('msetup.gh.signedIn', { login: login.login }));
    }
    if (!login) {
      // Without the GitHub CLI's sign-in: an address the person gives, or this computer only.
      const alt = await io.choose(T('msetup.noGh.ask'), [T('msetup.noGh.url'), T('msetup.noGh.local'), T('msetup.noGh.stop')], 1);
      if (alt === 2) return stop(io, T('msetup.stop.asked'));
      if (alt === 1) place = 'local';
    }
  }

  // ── 4 · the folder ──
  let dir: string;
  if (place === 'github') {
    dir = '';
  } else {
    const suggestion = current ?? joinPath(env.home, 'claude-memory');
    for (;;) {
      dir = res(await io.ask(T('msetup.ask.folder'), suggestion));
      const f = folderFacts(dir);
      if (f.exists && f.files === 1 && !f.hasIndex && readText(dir) !== null) {
        io.say(T('msetup.folder.notFolder', { dir }));
        continue;
      }
      if (f.exists && f.files > 0 && !f.hasIndex && !(await io.confirm(T('msetup.folder.foreign', { dir, n: f.files }), false))) continue;
      if (f.exists && f.hasIndex) io.say(T('msetup.folder.memory', { dir, n: f.files }));
      break;
    }
  }

  // ── 5 · the repository ──
  let repo: string | null = null;
  let remote: string | null = null;
  let createRepo = false;
  let clone = false;
  let adopt = false;
  if (place !== 'local') {
    const here = dir ? await remoteOf(env.runner, gitTool!.command, dir) : null;
    if (here?.url) {
      // The folder is already a clone: keep it, after checking what it is synced with.
      repo = here.repo;
      remote = here.url;
      adopt = true;
      if (repo && ghTool && login) {
        const info = await ghRepo(env.runner, ghTool.command, repo);
        if (info && !info.private) return stop(io, T('msetup.repo.public', { repo }));
      }
      io.say(T('msetup.repo.adopt', { repo: repo ?? remote }));
    } else if (login && ghTool) {
      for (;;) {
        const typed = await io.ask(T('msetup.ask.repo', { owner: login.login }), 'claude-memory');
        const name = typed.includes('/') ? typed.split('/').pop()! : typed;
        const owner = typed.includes('/') ? typed.split('/')[0]! : login.login;
        const problems = repoNameProblems(name);
        if (problems.length) {
          io.say(T(`msetup.repo.name.${problems[0]!}` as MessageKey, { suggestion: suggestRepoName(name) }));
          continue;
        }
        const full = `${owner}/${name}`;
        const info = await ghRepo(env.runner, ghTool.command, full);
        if (info && !info.private) {
          io.say(T('msetup.repo.public', { repo: full }));
          continue;
        }
        repo = full;
        remote = githubRemote(full);
        if (info) {
          const folder = dir ? folderFacts(dir) : { exists: false, files: 0, hasIndex: false };
          if (!info.empty && folder.files > 0) {
            io.say(T('msetup.repo.bothFull', { repo: full, dir }));
            continue;
          }
          if (!(await io.confirm(T(info.empty ? 'msetup.repo.useEmpty' : 'msetup.repo.useFull', { repo: full }), true))) continue;
          clone = !info.empty;
        } else {
          io.say(T('msetup.repo.willCreate', { repo: full }));
          createRepo = true;
        }
        break;
      }
    } else {
      for (;;) {
        const url = (await io.ask(T('msetup.ask.url'), '')).trim();
        if (!url) return stop(io, T('msetup.stop.asked'));
        const ls = await run(env.runner, [gitTool!.command, 'ls-remote', '--heads', url], env.cwd, 30_000);
        if (!ls.ok) {
          io.say(T('msetup.url.unreachable', { url, detail: ls.err.split('\n')[0] ?? '' }));
          continue;
        }
        if (ls.out.trim() && dir && folderFacts(dir).files > 0) {
          io.say(T('msetup.repo.bothFull', { repo: url, dir }));
          continue;
        }
        io.say(T('msetup.url.privacy'));
        if (!(await io.confirm(T('msetup.url.confirm', { url }), false))) continue;
        remote = url;
        repo = githubRepoOf(url);
        clone = ls.out.trim().length > 0;
        break;
      }
    }
    if (place === 'github') {
      // terminal-code's own working copy: used as it is when it is already this repository's clone.
      dir = githubOnlyDir(env.layout, repo);
      const there = folderFacts(dir);
      if (there.exists && there.files > 0) {
        const at = await remoteOf(env.runner, gitTool!.command, dir);
        if (at?.url && (at.url === remote || (at.repo !== null && at.repo === repo))) {
          adopt = true;
          clone = false;
          createRepo = false;
        } else dir = `${dir}-${env.now()}`;
      }
    }
  }

  // A folder already in a git history (a repository of the person's, perhaps a larger one) is used as it is.
  const tree = dir && gitTool && folderFacts(dir).exists ? await run(env.runner, [gitTool.command, '-C', dir, 'rev-parse', '--show-toplevel'], dir) : null;
  if (place === 'local' && tree?.ok && tree.out.trim()) adopt = true;

  // ── 5b · a memory someone already keeps in git: how terminal-code looks after it (a GitHub-only working copy is terminal-code's own) ──
  let mode: MemorySyncMode = 'auto';
  let handoffs = true;
  if (adopt && place !== 'github') {
    const ours = managedByUs(readText(joinPath(dir, 'README.md')));
    const modes: MemorySyncMode[] = place === 'local' ? ['auto', 'manual'] : ['auto', 'pull', 'manual'];
    const labels = modes.map((m) => T(`msetup.mode.${m}${place === 'local' && m === 'auto' ? 'Local' : ''}` as MessageKey));
    const def = ours ? 0 : 1;
    mode = modes[await io.choose(T(ours ? 'msetup.ask.modeOurs' : 'msetup.ask.mode', { dir }), labels, def)]!;
    if (mode !== 'auto') handoffs = (await io.choose(T('msetup.ask.handoffs'), [T('msetup.handoffs.store'), T('msetup.handoffs.tool')], 1)) === 0;
  }

  // ── 6 · what to bring along ──
  let bringFrom: string | null = null;
  if (current && !same(current, dir) && (currentFacts?.files ?? 0) > 0) {
    if (await io.confirm(T('msetup.bring.current', { from: current, n: currentFacts!.files }), true)) bringFrom = current;
  }
  let chosenProjects: SetupPlan['projects'] = [];
  if (projects.length && (await io.confirm(T('msetup.bring.projects', { n: projects.length, files: projects.reduce((a, p) => a + p.files, 0) }), true)))
    chosenProjects = projects;

  // ── 7 · protection ──
  const protect = env.config.memory.dirs.some((d) => same(res(d), dir)) || (await io.confirm(T('msetup.ask.protect'), true));

  // ── 8 · identity: a commit needs a name and an address; GitHub's private one when signed in ──
  let identity: SetupPlan['identity'] = null;
  if (gitTool && mode === 'auto') {
    const name = await run(env.runner, [gitTool.command, 'config', '--get', 'user.name'], dir && folderFacts(dir).exists ? dir : env.cwd);
    const email = await run(env.runner, [gitTool.command, 'config', '--get', 'user.email'], dir && folderFacts(dir).exists ? dir : env.cwd);
    if (!name.out.trim() || !email.out.trim())
      identity = login ? { name: login.login, email: noreplyEmail(login.login, login.id) } : { name: 'Claude Code memory', email: 'memory@localhost' };
  }

  const plan: SetupPlan = {
    place,
    dir,
    git: place !== 'local' || !!gitTool,
    gitCommand: gitTool?.command ?? null,
    ghCommand: ghTool?.command ?? null,
    repo,
    remote,
    createRepo,
    clone,
    adopt,
    mode,
    handoffs,
    setupGit: !!(ghTool && login && place !== 'local'),
    identity,
    bringFrom,
    projects: chosenProjects,
    protect,
    writeSetting: !current || !same(current, dir),
  };

  // ── 9 · the whole list, one yes ──
  io.say();
  io.say(T('msetup.plan.title'));
  for (const line of describePlan(plan, env.lang)) io.say(`  • ${line}`);
  io.say();
  if (!(await io.confirm(T('msetup.plan.confirm'), false))) return stop(io, T('msetup.stop.unchanged'));

  return applyPlan(io, env, plan);
}

/** The changes a plan makes, one line each, in the person's language. */
export function describePlan(p: SetupPlan, lang: Lang): string[] {
  const T = (k: MessageKey, x?: Record<string, string | number>) => tIn(lang, k, x);
  const out: string[] = [];
  if (p.createRepo) out.push(T('msetup.plan.create', { repo: p.repo ?? '' }));
  if (p.setupGit) out.push(T('msetup.plan.setupGit'));
  if (p.clone) out.push(T('msetup.plan.clone', { repo: p.repo ?? p.remote ?? '', dir: p.dir }));
  else if (p.adopt) out.push(T('msetup.plan.adopt', { dir: p.dir }));
  else {
    out.push(T('msetup.plan.folder', { dir: p.dir }));
    if (p.git) out.push(T(p.remote ? 'msetup.plan.gitRemote' : 'msetup.plan.gitLocal', { remote: p.repo ?? p.remote ?? '' }));
  }
  if (p.adopt) out.push(T(`msetup.plan.mode.${p.mode}` as MessageKey));
  if (p.identity) out.push(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }));
  if (!p.adopt) out.push(T('msetup.plan.scaffold'));
  else if (p.handoffs) out.push(T('msetup.plan.scaffoldHandoffs'));
  if (!p.handoffs) out.push(T('msetup.plan.handoffsTool'));
  if (p.bringFrom) out.push(T('msetup.plan.bring', { from: p.bringFrom }));
  if (p.projects.length) out.push(T('msetup.plan.projects', { n: p.projects.length }));
  if (p.git && p.mode === 'auto') out.push(T(p.remote ? 'msetup.plan.commitPush' : 'msetup.plan.commit'));
  else if (p.git && p.mode === 'pull' && p.remote) out.push(T('msetup.plan.pullOnly'));
  if (p.writeSetting) out.push(T('msetup.plan.setting', { dir: p.dir }));
  if (p.protect) out.push(T('msetup.plan.protect'));
  out.push(T('msetup.plan.save'));
  return out;
}

/** Makes the plan's changes in order; stops at the first that fails and says what was done. */
export async function applyPlan(io: SetupIO, env: SetupEnv, p: SetupPlan): Promise<SetupOutcome> {
  const T = (k: MessageKey, x?: Record<string, string | number>) => tIn(env.lang, k, x);
  const ok = (line: string) => io.say(`  ✓ ${line}`);
  const fail = (line: string, detail: string): SetupOutcome => {
    io.say(`  ✗ ${line}: ${detail}`);
    io.say(T('msetup.apply.partial'));
    return { ...STOP, plan: p };
  };
  const git = p.gitCommand ?? 'git';

  if (p.createRepo && p.repo && p.ghCommand) {
    const err = await ghCreatePrivate(env.runner, p.ghCommand, p.repo, 'Claude Code memory (terminal-code)');
    if (err) return fail(T('msetup.plan.create', { repo: p.repo }), err);
    ok(T('msetup.plan.create', { repo: p.repo }));
  }
  if (p.setupGit && p.ghCommand) {
    const r = await run(env.runner, [p.ghCommand, 'auth', 'setup-git', '--hostname', 'github.com'], env.cwd);
    if (!r.ok) return fail(T('msetup.plan.setupGit'), r.err);
    ok(T('msetup.plan.setupGit'));
  }
  if (p.clone && p.remote) {
    const r = await run(env.runner, [git, 'clone', '--quiet', p.remote, p.dir], env.cwd, 120_000);
    if (!r.ok) return fail(T('msetup.plan.clone', { repo: p.repo ?? p.remote, dir: p.dir }), r.err);
    ok(T('msetup.plan.clone', { repo: p.repo ?? p.remote, dir: p.dir }));
  } else if (!p.adopt) {
    scaffoldStore(p.dir, p.place);
    if (p.git) {
      const inside = await run(env.runner, [git, '-C', p.dir, 'rev-parse', '--show-toplevel'], p.dir);
      if (
        !inside.ok ||
        pathKey(resolvePath(inside.out.trim(), { platform: env.platform, home: env.home, cwd: p.dir }), env.platform) !== pathKey(p.dir, env.platform)
      ) {
        const init = await run(env.runner, [git, 'init', '--quiet', '--initial-branch=main', p.dir], env.cwd);
        if (!init.ok) return fail(T('msetup.plan.gitLocal', { remote: '' }), init.err);
      }
      if (p.remote) {
        const has = await run(env.runner, [git, '-C', p.dir, 'remote', 'get-url', 'origin'], p.dir);
        const set = has.ok
          ? await run(env.runner, [git, '-C', p.dir, 'remote', 'set-url', 'origin', p.remote], p.dir)
          : await run(env.runner, [git, '-C', p.dir, 'remote', 'add', 'origin', p.remote], p.dir);
        if (!set.ok) return fail(T('msetup.plan.gitRemote', { remote: p.repo ?? p.remote }), set.err);
      }
    }
    ok(T('msetup.plan.folder', { dir: p.dir }));
  } else ok(T('msetup.plan.adopt', { dir: p.dir }));

  if (p.identity && p.git) {
    for (const [k, v] of [
      ['user.name', p.identity.name],
      ['user.email', p.identity.email],
    ] as const) {
      const r = await run(env.runner, [git, '-C', p.dir, 'config', k, v], p.dir);
      if (!r.ok) return fail(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }), r.err);
    }
    ok(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }));
  }
  // A folder of the person's own gets nothing it did not ask for: at most the handoffs folder, when notes go there.
  if (!p.adopt) {
    scaffoldStore(p.dir, p.place, { readme: true, handoffs: p.handoffs });
    ok(T('msetup.plan.scaffold'));
  } else if (p.handoffs) {
    scaffoldStore(p.dir, p.place, { readme: false, handoffs: true });
    ok(T('msetup.plan.scaffoldHandoffs'));
  }
  if (p.bringFrom) {
    const r = copyNotes(p.bringFrom, p.dir);
    ok(T('msetup.apply.brought', { n: r.copied, from: p.bringFrom }));
    if (r.skipped.length) io.say(`    ${T('msetup.apply.skipped', { files: r.skipped.slice(0, 8).join(', '), n: r.skipped.length })}`);
  }
  if (p.projects.length) {
    const r = importProjects(p.dir, p.projects, (slug) => slug);
    ok(T('msetup.apply.projects', { n: r.length, files: r.reduce((a, x) => a + x.copied, 0) }));
  }

  let sync: SyncResult | null = null;
  const how = {
    dir: p.dir,
    message: (counts: { added: number; changed: number; removed: number }) => commitMessage(counts, null, env.lang),
    readFile: async (path: string) => readText(path),
    secrets: (text: string) => scanSecrets(text).length,
    gitCommand: git,
  };
  if (p.git && p.mode === 'auto') {
    sync = await syncMemory(env.runner, {
      ...how,
      remote: !!p.remote,
      steps: { commit: true, pull: !p.clone && !p.createRepo && !!p.remote, push: !!p.remote },
    });
    if (sync.commit === 'failed' || sync.commit === 'identity' || sync.commit === 'busy') return fail(T('msetup.plan.commit'), sync.detail);
    if (p.remote && sync.push !== 'ok' && sync.push !== 'none') return fail(T('msetup.plan.commitPush'), sync.detail || sync.push);
    ok(T(p.remote ? 'msetup.plan.commitPush' : 'msetup.plan.commit'));
    if (sync.held.length) io.say(`    ${T('msetup.apply.held', { files: sync.held.map((h) => h.path).join(', ') })}`);
  } else if (p.git && p.mode === 'pull' && p.remote) {
    // Only a fast-forward: nothing of the person's is committed, rebased or sent. One that cannot be made is said, not fatal.
    sync = await syncMemory(env.runner, { ...how, remote: true, steps: { commit: false, pull: true, push: false }, pullMode: 'ff-only' });
    if (sync.pull === 'ok' || sync.pull === 'none') ok(T('msetup.plan.pullOnly'));
    else io.say(`  · ${T('msetup.apply.pullLater', { detail: sync.detail || sync.pull })}`);
  }

  if (p.writeSetting) {
    const w = writeMemorySetting(env.claudeDir, p.dir, env.layout.backupsDir, env.now());
    if (w.error) return fail(T('msetup.plan.setting', { dir: p.dir }), w.error);
    ok(T('msetup.plan.setting', { dir: p.dir }) + (w.backup ? ` (${T('msetup.apply.backup', { file: w.backup })})` : ''));
  }

  const store: MemoryStore = { place: p.place, dir: p.dir, remote: p.remote, repo: p.repo, git: p.git, sync: p.mode, handoffs: p.handoffs };
  let next = setConfigValue(env.config, 'memory.store', store).config;
  if (p.protect && !next.memory.dirs.some((d) => pathKey(d, env.platform) === pathKey(p.dir, env.platform)))
    next = setConfigValue(next, 'memory.dirs', [...next.memory.dirs, p.dir]).config;
  if (p.protect) ok(T('msetup.plan.protect'));
  ok(T('msetup.plan.save'));

  io.say();
  io.say(T('msetup.done', { dir: p.dir }));
  if (p.place !== 'local') io.say(T('msetup.done.otherComputer', { repo: p.repo ?? p.remote ?? '' }));
  io.say(T('msetup.done.status'));
  return { ok: true, plan: p, store, config: next, sync };
}

function stop(io: SetupIO, why: string): SetupOutcome {
  io.say(why);
  return STOP;
}

export async function run(r: Runner, argv: string[], cwd: string, timeoutMs = 30_000): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const out = await r.run(argv, { cwd, timeoutMs, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' } });
    return { ok: out.exitCode === 0, out: out.stdout, err: out.stderr.trim() || out.stdout.trim() };
  } catch (err) {
    return { ok: false, out: '', err: String((err as Error)?.message ?? err) };
  }
}

/** The folder's origin as configured (not as `url.insteadOf` rewrites it), when the folder is in a work tree that has one. */
export async function remoteOf(r: Runner, git: string, dir: string): Promise<{ url: string; repo: string | null } | null> {
  const url = await run(r, [git, '-C', dir, 'config', '--get', 'remote.origin.url'], dir);
  if (!url.ok || !url.out.trim()) return null;
  return { url: url.out.trim(), repo: githubRepoOf(url.out.trim()) };
}

/** Offers to install a missing tool with this system's installer; finds it again afterwards. `cmd` is the setup to run again. */
export async function offerInstall(
  io: SetupIO,
  env: Pick<SetupEnv, 'has' | 'platform' | 'runner' | 'exists'>,
  tool: ToolName,
  T: (k: MessageKey, p?: Record<string, string | number>) => string,
  cmd = 'terminal-code memory setup',
): Promise<ToolFound | null> {
  const managers = ['winget', 'brew', 'apt-get', 'dnf', 'pacman', 'zypper'];
  const present = new Set<string>();
  for (const m of managers) if (await env.has(m)) present.add(m);
  const plan = installPlan(tool, env.platform, (p) => present.has(p));
  if (!plan.argv) {
    io.say(T('msetup.tool.page', { page: plan.page, cmd }));
    return null;
  }
  if (!(await io.confirm(T('msetup.tool.install', { cmd: plan.argv.join(' ') }), true))) {
    io.say(T('msetup.tool.page', { page: plan.page, cmd }));
    return null;
  }
  await io.interactive(plan.argv);
  const found = await findTool(env.runner, tool, env.platform, env.exists);
  if (found) io.say(T('msetup.tool.found', { tool, version: found.version }));
  else io.say(T('msetup.tool.reopen', { cmd }));
  return found;
}

/** The setup's folder for a GitHub-only memory: inside the data folder, named after the repository. */
export function githubOnlyDir(l: Layout, repo: string | null): string {
  return joinPath(l.memoryDir, (repo ?? 'memory').split('/').pop()!);
}

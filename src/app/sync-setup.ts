// SPDX-License-Identifier: Apache-2.0
/**
 * The sync setup (docs/sync.md): a short conversation that decides where the shared copy of mode-code's
 * settings and history lives (a private repository on the person's GitHub, named by them, or a folder another
 * service keeps in sync), what this computer is called there, and whether handoff notes go there too. It shows
 * every change and asks once; the questions go through the same SetupIO as the memory setup, every program
 * through a Runner. Settings that differ from the other computers' are asked about after the download, before
 * anything is sent.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setConfigValue, type Config, type SyncPlace, type SyncSetting } from '../core/config.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { githubRemote, githubRepoOf, repoNameProblems, suggestRepoName } from '../core/memory.js';
import type { Runner } from '../core/memory-sync.js';
import { expandHome, isUnder, joinPath, pathKey, resolvePath, type Platform } from '../core/paths.js';
import {
  applyShared,
  changedFromDefaults,
  differences,
  lowersProtection,
  machineId,
  machinePaths,
  MACHINES_DIR,
  parseMachineInfo,
  parseMachineSettings,
  syncReadme,
  type MachineSettings,
} from '../core/sync.js';
import type { SharedRecord } from '../core/sync-export.js';
import { ensureDir, readText, writeAtomic } from '../node/fsx.js';
import { copyNotes } from '../node/memory-store.js';
import { findTool, ghCreatePrivate, ghHasPath, ghRepo, ghUser, noreplyEmail, type ToolFound } from '../node/memory-tools.js';
import { syncShared } from '../node/sync.js';
import { offerInstall, remoteOf, run, type SetupIO } from './memory-setup.js';
import { nameOf, settingOf, valueText, type SettingPath } from '../core/ux/catalog.js';

export interface SyncSetupEnv {
  lang: Lang;
  platform: Platform;
  home: string;
  cwd: string;
  layout: Layout;
  /** This computer's own settings (config.json as it is). */
  config: Config;
  runner: Runner;
  has: (program: string) => Promise<boolean>;
  exists: (path: string) => boolean;
  now: () => number;
  /** This computer's name as the system gives it. */
  hostname: string;
  /** Four random hex digits, for this computer's id. */
  random: () => string;
}

/** What the setup decided; nothing of it exists yet. */
export interface SyncPlan {
  place: SyncPlace;
  /** The copy of the repository on this computer (GitHub), or the folder itself. */
  top: string;
  /** The shared place: the copy's top, or a folder in it. */
  dir: string;
  gitCommand: string | null;
  ghCommand: string | null;
  repo: string | null;
  remote: string | null;
  createRepo: boolean;
  /** The copy is to be made (downloaded); else one already here is used. */
  clone: boolean;
  setupGit: boolean;
  identity: { name: string; email: string } | null;
  machine: { id: string; name: string };
  handoffs: boolean;
  /** Handoff notes in mode-code's own folder to bring into the shared place. */
  moveNotes: number;
}

export interface SyncOutcome {
  ok: boolean;
  plan: SyncPlan | null;
  config: Config | null;
  record: SharedRecord | null;
}

const STOP: SyncOutcome = { ok: false, plan: null, config: null, record: null };
const CMD = 'mode-code sync setup';

/** The computers already in a shared place, as their own folders say. */
export function machinesIn(dir: string): { id: string; name: string; platform: string }[] {
  let ids: string[] = [];
  try {
    ids = readdirSync(join(dir, MACHINES_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,47}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return ids.map((id) => {
    const info = parseMachineInfo(readText(machinePaths(dir, id).machine));
    return { id, name: info?.name ?? id, platform: info?.platform ?? '' };
  });
}

function countNotes(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/^\d{8}-\d{6}-[a-z0-9]+\.md$/.test(e.name)) n++;
    }
  };
  walk(dir);
  return n;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isEmptyDir = (p: string) => {
  try {
    return readdirSync(p).length === 0;
  } catch {
    return true;
  }
};

/** A folder inside a repository, as the person names it: plain names, no way up or out. */
export function subfolderProblem(s: string): boolean {
  const parts = s.replace(/\\/g, '/').split('/').filter(Boolean);
  return !parts.length || parts.some((p) => p === '..' || p === '.git' || !/^[A-Za-z0-9._ -]{1,80}$/.test(p)) || /^[/\\]|^[A-Za-z]:/.test(s.trim());
}

/** The setup, start to end. */
export async function syncSetup(io: SetupIO, env: SyncSetupEnv): Promise<SyncOutcome> {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(env.lang, k, p);
  const res = (p: string) => resolvePath(expandHome(p.trim(), env.home), { platform: env.platform, home: env.home, cwd: env.cwd });
  const same = (a: string, b: string) => pathKey(a, env.platform) === pathKey(b, env.platform);
  const current = env.config.sync;
  // Where the setup is, six steps in all, each said once; a step this choice does not need says so.
  const shown = new Set<number>();
  const step = (n: number, key: MessageKey, skip = false) => {
    if (shown.has(n)) return;
    shown.add(n);
    io.step?.(n, 6, T(key), skip ? T('msetup.step.notNeeded') : undefined);
  };

  io.say(T('ssetup.title'));
  io.say(T('ssetup.intro'));
  io.say();
  if (current) io.say(T('ssetup.now', { place: T(`scli.place.${current.place}` as MessageKey), dir: current.dir, name: current.machine.name }));

  // ── 1 · where ──
  step(1, 'ssetup.step.where');
  let place: SyncPlace =
    (await io.choose(T('ssetup.ask.place'), [T('ssetup.option.github'), T('ssetup.option.folder')], current?.place === 'folder' ? 1 : 0)) === 1
      ? 'folder'
      : 'github';

  let top = '';
  let dir = '';
  let repo: string | null = null;
  let remote: string | null = null;
  let createRepo = false;
  let clone = false;
  let gitTool: ToolFound | null = null;
  let ghTool: ToolFound | null = null;
  let login: { login: string; id: number } | null = null;
  let subfolder = '.';

  if (place === 'github') {
    // ── 2 · git, the GitHub CLI, signing in: before the list, each on its own yes (Enter is no) ──
    step(2, 'msetup.step.tools');
    gitTool = await findTool(env.runner, 'git', env.platform, env.exists);
    if (!gitTool) {
      io.say(T('msetup.tool.missing', { tool: 'git' }));
      gitTool = await offerInstall(io, env, 'git', T, CMD);
      if (!gitTool) return stop(io, T('ssetup.stop.noGit'));
    } else io.say(T('msetup.tool.found', { tool: 'git', version: gitTool.version }));
    ghTool = await findTool(env.runner, 'gh', env.platform, env.exists);
    if (!ghTool) {
      io.say(T('msetup.tool.missing', { tool: 'GitHub CLI (gh)' }));
      ghTool = await offerInstall(io, env, 'gh', T, CMD);
    } else io.say(T('msetup.tool.found', { tool: 'gh', version: ghTool.version }));
    if (ghTool) {
      login = await ghUser(env.runner, ghTool.command);
      if (!login) {
        io.say(T('msetup.gh.notSignedIn'));
        if (await io.confirm(T('msetup.gh.signIn'), false)) {
          await io.interactive([ghTool.command, 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
          login = await ghUser(env.runner, ghTool.command);
        }
        if (!login) io.say(T('msetup.gh.stillNot'));
      }
      if (login) io.say(T('msetup.gh.signedIn', { login: login.login }));
    }

    // ── 3 · the repository, named by the person ──
    step(3, 'ssetup.step.copy');
    if (login && ghTool) {
      for (;;) {
        const typed = (await io.ask(T('ssetup.ask.repo', { owner: login.login }), current?.repo ?? 'mode-code-sync')).trim();
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
          io.say(T('ssetup.repo.public', { repo: full }));
          continue;
        }
        repo = full;
        remote = githubRemote(full);
        if (!info) {
          io.say(T('msetup.repo.willCreate', { repo: full }));
          createRepo = true;
        } else if (info.empty) {
          if (!(await io.confirm(T('msetup.repo.useEmpty', { repo: full }), true))) continue;
        } else if (await ghHasPath(env.runner, ghTool.command, full, MACHINES_DIR)) {
          io.say(T('ssetup.repo.synced', { repo: full }));
        } else {
          // A repository with other files in it (a memory, a project): mode-code keeps to a folder of it.
          io.say(T('ssetup.repo.other', { repo: full }));
          const before = current?.place === 'github' && current.repo === full ? await placeOf(env.runner, gitTool.command, current) : null;
          subfolder = await askSubfolder(io, T, before && before.sub !== '.' ? before.sub : 'mode-code');
        }
        break;
      }
    } else {
      const alt = await io.choose(T('ssetup.noGh.ask'), [T('msetup.noGh.url'), T('ssetup.noGh.folder'), T('msetup.noGh.stop')], 1);
      if (alt === 2) return stop(io, T('msetup.stop.asked'));
      if (alt === 1) place = 'folder';
      else
        for (;;) {
          const url = (await io.ask(T('msetup.ask.url'), '')).trim();
          if (!url) return stop(io, T('msetup.stop.asked'));
          const ls = await run(env.runner, [gitTool.command, 'ls-remote', '--heads', url], env.cwd, 30_000);
          if (!ls.ok) {
            io.say(T('msetup.url.unreachable', { url, detail: ls.err.split('\n')[0] ?? '' }));
            continue;
          }
          io.say(T('msetup.url.privacy'));
          if (!(await io.confirm(T('msetup.url.confirm', { url }), false))) continue;
          remote = url;
          repo = githubRepoOf(url);
          if (ls.out.trim()) subfolder = await askSubfolder(io, T, 'mode-code');
          break;
        }
    }
  }

  if (place === 'github') {
    // ── 4 · the copy on this computer: a new one, or one the person already has ──
    const store = env.config.memory.store;
    const storeTop = store?.git && gitTool ? await run(env.runner, [gitTool.command, '-C', store.dir, 'rev-parse', '--show-toplevel'], store.dir) : null;
    const storeRemote = storeTop?.ok && gitTool ? await remoteOf(env.runner, gitTool.command, storeTop.out.trim()) : null;
    const suggestion =
      current?.place === 'github' && current.remote === remote
        ? res((await placeOf(env.runner, gitTool!.command, current)).top)
        : storeRemote && (storeRemote.url === remote || (storeRemote.repo !== null && storeRemote.repo === repo))
          ? res(storeTop!.out.trim())
          : joinPath(env.layout.root, 'sync');
    for (;;) {
      top = res(await io.ask(T('ssetup.ask.copy'), suggestion));
      if (
        isUnder(top, env.layout.root, env.platform) &&
        !same(top, joinPath(env.layout.root, 'sync')) &&
        !isUnder(top, joinPath(env.layout.root, 'sync'), env.platform)
      ) {
        io.say(T('ssetup.copy.inData', { dir: top }));
        continue;
      }
      if (isDir(top) && !isEmptyDir(top)) {
        const at = await remoteOf(env.runner, gitTool!.command, top);
        if (at && (at.url === remote || (at.repo !== null && at.repo === repo))) {
          io.say(T('ssetup.copy.adopt', { dir: top }));
          clone = false;
          createRepo = false;
          break;
        }
        io.say(T('ssetup.copy.other', { dir: top }));
        continue;
      }
      if (env.exists(top) && !isDir(top)) {
        io.say(T('msetup.folder.notFolder', { dir: top }));
        continue;
      }
      clone = true;
      break;
    }
    dir = subfolder === '.' ? top : joinPath(top, ...subfolder.replace(/\\/g, '/').split('/').filter(Boolean));
  } else {
    // ── 2 · a folder another service keeps in sync ──
    step(2, 'msetup.step.tools', true);
    step(3, 'ssetup.step.copy');
    for (;;) {
      dir = res(await io.ask(T('ssetup.ask.folder'), current?.place === 'folder' ? current.dir : joinPath(env.home, 'mode-code-sync')));
      if (isUnder(dir, env.layout.root, env.platform)) {
        io.say(T('ssetup.folder.inData', { dir }));
        continue;
      }
      if (env.exists(dir) && !isDir(dir)) {
        io.say(T('msetup.folder.notFolder', { dir }));
        continue;
      }
      const store = env.config.memory.store;
      if (store && (isUnder(dir, store.dir, env.platform) || same(dir, store.dir))) {
        io.say(T('ssetup.folder.inMemory', { dir }));
        continue;
      }
      if (isDir(dir) && !isEmptyDir(dir) && !isDir(join(dir, MACHINES_DIR)) && !(await io.confirm(T('ssetup.folder.foreign', { dir }), false))) continue;
      break;
    }
    top = dir;
  }

  // ── 5 · this computer, as the others will show it ──
  step(4, 'ssetup.step.computer');
  const known = place === 'folder' || !clone ? machinesIn(dir) : [];
  if (known.length) io.say(T('ssetup.known', { names: known.map((k) => k.name).join(', ') }));
  let id: string | null = current?.machine && known.some((k) => k.id === current.machine.id) ? current.machine.id : null;
  let suggestedName = current?.machine.name ?? env.hostname;
  if (!id && known.length && !current) {
    const i = await io.choose(T('ssetup.ask.which'), [...known.map((k) => `${k.name} (${k.id})`), T('ssetup.which.none')], known.length);
    if (i < known.length) {
      id = known[i]!.id;
      suggestedName = known[i]!.name;
    }
  }
  const name = ((await io.ask(T('ssetup.ask.name'), suggestedName)).trim() || suggestedName).slice(0, 60);
  const machine = { id: id ?? current?.machine.id ?? machineId(name, env.random()), name };

  // ── 6 · handoff notes ──
  step(5, 'ssetup.step.handoffs');
  let handoffs = false;
  if (env.config.memory.store?.handoffs) io.say(T('ssetup.handoffs.inMemory'));
  else handoffs = await io.confirm(T('ssetup.ask.handoffs'), current?.handoffs ?? true);
  const moveNotes = handoffs ? countNotes(env.layout.handoffsDir) : 0;

  // ── 7 · identity: commits need a name and an address; GitHub's private one when signed in ──
  let identity: SyncPlan['identity'] = null;
  if (place === 'github' && gitTool) {
    const at = isDir(top) ? top : env.cwd;
    const n = await run(env.runner, [gitTool.command, 'config', '--get', 'user.name'], at);
    const e = await run(env.runner, [gitTool.command, 'config', '--get', 'user.email'], at);
    if (!n.out.trim() || !e.out.trim())
      identity = login ? { name: login.login, email: noreplyEmail(login.login, login.id) } : { name: 'mode-code', email: 'sync@localhost' };
  }

  const plan: SyncPlan = {
    place,
    top,
    dir,
    gitCommand: gitTool?.command ?? null,
    ghCommand: ghTool?.command ?? null,
    repo,
    remote,
    createRepo,
    clone,
    setupGit: !!(ghTool && login && place === 'github'),
    identity,
    machine,
    handoffs,
    moveNotes,
  };

  // ── 8 · the whole list, one yes ──
  step(6, 'msetup.step.plan');
  io.say();
  io.say(T('msetup.plan.title'));
  for (const line of describeSyncPlan(plan, env.lang)) io.say(`  • ${line}`);
  io.say();
  if (!(await io.confirm(T('msetup.plan.confirm'), false))) return stop(io, T('msetup.stop.unchanged'));
  return applySyncPlan(io, env, plan);
}

async function askSubfolder(io: SetupIO, T: (k: MessageKey, p?: Record<string, string | number>) => string, def: string): Promise<string> {
  for (;;) {
    const s = (await io.ask(T('ssetup.ask.subfolder'), def)).trim();
    if (s === '.' || !subfolderProblem(s)) return s.replace(/\\/g, '/').replace(/^\.\/+|\/+$/g, '') || '.';
    io.say(T('ssetup.subfolder.bad', { folder: s }));
  }
}

/** Where a GitHub sync set up before has its copy, and the folder in it: from git, else the folder itself. */
async function placeOf(r: Runner, git: string, s: SyncSetting): Promise<{ top: string; sub: string }> {
  const t = await run(r, [git, '-C', s.dir, 'rev-parse', '--show-toplevel'], s.dir);
  const dir = s.dir.replace(/\\/g, '/');
  const top = t.ok && t.out.trim() ? t.out.trim().replace(/\\/g, '/') : dir;
  if (!dir.toLowerCase().startsWith(top.toLowerCase())) return { top: dir, sub: '.' };
  return { top, sub: dir.slice(top.length).replace(/^\/+/, '') || '.' };
}

/** The changes a plan makes, one line each, in the person's language. */
export function describeSyncPlan(p: SyncPlan, lang: Lang): string[] {
  const T = (k: MessageKey, x?: Record<string, string | number>) => tIn(lang, k, x);
  const out: string[] = [];
  if (p.createRepo) out.push(T('msetup.plan.create', { repo: p.repo ?? '' }));
  if (p.setupGit) out.push(T('msetup.plan.setupGit'));
  if (p.place === 'github') out.push(p.clone ? T('ssetup.plan.clone', { repo: p.repo ?? p.remote ?? '', dir: p.top }) : T('ssetup.plan.adopt', { dir: p.top }));
  if (p.dir !== p.top) out.push(T('ssetup.plan.subfolder', { dir: p.dir }));
  if (p.place === 'folder') out.push(T('ssetup.plan.folder', { dir: p.dir }));
  if (p.identity) out.push(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }));
  out.push(T('ssetup.plan.machine', { name: p.machine.name, id: p.machine.id }));
  out.push(T('ssetup.plan.settings'));
  if (p.handoffs) out.push(p.moveNotes ? T('ssetup.plan.handoffsMove', { n: p.moveNotes }) : T('ssetup.plan.handoffs'));
  out.push(T(p.place === 'github' ? 'ssetup.plan.first' : 'ssetup.plan.firstFolder'));
  out.push(T('msetup.plan.save'));
  return out;
}

/** Makes the plan's changes in order; stops at the first that fails and says what was done. */
export async function applySyncPlan(io: SetupIO, env: SyncSetupEnv, p: SyncPlan): Promise<SyncOutcome> {
  const T = (k: MessageKey, x?: Record<string, string | number>) => tIn(env.lang, k, x);
  const ok = (line: string) => io.say(`  ✓ ${line}`);
  const fail = (line: string, detail: string): SyncOutcome => {
    io.say(`  ✗ ${line}: ${detail}`);
    io.say(T('ssetup.apply.partial'));
    return { ...STOP, plan: p };
  };
  const git = p.gitCommand ?? 'git';
  const now = env.now();

  if (p.createRepo && p.repo && p.ghCommand) {
    const err = await ghCreatePrivate(env.runner, p.ghCommand, p.repo, 'mode-code sync: settings and history between computers');
    if (err) return fail(T('msetup.plan.create', { repo: p.repo }), err);
    ok(T('msetup.plan.create', { repo: p.repo }));
  }
  if (p.setupGit && p.ghCommand) {
    const r = await run(env.runner, [p.ghCommand, 'auth', 'setup-git', '--hostname', 'github.com'], env.cwd);
    if (!r.ok) return fail(T('msetup.plan.setupGit'), r.err);
    ok(T('msetup.plan.setupGit'));
  }
  if (p.place === 'github' && p.clone && p.remote) {
    const r = await run(env.runner, [git, 'clone', '--quiet', p.remote, p.top], env.cwd, 120_000);
    if (!r.ok) return fail(T('ssetup.plan.clone', { repo: p.repo ?? p.remote, dir: p.top }), r.err);
    ok(T('ssetup.plan.clone', { repo: p.repo ?? p.remote, dir: p.top }));
  } else if (p.place === 'github') ok(T('ssetup.plan.adopt', { dir: p.top }));
  try {
    ensureDir(p.dir);
    if (readText(joinPath(p.dir, 'README.md')) === null && !machinesIn(p.dir).length) writeAtomic(joinPath(p.dir, 'README.md'), syncReadme());
  } catch (err) {
    return fail(T(p.place === 'folder' ? 'ssetup.plan.folder' : 'ssetup.plan.subfolder', { dir: p.dir }), String((err as Error).message));
  }
  if (p.dir !== p.top) ok(T('ssetup.plan.subfolder', { dir: p.dir }));
  if (p.place === 'folder') ok(T('ssetup.plan.folder', { dir: p.dir }));
  if (p.identity && p.place === 'github') {
    for (const [k, v] of [
      ['user.name', p.identity.name],
      ['user.email', p.identity.email],
    ] as const) {
      const r = await run(env.runner, [git, '-C', p.top, 'config', k, v], p.top);
      if (!r.ok) return fail(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }), r.err);
    }
    ok(T('msetup.plan.identity', { name: p.identity.name, email: p.identity.email }));
  }

  // The other computers' settings, now that they are here: the person decides where they differ, before anything is sent.
  let config = env.config;
  const others: MachineSettings[] = [];
  for (const m of machinesIn(p.dir)) {
    if (m.id === p.machine.id) continue;
    const s = parseMachineSettings(readText(machinePaths(p.dir, m.id).settings));
    if (s && s.machine === m.id) others.push(s);
  }
  let firstStamp: (key: string) => number;
  if (others.length) {
    const diffs = differences(config, others);
    if (diffs.length) {
      const names = new Map(machinesIn(p.dir).map((m) => [m.id, m.name]));
      io.say(T('ssetup.diff.title', { n: diffs.length }));
      // Each difference in words where the setting has them (its name, its values), its key otherwise.
      for (const d of diffs.slice(0, 12))
        io.say(
          `    ${settingWords(d.key, d.here, d.theirs, env.lang, T('ssetup.diff.none'))} (${names.get(d.machine) ?? d.machine})${lowersProtection(d.key, d.here, d.theirs) ? ` · ${T('ssetup.diff.lowers')}` : ''}`,
        );
      if (diffs.length > 12) io.say(`    ${T('ssetup.diff.more', { n: diffs.length - 12 })}`);
      // Enter takes the other computers' settings, the usual choice, unless one of them lowers a protection here.
      const lowers = diffs.some((d) => lowersProtection(d.key, d.here, d.theirs));
      const theirs = (await io.choose(T('ssetup.ask.diff'), [T('ssetup.diff.theirs'), T('ssetup.diff.mine')], lowers ? 1 : 0)) === 0;
      if (theirs) {
        config = applyShared(config, Object.fromEntries(diffs.map((d) => [d.key, d.theirs])));
        firstStamp = () => 0;
        ok(T('ssetup.diff.took', { n: diffs.length }));
      } else {
        const keys = new Set(diffs.map((d) => d.key));
        firstStamp = (k) => (keys.has(k) ? now : 0);
        ok(T('ssetup.diff.kept', { n: diffs.length }));
      }
    } else firstStamp = () => 0;
  } else {
    const changed = changedFromDefaults(config);
    firstStamp = (k) => (changed.has(k) ? now : 0);
  }

  if (p.handoffs && p.moveNotes) {
    const r = copyNotes(env.layout.handoffsDir, joinPath(p.dir, 'handoffs'));
    if (!r.skipped.length) rmSync(env.layout.handoffsDir, { recursive: true, force: true });
    ok(T('ssetup.apply.moved', { n: r.copied }));
  }

  const setting: SyncSetting = {
    place: p.place,
    dir: p.dir,
    remote: p.place === 'github' ? p.remote : null,
    repo: p.place === 'github' ? p.repo : null,
    machine: p.machine,
    everyMinutes: env.config.sync?.everyMinutes ?? 30,
    keepMonths: env.config.sync?.keepMonths ?? 3,
    handoffs: p.handoffs,
  };
  config = setConfigValue(config, 'sync', setting).config;

  const record = await syncShared(config, env.layout, { trigger: 'setup', session: null, writer: 'cli', runner: env.runner, now, firstStamp });
  if (record?.error) return fail(T('ssetup.plan.machine', { name: p.machine.name, id: p.machine.id }), record.error);
  const r = record?.result;
  if (r && (r.commit === 'identity' || r.commit === 'failed' || r.commit === 'busy')) return fail(T('ssetup.plan.first'), r.detail || r.commit);
  ok(T('ssetup.plan.machine', { name: p.machine.name, id: p.machine.id }));
  if (r && r.push !== 'ok' && r.push !== 'none') io.say(`  · ${T('ssetup.apply.sendLater', { detail: r.detail || r.push })}`);
  else ok(T(p.place === 'github' ? 'ssetup.plan.first' : 'ssetup.plan.firstFolder'));
  ok(T('msetup.plan.save'));

  io.say();
  io.say(T('ssetup.done', { name: p.machine.name, dir: p.dir }));
  io.say(T(p.place === 'github' ? 'ssetup.done.other' : 'ssetup.done.otherFolder', { repo: p.repo ?? p.remote ?? '', dir: p.dir }));
  io.say(T('ssetup.done.status'));
  return { ok: true, plan: p, config, record };
}

/** A setting that differs, as the person reads it: "Full autonomy: off → on", or its key and values for one the catalog does not name. */
function settingWords(key: string, here: unknown, theirs: unknown, lang: Lang, none: string): string {
  const s = settingOf(key);
  if (!s) return `${key}: ${show(here, none)} → ${show(theirs, none)}`;
  const word = (v: unknown) => (v === undefined ? none : valueText(key as SettingPath, v, lang));
  return `${nameOf(key as SettingPath, lang)}: ${word(here)} → ${word(theirs)}`;
}

function show(v: unknown, none: string): string {
  const s = v === undefined ? none : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function stop(io: SetupIO, why: string): SyncOutcome {
  io.say(why);
  return STOP;
}

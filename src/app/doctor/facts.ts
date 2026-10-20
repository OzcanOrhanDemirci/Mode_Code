// SPDX-License-Identifier: Apache-2.0
/**
 * Measuring the machine for the maintenance check. This is the only part of the doctor that looks
 * outside the process; every measurement is bounded in time, never prompts, never throws, and records
 * "could not be measured" as null instead of guessing. Every folder it reads comes from the DoctorEnv,
 * so the same code measures the person's machine and a throwaway sandbox.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { arch, release, tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { APP_VERSION, PLUGIN_ID, PREVIOUS_NAMES, SELF_TEST_SESSION } from '../../core/app.js';
import { parseConfig, type Config, type ConfigProblem } from '../../core/config.js';
import { evaluateToolCall } from '../../core/belt/evaluate.js';
import { fillSample, samplesFor, type SamplePlaces } from '../../core/belt/samples.js';
import { safeId, type Layout } from '../../core/layout.js';
import { joinPath, pathKey, type Platform } from '../../core/paths.js';
import { parseModState } from '../../core/session.js';
import { runAllSuites } from '../../core/selftest/suites.js';
import { transcriptShape } from '../../core/transcript.js';
import type { Lang } from '../../core/i18n/index.js';
import { pluginHooks, readClaudeEnv, pluginsVia, type ClaudeEnv, type ClaudeRunner, type HookEntry, type PluginInfo } from '../../node/claude-env.js';
import { scanSecrets } from '../../core/secrets/scan.js';
import { missingKeptSkills } from '../../node/skills.js';
import { broadRule, hookFiles, hookLine, startsModel, toolSearchOff, unpinnedServer, usesJq } from './setup.js';
import { cliProgram, hookProgram, isOurHook, readManifest, underAgent } from '../../node/install.js';
import { findPrevious, previousPlugin } from '../../node/previous.js';
import { readJson, readText, realPathOf } from '../../node/fsx.js';
import { readUpdateState } from '../../node/update.js';
import { beltContext, memoryDirs, protectedAliases } from '../../node/context.js';
import { toolPath } from '../../node/env.js';
import { readTail } from '../../node/tail.js';
import type { Facts, ProgramRun, SettingsFileFacts } from './types.js';
import { memorySyncFile } from '../../core/layout.js';
import { newestRecord, parseSyncRecord } from '../../core/memory-sync.js';
import { readMemorySetting } from '../../node/memory-store.js';
import { lastShared, mergedConfig } from '../../node/sync.js';
import { machinesIn } from '../sync-setup.js';

export interface DoctorEnv {
  layout: Layout;
  /** Claude Code's configuration folder and global config file. */
  claudeDir: string;
  globalConfig: string;
  managedSettings: string[];
  cwd: string;
  home: string;
  env: NodeJS.ProcessEnv;
  platform: Platform;
  config: Config;
  problems: ConfigProblem[];
  lang: Lang;
  claude: ClaudeRunner;
  /** Where this build's shipped files are (hook.mjs, plugin/). */
  distDir: string;
  /** Leave out the slow measurements: the plugin list, shells, transcripts, the hook agreement. */
  quick?: boolean;
  /** Finer control than `quick`: each slow measurement on or off (on unless quick). */
  measure?: Partial<Record<Measure, boolean>>;
}

export type Measure = 'plugins' | 'shells' | 'transcripts' | 'agreement' | 'shortNames' | 'gitProjects';

/** Claude Code's setup beyond this tool's own (setup.ts): hooks, project settings, MCP servers, secrets, the memory index. */
function setupFacts(d: DoctorEnv, env: ClaudeEnv, installed: boolean, plugins: PluginInfo[] | null): Facts['setup'] {
  const l = d.layout;
  const others = env.hooks.filter((h) => !isOurHook({ command: h.command, args: h.args }, l.root));
  const short = (h: { command: string; args: readonly string[] }) => hookLine(h).slice(0, 200);
  const deadHooks = others
    .filter((h) => h.type === 'command')
    .flatMap((h) =>
      hookFiles(h, { home: d.home, project: d.cwd, platform: d.platform })
        .filter((p) => !existsSync(p))
        .map((missing) => ({ event: h.event, command: short(h), missing })),
    );
  // The plugins' own hooks run on the same events: one that starts a model on each (an observer) costs quota unseen.
  const fromPlugins = (plugins ?? [])
    .filter((p) => p.enabled === true && p.path && p.id !== PLUGIN_ID)
    .flatMap((p) => pluginHooks(p.path!, '.mode-code').map((h) => ({ ...h, event: `${h.event} (${p.id})` })));
  const all = [...others, ...fromPlugins];
  const jq = onPath('jq', d.env, d.platform).length > 0;
  const jqHooks = jq ? [] : all.filter((h) => h.type === 'command' && usesJq(hookLine(h))).map((h) => ({ event: h.event, command: short(h) }));
  // A prompt or agent hook asks a model by its very kind; a command hook does when it starts claude -p.
  const startsOwnModel = (h: HookEntry) => h.type === 'prompt' || h.type === 'agent' || (h.type === 'command' && startsModel(hookLine(h)));
  const modelHooks = all.filter(startsOwnModel).map((h) => ({ event: h.event, command: h.type === 'command' ? short(h) : `${h.type} hook` }));
  const projectish = (scope: string) => scope === 'project' || scope === 'local';
  // Only the project's shared file: the local one holds the person's own "don't ask again" answers.
  const loosened = [
    ...env.permissions
      .filter((p) => p.kind === 'allow' && p.scope === 'project' && broadRule(p.rule))
      .map((p) => ({ scope: p.scope, what: `allow ${p.rule}` })),
    ...env.settings.flatMap((s) => {
      if (s.scope !== 'project' || !s.json) return [];
      const out: { scope: string; what: string }[] = [];
      if (s.json.enableAllProjectMcpServers === true) out.push({ scope: s.scope, what: 'enableAllProjectMcpServers' });
      // The project approving its own .mcp.json servers: Claude Code would otherwise ask the person first.
      const approved = Array.isArray(s.json.enabledMcpjsonServers) ? s.json.enabledMcpjsonServers.filter((x) => typeof x === 'string') : [];
      if (approved.length) out.push({ scope: s.scope, what: `enabledMcpjsonServers ${approved.join(', ')}` });
      const mode = (s.json.permissions as { defaultMode?: unknown } | undefined)?.defaultMode;
      if (mode === 'bypassPermissions') out.push({ scope: s.scope, what: 'defaultMode bypassPermissions' });
      return out;
    }),
  ];
  const unpinnedMcp = env.mcp.filter((s) => unpinnedServer(s.target)).map((s) => ({ scope: s.scope, name: s.name, target: s.target.slice(0, 200) }));
  const git = (args: string[]) => runProgram('git', ['-C', d.cwd, ...args], { timeoutMs: 4000 });
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  const noGit = inside.ok ? inside.out !== 'true' : /not a git repository/i.test(inside.error ?? '') ? true : null;
  const tracked = (file: string) => noGit === false && git(['ls-files', '--error-unmatch', '--', file]).ok;
  const secrets = [...env.settings.map((s) => ({ path: s.path, scope: s.scope })), { path: d.globalConfig, scope: 'user' as const }].flatMap((s) => {
    const text = readText(s.path);
    if (!text) return [];
    const kinds = [
      ...new Set(
        scanSecrets(text)
          .filter((x) => x.confidence === 'high')
          .map((x) => x.kind),
      ),
    ];
    return kinds.length ? [{ path: s.path, kinds, tracked: projectish(s.scope) && tracked(s.path) }] : [];
  });
  const index = env.instructions.find((i) => i.kind === 'memory-index' && i.exists);
  // The settings' "env" is laid over the process's as Claude Code does it: user, project, local, then managed.
  const rank = { user: 0, project: 1, local: 2, managed: 3 } as const;
  const settingsEnv = [...env.settings]
    .sort((a, b) => rank[a.scope] - rank[b.scope])
    .flatMap((s) => {
      const e = s.json?.env;
      return e && typeof e === 'object' && !Array.isArray(e) ? Object.entries(e as Record<string, unknown>).map(([k, v]) => [k, String(v)] as const) : [];
    });
  const offs = toolSearchOff({ ...d.env, ...Object.fromEntries(settingsEnv) });
  return {
    deadHooks,
    jqHooks,
    modelHooks,
    loosened,
    unpinnedMcp,
    secrets,
    localTracked: tracked('.claude/settings.local.json'),
    noGit,
    memoryIndex: index
      ? { path: index.path, lines: index.lines, bytes: index.bytes, maxLines: index.limit?.lines ?? 200, maxBytes: index.limit?.bytes ?? 25_000 }
      : null,
    toolSearchOff: offs,
    autoMode: env.settings.filter((s) => (s.json?.permissions as { defaultMode?: unknown } | undefined)?.defaultMode === 'auto').map((s) => s.scope),
    skillsMissing: installed ? missingKeptSkills(l, d.config) : [],
  };
}

/** The memory store as the doctor reads it: settings, folder, git, Claude Code's setting, the newest sync record. */
function memoryStoreFacts(d: DoctorEnv): Facts['memoryStore'] {
  const s = d.config.memory.store;
  if (!s) return null;
  const exists = existsSync(s.dir);
  const inside = exists ? runProgram('git', ['-C', s.dir, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 4000 }) : null;
  const origin = exists ? runProgram('git', ['-C', s.dir, 'config', '--get', 'remote.origin.url'], { timeoutMs: 4000 }) : null;
  const setting = readMemorySetting(d.claudeDir);
  return {
    place: s.place,
    dir: s.dir,
    exists,
    isRepo: !!inside?.ok && inside.out === 'true',
    git: s.git,
    remote: s.remote,
    hasOrigin: !!origin?.ok && origin.out.length > 0,
    setting,
    inUse: !!setting && pathKey(toolPath(setting), d.platform) === pathKey(toolPath(s.dir), d.platform),
    last: newestRecord((['mod', 'hook', 'cli'] as const).map((w) => parseSyncRecord(readText(memorySyncFile(d.layout, w))))),
  };
}

/** Sync across computers as the doctor reads it: the setting, the shared place, git there, the last sync, what waits. */
function syncFacts(d: DoctorEnv): Facts['sync'] {
  const s = d.config.sync;
  if (!s) return null;
  const exists = existsSync(s.dir);
  const inside = exists && s.place === 'github' ? runProgram('git', ['-C', s.dir, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 4000 }) : null;
  const origin = exists && s.place === 'github' ? runProgram('git', ['-C', s.dir, 'config', '--get', 'remote.origin.url'], { timeoutMs: 4000 }) : null;
  return {
    place: s.place,
    dir: s.dir,
    name: s.machine.name,
    exists,
    isRepo: !!inside?.ok && inside.out === 'true',
    hasOrigin: !!origin?.ok && origin.out.length > 0,
    others: machinesIn(s.dir).filter((m) => m.id !== s.machine.id).length,
    last: lastShared(d.layout),
    pending: mergedConfig(d.config, d.layout).pending.map((p) => p.key),
  };
}

function wants(d: DoctorEnv, what: Measure): boolean {
  return d.measure?.[what] ?? !d.quick;
}

/** Runs a program with fixed arguments, no shell, a time limit, and no window. */
export function runProgram(cmd: string, args: readonly string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}): ProgramRun {
  const started = Date.now();
  try {
    const r = spawnSync(cmd, [...args], {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 5000,
      windowsHide: true,
      env: opts.env ?? process.env,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = (r.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (r.error) return { ok: false, out, error: r.error.message, ms: Date.now() - started };
    const err = (r.stderr ?? '').trim();
    return { ok: r.status === 0, out, ...(r.status === 0 ? {} : { error: err.split(/\r?\n/)[0] || `exit ${r.status}` }), ms: Date.now() - started };
  } catch (err) {
    return { ok: false, out: '', error: (err as Error).message, ms: Date.now() - started };
  }
}

export function sha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function pathValue(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return key ? (env[key] ?? '') : '';
}

/** Every file named `name` (with the platform's executable extensions) on PATH, in PATH order. */
export function onPath(name: string, env: NodeJS.ProcessEnv, platform: Platform): string[] {
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dir of pathValue(env).split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir.replace(/^"|"$/g, ''), name + ext);
      const key = pathKey(toolPath(p), platform);
      if (seen.has(key)) continue;
      try {
        if (statSync(p).isFile()) {
          seen.add(key);
          out.push(toolPath(p));
          break; // one entry per folder: the one the shell would pick
        }
      } catch {
        /* not here */
      }
    }
  }
  return out;
}

/** The position V8 reports for a JSON error, as "line L, column C", when the message carries it. */
function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    const msg = (err as Error).message;
    const head = (msg.split(/\s*\(/)[0] ?? msg).replace(/ in JSON at position \d+.*/, '');
    const lc = /line (\d+) column (\d+)/.exec(msg);
    if (lc) return `${head} (line ${lc[1]}, column ${lc[2]})`;
    const pos = /position (\d+)/.exec(msg);
    if (pos) {
      const before = text.slice(0, Number(pos[1]));
      return `${head} (line ${before.split('\n').length}, column ${before.length - before.lastIndexOf('\n')})`;
    }
    return msg;
  }
}

function settingsFacts(scope: SettingsFileFacts['scope'], path: string): SettingsFileFacts {
  const text = readText(path);
  if (text === null) return { scope, path, exists: false, error: null, disableAllHooks: false, allowManagedHooksOnly: false, pluginEnabled: null };
  const error = text.trim() === '' ? null : jsonError(text);
  let json: Record<string, unknown> = {};
  if (!error && text.trim()) {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) json = v as Record<string, unknown>;
  }
  const enabled = json.enabledPlugins && typeof json.enabledPlugins === 'object' ? (json.enabledPlugins as Record<string, unknown>)[PLUGIN_ID] : undefined;
  return {
    scope,
    path,
    exists: true,
    error,
    disableAllHooks: json.disableAllHooks === true,
    allowManagedHooksOnly: json.allowManagedHooksOnly === true,
    pluginEnabled: typeof enabled === 'boolean' ? enabled : null,
  };
}

/** Files under `dir`, relative, with forward slashes. */
function filesUnder(dir: string, depth = 0): string[] {
  if (depth > 8) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, depth + 1).map((x) => `${e.name}/${x}`);
    return e.isFile() ? [e.name] : [];
  });
}

function pluginFiles(dist: string, installed: string): Facts['pluginFiles'] {
  const shippedDir = join(dist, 'plugin');
  const shipped = existsSync(join(shippedDir, '.claude-plugin', 'plugin.json'));
  if (!shipped) return { dir: installed, missing: [], different: [], shipped: false };
  const missing: string[] = [];
  const different: string[] = [];
  for (const f of filesUnder(shippedDir)) {
    const target = join(installed, f);
    if (!existsSync(target)) missing.push(f);
    else if (sha256(target) !== sha256(join(shippedDir, f))) different.push(f);
  }
  return { dir: installed, missing, different, shipped: true };
}

function modSeen(l: Layout): Facts['modSeen'] {
  let best: { at: number; version: string } | null = null;
  let names: string[] = [];
  try {
    names = readdirSync(l.sessionsDir).filter((n) => n.endsWith('.mod.json'));
  } catch {
    return null;
  }
  const recent = names
    .map((n) => {
      try {
        return { n, t: statSync(join(l.sessionsDir, n)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { n: string; t: number } => x !== null)
    .sort((a, b) => b.t - a.t)
    .slice(0, 20);
  for (const x of recent) {
    const s = parseModState(readText(join(l.sessionsDir, x.n)));
    if (s && (!best || s.aliveAt > best.at)) best = { at: s.aliveAt, version: s.modVersion };
  }
  return best;
}

/** The 8.3 short form of each path, asked of Windows itself; paths without one are left out. */
function shortForms(paths: readonly string[]): { long: string; short: string }[] {
  const existing = paths.filter((p) => existsSync(p));
  if (!existing.length) return [];
  const list = existing.map((p) => `"${p.replace(/\//g, '\\')}"`).join(' ');
  try {
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `for %I in (${list}) do @echo %~sI`], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    const lines = (r.stdout ?? '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    return existing.flatMap((p, i) => {
      const s = lines[i];
      return s && pathKey(toolPath(s), 'win32') !== pathKey(p, 'win32') ? [{ long: p, short: toolPath(s) }] : [];
    });
  } catch {
    return [];
  }
}

/** The Git Bash Claude Code runs on Windows: the one CLAUDE_CODE_GIT_BASH_PATH names, else the one beside git. */
export function locateGitBash(env: NodeJS.ProcessEnv, platform: Platform): string | null {
  if (env.CLAUDE_CODE_GIT_BASH_PATH && existsSync(env.CLAUDE_CODE_GIT_BASH_PATH)) return toolPath(env.CLAUDE_CODE_GIT_BASH_PATH);
  for (const git of onPath('git', env, platform)) {
    // C:/Program Files/Git/cmd/git.exe or …/mingw64/bin/git.exe: bash.exe is in <Git>/bin.
    for (const up of [dirname(dirname(git)), dirname(dirname(dirname(git)))]) {
      const bash = join(up, 'bin', 'bash.exe');
      if (existsSync(bash)) return toolPath(bash);
    }
  }
  return null;
}

function dataFacts(l: Layout, platform: Platform, installed: boolean, now: number): Facts['data'] {
  const out: Facts['data'] = {
    exists: existsSync(l.root),
    writable: false,
    renameWorks: false,
    freeBytes: null,
    caseInsensitive: null,
    staleTemp: [],
    staleStates: 0,
    looseModes: [],
    missingDirs: [],
  };
  if (!out.exists) return out;
  const name = `.doctor-probe-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
  const probe = join(l.root, name);
  try {
    writeFileSync(probe + '.a', 'probe');
    out.writable = true;
    // The same name in capitals finds the file only where the file system ignores case.
    out.caseInsensitive = existsSync(join(l.root, `${name}.a`.toUpperCase()));
    renameSync(probe + '.a', probe + '.b');
    out.renameWorks = existsSync(probe + '.b');
  } catch {
    /* recorded as not writable */
  } finally {
    rmSync(probe + '.a', { force: true });
    rmSync(probe + '.b', { force: true });
  }
  try {
    const s = statfsSync(l.root);
    out.freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch {
    out.freeBytes = null;
  }
  // Temporary files an interrupted atomic write left behind (name.<pid>.<hex>.tmp), older than an hour.
  for (const f of filesUnder(l.root).filter((x) => /\.\d+\.[0-9a-f]{8}\.tmp$/.test(x) && !x.startsWith('marketplace/'))) {
    try {
      if (now - statSync(join(l.root, f)).mtimeMs > 3600_000) out.staleTemp.push(f);
    } catch {
      /* gone meanwhile */
    }
  }
  try {
    for (const n of readdirSync(l.sessionsDir))
      if (/\.(?:mod|hook)\.json$/.test(n) && now - statSync(join(l.sessionsDir, n)).mtimeMs > 30 * 86400_000) out.staleStates++;
  } catch {
    /* no sessions yet */
  }
  if (platform !== 'win32')
    for (const p of [l.root, l.config, l.stateDir]) {
      try {
        const mode = statSync(p).mode & 0o777;
        if (mode & 0o022) out.looseModes.push(`${relative(dirname(l.root), p).replace(/\\/g, '/')} ${mode.toString(8)}`);
      } catch {
        /* missing: another check reports it */
      }
    }
  if (installed)
    for (const d of [l.stateDir, l.sessionsDir, l.eventsDir, l.installDir, l.backupsDir, join(l.root, 'bin')]) if (!existsSync(d)) out.missingDirs.push(d);
  return out;
}

async function indexFacts(l: Layout): Promise<Facts['index']> {
  if (!existsSync(l.index)) return { exists: false, ok: null, detail: null, sessions: null };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(l.index, { readOnly: true });
    try {
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      const verdict = check ? String(Object.values(check)[0]) : 'no answer';
      let sessions: number | null = null;
      try {
        sessions = Number((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n);
      } catch {
        sessions = null;
      }
      return { exists: true, ok: verdict === 'ok', detail: verdict === 'ok' ? null : verdict, sessions };
    } finally {
      db.close();
    }
  } catch (err) {
    return { exists: true, ok: false, detail: (err as Error).message, sessions: null };
  }
}

function gitFacts(config: Config, cwd: string, quick: boolean): Facts['git'] {
  const v = runProgram('git', ['--version'], { timeoutMs: 5000 });
  const version = v.ok ? (/(\d+\.\d+\.\d+)/.exec(v.out)?.[1] ?? v.out) : null;
  const projects = quick
    ? []
    : config.projects
        .filter((p) => p.path)
        .slice(0, 50)
        .map((p) => {
          const path = toolPath(p.path!, cwd);
          if (!existsSync(path)) return { path, exists: false, readable: false, error: null, notRepo: false };
          if (!version) return { path, exists: true, readable: false, error: 'git not found', notRepo: false };
          const r = runProgram('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
            timeoutMs: 4000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
          });
          const notRepo = !r.ok && /not a git repository/i.test(r.error ?? '');
          return { path, exists: true, readable: r.ok && r.out === 'true', error: r.ok ? null : (r.error ?? null), notRepo };
        });
  return { version, projects };
}

function transcriptFacts(claudeDir: string, now: number): Facts['transcripts'] {
  const root = join(claudeDir, 'projects');
  const files: { p: string; t: number }[] = [];
  const walk = (d: string, depth: number) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const t = statSync(p).mtimeMs;
          if (now - t < 30 * 86400_000) files.push({ p, t });
        } catch {
          /* gone */
        }
      }
    }
  };
  walk(root, 0);
  const newest = files.sort((a, b) => b.t - a.t).slice(0, 20);
  if (!newest.length) return { files: 0, shape: null, badSessionIds: [] };
  const lines = newest.flatMap((f) => readTail(f.p, 256 * 1024));
  const shape = transcriptShape(lines);
  return { files: newest.length, shape, badSessionIds: shape.sessionIds.filter((id) => safeId(id) === null).slice(0, 5) };
}

/** Runs the installed hook program on one call and reads its verdict. */
export function hookVerdict(node: string, hook: string, input: object, env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (v: string) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const child = spawn(node, [hook, 'PreToolUse'], { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const timer = setTimeout(() => {
        child.kill();
        done('timeout');
      }, 20_000);
      child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
      child.on('error', (err) => done(`error: ${err.message}`));
      // A hook program that ends before it reads the call closes the pipe under the write (EPIPE). Unheard, that
      // error ends the doctor itself; the verdict comes from how the program ended.
      child.stdin.on('error', () => {});
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return done(`exit ${code}`);
        const text = out.trim();
        if (!text) return done('allow');
        try {
          const o = JSON.parse(text) as { hookSpecificOutput?: { permissionDecision?: string; additionalContext?: string } };
          done(o.hookSpecificOutput?.permissionDecision ?? (o.hookSpecificOutput?.additionalContext ? 'warn' : 'allow'));
        } catch {
          done('unreadable');
        }
      });
      child.stdin.end(JSON.stringify(input));
    } catch (err) {
      done(`error: ${(err as Error).message}`);
    }
  });
}

/**
 * The installed hook program and this build, asked the same questions on this machine: the belt samples
 * with this machine's real folders. They must agree; a hook that answers differently is outdated or altered.
 */
async function hookAgreement(d: DoctorEnv, node: string, hook: string): Promise<Facts['hookAgreement']> {
  const sandbox = join(tmpdir(), `tc-doctor-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  try {
    const places: SamplePlaces = {
      home: d.home,
      project: toolPath(sandbox),
      data: d.layout.root,
      claude: d.claudeDir,
      temp: toolPath(tmpdir()),
      outside: joinPath(d.home, `.tc-doctor-outside-${process.pid}`),
    };
    const env: NodeJS.ProcessEnv = { ...d.env, MODE_CODE_HOME: d.layout.root, CLAUDE_PROJECT_DIR: places.project };
    for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
    const ctx = beltContext({ cwd: places.project, projectDir: places.project, config: d.config, layout: d.layout, lang: d.lang, env });
    const samples = samplesFor(d.platform).filter((s) => s.tool !== 'Read');
    const differences: { call: string; mine: string; theirs: string }[] = [];
    let agreed = 0;
    const queue = [...samples];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const input = fillSample(s, places);
        const mine = (await evaluateToolCall(s.tool, input, ctx)).verdict;
        const theirs = await hookVerdict(
          node,
          hook,
          {
            session_id: SELF_TEST_SESSION,
            cwd: places.project,
            hook_event_name: 'PreToolUse',
            permission_mode: 'default',
            tool_name: s.tool,
            tool_use_id: `doctor_${s.name.replace(/\W+/g, '_')}`,
            tool_input: input,
          },
          env,
          tmpdir(),
        );
        if (theirs === mine) agreed++;
        else differences.push({ call: `${s.tool} ${input.command ?? input.file_path ?? ''}`.trim(), mine, theirs });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, samples.length) }, worker));
    return { samples: samples.length, agreed, differences, error: null };
  } catch (err) {
    return { samples: 0, agreed: 0, differences: [], error: (err as Error).message };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** Measures everything the checks look at. */
export async function gatherFacts(d0: DoctorEnv, now = Date.now()): Promise<Facts> {
  const l = d0.layout;
  // The settings are read again on every measurement: a repair may have just rewritten them.
  const parsed = existsSync(l.config) ? parseConfig(readText(l.config)) : { config: d0.config, problems: d0.problems };
  const d: DoctorEnv = { ...d0, config: parsed.config, problems: parsed.problems };
  const manifest = readManifest(l);
  const hookFile = hookProgram(l).replace(/\\/g, '/');
  const claudeVersion = d.claude.version();
  const env = readClaudeEnv(d.cwd, {
    dir: d.claudeDir,
    globalConfig: d.globalConfig,
    managed: d.managedSettings,
    version: claudeVersion,
    ourMarker: `${l.root.replace(/\\/g, '/')}/bin/hook.mjs`,
  });
  const memory = memoryDirs(d.config, d.cwd);
  const roots = [l.root, d.claudeDir, joinPath(d.claudeDir, 'settings.json'), joinPath(d.claudeDir, 'settings.local.json'), d.globalConfig, ...memory];

  const hookNodePath = manifest?.node ?? null;
  let hookNode: Facts['hookNode'] = null;
  if (hookNodePath) {
    const exists = existsSync(hookNodePath);
    const v = exists ? runProgram(hookNodePath, ['--version'], { timeoutMs: 8000 }) : null;
    hookNode = { path: hookNodePath, exists, version: v?.ok ? v.out.replace(/^v/, '') : null };
  }

  let shortNames: Facts['shortNames'] = [];
  if (d.platform === 'win32' && wants(d, 'shortNames')) {
    // Judged by the belt both ways: deleting a folder, or writing a file, by its short and its long name
    // must get the same answer. (Two short names can stand for either of two similar long names; what
    // matters is that both are protected alike.)
    const ctx = beltContext({ cwd: d.cwd, config: d.config, layout: l, lang: d.lang, env: d.env });
    const verdict = async (p: string, file: boolean) => {
      const r = file
        ? await evaluateToolCall('Write', { file_path: p, content: '{}' }, ctx)
        : await evaluateToolCall('Bash', { command: `rm -rf "${p}"` }, ctx);
      return [r.verdict, ...new Set(r.findings.map((f) => f.rule))].sort().join(' ');
    };
    for (const x of shortForms(roots)) {
      let file = false;
      try {
        file = statSync(x.long).isFile();
      } catch {
        file = false;
      }
      shortNames.push({ ...x, recognised: (await verdict(x.short, file)) === (await verdict(x.long, file)) });
    }
  }

  let gitBash: Facts['gitBash'] = null;
  if (d.platform === 'win32' && wants(d, 'shells')) {
    const bash = locateGitBash(d.env, d.platform);
    const expectedTmp = joinPath(d.home, 'AppData/Local/Temp');
    if (!bash) gitBash = { path: null, tmp: null, expectedTmp };
    else {
      const r = runProgram(bash, ['-c', 'cygpath -w /tmp'], { timeoutMs: 8000 });
      gitBash = { path: bash, tmp: r.ok && r.out ? toolPath(r.out) : null, expectedTmp, ...(r.ok ? {} : { error: r.error ?? 'failed' }) };
    }
  }

  let powershell: Facts['powershell'] = null;
  if (wants(d, 'shells') && (d.platform === 'win32' || onPath('pwsh', d.env, d.platform).length)) {
    const r = runProgram('pwsh', ['-v'], { timeoutMs: 8000 });
    powershell = {
      pwsh: r.ok ? (/(\d+\.\d+\.\d+)/.exec(r.out)?.[1] ?? r.out) : null,
      windowsPowerShell: d.platform === 'win32' && existsSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
    };
  }

  let posixShell: Facts['posixShell'] = null;
  if (d.platform !== 'win32' && wants(d, 'shells')) {
    const shell = d.env.SHELL ?? null;
    const v = shell ? runProgram(shell, ['--version'], { timeoutMs: 4000 }) : null;
    posixShell = { shell, version: v?.ok ? v.out : null };
  }

  let codePage: number | null = null;
  if (d.platform === 'win32' && wants(d, 'shells')) {
    const r = runProgram('chcp.com', [], { timeoutMs: 3000 });
    codePage = r.ok ? Number(/(\d+)/.exec(r.out)?.[1] ?? NaN) || null : null;
  }

  let intl = 'und';
  try {
    intl = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    intl = 'und';
  }

  const quotaRaw = readJson<{ windows?: unknown; measuredAt?: unknown }>(l.quota);
  const plugins = wants(d, 'plugins') ? pluginsVia(d.claude) : null;
  const prev = findPrevious(l);
  const hookExists = existsSync(hookFile);
  const shippedHook = join(d.distDir, 'hook.mjs');
  const node = hookNode?.exists ? hookNode.path : process.execPath;

  return {
    measuredAt: now,
    platform: d.platform,
    arch: arch(),
    osRelease: release(),
    appVersion: APP_VERSION,
    dataDir: l.root,
    claudeDir: d.claudeDir,
    claudeDirFromEnv: !!d.env.CLAUDE_CONFIG_DIR,
    underAgent: underAgent(d.env),
    node: { version: process.versions.node, execPath: toolPath(process.execPath), sqlite: isBuiltin('node:sqlite') },
    hookNode,
    claude: { installs: onPath('claude', d.env, d.platform), version: claudeVersion },
    settings: env.settings.map((s) => settingsFacts(s.scope, s.path)),
    hooks: env.hooks.map((h) => ({ ...h, ours: isOurHook({ command: h.command, args: h.args }, l.root) })),
    plugins,
    manifest,
    previous: prev
      ? {
          id: prev.id,
          name: prev.name,
          root: prev.root,
          installed: prev.manifest !== null,
          hooks: env.hooks.filter((h) => isOurHook({ command: h.command, args: h.args }, prev.root)).length,
          plugin: plugins ? plugins.some((p) => p.id === previousPlugin(prev).id) : null,
        }
      : null,
    previousNames: PREVIOUS_NAMES.map((n) => n.name),
    hookProgram: { path: hookFile, exists: hookExists, hash: hookExists ? sha256(hookFile) : null, shippedHash: sha256(shippedHook) },
    pluginFiles: pluginFiles(d.distDir, l.pluginDir),
    controlCenter: {
      recorded: manifest?.cli ?? null,
      exists: !!manifest?.cli && existsSync(manifest.cli),
      shipped: cliProgram(d.distDir),
    },
    modSeen: modSeen(l),
    aliases: protectedAliases(roots),
    shortNames,
    memoryDirs: memory.map((p) => {
      const exists = existsSync(p);
      const r = exists ? runProgram('git', ['-C', p, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 4000 }) : null;
      return { path: p, exists, isRepo: !!r?.ok && r.out === 'true' };
    }),
    memorySetting: readMemorySetting(d.claudeDir),
    memoryStore: memoryStoreFacts(d),
    sync: syncFacts(d),
    gitBash,
    powershell,
    posixShell,
    terminal: {
      tty: !!process.stdout.isTTY,
      columns: process.stdout.columns ?? null,
      term: d.env.TERM ?? null,
      program: d.env.TERM_PROGRAM ?? (d.env.WT_SESSION ? 'Windows Terminal' : null),
      codePage,
      noColor: d.env.NO_COLOR !== undefined && d.env.NO_COLOR !== '',
    },
    locale: { intl, lang: d.env.LC_ALL ?? d.env.LC_MESSAGES ?? d.env.LANG ?? null, chosen: d.lang },
    data: dataFacts(l, d.platform, manifest !== null, now),
    config: { problems: d.problems, exists: existsSync(l.config) },
    index: await indexFacts(l),
    quota: {
      exists: quotaRaw !== null || existsSync(l.quota),
      valid: !!quotaRaw && Array.isArray(quotaRaw.windows) && typeof quotaRaw.measuredAt === 'number',
      measuredAt: quotaRaw && typeof quotaRaw.measuredAt === 'number' ? quotaRaw.measuredAt : null,
    },
    git: gitFacts(d.config, d.cwd, !wants(d, 'gitProjects')),
    transcripts: wants(d, 'transcripts') ? transcriptFacts(d.claudeDir, now) : { files: 0, shape: null, badSessionIds: [] },
    selftest: await runAllSuites(),
    hookAgreement: !wants(d, 'agreement') || !hookExists || !realPathOf(node) ? null : await hookAgreement(d, node, hookFile),
    update: { check: d.config.update.check, current: APP_VERSION, state: readUpdateState(l) },
    setup: setupFacts(d, env, manifest !== null, plugins),
  };
}

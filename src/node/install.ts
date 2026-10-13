// SPDX-License-Identifier: Apache-2.0
/**
 * Installing and removing the tool. Every change is planned first (so it can be shown and approved),
 * then applied, and recorded in a manifest: removal undoes exactly what the manifest lists and nothing
 * else. The person's Claude Code settings file is backed up before it is touched, and the tool never
 * writes a setting without listing it.
 *
 * What an installation consists of:
 *   1. the data folder with the hook program (bin/hook.mjs) and a local plugin marketplace;
 *   2. the plugin (the in-process mod) installed into Claude Code from that marketplace, user scope;
 *   3. the safety-net hooks added to the user settings file (exec form, absolute node, block on failure);
 *   4. a settings file for the tool itself, created only when there is none.
 *
 * An installation made under an earlier name of the tool (PREVIOUS_NAMES) is moved by the same command:
 * its data is copied here, its hooks are swapped for these in the same write that adds them, and its
 * plugin, marketplace and folder are removed only after this installation tested itself.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ID,
  APP_VERSION,
  MARKETPLACE_NAME,
  MIN_CLAUDE_CODE_FOR_HOOKS,
  MIN_CLAUDE_CODE_FOR_MODS,
  PLUGIN_ID,
  PLUGIN_NAME,
  SELF_TEST_SESSION,
} from '../core/app.js';
import { cloneDefaults, serializeConfig, type Config } from '../core/config.js';
import { compareVersions } from '../core/version.js';
import type { Layout } from '../core/layout.js';
import { copyPrevious, findPrevious, movedMemorySetting, previousPlugin, type PreviousInstall } from './previous.js';
import { ensureDir, readJson, readText, writeAtomic, writeJsonAtomic } from './fsx.js';
import { claudeDir } from './env.js';
import { claudeVersion, realClaude, type ClaudeRunner } from './claude-env.js';

export const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart'] as const;
import { BELT_MATCHER } from '../core/belt/tools.js';
export { BELT_MATCHER };

export interface Manifest {
  v: 1;
  app: string;
  version: string;
  installedAt: number;
  node: string;
  dataDir: string;
  settingsFile: string;
  settingsBackup: string | null;
  /**
   * The sha256 of the hook program as installed, so the doctor can tell a program from another build of
   * the same version (a reinstall fixes it) from one changed after installation. Absent before 0.1.0.
   */
  hookHash?: string;
  /**
   * The command-line program of the build that installed, absolute: what `/0` opens beside a session, run by
   * `node`. Absent before 0.1.0, and when the build had none; the doctor records it then.
   */
  cli?: string;
  /** The exact hook groups added, per event, so removal takes out these and nothing else. */
  hooks: Record<string, unknown[]>;
  plugin: { id: string; installed: boolean; marketplaceDir: string };
  createdConfig: boolean;
  /** The installation under an earlier name this one replaced: where it was, and whether its folder is gone. */
  previous?: { id: string; root: string; removed: boolean };
}

export type StepKind = 'migrate' | 'data-folder' | 'hook-program' | 'marketplace' | 'plugin' | 'settings-hooks' | 'config' | 'self-test' | 'retire-previous';

export interface PlanStep {
  kind: StepKind;
  /** Paths or ids the step touches, shown to the person. */
  targets: string[];
  /** The step changes nothing because it is already in place. */
  done: boolean;
}

export interface InstallPlan {
  steps: PlanStep[];
  /** Problems that stop the installation, as message keys with parameters. */
  blockers: { key: 'install.block.noClaude' | 'install.block.oldClaude' | 'install.block.noBuild' | 'install.block.agent'; params?: Record<string, string> }[];
  /** Things that work with reduced features. */
  warnings: { key: 'install.warn.noMods' | 'install.warn.hooksDisabled' | 'install.warn.otherVersion'; params?: Record<string, string> }[];
  claude: string | null;
  node: string;
  settingsFile: string;
  hookCommand: { command: string; args: string[] };
  /** An installation, or only the data, under an earlier name, which this installation takes over. */
  previous: PreviousInstall | null;
}

/** Where the built programs are: next to this bundle in dist/, or in dist/ beside src/ when running from source. */
export function distDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const d of [here, join(here, '..', '..', 'dist')]) if (existsSync(join(d, 'hook.mjs')) && existsSync(join(d, 'plugin'))) return d;
  return here;
}

/**
 * The Node.js the hooks will run, by a path that outlives this shell: version managers hand out per-shell
 * links (fnm's "multishells") that disappear, so the link is resolved to the installation it points at.
 */
export function stableNodePath(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

/** The command-line program beside the built hook and plugin, with forward slashes; null when the build has none. */
export function cliProgram(dist: string): string | null {
  const p = join(dist, 'cli.mjs');
  return existsSync(p) ? p.replace(/\\/g, '/') : null;
}

export function hookProgram(l: Layout): string {
  return join(l.root, 'bin', 'hook.mjs');
}

/** The sha256 of a file, or undefined when it cannot be read. */
export function fileHash(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return undefined;
  }
}

/** The hook groups the installer adds, for one data folder and one node binary. */
export function hookGroups(node: string, hook: string): Record<string, unknown[]> {
  const entry = (event: string, timeout: number, block: boolean) => ({
    type: 'command',
    command: node,
    args: [hook, event],
    timeout,
    ...(block ? { onFailure: 'block' } : {}),
  });
  return {
    PreToolUse: [{ matcher: BELT_MATCHER, hooks: [entry('PreToolUse', 15, true)] }],
    UserPromptSubmit: [{ hooks: [entry('UserPromptSubmit', 10, false)] }],
    Stop: [{ hooks: [entry('Stop', 15, false)] }],
    SessionStart: [{ hooks: [entry('SessionStart', 10, false)] }],
  };
}

/** True for a hook entry that runs this tool's hook program from `dataDir`. */
export function isOurHook(h: unknown, dataDir: string): boolean {
  if (!h || typeof h !== 'object') return false;
  const o = h as Record<string, unknown>;
  const text = [o.command, ...(Array.isArray(o.args) ? o.args : [])].map(String).join(' ').replace(/\\/g, '/').toLowerCase();
  return text.includes(`${dataDir.replace(/\\/g, '/').toLowerCase()}/bin/hook.mjs`);
}

/** Settings with our hook groups added (any earlier copy of ours replaced). Pure. */
export function withOurHooks(settings: Record<string, unknown>, groups: Record<string, unknown[]>, dataDir: string): Record<string, unknown> {
  const cleaned = withoutOurHooks(settings, dataDir);
  const hooks = { ...((cleaned.hooks as Record<string, unknown[]> | undefined) ?? {}) };
  for (const [event, list] of Object.entries(groups)) hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ...list];
  return { ...cleaned, hooks };
}

/** Settings with every hook entry of ours removed, and groups or events left empty by that removed too. Pure. */
export function withoutOurHooks(settings: Record<string, unknown>, dataDir: string): Record<string, unknown> {
  const src = settings.hooks;
  if (!src || typeof src !== 'object') return settings;
  const hooks: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(src as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups as unknown[];
      continue;
    }
    const kept = groups.flatMap((g) => {
      if (!g || typeof g !== 'object' || !Array.isArray((g as Record<string, unknown>).hooks)) return [g];
      const list = ((g as Record<string, unknown>).hooks as unknown[]).filter((h) => !isOurHook(h, dataDir));
      if (list.length === 0) return [];
      return [{ ...(g as Record<string, unknown>), hooks: list }];
    });
    if (kept.length) hooks[event] = kept;
  }
  const out = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete (out as Record<string, unknown>).hooks;
  return out;
}

/**
 * Settings with an earlier installation's hooks taken out and, when its data is copied here, Claude Code's
 * memory folder moved with it (movedMemorySetting). Pure.
 */
export function withoutPrevious(settings: Record<string, unknown>, prev: PreviousInstall | null, root: string): Record<string, unknown> {
  return prev ? movedMemorySetting(withoutOurHooks(settings, prev.root), prev, root) : settings;
}

/** Running from inside a Claude Code session (an agent's shell) or without a person at a terminal. */
export function underAgent(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDECODE === '1' || !!env.CLAUDE_CODE_ENTRYPOINT;
}

export function planInstall(
  l: Layout,
  opts: { node?: string; claude?: string | null; claudeDir?: string; env?: NodeJS.ProcessEnv; previousNames?: readonly { id: string; name: string }[] } = {},
): InstallPlan {
  const node = (opts.node ?? stableNodePath()).replace(/\\/g, '/');
  const settingsFile = join(opts.claudeDir ?? claudeDir(), 'settings.json');
  const hook = hookProgram(l).replace(/\\/g, '/');
  const plan: InstallPlan = {
    steps: [],
    blockers: [],
    warnings: [],
    claude: null,
    node,
    settingsFile,
    hookCommand: { command: node, args: [hook, '<Event>'] },
    previous: findPrevious(l, opts.previousNames),
  };
  const prev = plan.previous;
  const dist = distDir();
  if (!existsSync(join(dist, 'hook.mjs')) || !existsSync(join(dist, 'plugin', '.claude-plugin', 'plugin.json')))
    plan.blockers.push({ key: 'install.block.noBuild', params: { dir: dist } });
  const claude = opts.claude !== undefined ? opts.claude : claudeVersion();
  plan.claude = claude;
  if (!claude) plan.blockers.push({ key: 'install.block.noClaude' });
  else if (compareVersions(claude, MIN_CLAUDE_CODE_FOR_HOOKS) < 0)
    plan.blockers.push({ key: 'install.block.oldClaude', params: { have: claude, need: MIN_CLAUDE_CODE_FOR_HOOKS } });
  else if (compareVersions(claude, MIN_CLAUDE_CODE_FOR_MODS) < 0)
    plan.warnings.push({ key: 'install.warn.noMods', params: { need: MIN_CLAUDE_CODE_FOR_MODS } });
  if (underAgent(opts.env)) plan.blockers.push({ key: 'install.block.agent' });

  const settings = readJson<Record<string, unknown>>(settingsFile) ?? {};
  if (settings.disableAllHooks === true) plan.warnings.push({ key: 'install.warn.hooksDisabled', params: { file: settingsFile } });
  const manifest = readManifest(l);
  if (manifest && manifest.version !== APP_VERSION)
    plan.warnings.push({ key: 'install.warn.otherVersion', params: { have: manifest.version, now: APP_VERSION } });

  const groups = hookGroups(node, hook);
  const current = JSON.stringify(withOurHooks(withoutPrevious(settings, prev, l.root), groups, l.root));
  if (prev?.copy) plan.steps.push({ kind: 'migrate', targets: [prev.root, l.root], done: false });
  plan.steps.push({ kind: 'data-folder', targets: [l.root], done: existsSync(l.root) });
  plan.steps.push({ kind: 'hook-program', targets: [hook], done: false });
  plan.steps.push({ kind: 'marketplace', targets: [l.marketplace], done: false });
  plan.steps.push({ kind: 'plugin', targets: [PLUGIN_ID], done: false });
  plan.steps.push({ kind: 'settings-hooks', targets: [settingsFile, ...HOOK_EVENTS], done: current === JSON.stringify(settings) });
  plan.steps.push({ kind: 'config', targets: [l.config], done: existsSync(l.config) || (!!prev?.copy && existsSync(join(prev.root, 'config.json'))) });
  plan.steps.push({ kind: 'self-test', targets: [hook], done: false });
  if (prev) plan.steps.push({ kind: 'retire-previous', targets: [previousPlugin(prev).id, ...(prev.copy ? [prev.root] : [])], done: false });
  return plan;
}

export interface ApplyResult {
  ok: boolean;
  steps: { kind: StepKind; ok: boolean; detail?: string }[];
  manifest: Manifest | null;
}

function claudeCli(runner: ClaudeRunner, args: string[]): { ok: boolean; out: string } {
  const r = runner.run(args, 120_000);
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

/** Runs the installed hook on two harmless samples: a read must pass, a write into the data folder must be refused. */
export function selfTest(node: string, hook: string, l: Layout): { ok: boolean; detail: string } {
  const run = (input: object) => {
    const r = spawnSync(node, [hook, 'PreToolUse'], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
      env: { ...process.env, TERMINAL_CODE_HOME: l.root },
    });
    return { status: r.status, out: (r.stdout ?? '').trim() };
  };
  const base = { session_id: SELF_TEST_SESSION, cwd: l.root, hook_event_name: 'PreToolUse', permission_mode: 'default' };
  const read = run({ ...base, tool_name: 'Read', tool_use_id: 'self_test_read', tool_input: { file_path: l.config } });
  if (read.status !== 0 || read.out !== '') return { ok: false, detail: `read sample: exit ${read.status}, output ${read.out.slice(0, 200)}` };
  const write = run({ ...base, tool_name: 'Write', tool_use_id: 'self_test_write', tool_input: { file_path: join(l.root, 'self-test.txt'), content: 'x' } });
  if (write.status !== 0 || !write.out.includes('"deny"')) return { ok: false, detail: `protected-write sample was not refused: exit ${write.status}` };
  return { ok: true, detail: 'read passed, protected write refused' };
}

export function applyInstall(l: Layout, plan: InstallPlan, opts: { config?: Partial<Config>; runner?: ClaudeRunner } = {}): ApplyResult {
  const runner = opts.runner ?? realClaude;
  const steps: ApplyResult['steps'] = [];
  const dist = distDir();
  const hook = hookProgram(l);
  const step = (kind: StepKind, f: () => string | void): boolean => {
    try {
      const detail = f();
      steps.push({ kind, ok: true, ...(detail ? { detail } : {}) });
      return true;
    } catch (err) {
      steps.push({ kind, ok: false, detail: (err as Error).message });
      return false;
    }
  };
  let ok = true;
  const prev = plan.previous;
  if (prev?.copy)
    ok &&= step('migrate', () => {
      const r = copyPrevious(prev, l);
      return `${r.files} files, ${r.paths} paths pointed here`;
    });
  ok &&= step('data-folder', () => {
    for (const d of [l.root, l.stateDir, l.sessionsDir, l.eventsDir, l.installDir, l.backupsDir, join(l.root, 'bin')]) ensureDir(d);
  });
  ok &&= step('hook-program', () => {
    cpSync(join(dist, 'hook.mjs'), hook);
  });
  ok &&= step('marketplace', () => writeMarketplace(l, dist));
  let pluginInstalled = false;
  ok &&= step('plugin', () => {
    const r = claudeCli(runner, pluginInstallArgs(l));
    if (!r.ok) throw new Error(r.out.slice(0, 500) || 'claude plugin install failed');
    pluginInstalled = true;
    return r.out.split('\n').pop();
  });
  let backup: string | null = null;
  const groups = hookGroups(plan.node, hook.replace(/\\/g, '/'));
  ok &&= step('settings-hooks', () => {
    const text = readText(plan.settingsFile);
    let settings: Record<string, unknown> = {};
    if (text !== null) {
      settings = JSON.parse(text) as Record<string, unknown>; // a settings file that is not JSON stops the install untouched
      backup = join(l.backupsDir, `settings.json.${Date.now()}`);
      writeAtomic(backup, text);
    }
    // An earlier installation's hooks leave in the same write that adds these: never both, never neither.
    writeAtomic(plan.settingsFile, JSON.stringify(withOurHooks(withoutPrevious(settings, prev, l.root), groups, l.root), null, 2) + '\n');
  });
  let createdConfig = false;
  ok &&= step('config', () => {
    if (existsSync(l.config)) return 'kept';
    const c = { ...cloneDefaults(), ...opts.config } as Config;
    writeAtomic(l.config, serializeConfig(c));
    createdConfig = true;
  });
  ok &&= step('self-test', () => {
    const r = selfTest(plan.node, hook, l);
    if (!r.ok) throw new Error(r.detail);
    return r.detail;
  });
  // Only once this installation works: the earlier plugin, its marketplace, and its folder when it was copied.
  let removed = false;
  if (prev)
    ok &&= step('retire-previous', () => {
      const old = previousPlugin(prev);
      const r1 = claudeCli(runner, ['plugin', 'uninstall', old.id, '--scope', 'user']);
      if (!r1.ok && !/not (?:installed|found)/i.test(r1.out)) throw new Error(r1.out.slice(0, 500) || `claude plugin uninstall ${old.id} failed`);
      const r2 = claudeCli(runner, ['plugin', 'marketplace', 'remove', old.marketplace]);
      if (!r2.ok && !/not found|no marketplace/i.test(r2.out))
        throw new Error(r2.out.slice(0, 500) || `claude plugin marketplace remove ${old.marketplace} failed`);
      if (!prev.copy) return `${old.id} removed; ${prev.root} left as it is`;
      rmSync(prev.root, { recursive: true, force: true, maxRetries: 3 });
      removed = true;
      return `${old.id} and ${prev.root} removed`;
    });
  const hookHash = fileHash(hook);
  const cli = cliProgram(dist);
  const manifest: Manifest = {
    v: 1,
    app: APP_ID,
    version: APP_VERSION,
    installedAt: Date.now(),
    node: plan.node,
    dataDir: l.root,
    settingsFile: plan.settingsFile,
    settingsBackup: backup,
    ...(hookHash ? { hookHash } : {}),
    ...(cli ? { cli } : {}),
    hooks: groups,
    plugin: { id: PLUGIN_ID, installed: pluginInstalled, marketplaceDir: l.marketplace },
    createdConfig,
    ...(prev ? { previous: { id: prev.id, root: prev.root, removed } } : {}),
  };
  try {
    writeJsonAtomic(l.manifest, manifest);
  } catch {
    ok = false;
  }
  return { ok, steps, manifest };
}

/** Copies the shipped plugin into the local marketplace folder and writes the marketplace's catalog. */
export function writeMarketplace(l: Layout, dist: string): void {
  rmSync(l.pluginDir, { recursive: true, force: true });
  cpSync(join(dist, 'plugin'), l.pluginDir, { recursive: true });
  const pkgManifest = readJson<Record<string, unknown>>(join(l.pluginDir, '.claude-plugin', 'plugin.json')) ?? {};
  writeJsonAtomic(join(l.marketplace, '.claude-plugin', 'marketplace.json'), {
    name: MARKETPLACE_NAME,
    owner: { name: APP_ID },
    metadata: { description: 'Local marketplace created by the terminal-code installer.' },
    plugins: [
      { name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, version: pkgManifest.version ?? APP_VERSION, description: pkgManifest.description ?? '' },
    ],
  });
}

/** The command that installs the plugin from the local marketplace, at user scope. */
export function pluginInstallArgs(l: Layout): string[] {
  return ['plugin', 'install', PLUGIN_NAME, '--marketplace', l.marketplace, '--scope', 'user'];
}

export function readManifest(l: Layout): Manifest | null {
  const m = readJson<Manifest>(l.manifest);
  return m && m.v === 1 && m.app === APP_ID ? m : null;
}

export interface UninstallResult {
  ok: boolean;
  steps: { what: 'plugin' | 'marketplace' | 'settings-hooks' | 'files' | 'data'; ok: boolean; detail?: string }[];
}

/** Removes what the manifest lists. With `purge`, also the data folder (settings, history, index). */
export function applyUninstall(l: Layout, opts: { purge?: boolean; runner?: ClaudeRunner; claudeDir?: string } = {}): UninstallResult {
  const steps: UninstallResult['steps'] = [];
  const runner = opts.runner ?? realClaude;
  const m = readManifest(l);
  const settingsFile = m?.settingsFile ?? join(opts.claudeDir ?? claudeDir(), 'settings.json');
  const r1 = claudeCli(runner, ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user']);
  steps.push({ what: 'plugin', ok: r1.ok || /not (?:installed|found)/i.test(r1.out), detail: r1.out.split('\n').pop() });
  const r2 = claudeCli(runner, ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME]);
  steps.push({ what: 'marketplace', ok: r2.ok || /not found|no marketplace/i.test(r2.out), detail: r2.out.split('\n').pop() });
  try {
    const text = readText(settingsFile);
    if (text !== null) {
      const settings = JSON.parse(text) as Record<string, unknown>;
      const next = withoutOurHooks(settings, l.root);
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        writeAtomic(join(l.backupsDir, `settings.json.uninstall.${Date.now()}`), text);
        writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n');
      }
    }
    steps.push({ what: 'settings-hooks', ok: true });
  } catch (err) {
    steps.push({ what: 'settings-hooks', ok: false, detail: (err as Error).message });
  }
  try {
    rmSync(join(l.root, 'bin'), { recursive: true, force: true });
    rmSync(l.marketplace, { recursive: true, force: true });
    rmSync(l.manifest, { force: true });
    steps.push({ what: 'files', ok: true });
  } catch (err) {
    steps.push({ what: 'files', ok: false, detail: (err as Error).message });
  }
  if (opts.purge) {
    try {
      rmSync(l.root, { recursive: true, force: true });
      steps.push({ what: 'data', ok: true });
    } catch (err) {
      steps.push({ what: 'data', ok: false, detail: (err as Error).message });
    }
  }
  return { ok: steps.every((s) => s.ok), steps };
}

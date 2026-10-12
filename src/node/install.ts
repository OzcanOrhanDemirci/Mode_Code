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
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, realpathSync, rmSync } from 'node:fs';
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
import { ensureDir, readJson, readText, writeAtomic, writeJsonAtomic } from './fsx.js';
import { claudeDir } from './env.js';
import { claudeVersion, runClaude } from './claude-env.js';

export const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart'] as const;
export const BELT_MATCHER = 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit';

export interface Manifest {
  v: 1;
  app: string;
  version: string;
  installedAt: number;
  node: string;
  dataDir: string;
  settingsFile: string;
  settingsBackup: string | null;
  /** The exact hook groups added, per event, so removal takes out these and nothing else. */
  hooks: Record<string, unknown[]>;
  plugin: { id: string; installed: boolean; marketplaceDir: string };
  createdConfig: boolean;
}

export type StepKind = 'data-folder' | 'hook-program' | 'marketplace' | 'plugin' | 'settings-hooks' | 'config' | 'self-test';

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

export function hookProgram(l: Layout): string {
  return join(l.root, 'bin', 'hook.mjs');
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

/** Running from inside a Claude Code session (an agent's shell) or without a person at a terminal. */
export function underAgent(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDECODE === '1' || !!env.CLAUDE_CODE_ENTRYPOINT;
}

export function planInstall(l: Layout, opts: { node?: string; claude?: string | null } = {}): InstallPlan {
  const node = (opts.node ?? stableNodePath()).replace(/\\/g, '/');
  const settingsFile = join(claudeDir(), 'settings.json');
  const hook = hookProgram(l).replace(/\\/g, '/');
  const plan: InstallPlan = {
    steps: [],
    blockers: [],
    warnings: [],
    claude: null,
    node,
    settingsFile,
    hookCommand: { command: node, args: [hook, '<Event>'] },
  };
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
  if (underAgent()) plan.blockers.push({ key: 'install.block.agent' });

  const settings = readJson<Record<string, unknown>>(settingsFile) ?? {};
  if (settings.disableAllHooks === true) plan.warnings.push({ key: 'install.warn.hooksDisabled', params: { file: settingsFile } });
  const manifest = readManifest(l);
  if (manifest && manifest.version !== APP_VERSION)
    plan.warnings.push({ key: 'install.warn.otherVersion', params: { have: manifest.version, now: APP_VERSION } });

  const groups = hookGroups(node, hook);
  const current = JSON.stringify(withOurHooks(settings, groups, l.root));
  plan.steps.push({ kind: 'data-folder', targets: [l.root], done: existsSync(l.root) });
  plan.steps.push({ kind: 'hook-program', targets: [hook], done: false });
  plan.steps.push({ kind: 'marketplace', targets: [l.marketplace], done: false });
  plan.steps.push({ kind: 'plugin', targets: [PLUGIN_ID], done: false });
  plan.steps.push({ kind: 'settings-hooks', targets: [settingsFile, ...HOOK_EVENTS], done: current === JSON.stringify(settings) });
  plan.steps.push({ kind: 'config', targets: [l.config], done: existsSync(l.config) });
  plan.steps.push({ kind: 'self-test', targets: [hook], done: false });
  return plan;
}

export interface ApplyResult {
  ok: boolean;
  steps: { kind: StepKind; ok: boolean; detail?: string }[];
  manifest: Manifest | null;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
  return env;
}

function claudeCli(args: string[]): { ok: boolean; out: string } {
  const r = runClaude(args, { timeoutMs: 120_000, env: cleanEnv() });
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

export function applyInstall(l: Layout, plan: InstallPlan, opts: { config?: Partial<Config> } = {}): ApplyResult {
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
  ok &&= step('data-folder', () => {
    for (const d of [l.root, l.stateDir, l.sessionsDir, l.eventsDir, l.installDir, l.backupsDir, join(l.root, 'bin')]) ensureDir(d);
  });
  ok &&= step('hook-program', () => {
    cpSync(join(dist, 'hook.mjs'), hook);
  });
  ok &&= step('marketplace', () => {
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
  });
  let pluginInstalled = false;
  ok &&= step('plugin', () => {
    const r = claudeCli(['plugin', 'install', PLUGIN_NAME, '--marketplace', l.marketplace, '--scope', 'user']);
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
    writeAtomic(plan.settingsFile, JSON.stringify(withOurHooks(settings, groups, l.root), null, 2) + '\n');
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
  const manifest: Manifest = {
    v: 1,
    app: APP_ID,
    version: APP_VERSION,
    installedAt: Date.now(),
    node: plan.node,
    dataDir: l.root,
    settingsFile: plan.settingsFile,
    settingsBackup: backup,
    hooks: groups,
    plugin: { id: PLUGIN_ID, installed: pluginInstalled, marketplaceDir: l.marketplace },
    createdConfig,
  };
  try {
    writeJsonAtomic(l.manifest, manifest);
  } catch {
    ok = false;
  }
  return { ok, steps, manifest };
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
export function applyUninstall(l: Layout, opts: { purge?: boolean } = {}): UninstallResult {
  const steps: UninstallResult['steps'] = [];
  const m = readManifest(l);
  const settingsFile = m?.settingsFile ?? join(claudeDir(), 'settings.json');
  const r1 = claudeCli(['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user']);
  steps.push({ what: 'plugin', ok: r1.ok || /not (?:installed|found)/i.test(r1.out), detail: r1.out.split('\n').pop() });
  const r2 = claudeCli(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME]);
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

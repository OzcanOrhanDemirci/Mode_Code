// SPDX-License-Identifier: Apache-2.0
/**
 * A read-only look at the person's Claude Code setup: version, settings files and what they set, hooks,
 * permission rules, MCP servers, plugins, instruction files (CLAUDE.md, memory), skills, agents and
 * commands. Everything is read from the documented places; nothing here writes.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readText } from './fsx.js';
import { claudeDir, managedSettingsFiles } from './env.js';
import { compareVersions } from '../core/version.js';

export type SettingsScope = 'managed' | 'user' | 'project' | 'local';

export interface SettingsSource {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  json: Record<string, unknown> | null;
  error?: string;
}

export interface HookEntry {
  scope: SettingsScope;
  event: string;
  matcher: string | null;
  type: string;
  command: string;
  args: string[];
  timeout: number | null;
  onFailure: string | null;
  /** True when the entry runs this tool's hook program. */
  ours: boolean;
}

export interface PermissionRule {
  scope: SettingsScope;
  kind: 'allow' | 'deny' | 'ask';
  rule: string;
}

export interface McpServer {
  scope: 'user' | 'local' | 'project';
  name: string;
  transport: string;
  target: string;
}

export interface InstructionFile {
  kind: 'user' | 'project' | 'project-dir' | 'local' | 'memory-index';
  path: string;
  exists: boolean;
  bytes: number;
  lines: number;
  /** For the memory index: Claude Code loads only the first 200 lines or 25 KB. */
  limit?: { lines: number; bytes: number };
}

export interface NamedFile {
  scope: 'user' | 'project';
  name: string;
  path: string;
}

export interface PluginInfo {
  id: string;
  enabled: boolean | null;
  /** The version Claude Code recorded when the plugin was installed or last updated. */
  version: string | null;
  /**
   * The version that loads. A plugin read in place from its folder (a local marketplace) loads what the
   * folder holds, whatever was recorded: installing over an older one leaves the record behind (Claude Code
   * 2.1.300, measured 2026-10-15).
   */
  loads?: string | null;
  scope: string | null;
}

export interface ClaudeEnv {
  dir: string;
  version: string | null;
  settings: SettingsSource[];
  hooks: HookEntry[];
  permissions: PermissionRule[];
  mcp: McpServer[];
  plugins: PluginInfo[] | null;
  instructions: InstructionFile[];
  memoryDir: string;
  memoryDirFromSetting: boolean;
  skills: NamedFile[];
  agents: NamedFile[];
  commands: NamedFile[];
  /** Settings sources that turn every hook off. */
  hooksDisabledBy: SettingsScope[];
}

export function readSettings(scope: SettingsScope, path: string): SettingsSource {
  const text = readText(path);
  if (text === null) return { scope, path, exists: false, json: null };
  try {
    const json = JSON.parse(text) as unknown;
    return { scope, path, exists: true, json: typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null };
  } catch (err) {
    return { scope, path, exists: true, json: null, error: (err as Error).message };
  }
}

/** The folder name Claude Code gives a project under ~/.claude/projects: every non-alphanumeric becomes "-". */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Runs the `claude` command with fixed arguments and no shell where possible. A native install is an
 * executable; an npm install on Windows is a .cmd shim, which only a shell can start: then the fixed
 * command line is passed as one string (nothing in it comes from outside).
 */
export function runClaude(
  args: readonly string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const base = {
    encoding: 'utf8' as const,
    timeout: opts.timeoutMs ?? 30_000,
    windowsHide: true,
    env: opts.env ?? process.env,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  };
  let r = spawnSync('claude', [...args], base);
  if (r.error && process.platform === 'win32') {
    const line = ['claude', ...args.map((a) => (/^[\w@./:=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`))].join(' ');
    r = spawnSync(line, { ...base, shell: true });
  }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Runs `claude` attached to this terminal and returns its exit code, or null when it cannot be started. */
export function runClaudeInteractive(args: readonly string[]): number | null {
  let r = spawnSync('claude', [...args], { stdio: 'inherit' });
  if (r.error && process.platform === 'win32') {
    const line = ['claude', ...args.map((a) => (/^[\w@./:=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`))].join(' ');
    r = spawnSync(line, { stdio: 'inherit', shell: true });
  }
  return r.error ? null : (r.status ?? 0);
}

/** Environment for running `claude` as a separate program: without the variables of a session it may run in. */
export function cleanClaudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete out[k];
  return out;
}

/** How the tool runs `claude`: the real command, or a stand-in in tests and the doctor's sandbox. */
export interface ClaudeRunner {
  version(): string | null;
  run(args: readonly string[], timeoutMs?: number): { status: number | null; stdout: string; stderr: string };
}

export const realClaude: ClaudeRunner = {
  version: () => claudeVersion(),
  run: (args, timeoutMs = 120_000) => runClaude(args, { timeoutMs, env: cleanClaudeEnv() }),
};

/** The plugins `claude plugin list --json` reports through a runner, or null when it could not be run or read. */
export function pluginsVia(runner: ClaudeRunner): PluginInfo[] | null {
  try {
    const r = runner.run(['plugin', 'list', '--json'], 30_000);
    if (r.status !== 0) return null;
    const list = JSON.parse(r.stdout) as Record<string, unknown>[];
    if (!Array.isArray(list)) return null;
    return list.map((p) => {
      const version = typeof p.version === 'string' ? p.version : null;
      const inPlace = typeof p.readFromFolder === 'string' && typeof p.folderVersion === 'string' ? p.folderVersion : null;
      return {
        id: String(p.id ?? p.name ?? '?'),
        enabled: typeof p.enabled === 'boolean' ? p.enabled : null,
        version,
        loads: inPlace ?? version,
        scope: typeof p.scope === 'string' ? p.scope : null,
      };
    });
  } catch {
    return null;
  }
}

let versionCache: string | null | undefined;

/** The installed Claude Code version ("2.1.296"), or null when `claude` cannot be run. Cached per process. */
export function claudeVersion(): string | null {
  if (versionCache !== undefined) return versionCache;
  try {
    const r = runClaude(['--version'], { timeoutMs: 15000 });
    const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
    versionCache = r.status === 0 && m ? m[1]! : null;
  } catch {
    versionCache = null;
  }
  return versionCache;
}

export function claudeAtLeast(min: string): boolean | null {
  const v = claudeVersion();
  return v === null ? null : compareVersions(v, min) >= 0;
}

export function hooksOf(src: SettingsSource, ourMarker: string): HookEntry[] {
  const out: HookEntry[] = [];
  const hooks = src.json?.hooks;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups as Record<string, unknown>[]) {
      const list = Array.isArray(g?.hooks) ? (g.hooks as Record<string, unknown>[]) : [];
      for (const h of list) {
        const command = typeof h.command === 'string' ? h.command : typeof h.url === 'string' ? h.url : '';
        const args = Array.isArray(h.args) ? (h.args as unknown[]).map(String) : [];
        const whole = [command, ...args].join(' ').replace(/\\/g, '/').toLowerCase();
        out.push({
          scope: src.scope,
          event,
          matcher: typeof g.matcher === 'string' ? g.matcher : null,
          type: typeof h.type === 'string' ? h.type : 'command',
          command,
          args,
          timeout: typeof h.timeout === 'number' ? h.timeout : null,
          onFailure: typeof h.onFailure === 'string' ? h.onFailure : null,
          ours: whole.includes(ourMarker.toLowerCase()),
        });
      }
    }
  }
  return out;
}

function permissionsOf(src: SettingsSource): PermissionRule[] {
  const p = src.json?.permissions as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return [];
  const out: PermissionRule[] = [];
  for (const kind of ['allow', 'deny', 'ask'] as const) {
    const list = p[kind];
    if (Array.isArray(list)) for (const r of list) if (typeof r === 'string') out.push({ scope: src.scope, kind, rule: r });
  }
  return out;
}

function mcpOf(obj: unknown, scope: McpServer['scope']): McpServer[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, Record<string, unknown>>).map(([name, s]) => ({
    scope,
    name,
    transport: typeof s?.type === 'string' ? s.type : typeof s?.url === 'string' ? 'http' : 'stdio',
    target: typeof s?.url === 'string' ? s.url : [s?.command, ...(Array.isArray(s?.args) ? (s.args as unknown[]) : [])].filter(Boolean).map(String).join(' '),
  }));
}

function instruction(kind: InstructionFile['kind'], path: string, limit?: InstructionFile['limit']): InstructionFile {
  const text = readText(path);
  return {
    kind,
    path,
    exists: text !== null,
    bytes: text === null ? 0 : Buffer.byteLength(text, 'utf8'),
    lines: text === null ? 0 : text.split('\n').length,
    ...(limit ? { limit } : {}),
  };
}

function named(dir: string, scope: NamedFile['scope'], kind: 'skill' | 'md'): NamedFile[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (kind === 'skill') {
        if (!e.isDirectory()) return [];
        const p = join(dir, e.name, 'SKILL.md');
        try {
          statSync(p);
          return [{ scope, name: e.name, path: p }];
        } catch {
          return [];
        }
      }
      return e.isFile() && e.name.endsWith('.md') ? [{ scope, name: e.name.slice(0, -3), path: join(dir, e.name) }] : [];
    });
  } catch {
    return [];
  }
}

/** `claude plugin list --json`, or null when it could not be run or read. */
export function plugins(): PluginInfo[] | null {
  return pluginsVia(realClaude);
}

export interface ClaudeEnvOptions {
  /** Run `claude plugin list` (slow). */
  withPlugins?: boolean;
  /** A text that only this tool's hook commands contain (its hook program's path). */
  ourMarker?: string;
  /** Claude Code's configuration folder and global config file, when not the ones of this process. */
  dir?: string;
  globalConfig?: string;
  managed?: string[];
  /** The Claude Code version, when already known (null: not installed); measured when absent. */
  version?: string | null;
  /** Lists plugins, when not by running `claude plugin list`. */
  plugins?: () => PluginInfo[] | null;
}

/** Reads the setup as Claude Code would see it for a session started in `cwd`. */
export function readClaudeEnv(cwd: string, opts: ClaudeEnvOptions = {}): ClaudeEnv {
  const dir = opts.dir ?? claudeDir();
  // A session started in the home folder has the user's own .claude folder as its project folder: the
  // same files, read once, as the user's (else every hook and setting there would count twice).
  const fold = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? resolve(p).toLowerCase() : resolve(p));
  const homeIsProject = fold(join(cwd, '.claude')) === fold(dir);
  const settings: SettingsSource[] = [
    ...(opts.managed ?? managedSettingsFiles()).map((p) => readSettings('managed', p)),
    readSettings('user', join(dir, 'settings.json')),
    ...(homeIsProject ? [] : [readSettings('project', join(cwd, '.claude', 'settings.json'))]),
    readSettings('local', join(cwd, '.claude', 'settings.local.json')),
  ];
  const marker = opts.ourMarker ?? '.mode-code';
  const global = (() => {
    const text = readText(opts.globalConfig ?? (process.env.CLAUDE_CONFIG_DIR ? join(dir, '.claude.json') : join(homedir(), '.claude.json')));
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();
  const projectEntry =
    (global?.projects as Record<string, Record<string, unknown>> | undefined)?.[cwd.replace(/\//g, '\\')] ??
    (global?.projects as Record<string, Record<string, unknown>> | undefined)?.[cwd];
  const projectMcp = (() => {
    const text = readText(join(cwd, '.mcp.json'));
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>).mcpServers : null;
    } catch {
      return null;
    }
  })();
  const userSettings = settings.find((s) => s.scope === 'user')?.json;
  const memSetting = typeof userSettings?.autoMemoryDirectory === 'string' ? userSettings.autoMemoryDirectory : null;
  const memoryDir = memSetting ?? join(dir, 'projects', projectSlug(cwd), 'memory');
  return {
    dir,
    version: opts.version !== undefined ? opts.version : claudeVersion(),
    settings,
    hooks: settings.flatMap((s) => hooksOf(s, marker)),
    permissions: settings.flatMap(permissionsOf),
    mcp: [...mcpOf(global?.mcpServers, 'user'), ...mcpOf(projectEntry?.mcpServers, 'local'), ...mcpOf(projectMcp, 'project')],
    plugins: opts.withPlugins ? (opts.plugins ?? plugins)() : null,
    instructions: [
      instruction('user', join(dir, 'CLAUDE.md')),
      instruction('project', join(cwd, 'CLAUDE.md')),
      ...(homeIsProject ? [] : [instruction('project-dir', join(cwd, '.claude', 'CLAUDE.md'))]),
      instruction('local', join(cwd, 'CLAUDE.local.md')),
      instruction('memory-index', join(memoryDir, 'MEMORY.md'), { lines: 200, bytes: 25_000 }),
    ],
    memoryDir,
    memoryDirFromSetting: memSetting !== null,
    skills: [...named(join(dir, 'skills'), 'user', 'skill'), ...(homeIsProject ? [] : named(join(cwd, '.claude', 'skills'), 'project', 'skill'))],
    agents: [...named(join(dir, 'agents'), 'user', 'md'), ...(homeIsProject ? [] : named(join(cwd, '.claude', 'agents'), 'project', 'md'))],
    commands: [...named(join(dir, 'commands'), 'user', 'md'), ...(homeIsProject ? [] : named(join(cwd, '.claude', 'commands'), 'project', 'md'))],
    hooksDisabledBy: settings.filter((s) => s.json?.disableAllHooks === true).map((s) => s.scope),
  };
}

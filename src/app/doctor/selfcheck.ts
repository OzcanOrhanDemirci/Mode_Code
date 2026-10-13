// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor's test of itself: an installation in a throwaway folder, broken on purpose in known ways,
 * each fault checked for detection and, where a repair exists, for repair. It uses the real installer,
 * the real checks, the real repairs and the real hook program; only `claude` is a stand-in, so nothing
 * is installed into Claude Code and the person's files are not touched.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS, PLUGIN_ID } from '../../core/app.js';
import { cloneDefaults } from '../../core/config.js';
import { layout, type Layout } from '../../core/layout.js';
import type { Lang } from '../../core/i18n/index.js';
import type { ClaudeRunner } from '../../node/claude-env.js';
import { readJson, readText, writeJsonAtomic } from '../../node/fsx.js';
import { platform, toolPath } from '../../node/env.js';
import { applyInstall, distDir, hookProgram, planInstall, stableNodePath, type Manifest } from '../../node/install.js';
import type { DoctorEnv } from './facts.js';
import { examine, planRepairs, repair } from './doctor.js';
import type { RepairId } from './types.js';

/** A stand-in for `claude`: answers the plugin commands the installer and the doctor use, from memory. */
export function standInClaude(version = MIN_CLAUDE_CODE_FOR_HOOKS): ClaudeRunner & { calls: string[][]; plugin: { installed: boolean; enabled: boolean } } {
  const plugin = { installed: false, enabled: false };
  const calls: string[][] = [];
  return {
    calls,
    plugin,
    version: () => version,
    run: (args) => {
      calls.push([...args]);
      const a = args.join(' ');
      const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
      if (a === '--version') return ok(`${version} (Claude Code)`);
      if (a.startsWith('plugin list'))
        return ok(JSON.stringify(plugin.installed ? [{ id: PLUGIN_ID, enabled: plugin.enabled, version: APP_VERSION, scope: 'user' }] : []));
      if (a.startsWith('plugin install')) {
        plugin.installed = true;
        plugin.enabled = true;
        return ok('Installed');
      }
      if (a.startsWith('plugin enable')) {
        plugin.enabled = plugin.installed;
        return plugin.installed ? ok('Enabled') : { status: 1, stdout: '', stderr: 'not installed' };
      }
      if (a.startsWith('plugin uninstall')) {
        plugin.installed = false;
        return ok('Uninstalled');
      }
      if (a.startsWith('plugin marketplace remove')) return ok('Removed');
      return { status: 1, stdout: '', stderr: `stand-in claude: unknown command ${a}` };
    },
  };
}

export interface Sandbox {
  root: string;
  layout: Layout;
  claudeDir: string;
  settingsFile: string;
  env: DoctorEnv;
  manifest(): Manifest;
  /** Puts the healthy settings file back (for faults no repair undoes). */
  resetSettings(): void;
}

export interface Fault {
  /** Its message is doc.fault.<id>. */
  id: string;
  /** The check that must notice it. */
  check: string;
  /** The repair that must fix it; null when the fault is the person's to fix (detection only). */
  repair: RepairId | null;
  only?: NodeJS.Platform[];
  /** Needs the installed hook compared with this build (slower). */
  agreement?: boolean;
  inject(s: Sandbox): void;
}

export const FAULTS: readonly Fault[] = [
  { id: 'hooks-removed', check: 'install.hooks', repair: 'restore-hooks', inject: (s) => writeFileSync(s.settingsFile, '{}\n') },
  {
    id: 'hook-weakened',
    check: 'install.hooks',
    repair: 'restore-hooks',
    inject: (s) => {
      const j = readJson<{ hooks: Record<string, { hooks: Record<string, unknown>[] }[]> }>(s.settingsFile)!;
      for (const g of j.hooks.PreToolUse ?? []) for (const h of g.hooks) delete h.onFailure;
      writeFileSync(s.settingsFile, JSON.stringify(j, null, 2));
    },
  },
  { id: 'hook-deleted', check: 'install.hookProgram', repair: 'restore-hook-program', inject: (s) => rmSync(hookProgram(s.layout), { force: true }) },
  { id: 'hook-altered', check: 'install.hookProgram', repair: 'restore-hook-program', inject: (s) => appendFileSync(hookProgram(s.layout), '\n// altered\n') },
  {
    id: 'hook-allows-all',
    check: 'protect.agreement',
    repair: 'restore-hook-program',
    agreement: true,
    inject: (s) => writeFileSync(hookProgram(s.layout), 'process.exit(0);\n'),
  },
  {
    id: 'node-gone',
    check: 'node.hooks',
    repair: 'repoint-node',
    inject: (s) => {
      const gone = toolPath(join(s.root, 'gone', process.platform === 'win32' ? 'node.exe' : 'node'));
      const before = s.manifest().node;
      writeJsonAtomic(s.layout.manifest, { ...s.manifest(), node: gone });
      writeFileSync(s.settingsFile, readText(s.settingsFile)!.split(JSON.stringify(before)).join(JSON.stringify(gone)));
    },
  },
  {
    id: 'plugin-changed',
    check: 'install.pluginFiles',
    repair: 'restore-plugin-files',
    inject: (s) => appendFileSync(join(s.layout.pluginDir, 'hooks', 'register.js'), '\n// changed\n'),
  },
  {
    id: 'cli-unrecorded',
    check: 'install.controlCenter',
    repair: 'record-cli',
    inject: (s) => {
      const m: Partial<Manifest> = { ...s.manifest() };
      delete m.cli;
      writeJsonAtomic(s.layout.manifest, m);
    },
  },
  {
    id: 'data-folder-deleted',
    check: 'files.data',
    repair: 'create-data-folders',
    inject: (s) => rmSync(s.layout.sessionsDir, { recursive: true, force: true }),
  },
  { id: 'index-damaged', check: 'data.index', repair: 'rebuild-index', inject: (s) => writeFileSync(s.layout.index, 'this is not a database'.repeat(200)) },
  { id: 'quota-damaged', check: 'data.quota', repair: 'remove-bad-quota', inject: (s) => writeFileSync(s.layout.quota, '{ "windows": ') },
  {
    id: 'leftover-file',
    check: 'files.leftovers',
    repair: 'remove-stale-temp',
    inject: (s) => {
      const p = join(s.layout.root, 'config.json.4242.0a1b2c3d.tmp');
      writeFileSync(p, '{}');
      const old = new Date(Date.now() - 3 * 3600_000);
      utimesSync(p, old, old);
    },
  },
  {
    id: 'bad-setting',
    check: 'data.config',
    repair: 'rewrite-config',
    inject: (s) => {
      const c = readJson<Record<string, unknown>>(s.layout.config) ?? {};
      const text = JSON.stringify({ ...c, view: 'enormous' }, null, 2);
      writeFileSync(s.layout.config, text);
    },
  },
  { id: 'settings-broken', check: 'claude.settings', repair: null, inject: (s) => appendFileSync(s.settingsFile, '\n}{ broken') },
  {
    id: 'loose-permissions',
    check: 'files.permissions',
    repair: 'tighten-permissions',
    only: ['darwin', 'linux'],
    inject: (s) => chmodSync(s.layout.config, 0o666),
  },
];

export interface FaultResult {
  id: string;
  check: string;
  detected: boolean;
  /** null: no repair is expected (the person fixes it). */
  repaired: boolean | null;
  detail: string;
  ms: number;
}

export interface SelfCheckReport {
  ok: boolean;
  /** Why the self-check could not run at all, when it could not. */
  skipped: string | null;
  baseline: { ok: boolean; problems: string[] };
  faults: FaultResult[];
  ms: number;
}

/** Builds the sandbox: a real installation in a temporary folder, with a stand-in `claude`. */
export function buildSandbox(lang: Lang): Sandbox | string {
  const dist = distDir();
  if (!existsSync(join(dist, 'hook.mjs')) || !existsSync(join(dist, 'plugin', '.claude-plugin', 'plugin.json'))) return `no build at ${dist}`;
  const root = toolPath(mkdtempSync(join(tmpdir(), 'tc-selfcheck-')));
  const l = layout(`${root}/data`);
  const claudeDir = `${root}/claude`;
  mkdirSync(claudeDir, { recursive: true });
  const settingsFile = `${claudeDir}/settings.json`;
  writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }, null, 2));
  const claude = standInClaude();
  const plan = planInstall(l, { node: stableNodePath(), claude: claude.version(), claudeDir, env: {} });
  const r = applyInstall(l, plan, { runner: claude, config: { language: lang } });
  if (!r.ok) {
    rmSync(root, { recursive: true, force: true });
    return `installation failed: ${r.steps.find((x) => !x.ok)?.detail ?? '?'}`;
  }
  const healthy = readText(settingsFile)!;
  const env: DoctorEnv = {
    layout: l,
    claudeDir,
    globalConfig: `${claudeDir}/.claude.json`,
    managedSettings: [],
    cwd: root,
    home: root,
    env: { ...process.env, TERMINAL_CODE_HOME: l.root, CLAUDE_CONFIG_DIR: claudeDir },
    platform,
    config: { ...cloneDefaults(), language: lang },
    problems: [],
    lang,
    claude,
    distDir: dist,
    measure: { plugins: true, shells: false, transcripts: false, agreement: false, shortNames: false, gitProjects: false },
  };
  for (const k of Object.keys(env.env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env.env[k];
  return {
    root,
    layout: l,
    claudeDir,
    settingsFile,
    env,
    manifest: () => readJson<Manifest>(l.manifest)!,
    resetSettings: () => writeFileSync(settingsFile, healthy),
  };
}

/** The checks a healthy sandbox must pass (the rest measure the machine, not the installation). */
export const SANDBOX_CHECKS = [
  'node.hooks',
  'claude.settings',
  'claude.plugin',
  'install.manifest',
  'install.hookProgram',
  'install.hooks',
  'install.pluginFiles',
  'install.controlCenter',
  'files.data',
  'files.leftovers',
  'files.permissions',
  'data.config',
  'data.quota',
  'data.index',
  'protect.agreement',
];

export async function selfCheck(lang: Lang = 'en', faults: readonly Fault[] = FAULTS): Promise<SelfCheckReport> {
  const started = Date.now();
  const sb = buildSandbox(lang);
  if (typeof sb === 'string') return { ok: false, skipped: sb, baseline: { ok: false, problems: [] }, faults: [], ms: Date.now() - started };
  try {
    const base = await examine(sb.env, { agreement: true });
    const problems = base.results
      .filter((r) => SANDBOX_CHECKS.includes(r.id) && (r.status === 'fail' || r.status === 'warn'))
      .map((r) => `${r.id}: ${r.status}`);
    const out: FaultResult[] = [];
    for (const fault of faults) {
      if (fault.only && !fault.only.includes(process.platform)) continue;
      const t0 = Date.now();
      const env0 = sb.env;
      fault.inject(sb);
      const measure = { agreement: !!fault.agreement };
      const before = await examine(sb.env, measure);
      const hit = before.results.find((r) => r.id === fault.check);
      const detected = !!hit && (hit.status === 'fail' || hit.status === 'warn');
      let repaired: boolean | null = null;
      let detail = hit ? hit.status : 'check missing';
      if (fault.repair) {
        const plans = planRepairs(before.results, { agent: false }).filter((p) => p.checks.includes(fault.check));
        const planned = plans.find((p) => p.id === fault.repair);
        if (!planned) {
          repaired = false;
          detail += `; repair ${fault.repair} not planned (${plans.map((p) => p.id).join(', ') || 'none'})`;
        } else {
          const rep = await repair({ ...sb.env, measure: { ...sb.env.measure, ...measure } }, before, [planned]);
          const o = rep.outcomes[0]!;
          repaired = o.verified;
          detail += `; ${o.id}: ${o.ok ? 'done' : 'failed'}${o.verified ? ', verified' : ', not verified'} (${o.detail})`;
        }
      } else sb.resetSettings();
      sb.env = env0;
      out.push({ id: fault.id, check: fault.check, detected, repaired, detail, ms: Date.now() - t0 });
    }
    const ok = problems.length === 0 && out.every((f) => f.detected && f.repaired !== false);
    return { ok, skipped: null, baseline: { ok: problems.length === 0, problems }, faults: out, ms: Date.now() - started };
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
}

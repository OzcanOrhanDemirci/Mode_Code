// SPDX-License-Identifier: Apache-2.0
/** Builds the contexts the pure core needs from what a Node process can see. */
import { homedir } from 'node:os';
import { parseConfig, type Config, type ConfigProblem } from '../core/config.js';
import type { Pending } from '../core/sync.js';
import { beltConfigOf } from '../core/settings-view.js';
import type { BeltContext } from '../core/belt/types.js';
import type { ClassifyEnv } from '../core/footer.js';
import { joinPath, pathKey, resolvePath, type PathAlias } from '../core/paths.js';
import type { Lang } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { readText, fileSize, realPathOf } from './fsx.js';
import { gitFacts } from './git.js';
import { claudeDir, home, managedSettingsFiles, platform, scratchDirs, toolPath } from './env.js';
import { mergedConfig } from './sync.js';

export interface LoadedConfig {
  /** The settings in effect: this computer's own, with the other computers' changes when sync is set up (docs/sync.md). */
  config: Config;
  problems: ConfigProblem[];
  /** This computer's own settings, config.json as it is. */
  local: Config;
  /** Settings from other computers that lower a protection here, waiting for the person. */
  pending: Pending[];
}

export function loadConfig(l: Layout): LoadedConfig {
  const { config, problems } = parseConfig(readText(l.config));
  const m = mergedConfig(config, l);
  return { config: m.config, problems, local: config, pending: m.pending };
}

export function memoryDirs(config: Config, cwd: string): string[] {
  return config.memory.dirs.map((d) => resolvePath(d, { platform, home: homedir(), cwd }));
}

/**
 * The protected folders and files that are links, or that the file system spells differently (8.3 short
 * names written out on Windows): measured here, where the disk can be asked, so the pure belt can judge
 * a path that reaches them another way. Only differences are returned.
 */
export function protectedAliases(paths: readonly string[]): PathAlias[] {
  const out: PathAlias[] = [];
  for (const p of paths) {
    const real = realPathOf(p);
    if (real === null) continue;
    const r = toolPath(real);
    if (pathKey(r, platform) !== pathKey(p, platform)) out.push({ real: r, spelled: p });
  }
  return out;
}

/** The places whose real location the belt is told: the data folder, Claude Code's settings and the memory folders. */
export function aliasRoots(dataDir: string, memory: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const cdir = claudeDir(env);
  const globalConfig = env.CLAUDE_CONFIG_DIR ? joinPath(cdir, '.claude.json') : joinPath(home(), '.claude.json');
  return [dataDir, cdir, joinPath(cdir, 'settings.json'), joinPath(cdir, 'settings.local.json'), globalConfig, ...memory];
}

export function beltContext(opts: {
  cwd: string;
  projectDir?: string | undefined;
  config: Config;
  layout: Layout;
  lang: Lang;
  env?: NodeJS.ProcessEnv;
}): BeltContext {
  const env = opts.env ?? process.env;
  const memory = memoryDirs(opts.config, opts.cwd);
  return {
    platform,
    home: home(),
    cwd: resolvePath(opts.cwd, { platform, home: homedir(), cwd: opts.cwd }),
    projectDir: resolvePath(opts.projectDir ?? env.CLAUDE_PROJECT_DIR ?? opts.cwd, { platform, home: homedir(), cwd: opts.cwd }),
    knownProjects: opts.config.projects.flatMap((p) => (p.path ? [resolvePath(p.path, { platform, home: homedir(), cwd: opts.cwd })] : [])),
    env,
    dataDir: opts.layout.root,
    ...(opts.config.sync ? { syncDir: resolvePath(opts.config.sync.dir, { platform, home: homedir(), cwd: opts.cwd }) } : {}),
    memoryDirs: memory,
    managedSettingsFiles: managedSettingsFiles(),
    lang: opts.lang,
    config: beltConfigOf(opts.config),
    git: gitFacts(),
    fileSize: async (p) => fileSize(p),
    aliases: protectedAliases(aliasRoots(opts.layout.root, memory, env)),
  };
}

export function classifyEnv(cwd: string, config: Config, extraIgnore: string[] = []): ClassifyEnv {
  return {
    platform,
    home: home(),
    cwd: resolvePath(cwd, { platform, home: homedir(), cwd }),
    memoryRoots: memoryDirs(config, cwd),
    ignore: [...scratchDirs(), ...extraIgnore],
  };
}

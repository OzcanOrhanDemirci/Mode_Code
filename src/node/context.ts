// SPDX-License-Identifier: Apache-2.0
/** Builds the contexts the pure core needs from what a Node process can see. */
import { homedir } from 'node:os';
import { parseConfig, type Config, type ConfigProblem } from '../core/config.js';
import type { BeltContext } from '../core/belt/types.js';
import type { ClassifyEnv } from '../core/footer.js';
import { resolvePath } from '../core/paths.js';
import type { Lang } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { readText, fileSize } from './fsx.js';
import { gitFacts } from './git.js';
import { home, managedSettingsFiles, platform, scratchDirs } from './env.js';

export interface LoadedConfig {
  config: Config;
  problems: ConfigProblem[];
}

export function loadConfig(l: Layout): LoadedConfig {
  return parseConfig(readText(l.config));
}

export function memoryDirs(config: Config, cwd: string): string[] {
  return config.memory.dirs.map((d) => resolvePath(d, { platform, home: homedir(), cwd }));
}

export function beltContext(opts: { cwd: string; projectDir?: string | undefined; config: Config; layout: Layout; lang: Lang }): BeltContext {
  const env = process.env;
  return {
    platform,
    home: home(),
    cwd: resolvePath(opts.cwd, { platform, home: homedir(), cwd: opts.cwd }),
    projectDir: resolvePath(opts.projectDir ?? env.CLAUDE_PROJECT_DIR ?? opts.cwd, { platform, home: homedir(), cwd: opts.cwd }),
    env,
    dataDir: opts.layout.root,
    memoryDirs: memoryDirs(opts.config, opts.cwd),
    managedSettingsFiles: managedSettingsFiles(),
    lang: opts.lang,
    config: opts.config.belt,
    git: gitFacts(),
    fileSize: async (p) => fileSize(p),
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

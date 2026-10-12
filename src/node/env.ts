// SPDX-License-Identifier: Apache-2.0
/** Facts about this machine and process that every Node entry point needs, in one place. */
import { homedir } from 'node:os';
import { DATA_DIR_NAME } from '../core/app.js';
import { joinPath, resolvePath, type Platform } from '../core/paths.js';
import { layout, type Layout } from '../core/layout.js';
import { detectLanguage, type Lang } from '../core/i18n/index.js';

export const platform: Platform = process.platform;

/** Home directory in the tool's path form (forward slashes, upper-case drive). */
export function home(): string {
  return resolvePath(homedir(), { platform, home: homedir(), cwd: homedir() });
}

export function toolPath(p: string, cwd = process.cwd()): string {
  return resolvePath(p, { platform, home: homedir(), cwd });
}

/** The data folder: TERMINAL_CODE_HOME when set (tests, portable installs), else ~/.terminal-code. */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TERMINAL_CODE_HOME;
  return override ? toolPath(override) : joinPath(home(), DATA_DIR_NAME);
}

export function dataLayout(env: NodeJS.ProcessEnv = process.env): Layout {
  return layout(dataRoot(env));
}

/** Claude Code's configuration folder: CLAUDE_CONFIG_DIR when set, else ~/.claude. */
export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? toolPath(env.CLAUDE_CONFIG_DIR) : joinPath(home(), '.claude');
}

/** Managed (organisation) settings files Claude Code reads on this platform; written by administrators, never by the tool. */
export function managedSettingsFiles(p: Platform = platform): string[] {
  if (p === 'win32') return ['C:/Program Files/ClaudeCode/managed-settings.json'];
  if (p === 'darwin') return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
  return ['/etc/claude-code/managed-settings.json'];
}

/** The interface language for this process. */
export function processLanguage(configured: string | null | undefined): Lang {
  let intlLocale: string | null = null;
  try {
    intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    intlLocale = null;
  }
  return detectLanguage({ configured: configured === 'auto' ? null : (configured ?? null), env: process.env, intlLocale });
}

/** Folders whose changes are never "work": the system temp folder and Claude Code's scratch folders. */
export function scratchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const v of [env.TMPDIR, env.TEMP, env.TMP]) if (v) out.add(toolPath(v));
  if (platform !== 'win32') out.add('/tmp');
  return [...out];
}

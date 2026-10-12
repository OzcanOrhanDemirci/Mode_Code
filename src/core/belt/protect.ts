// SPDX-License-Identifier: Apache-2.0
/**
 * The protected path sets the belt checks against, derived from the context (platform, home, project,
 * data folder, memory folders, environment). Every path here is resolved and slash-separated.
 */
import { isRoot, isUnder, joinPath, pathKey, resolvePath, type Platform } from '../paths.js';
import type { BeltContext } from './types.js';

export interface ProtectedPaths {
  /** Deleting or moving one of these, or anything that contains one of them, is catastrophic. */
  critical: string[];
  /** Operating system folders: everything inside them is critical too. */
  systemDirs: string[];
  /** Claude Code's own configuration: user settings, global config, plugin registry, managed settings. */
  claudeConfig: string[];
  /** Claude Code configuration that a project legitimately changes now and then (asks instead of denying). */
  claudeProjectConfig: (resolved: string) => boolean;
  /** The tool's own data folder. */
  toolDirs: string[];
  memoryDirs: string[];
  startupDirs: string[];
  shellProfiles: (resolved: string) => boolean;
  sshDir: string;
  /** Places where deleting freely is normal. */
  tempDirs: string[];
}

function ancestors(p: string): string[] {
  const out: string[] = [];
  let cur = p;
  for (let guard = 0; guard < 64; guard++) {
    const i = cur.replace(/\/+$/, '').lastIndexOf('/');
    if (i <= 0 || isRoot(cur)) break;
    let parent = cur.slice(0, i);
    if (/^[A-Za-z]:$/.test(parent)) parent += '/';
    if (parent === '' || parent === '/') break;
    out.push(parent);
    if (isRoot(parent)) break;
    cur = parent;
  }
  return out;
}

const SYSTEM_DIRS: Record<string, string[]> = {
  win32: ['C:/Windows', 'C:/Program Files', 'C:/Program Files (x86)', 'C:/ProgramData', 'C:/Users/Public', 'C:/Recovery', 'C:/System Volume Information'],
  darwin: ['/System', '/Library', '/Applications', '/Users', '/usr', '/bin', '/sbin', '/etc', '/private', '/var', '/opt', '/Volumes', '/cores'],
  linux: [
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/lib',
    '/lib32',
    '/lib64',
    '/boot',
    '/var',
    '/opt',
    '/root',
    '/home',
    '/srv',
    '/dev',
    '/proc',
    '/sys',
    '/run',
    '/snap',
    '/mnt',
    '/media',
  ],
};

const USER_FOLDERS = [
  'Desktop',
  'Documents',
  'Downloads',
  'Pictures',
  'Music',
  'Videos',
  'Movies',
  'Library',
  'AppData',
  'OneDrive',
  '.config',
  '.local',
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.azure',
  '.docker',
  'Dropbox',
  'iCloud Drive',
];

export function claudeDir(ctx: Pick<BeltContext, 'env' | 'home' | 'platform' | 'cwd'>): string {
  const override = ctx.env.CLAUDE_CONFIG_DIR;
  return override ? resolvePath(override, ctx) : joinPath(ctx.home, '.claude');
}

export function protectedPaths(ctx: BeltContext): ProtectedPaths {
  const env = { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd };
  const home = resolvePath(ctx.home, env);
  const cdir = claudeDir(ctx);
  const globalConfig = ctx.env.CLAUDE_CONFIG_DIR ? joinPath(cdir, '.claude.json') : joinPath(home, '.claude.json');
  const project = resolvePath(ctx.projectDir, env);
  const system = (SYSTEM_DIRS[ctx.platform] ?? SYSTEM_DIRS.linux!).map((p) => resolvePath(p, env));
  const userFolders = USER_FOLDERS.map((f) => joinPath(home, f));
  const claudeConfig = [
    joinPath(cdir, 'settings.json'),
    joinPath(cdir, 'settings.local.json'),
    joinPath(cdir, 'plugins'),
    globalConfig,
    ...ctx.managedSettingsFiles.map((p) => resolvePath(p, env)),
  ];
  const critical = [
    home,
    ...ancestors(home),
    ...system,
    ...userFolders,
    cdir,
    joinPath(cdir, 'projects'),
    ...claudeConfig,
    resolvePath(ctx.dataDir, env),
    ...ctx.memoryDirs.map((p) => resolvePath(p, env)),
    project,
  ];
  const tempDirs = [
    // Resolved like the targets they are compared with: on Windows `/tmp` (Git Bash's temp) becomes C:/tmp.
    ...['/tmp', '/var/tmp', '/private/tmp', '/private/var/folders'].map((p) => resolvePath(p, env)),
    joinPath(home, 'AppData/Local/Temp'),
    ...['TMPDIR', 'TEMP', 'TMP']
      .map((k) => ctx.env[k])
      .filter((v): v is string => !!v)
      .map((v) => resolvePath(v, env)),
  ].filter((p) => !critical.some((c) => pathKey(c, ctx.platform) === pathKey(p, ctx.platform)));

  const profileNames = new Set([
    '.bashrc',
    '.bash_profile',
    '.bash_login',
    '.profile',
    '.zshrc',
    '.zprofile',
    '.zshenv',
    '.zlogin',
    '.kshrc',
    '.cshrc',
    '.tcshrc',
  ]);
  const shellProfiles = (p: string): boolean => {
    const key = pathKey(p, ctx.platform);
    const homeKey = pathKey(home, ctx.platform);
    const name = key.slice(key.lastIndexOf('/') + 1);
    if (key.startsWith(homeKey + '/') && key.lastIndexOf('/') === homeKey.length && profileNames.has(name)) return true;
    if (key === pathKey(joinPath(home, '.config/fish/config.fish'), ctx.platform)) return true;
    if (/\/(documents|onedrive\/documents|onedrive\/belgeler|belgeler)\/(windows)?powershell\/[^/]*profile[^/]*\.ps1$/.test(key)) return true;
    if (['/etc/profile', '/etc/bash.bashrc', '/etc/zshrc', '/etc/zsh/zshrc', '/etc/environment'].includes(key)) return true;
    return false;
  };

  const claudeProjectConfig = (p: string): boolean => {
    const key = pathKey(p, ctx.platform);
    if (/\/\.claude\/settings(\.local)?\.json$/.test(key)) return true; // any project's settings
    if (key === pathKey(joinPath(cdir, 'CLAUDE.md'), ctx.platform)) return true; // the person's global instructions
    if (/\/\.mcp\.json$/.test(key)) return true; // project MCP servers
    return false;
  };

  return {
    critical: dedupe(critical, ctx.platform),
    systemDirs: system,
    claudeConfig,
    claudeProjectConfig,
    toolDirs: [resolvePath(ctx.dataDir, env)],
    memoryDirs: ctx.memoryDirs.map((p) => resolvePath(p, env)),
    startupDirs: [
      joinPath(home, 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup'),
      'C:/ProgramData/Microsoft/Windows/Start Menu/Programs/StartUp',
      joinPath(home, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
      joinPath(home, '.config/autostart'),
      joinPath(home, '.config/systemd/user'),
      '/etc/systemd/system',
      '/etc/init.d',
      '/etc/cron.d',
      '/etc/crontab',
    ].map((p) => resolvePath(p, env)),
    shellProfiles,
    sshDir: joinPath(home, '.ssh'),
    tempDirs,
  };
}

function dedupe(paths: string[], platform: Platform): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    const k = pathKey(p, platform);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The critical path that `target` is, contains, or null. A target inside a critical path is not itself critical. */
export function hitsCritical(target: string, paths: ProtectedPaths, platform: Platform): string | null {
  if (isRoot(target)) return target;
  for (const c of paths.critical) if (isUnder(c, target, platform)) return c;
  for (const d of paths.systemDirs) if (isUnder(target, d, platform)) return d;
  return null;
}

export function under(target: string, dirs: readonly string[], platform: Platform): string | null {
  for (const d of dirs) if (isUnder(target, d, platform)) return d;
  return null;
}

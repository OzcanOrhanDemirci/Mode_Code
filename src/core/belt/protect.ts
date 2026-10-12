// SPDX-License-Identifier: Apache-2.0
/**
 * The protected path sets the belt checks against, derived from the context (platform, home, project,
 * data folder, memory folders, environment). Every path here is resolved and slash-separated.
 */
import { applyAliases, expandShortNames, isRoot, isUnder, joinPath, pathKey, resolvePath, type Platform } from '../paths.js';
import type { BeltContext } from './types.js';

export interface ProtectedPaths {
  /** Deleting or moving one of these, or anything that contains one of them, is catastrophic. */
  critical: string[];
  /** Operating system folders: everything inside them is critical too, except what lies inside `ownRoots`. */
  systemDirs: string[];
  /**
   * The person's own places, which may lie inside an operating system folder (`/Users/ada` in `/Users`,
   * `/private/tmp` in `/private`, a project in `/Volumes` or `/mnt`): inside them the ordinary rules apply.
   */
  ownRoots: string[];
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
  /**
   * The one spelling the checks compare: a resolved path with the 8.3 short names of known folders written
   * out and the real locations of linked protected folders replaced by their protected spelling.
   */
  canonical: (resolved: string) => string;
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
    // Resolved like the targets they are compared with: on Windows `/tmp` is Git Bash's mount of the user's Temp.
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
    if (/\/\.mcp\.json$/.test(key)) return true; // project MCP servers
    return false;
  };

  const startupDirs = [
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
  ].map((p) => resolvePath(p, env));
  const memoryDirs = ctx.memoryDirs.map((p) => resolvePath(p, env));
  const toolDirs = [resolvePath(ctx.dataDir, env)];
  // Every folder and file the checks name, so a short-name spelling of any of them is written out.
  const known = dedupe(
    [
      ...critical,
      ...claudeConfig,
      joinPath(cdir, 'CLAUDE.md'),
      ...toolDirs,
      ...memoryDirs,
      ...startupDirs,
      ...tempDirs,
      ...(ctx.knownProjects ?? []).map((p) => resolvePath(p, env)),
      ...[...profileNames].map((n) => joinPath(home, n)),
      joinPath(home, 'Documents/PowerShell'),
      joinPath(home, 'Documents/WindowsPowerShell'),
    ],
    ctx.platform,
  );
  const aliases = (ctx.aliases ?? []).map((a) => ({ real: resolvePath(a.real, env), spelled: resolvePath(a.spelled, env) }));
  const canonical = (p: string): string => expandShortNames(applyAliases(p, aliases, ctx.platform), known, ctx.platform);
  // The protected places are brought to the same spelling as the targets they are compared with: a data
  // folder given as C:/Users/RUNNER~1/… (a short TEMP, as on CI machines) and a target written in long form
  // must meet. Measured on GitHub's Windows runners, where the first version of this missed it.
  const same = (list: readonly string[]) => dedupe(list.map(canonical), ctx.platform);
  const homeC = canonical(home);
  const cdirC = canonical(cdir);

  return {
    critical: same(critical),
    systemDirs: system,
    // A place counts as the person's own only when it is not itself an operating system folder (a session
    // started in /usr does not make /usr a project whose insides may be deleted).
    ownRoots: same([home, project, ...tempDirs, ...(ctx.knownProjects ?? []).map((p) => resolvePath(p, env))]).filter(
      (r) => !isRoot(r) && !system.some((d) => isUnder(d, r, ctx.platform)),
    ),
    claudeConfig: same(claudeConfig),
    // The person's global instructions (CLAUDE.md in Claude Code's folder) count as configuration a project changes now and then.
    claudeProjectConfig: (p) => claudeProjectConfig(p) || pathKey(p, ctx.platform) === pathKey(joinPath(cdirC, 'CLAUDE.md'), ctx.platform),
    toolDirs: same(toolDirs),
    memoryDirs: same(memoryDirs),
    startupDirs: same(startupDirs),
    shellProfiles: (p) => {
      if (shellProfiles(p)) return true;
      if (homeC === home || !isUnder(p, homeC, ctx.platform) || pathKey(p, ctx.platform) === pathKey(homeC, ctx.platform)) return false;
      return shellProfiles(joinPath(home, p.slice(homeC.replace(/\/+$/, '').length + 1)));
    },
    sshDir: canonical(joinPath(home, '.ssh')),
    tempDirs: same(tempDirs),
    canonical,
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

/**
 * The critical path that `target` is, contains, or null. A target inside a critical path is not itself
 * critical; a target inside an operating system folder is, unless it lies strictly inside one of the
 * person's own places (home, temporary folders, projects), where the ordinary rules decide.
 */
export function hitsCritical(target: string, paths: ProtectedPaths, platform: Platform): string | null {
  if (isRoot(target)) return target;
  for (const c of paths.critical) if (isUnder(c, target, platform)) return c;
  const own = paths.ownRoots.some((r) => isUnder(target, r, platform) && pathKey(target, platform) !== pathKey(r, platform));
  if (own) return null;
  for (const d of paths.systemDirs) if (isUnder(target, d, platform)) return d;
  return null;
}

export function under(target: string, dirs: readonly string[], platform: Platform): string | null {
  for (const d of dirs) if (isUnder(target, d, platform)) return d;
  return null;
}

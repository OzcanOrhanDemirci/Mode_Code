// SPDX-License-Identifier: Apache-2.0
/**
 * Lexical path handling for Windows and POSIX, written without Node so the in-process mod can use it.
 *
 * Every path an agent can write (Windows, Git Bash `/c/...`, `~`, `$HOME`, `%USERPROFILE%`, relative) is
 * turned into one absolute form with forward slashes. Comparisons are case-insensitive on Windows and
 * macOS, whose default file systems ignore case, so `~/.Claude/Settings.json` is the same file as
 * `~/.claude/settings.json` there. This is lexical only: links and 8.3 short names are resolved by the
 * adapters that can touch the disk.
 */

export type Platform = 'win32' | 'darwin' | 'linux' | (string & {});

export interface PathEnv {
  platform: Platform;
  /** Home directory, absolute. */
  home: string;
  /** Directory relative paths are resolved against, absolute. */
  cwd: string;
}

export function isWindows(platform: Platform): boolean {
  return platform === 'win32';
}

export function caseInsensitive(platform: Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

const HOME_VARS = /^(?:\$HOME|\$\{HOME\}|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%|\$env:USERPROFILE|\$env:HOME|\$\{env:USERPROFILE\})(?=$|[\\/])/i;

/** Expands the home forms an agent writes: `~`, `$HOME`, `${HOME}`, `%USERPROFILE%`, `$env:USERPROFILE`. */
export function expandHome(input: string, home: string): string {
  if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) return home + input.slice(1);
  const m = HOME_VARS.exec(input);
  return m ? home + input.slice(m[0].length) : input;
}

/** Splits an absolute, slash-separated path into its root and its segments. */
function splitRoot(p: string): { root: string; rest: string } {
  const drive = /^([A-Za-z]):(?:\/|$)/.exec(p);
  if (drive) return { root: `${drive[1]!.toUpperCase()}:/`, rest: p.slice(drive[0].length) };
  const unc = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(p);
  if (unc) return { root: `//${unc[1]}/${unc[2]}/`, rest: p.slice(unc[0].length) };
  if (p.startsWith('/')) return { root: '/', rest: p.slice(1) };
  return { root: '', rest: p };
}

function normalizeSegments(rest: string): string[] {
  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out;
}

/** Converts Windows-specific spellings into slash form: `C:\x`, `\\?\C:\x`, `/c/x`, `/cygdrive/c/x`, `\\srv\share`. */
function windowsSlashForm(input: string): string {
  let p = input.replace(/\\/g, '/');
  p = p.replace(/^\/\/\?\/(?:UNC\/)?/i, (m) => (/UNC/i.test(m) ? '//' : ''));
  const msys = /^\/(?:cygdrive\/|mnt\/)?([A-Za-z])(?=\/|$)/.exec(p);
  if (msys) p = `${msys[1]!.toUpperCase()}:${p.slice(msys[0].length) || '/'}`;
  const driveRelative = /^([A-Za-z]):(?!\/)/.exec(p);
  if (driveRelative) p = `${driveRelative[1]}:/${p.slice(2)}`;
  return p;
}

/**
 * Resolves a path the way the shell or tool would, lexically. Returns an absolute path with forward
 * slashes and an upper-case drive letter on Windows.
 */
export function resolvePath(input: string, env: PathEnv): string {
  const win = isWindows(env.platform);
  let p = expandHome(input.trim(), env.home);
  if (win) {
    p = windowsSlashForm(p);
    // Git Bash, the shell Claude Code runs on Windows, mounts /tmp on the user's temporary folder.
    if (/^\/tmp(?=\/|$)/i.test(p)) p = windowsSlashForm(`${env.home}/AppData/Local/Temp${p.slice(4)}`);
  }
  let { root, rest } = splitRoot(p);
  if (!root) {
    const base = win ? windowsSlashForm(env.cwd) : env.cwd;
    const b = splitRoot(base);
    root = b.root || '/';
    rest = `${b.rest}/${rest}`;
  } else if (win && root === '/') {
    // A rooted path without a drive on Windows ("/Users/x") lives on the current drive.
    const drive = splitRoot(windowsSlashForm(env.cwd)).root;
    if (/^[A-Z]:\/$/.test(drive)) root = drive;
  }
  const segs = normalizeSegments(rest);
  return root + segs.join('/');
}

/** The comparison key of a resolved path: case-folded where the platform ignores case, no trailing slash. */
export function pathKey(resolved: string, platform: Platform): string {
  const p = resolved.length > 1 && resolved.endsWith('/') && !/^[A-Za-z]:\/$/.test(resolved) ? resolved.slice(0, -1) : resolved;
  return caseInsensitive(platform) ? p.toLowerCase() : p;
}

/** True when `child` is `parent` or lies inside it. Both must be resolved paths. */
export function isUnder(child: string, parent: string, platform: Platform): boolean {
  const c = pathKey(child, platform);
  const pk = pathKey(parent, platform);
  if (c === pk) return true;
  const prefix = pk.endsWith('/') ? pk : pk + '/';
  return c.startsWith(prefix);
}

/** True when `resolved` is a filesystem root: `/`, `C:/`, or a UNC share root. */
export function isRoot(resolved: string): boolean {
  return resolved === '/' || /^[A-Za-z]:\/$/.test(resolved) || /^\/\/[^/]+\/[^/]+\/?$/.test(resolved);
}

/** The last segment of a resolved path. */
export function baseName(resolved: string): string {
  const parts = resolved.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? resolved;
}

/** Joins a resolved directory and relative parts. */
export function joinPath(dir: string, ...parts: string[]): string {
  const all = [dir.replace(/\/+$/, ''), ...parts.map((x) => x.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))].filter(Boolean);
  return all.join('/') || '/';
}

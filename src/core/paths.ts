// SPDX-License-Identifier: Apache-2.0
/**
 * Lexical path handling for Windows and POSIX, written without Node so the in-process mod can use it.
 *
 * Every path an agent can write (Windows, Git Bash `/c/...`, `~`, `$HOME`, `%USERPROFILE%`, relative) is
 * turned into one absolute form with forward slashes. Comparisons are case-insensitive on Windows and
 * macOS, whose default file systems ignore case, so `~/.Claude/Settings.json` is the same file as
 * `~/.claude/settings.json` there. Everything here is lexical: 8.3 short names are matched against the
 * names they can stand for, and links are known only through the aliases an adapter that can touch the
 * disk measured.
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

/**
 * Segments with `.` and `..` folded. On Windows, trailing dots and spaces are dropped from each segment as
 * the Win32 path rules do: measured, PowerShell's Set-Content and cmd's `>` write `folder.\x.txt.` into
 * `folder\x.txt`, so `.claude.\settings.json` is the settings file. (Node and Git Bash keep such names
 * literally; judging them as the plain name only ever protects more.) Three or more dots alone are a name.
 */
function normalizeSegments(rest: string, win: boolean): string[] {
  const out: string[] = [];
  for (const raw of rest.split('/')) {
    const seg = win && raw !== '.' && raw !== '..' && /[. ]$/.test(raw) && !/^\.{3,}$/.test(raw) ? raw.replace(/[. ]+$/, '') : raw;
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
  const segs = normalizeSegments(rest, win);
  // The input was trimmed; a last name that ends in spaces only once ".." is folded is trimmed the same way,
  // so a path resolves to the same form however often it is resolved (and such a name is judged as the plain one).
  while (segs.length && /^\s*$/.test(segs[segs.length - 1]!)) segs.pop();
  if (segs.length) segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\s+$/, '');
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

// ── Windows 8.3 short names ───────────────────────────────────────────────────────────────────────────

/** A segment in the 8.3 short form Windows generates for long names: `TERMIN~1`, `CLAUDE~1.JSO`, `TE1A2B~5`. */
const SHORT_NAME = /^([^~.\s/]{1,6})~(\d{1,6})(?:\.([^.\s/]{1,3}))?$/;

export function isShortNameSegment(seg: string): boolean {
  return SHORT_NAME.test(seg);
}

/**
 * ASCII letters and digits of a name, upper-cased: the part of a long name its short name keeps. Letters
 * outside ASCII are dropped before upper-casing, as Windows does (measured: `çağrı-öğe` is `AR-E~1`; an
 * upper-cased `ı` would otherwise become an `I` Windows never wrote).
 */
function shortBasis(s: string): string {
  return s
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Whether Windows could have given `long` the short name `short`. It keeps the first letters of the name
 * (dots, spaces and most punctuation dropped), then `~N`; after a few clashes it keeps two letters and four
 * hex digits of a hash. Lexical and generous on purpose: a false match only means a path is judged as the
 * protected folder it may be.
 */
export function couldBeShortName(short: string, long: string): boolean {
  const m = SHORT_NAME.exec(short);
  if (!m) return false;
  const head = shortBasis(m[1]!);
  if (!head) return false;
  const lastDot = long.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < long.length - 1;
  const base = shortBasis(hasExt ? long.slice(0, lastDot) : long);
  const ext = hasExt ? shortBasis(long.slice(lastDot + 1)) : '';
  if (m[3] !== undefined && !ext.startsWith(shortBasis(m[3]))) return false;
  if (base.startsWith(head)) return true;
  // The hashed form: two letters of the name, then four hex digits.
  return head.length === 6 && /^[0-9A-F]{4}$/.test(head.slice(2)) && base.startsWith(head.slice(0, 2));
}

/**
 * Rewrites a resolved Windows path whose leading segments spell one of the `known` paths through 8.3 short
 * names (`C:/Users/ada/TERMIN~1/x` for `C:/Users/ada/.terminal-code/x`), so a protected folder is recognised
 * however it is spelled. The longest known path that matches wins; paths without a short segment are
 * returned unchanged. Elsewhere than Windows nothing changes.
 */
export function expandShortNames(p: string, known: readonly string[], platform: Platform): string {
  if (!isWindows(platform)) return p;
  const segs = p.split('/');
  if (!segs.some(isShortNameSegment)) return p;
  let best: { known: string[]; length: number } | null = null;
  for (const k of known) {
    const ks = k.replace(/\/+$/, '').split('/');
    if (ks.length > segs.length || (best && ks.length <= best.length)) continue;
    let viaShort = false;
    let ok = true;
    for (let i = 0; i < ks.length; i++) {
      const a = segs[i]!;
      const b = ks[i]!;
      if (a.toLowerCase() === b.toLowerCase()) continue;
      if (isShortNameSegment(a) && couldBeShortName(a, b)) {
        viaShort = true;
        continue;
      }
      ok = false;
      break;
    }
    if (ok && viaShort) best = { known: ks, length: ks.length };
  }
  return best ? [...best.known, ...segs.slice(best.length)].join('/') : p;
}

// ── links ─────────────────────────────────────────────────────────────────────────────────────────────

/** A protected folder that is a link: `real` is where it leads, `spelled` the protected spelling. */
export interface PathAlias {
  real: string;
  spelled: string;
}

/** Rewrites a path inside the real location of a linked protected folder to the protected spelling. */
export function applyAliases(p: string, aliases: readonly PathAlias[], platform: Platform): string {
  for (const a of aliases) {
    if (!isUnder(p, a.real, platform)) continue;
    const rest = pathKey(p, platform) === pathKey(a.real, platform) ? '' : p.slice(a.real.replace(/\/+$/, '').length + 1);
    return rest ? joinPath(a.spelled, rest) : a.spelled;
  }
  return p;
}

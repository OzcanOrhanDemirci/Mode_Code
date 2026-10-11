// SPDX-License-Identifier: Apache-2.0
/**
 * Reading a git command line the way git does: global options first (-C, -c, --git-dir, --work-tree,
 * --no-pager, …), then the subcommand and its arguments. Permission rules match command text and miss
 * `git -C . push --force`; this reads the command instead.
 */
import { resolvePath, type PathEnv } from '../paths.js';

export interface GitCall {
  /** The directory git runs in after every -C (resolved), or null when a -C value is only known at run time. */
  dir: string | null;
  /** The subcommand (push, branch, …), lower-case; '' when none. */
  sub: string;
  args: string[];
  dynamic: boolean[];
  /** name=value pairs from -c and --config-env. */
  config: string[];
  gitDir?: string;
}

const VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--exec-path',
  '--list-cmds',
  '--attr-source',
]);

export function parseGit(args: readonly string[], dynamic: readonly boolean[], env: PathEnv): GitCall {
  let dir: string | null = env.cwd;
  const config: string[] = [];
  let gitDir: string | undefined;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (!a.startsWith('-')) break;
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq !== -1 ? a.slice(0, eq) : a;
    const inline = a.startsWith('--') && eq !== -1 ? a.slice(eq + 1) : undefined;
    if (VALUE_OPTS.has(name)) {
      const value = inline ?? args[i + 1];
      const valueDynamic = inline !== undefined ? false : !!dynamic[i + 1];
      if (name === '-C' && value !== undefined) dir = dir === null || valueDynamic ? null : resolvePath(value, { ...env, cwd: dir });
      if (name === '-c' && value !== undefined) config.push(value);
      if (name === '--config-env' && value !== undefined) config.push(value.split('=')[0] + '=<env>');
      if (name === '--git-dir' && value !== undefined) gitDir = value;
      i += inline !== undefined ? 1 : 2;
      continue;
    }
    if (a.startsWith('-c') && a.length > 2 && !a.startsWith('--')) {
      config.push(a.slice(2)); // -cname=value
      i++;
      continue;
    }
    i++; // flag without value: --no-pager, -p, --bare, --literal-pathspecs, …
  }
  return { dir, sub: (args[i] ?? '').toLowerCase(), args: args.slice(i + 1), dynamic: dynamic.slice(i + 1), config, ...(gitDir ? { gitDir } : {}) };
}

export interface PushTarget {
  /** Destination branch name (refs/heads/ stripped), '*' for "every branch", or null when unknown. */
  dst: string | null;
  force: boolean;
  delete: boolean;
}

export interface PushPlan {
  remote: string | null;
  targets: PushTarget[];
  force: boolean;
  mirror: boolean;
  prune: boolean;
  dryRun: boolean;
  noVerify: boolean;
  /** True when no refspec was given: the target is the current branch (push.default simple/current). */
  implicit: boolean;
}

const PUSH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec', '--signed']);

/** Reads `git push` arguments into targets. `current` is the current branch, when known. */
export function planPush(args: readonly string[], current: string | null): PushPlan {
  let force = false;
  let del = false;
  let mirror = false;
  let prune = false;
  let all = false;
  let dryRun = false;
  let noVerify = false;
  let remote: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      positional.push(a);
      continue;
    }
    const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (name === '--repo') remote = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[i + 1] ?? null);
    if (PUSH_VALUE.has(name) && !a.includes('=') && name !== '--signed') {
      i++;
      continue;
    }
    if (name === '--force' || name === '--force-with-lease' || name === '--force-if-includes') force = true;
    else if (name === '--delete') del = true;
    else if (name === '--mirror') mirror = true;
    else if (name === '--prune') prune = true;
    else if (name === '--all' || name === '--branches') all = true;
    else if (name === '--dry-run') dryRun = true;
    else if (name === '--no-verify') noVerify = true;
    else if (!a.startsWith('--')) {
      // short option cluster: -fu, -dn, …
      const letters = a.slice(1);
      if (letters.includes('f')) force = true;
      if (letters.includes('d')) del = true;
      if (letters.includes('n')) dryRun = true;
      if (letters.includes('o')) i++; // -o takes a value
    }
  }
  if (remote === null && positional.length) remote = positional.shift()!;
  else if (remote !== null && positional.length && positional[0] === remote) positional.shift();
  const targets: PushTarget[] = [];
  for (const spec of positional) {
    const plus = spec.startsWith('+');
    const body = plus ? spec.slice(1) : spec;
    const colon = body.indexOf(':');
    if (colon === 0) {
      targets.push({ dst: branchName(body.slice(1), current), force: force || plus, delete: true });
      continue;
    }
    const src = colon === -1 ? body : body.slice(0, colon);
    const dst = colon === -1 ? src : body.slice(colon + 1);
    targets.push({ dst: branchName(dst, current), force: force || plus, delete: del });
  }
  const implicit = targets.length === 0 && !all && !mirror;
  if (all || mirror) targets.push({ dst: '*', force: force || mirror, delete: false });
  if (implicit) targets.push({ dst: current, force, delete: false });
  return { remote, targets, force, mirror, prune, dryRun, noVerify, implicit };
}

function branchName(ref: string, current: string | null): string | null {
  if (ref === 'HEAD' || ref === '@') return current;
  if (ref.startsWith('refs/tags/')) return `tag:${ref.slice(10)}`;
  return ref.replace(/^refs\/heads\//, '').replace(/^heads\//, '') || null;
}

/** True when `branch` matches one of the protected patterns (exact, or with a trailing '*'). */
export function isProtectedBranch(branch: string | null, patterns: readonly string[]): boolean {
  if (branch === null) return false;
  if (branch === '*') return true;
  return patterns.some((p) => (p.endsWith('*') ? branch.startsWith(p.slice(0, -1)) : branch === p));
}

/** Normalises a remote URL for substring matching: lower-case, no .git suffix, no credentials. */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\/\/[^@/]+@/, '//')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

export function remoteMatches(url: string | null, patterns: readonly string[] | undefined): boolean {
  if (!url || !patterns?.length) return false;
  const n = normalizeRemote(url);
  return patterns.some((p) => n.includes(p.toLowerCase()));
}

export function looksLikeUrl(s: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/i.test(s);
}

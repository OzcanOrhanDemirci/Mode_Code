// SPDX-License-Identifier: Apache-2.0
/**
 * The safety net (docs/safety-belt.md, "Safety net"). A few risky calls are let through in Autonomous and full
 * autonomy because what they take away is kept first: the tips of the branches and the uncommitted changes
 * before a hard reset or a history rewrite, a remote branch's tip before a force-push, the files `git clean`
 * would remove, a folder before it is deleted. What is kept stays where Claude cannot reach it (Mode_Code's data
 * folder, and refs under `refs/modecode/net/` in the repository), and `mode-code net restore <id>` puts it back
 * without overwriting anything. When it cannot be kept, the call is decided as it would be without a net.
 *
 * Pure: what each kind of call keeps, the record, how a record is read back, and the steps back. src/node/net.ts
 * keeps it, with git and the file system.
 */
import type { RuleId } from './belt/types.js';

/** What a call would take away, and so what is kept before it runs. */
export type NetPlan =
  /** Branch, tag and remote-tracking tips, the stash, and the uncommitted changes to tracked files. */
  | { kind: 'refs'; repo: string }
  /** A remote branch's tip, as this computer last saw it (its remote-tracking branch). */
  | { kind: 'remote'; repo: string; remote: string; branch: string }
  /** The untracked files `git clean`, with these arguments, would remove. */
  | { kind: 'untracked'; repo: string; args: readonly string[] }
  /** Files and folders a delete would remove; `copy` for a file the call writes over, which a hard link would follow. */
  | { kind: 'paths'; paths: readonly string[]; copy?: true };

/** A file or folder kept: where it was, and its copy in the net's own folder. */
export interface KeptFile {
  from: string;
  to: string;
}

/** What one net kept. */
export interface NetRecord {
  v: 1;
  id: string;
  at: number;
  session: string | null;
  rule: RuleId;
  tool: string;
  /** The call, secrets masked: what the person reads in the list. */
  command: string;
  plan: NetPlan;
  /** The tips as they were, by full ref name. */
  refs: { name: string; sha: string }[];
  /** The uncommitted changes to tracked files, as a stash commit (`git stash create`); null when there were none. */
  work: string | null;
  /** The stash's entries, newest first. */
  stashes: string[];
  /** The remote branch's tip before the call, as its remote-tracking branch had it. */
  remote: { remote: string; branch: string; sha: string } | null;
  files: KeptFile[];
  /** Bytes copied (a file kept by a hard link costs nothing). */
  bytes: number;
}

/** How long a net is kept, and how many at most: older ones go at a session's start. */
export const NET_KEEP_DAYS = 14;
export const NET_KEEP_MAX = 100;

/** Above this, a net that would have to copy (no hard link: another drive) is not laid. */
export const NET_COPY_LIMIT = 50 * 1024 * 1024;

/** Above this many files a net is not laid: the call is decided as without one. */
export const NET_FILE_LIMIT = 20_000;

/** The ref a kept commit lives under in its repository, so git's cleanup never takes it. */
export function keepRef(id: string, sha: string): string {
  return `refs/modecode/net/${id}/${sha}`;
}

/** A net's id: its time (UTC) and a few random letters, so the list sorts by time. */
export function netId(now: number, random: string): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${random.replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
}

/** Whether a string is a net's id: a name for a folder, never a path. */
export function isNetId(s: string): boolean {
  return /^\d{8}-\d{6}-[a-z0-9]{1,6}$/.test(s);
}

/** `git for-each-ref --format='%(objectname) %(refname)'`: the tips worth keeping (not Mode_Code's own). */
export function parseRefs(out: string): { name: string; sha: string }[] {
  const refs: { name: string; sha: string }[] = [];
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40,64}) (refs\/(?:heads|tags|remotes)\/\S+)$/.exec(line.trim());
    if (m && !m[2]!.endsWith('/HEAD')) refs.push({ name: m[2]!, sha: m[1]! });
  }
  return refs;
}

/** One commit id per line (`git stash create`, `git log -g --format=%H refs/stash`). */
export function parseShas(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{40,64}$/.test(l));
}

/** `git clean -n`'s answer: the paths it would remove, relative to where it ran (a folder ends in `/`). */
export function parseCleanDryRun(out: string): string[] {
  const paths: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^Would remove (.+)$/.exec(line.trimEnd());
    if (m) paths.push(m[1]!);
  }
  return paths;
}

/**
 * The arguments that ask `git clean` what it would remove, without removing it: the call's own flags (which
 * files, which folders, ignored ones too), its paths, and `-n` in place of `-f`. Interactive mode is never asked.
 */
export function cleanDryRunArgs(args: readonly string[]): string[] {
  const out: string[] = ['clean', '-n'];
  let paths = false;
  for (const a of args) {
    if (paths || a === '--') {
      out.push(a);
      paths = true;
      continue;
    }
    if (a === '--force' || a === '--interactive' || a === '--quiet') continue;
    // Short flags, alone or together (-f, -fdx): every one but force, interactive, quiet and the dry run itself.
    if (/^-[a-zA-Z]+$/.test(a)) {
      const kept = a
        .slice(1)
        .split('')
        .filter((c) => !'fiqn'.includes(c))
        .join('');
      if (kept) out.push(`-${kept}`);
      continue;
    }
    out.push(a);
  }
  return out;
}

/** A record read back from its file; null for anything that is not one. */
export function parseNetRecord(text: string | null): NetRecord | null {
  if (!text) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || o.v !== 1 || typeof o.id !== 'string' || !isNetId(o.id) || typeof o.at !== 'number' || typeof o.rule !== 'string')
    return null;
  const plan = o.plan as NetPlan | undefined;
  if (!plan || typeof plan !== 'object' || !['refs', 'remote', 'untracked', 'paths'].includes((plan as { kind?: unknown }).kind as string)) return null;
  const list = <T>(x: unknown, ok: (y: unknown) => y is T): T[] => (Array.isArray(x) ? x.filter(ok) : []);
  const isRef = (y: unknown): y is { name: string; sha: string } =>
    !!y && typeof y === 'object' && typeof (y as { name?: unknown }).name === 'string' && typeof (y as { sha?: unknown }).sha === 'string';
  const isFile = (y: unknown): y is KeptFile =>
    !!y && typeof y === 'object' && typeof (y as { from?: unknown }).from === 'string' && typeof (y as { to?: unknown }).to === 'string';
  const r = o.remote as NetRecord['remote'];
  return {
    v: 1,
    id: o.id,
    at: o.at,
    session: typeof o.session === 'string' ? o.session : null,
    rule: o.rule as RuleId,
    tool: typeof o.tool === 'string' ? o.tool : '?',
    command: typeof o.command === 'string' ? o.command : '',
    plan,
    refs: list(o.refs, isRef),
    work: typeof o.work === 'string' ? o.work : null,
    stashes: list(o.stashes, (y): y is string => typeof y === 'string'),
    remote: r && typeof r === 'object' && typeof r.remote === 'string' && typeof r.branch === 'string' && typeof r.sha === 'string' ? r : null,
    files: list(o.files, isFile),
    bytes: typeof o.bytes === 'number' ? o.bytes : 0,
  };
}

/** Whether a net kept anything at all: one that kept nothing is not recorded. */
export function keptAnything(r: Pick<NetRecord, 'refs' | 'work' | 'stashes' | 'remote' | 'files'>): boolean {
  return r.refs.length > 0 || r.work !== null || r.stashes.length > 0 || r.remote !== null || r.files.length > 0;
}

/** One step back: a git call to run, a file to put back where it was, or a command for the person. */
export type RestoreStep =
  { kind: 'git'; repo: string; args: string[]; what: string } | { kind: 'copy'; from: string; to: string } | { kind: 'person'; command: string; what: string };

/**
 * The steps back, none of which overwrites anything. A branch that is gone comes back under its name; one that
 * moved gets a branch of its own at its old tip, beside it; the uncommitted changes go into the stash list; a file
 * comes back where it was if nothing is there now. What goes outside the computer (a remote branch) is the
 * person's to run: its command is said. `now` is the repository's refs as they are now (full name → commit),
 * `stashed` the commits its stash holds now.
 */
export function restoreSteps(r: NetRecord, now: ReadonlyMap<string, string>, stashed: ReadonlySet<string>, exists: (path: string) => boolean): RestoreStep[] {
  const steps: RestoreStep[] = [];
  const repo = r.plan.kind === 'paths' ? null : r.plan.repo;
  if (repo) {
    for (const ref of r.refs) {
      if (!ref.name.startsWith('refs/heads/')) continue;
      const branch = ref.name.slice('refs/heads/'.length);
      const current = now.get(ref.name);
      if (current === ref.sha) continue;
      if (current === undefined) steps.push({ kind: 'git', repo, args: ['branch', '--', branch, ref.sha], what: branch });
      else {
        const beside = `modecode/net-${r.id}/${branch}`;
        if (!now.has(`refs/heads/${beside}`)) steps.push({ kind: 'git', repo, args: ['branch', '--', beside, ref.sha], what: beside });
      }
    }
    for (const ref of r.refs) {
      if (!ref.name.startsWith('refs/tags/') || now.has(ref.name)) continue;
      steps.push({ kind: 'git', repo, args: ['tag', '--', ref.name.slice('refs/tags/'.length), ref.sha], what: ref.name.slice('refs/tags/'.length) });
    }
    // Oldest first, so the stash ends as it was; the uncommitted changes on top.
    const back = [...r.stashes.slice().reverse(), ...(r.work ? [r.work] : [])];
    for (const sha of [...new Set(back)])
      if (!stashed.has(sha)) steps.push({ kind: 'git', repo, args: ['stash', 'store', '-m', `mode-code net ${r.id}`, sha], what: 'stash' });
    if (r.remote) {
      const tip = now.get(`refs/remotes/${r.remote.remote}/${r.remote.branch}`);
      if (tip !== r.remote.sha)
        steps.push({
          kind: 'person',
          command: `git push --force-with-lease=${r.remote.branch}:${tip ?? ''} ${r.remote.remote} ${r.remote.sha}:refs/heads/${r.remote.branch}`,
          what: `${r.remote.remote}/${r.remote.branch}`,
        });
    }
  }
  for (const f of r.files) if (!exists(f.from)) steps.push({ kind: 'copy', from: f.to, to: f.from });
  return steps;
}

/** The nets to remove now: past their days, or past the most kept, oldest first. */
export function netsToPrune(records: readonly Pick<NetRecord, 'id' | 'at'>[], now: number, keepDays = NET_KEEP_DAYS, keepMax = NET_KEEP_MAX): string[] {
  const sorted = records.slice().sort((a, b) => b.at - a.at);
  return sorted.filter((r, i) => i >= keepMax || now - r.at > keepDays * 86_400_000).map((r) => r.id);
}

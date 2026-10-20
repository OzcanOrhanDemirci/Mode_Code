// SPDX-License-Identifier: Apache-2.0
/**
 * The safety net kept on disk (src/core/net.ts, docs/safety-belt.md "Safety net"), for the safety-net hook and the
 * command line: laying a net before a call, listing the nets, putting one back, and pruning old ones. git runs with
 * nothing the repository names (src/core/git-safe.ts) and with its hooks off, as every git call of Mode_Code's.
 * A net that cannot be laid in full is not laid: the call is then decided as it would be without one.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, linkSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RuleId } from '../core/belt/types.js';
import { filterDriversQuery, needsFilterDrivers, repoFilterDrivers, safeGitArgs } from '../core/git-safe.js';
import type { Layout } from '../core/layout.js';
import {
  cleanDryRunArgs,
  isNetId,
  keepRef,
  keptAnything,
  NET_COPY_LIMIT,
  NET_FILE_LIMIT,
  netId,
  netsToPrune,
  parseCleanDryRun,
  parseNetRecord,
  parseRefs,
  parseShas,
  restoreSteps,
  type KeptFile,
  type NetPlan,
  type NetRecord,
  type RestoreStep,
} from '../core/net.js';
import { exists, readText, writeJsonAtomic } from './fsx.js';
import { gitProgram } from './git.js';

/** How long laying one net may take: the hook answers for itself after eight seconds (src/hook/main.ts). */
const BUDGET_MS = 5000;

class NoNet extends Error {}

/**
 * git for the net: no prompt, nothing the repository's settings name (its filter drivers off where git reads the
 * files' content), and no hooks, since writing a ref runs one; the output untrimmed. `input` goes to git's stdin.
 */
function netGit(dir: string, args: readonly string[], noHooks: string, opts: { timeoutMs?: number; input?: string } = {}): { ok: boolean; out: string } {
  const program = gitProgram();
  if (!program) return { ok: false, out: '' };
  const run = (argv: readonly string[]) =>
    spawnSync(program, argv, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 4000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      ...(opts.input === undefined ? {} : { input: opts.input }),
      maxBuffer: 64 * 1024 * 1024,
    });
  let drivers: string[] = [];
  if (needsFilterDrivers(args)) {
    const q = run(filterDriversQuery(dir));
    const names = q.status === 0 ? repoFilterDrivers(q.stdout ?? '') : q.status === 1 ? [] : null;
    if (!names) return { ok: false, out: '' };
    drivers = names;
  }
  const base = safeGitArgs(dir, args, drivers);
  const at = base.indexOf('--no-pager') + 1;
  const r = run([...base.slice(0, at), '-c', `core.hooksPath=${noHooks}`, ...base.slice(at)]);
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/** Keeps a file or folder at `to`: a hard link per file where the drive allows, else a copy, within the limits. */
function keepTree(from: string, to: string, count: { files: number; bytes: number; until: number }): void {
  if (Date.now() > count.until) throw new NoNet('time');
  const s = lstatSync(from);
  if (s.isSymbolicLink()) {
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(readlinkSync(from), to);
    return;
  }
  if (s.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) keepTree(join(from, name), join(to, name), count);
    return;
  }
  if (!s.isFile()) return;
  if (++count.files > NET_FILE_LIMIT) throw new NoNet('files');
  mkdirSync(dirname(to), { recursive: true });
  try {
    linkSync(from, to);
  } catch {
    count.bytes += s.size;
    if (count.bytes > NET_COPY_LIMIT) throw new NoNet('size');
    copyFileSync(from, to);
  }
}

export interface LayInput {
  layout: Pick<Layout, 'netDir'>;
  plan: NetPlan;
  rule: RuleId;
  tool: string;
  command: string;
  session: string | null;
  now: number;
}

/**
 * Lays one net: keeps what the call would take away, writes the record, and returns it. Null when it could not be
 * kept in full (no git, a limit passed, a file that cannot be read), with whatever was half kept removed again.
 */
export function layNet(input: LayInput): NetRecord | null {
  const id = netId(
    input.now,
    randomBytes(4)
      .toString('hex')
      .replace(/[^a-z0-9]/g, ''),
  );
  const dir = join(input.layout.netDir, id);
  const noHooks = join(input.layout.netDir, '.no-hooks');
  const count = { files: 0, bytes: 0, until: Date.now() + BUDGET_MS };
  // Each git call gets what is left of the time: one that runs out lays no net.
  const left = () => {
    const ms = count.until - Date.now();
    if (ms <= 0) throw new NoNet('time');
    return { timeoutMs: ms };
  };
  const record: NetRecord = {
    v: 1,
    id,
    at: input.now,
    session: input.session,
    rule: input.rule,
    tool: input.tool,
    command: input.command,
    plan: input.plan,
    refs: [],
    work: null,
    stashes: [],
    remote: null,
    files: [],
    bytes: 0,
  };
  // One ref per commit kept, in one call: git's cleanup never takes what a ref names.
  const keepCommits = (repo: string, shas: readonly string[]) => {
    const lines = [...new Set(shas)].map((sha) => `update ${keepRef(id, sha)} ${sha}\n`).join('');
    if (lines && !netGit(repo, ['update-ref', '--stdin'], noHooks, { ...left(), input: lines }).ok) throw new NoNet('ref');
  };
  try {
    const p = input.plan;
    if (p.kind === 'refs') {
      const refs = netGit(p.repo, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags', 'refs/remotes'], noHooks, left());
      if (!refs.ok) throw new NoNet('refs');
      record.refs = parseRefs(refs.out);
      const work = netGit(p.repo, ['stash', 'create'], noHooks, left());
      if (!work.ok) throw new NoNet('work');
      record.work = parseShas(work.out)[0] ?? null;
      const stash = netGit(p.repo, ['log', '-g', '--format=%H', 'refs/stash'], noHooks, left());
      record.stashes = stash.ok ? parseShas(stash.out) : [];
      // Tags may point at tags: the commit each names is kept by the tag object itself.
      keepCommits(p.repo, [...record.refs.map((r) => r.sha), ...(record.work ? [record.work] : []), ...record.stashes]);
    } else if (p.kind === 'remote') {
      const tip = netGit(p.repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${p.remote}/${p.branch}^{commit}`], noHooks, left());
      const sha = parseShas(tip.out)[0];
      if (!tip.ok || !sha) throw new NoNet('remote');
      record.remote = { remote: p.remote, branch: p.branch, sha };
      keepCommits(p.repo, [sha]);
    } else {
      const sources =
        p.kind === 'paths'
          ? p.paths
          : (() => {
              const dry = netGit(p.repo, cleanDryRunArgs(p.args), noHooks, left());
              if (!dry.ok) throw new NoNet('clean');
              return parseCleanDryRun(dry.out).map((rel) => join(p.repo, rel.replace(/\/$/, '')));
            })();
      const files: KeptFile[] = [];
      sources.forEach((from, n) => {
        try {
          lstatSync(from);
        } catch {
          return; // nothing there: nothing to keep
        }
        const to = join(dir, 'files', String(n));
        keepTree(from, to, count);
        files.push({ from: from.replace(/\\/g, '/'), to: to.replace(/\\/g, '/') });
      });
      record.files = files;
      record.bytes = count.bytes;
    }
    if (!keptAnything(record)) return { ...record };
    writeJsonAtomic(join(dir, 'net.json'), record);
    return record;
  } catch {
    dropNet(input.layout, record);
    return null;
  }
}

/** Removes a net: its folder, and its refs in the repository. */
function dropNet(l: Pick<Layout, 'netDir'>, r: NetRecord): void {
  const repo = r.plan.kind === 'paths' ? null : r.plan.repo;
  if (repo) {
    const noHooks = join(l.netDir, '.no-hooks');
    const shas = [...new Set([...r.refs.map((x) => x.sha), ...(r.work ? [r.work] : []), ...r.stashes, ...(r.remote ? [r.remote.sha] : [])])];
    const lines = shas.map((sha) => `delete ${keepRef(r.id, sha)}\n`).join('');
    if (lines) netGit(repo, ['update-ref', '--stdin'], noHooks, { input: lines });
  }
  try {
    rmSync(join(l.netDir, r.id), { recursive: true, force: true });
  } catch {
    /* removed at the next prune */
  }
}

/** Every net on this computer, newest first. */
export function listNets(l: Pick<Layout, 'netDir'>): NetRecord[] {
  let names: string[];
  try {
    names = readdirSync(l.netDir).filter(isNetId);
  } catch {
    return [];
  }
  return names
    .map((id) => parseNetRecord(readText(join(l.netDir, id, 'net.json'))))
    .filter((r): r is NetRecord => r !== null)
    .sort((a, b) => b.at - a.at);
}

/** A repository's refs as they are now, full name → commit. */
function refsNow(l: Pick<Layout, 'netDir'>, repo: string): Map<string, string> {
  const out = netGit(repo, ['for-each-ref', '--format=%(objectname) %(refname)'], join(l.netDir, '.no-hooks'));
  const map = new Map<string, string>();
  for (const line of out.out.split('\n')) {
    const m = /^([0-9a-f]{40,64}) (\S+)$/.exec(line.trim());
    if (m) map.set(m[2]!, m[1]!);
  }
  return map;
}

/** The steps back for one net, as they stand now. */
export function netSteps(l: Pick<Layout, 'netDir'>, r: NetRecord): RestoreStep[] {
  const repo = r.plan.kind === 'paths' ? null : r.plan.repo;
  const stash = repo ? netGit(repo, ['log', '-g', '--format=%H', 'refs/stash'], join(l.netDir, '.no-hooks')) : null;
  return restoreSteps(r, repo ? refsNow(l, repo) : new Map(), new Set(stash?.ok ? parseShas(stash.out) : []), exists);
}

/** Puts a net back: every step that changes nothing already there; what is the person's (outward) is returned. */
export function restoreNet(l: Pick<Layout, 'netDir'>, r: NetRecord): { done: RestoreStep[]; failed: RestoreStep[]; person: RestoreStep[] } {
  const out = { done: [] as RestoreStep[], failed: [] as RestoreStep[], person: [] as RestoreStep[] };
  const noHooks = join(l.netDir, '.no-hooks');
  for (const step of netSteps(l, r)) {
    if (step.kind === 'person') out.person.push(step);
    else if (step.kind === 'git') (netGit(step.repo, step.args, noHooks).ok ? out.done : out.failed).push(step);
    else {
      try {
        copyBack(step.from, step.to);
        out.done.push(step);
      } catch {
        out.failed.push(step);
      }
    }
  }
  return out;
}

/** A kept file or folder copied back where it was (a copy, so the net keeps its own). */
function copyBack(from: string, to: string): void {
  const s = lstatSync(from);
  if (s.isSymbolicLink()) {
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(readlinkSync(from), to);
    return;
  }
  if (s.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const next = join(to, name);
      if (!exists(next)) copyBack(join(from, name), next);
    }
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** Removes the nets past their days or their number (at a session's start). */
export function pruneNets(l: Pick<Layout, 'netDir'>, now: number): number {
  const all = listNets(l);
  const gone = new Set(netsToPrune(all, now));
  for (const r of all) if (gone.has(r.id)) dropNet(l, r);
  // A folder without a record is half a net a hook was stopped in the middle of: it goes too.
  try {
    for (const name of readdirSync(l.netDir))
      if (isNetId(name) && !all.some((r) => r.id === name)) {
        const age = now - statSync(join(l.netDir, name)).mtimeMs;
        if (age > 3_600_000) rmSync(join(l.netDir, name), { recursive: true, force: true });
      }
  } catch {
    /* no nets yet */
  }
  return gone.size;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Keeping the memory store in sync (docs/memory.md): commit what changed (holding back files that look like
 * they hold a secret), bring in what changed elsewhere, send what is new. One function over an injected
 * command runner, so the plugin ($.process.run), the safety-net hook and the command line (child processes)
 * run the same steps. Nothing is ever forced: a conflict is undone and reported, a rejected push is
 * retried once after a pull, an unreachable remote is left for the next time.
 */
import type { MemorySyncMode } from './config.js';
import { sha256Hex } from './sha256.js';
import { scanSecrets } from './secrets/scan.js';
import { changeCounts, indexChange, INDEX_FILE, isDeletion, mergePulled, parsePorcelainZ, type Pulled, type StoreChange } from './memory.js';

/** Runs a program; resolves with its exit code and output, rejects when it cannot start or times out. */
export interface Runner {
  run(
    argv: readonly string[],
    opts: { cwd: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** git never asks a question here: no terminal prompts, no credential windows, English messages to classify. */
export const GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
  LANGUAGE: 'C',
});

/** Files larger than this are held back: memory is notes, and a large file is likely something else. */
export const MAX_NOTE_BYTES = 1_000_000;

export type Outcome = 'ok' | 'none' | 'skipped' | 'offline' | 'auth' | 'busy' | 'failed';
/** conflict: the pull could not join files changed here (undone); diverged: a fast-forward was asked for and both sides moved. */
export type PullOutcome = Outcome | 'conflict' | 'diverged';
/** held: what it would send holds a secret (SyncInput.outgoing): nothing was sent. */
export type PushOutcome = Outcome | 'rejected' | 'held';
export type CommitOutcome = 'ok' | 'none' | 'skipped' | 'held' | 'identity' | 'busy' | 'failed';

export interface HeldFile {
  path: string;
  reason: 'secret' | 'large';
  /** A secret in a commit a push would send: its kind, and the fingerprint the person can allow (never the value). */
  kind?: string;
  fingerprint?: string;
}

/** A held file as the person reads it: its path, and the kind of secret in it, never the secret. */
export function heldText(h: HeldFile): string {
  return h.kind ? `${h.path} <REDACTED:${h.kind}>` : h.path;
}

/** A secret in what a push would send: the file it is added to, its kind, and its fingerprint (SHA-256 of the value). */
export interface OutgoingSecret {
  path: string;
  kind: string;
  fingerprint: string;
}

/**
 * The secrets in what a push would send, but those the person allowed by fingerprint (a false alarm they looked at):
 * documented token formats only, in the lines the commits add. Pure.
 */
export function outgoingSecrets(allowed: ReadonlySet<string>): (files: readonly { path: string; text: string }[]) => OutgoingSecret[] {
  return (files) =>
    files.flatMap((f) =>
      scanSecrets(f.text)
        .filter((m) => m.confidence === 'high')
        .map((m) => ({ path: f.path, kind: m.kind, fingerprint: sha256Hex(f.text.slice(m.start, m.end)) }))
        .filter((s) => !allowed.has(s.fingerprint)),
    );
}

/** The fingerprints of the secrets the person allowed to leave in a push (secrets-allow.json); anything malformed is none. */
export function parseAllowed(text: string | null): Set<string> {
  try {
    const o = JSON.parse(text ?? '') as { allowed?: unknown };
    return new Set(
      (Array.isArray(o.allowed) ? o.allowed : []).flatMap((a) =>
        a && typeof a.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(a.fingerprint) ? [a.fingerprint as string] : [],
      ),
    );
  } catch {
    return new Set();
  }
}

/** The lines `git log -p` shows added, by file (the path after `+++ b/`). Pure. */
export function addedLines(patch: string): { path: string; text: string }[] {
  const by = new Map<string, string[]>();
  let path: string | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      path = p === '/dev/null' ? null : p.replace(/^b\//, '');
    } else if (line.startsWith('diff --git ')) path = null;
    else if (path !== null && line.startsWith('+')) (by.get(path) ?? by.set(path, []).get(path)!).push(line.slice(1));
  }
  return [...by].map(([p, lines]) => ({ path: p, text: lines.join('\n') }));
}

export interface SyncResult {
  /** The folder is a git work tree. */
  repo: boolean;
  commit: CommitOutcome;
  /** Files in the commit made now. */
  committed: number;
  held: HeldFile[];
  pull: PullOutcome;
  push: PushOutcome;
  /** Files a pull could not join (the pull was undone; they are as they were). */
  conflicts: string[];
  /** Commits not yet on the remote, and on the remote not yet here (as of the last fetch); null without an upstream. */
  ahead: number | null;
  behind: number | null;
  /**
   * What arrived from elsewhere, by paths in the store: what this sync's pulls brought, and what came in since
   * `since` by any other hand (the person's own pull, another tool); with the lines it changed in the index.
   */
  pulled: string[];
  index: Pulled['index'];
  /** Where the store stands after the sync (a commit), null without one: the next sync's `since`. */
  head: string | null;
  /** The first line of what went wrong, for the person. */
  detail: string;
}

export interface SyncInput {
  dir: string;
  /** The store has a remote to pull from and push to (place github or both). */
  remote: boolean;
  /** Which steps to take: a turn's end commits and pushes; a session's start does all three. */
  steps: { commit: boolean; pull: boolean; push: boolean };
  /** The commit message for what changed. */
  message: (counts: { added: number; changed: number; removed: number }) => string;
  /** A file's text by its absolute path (the repository's top joined with git's path), or null when it cannot be read. */
  readFile: (path: string) => Promise<string | null>;
  /** How many secrets the scanner finds in a text. */
  secrets: (text: string) => number;
  /** How to run git: its name on the PATH (the default), or the full path the setup found it at. */
  gitCommand?: string;
  /**
   * How a pull joins what came in: rebase this store's own commits onto it (the default), or only a
   * fast-forward, for a store whose owner commits and pushes (memory.store.sync "pull").
   */
  pullMode?: 'rebase' | 'ff-only';
  /** The commit this computer last saw the store at: what arrived since, by any hand, is reported as well. */
  since?: string | null;
  /** Files larger than this are held back (MAX_NOTE_BYTES unless given: the sync's history files may be larger than notes). */
  maxBytes?: number;
  /**
   * The secrets in what a push would send (outgoingSecrets): the lines the commits not yet on the remote add, those
   * made by hand too. A push that would send one is held, and each is told by its kind and fingerprint.
   */
  outgoing?: (files: readonly { path: string; text: string }[]) => OutgoingSecret[];
}

export type SyncTrigger = 'start' | 'turn' | 'manual';

export interface SyncPlan {
  steps: { commit: boolean; pull: boolean; push: boolean };
  pullMode: 'rebase' | 'ff-only';
}

/**
 * What a sync does, by the store's mode and what set it off. auto: everything at a session's start and when
 * the person asks, commit and send after a turn. pull: only a fast-forward at the start and when asked,
 * never a commit or a push. manual: nothing by itself; everything when the person asks. A plan without a
 * step still looks: what arrived since the last session, by any hand, is reported.
 */
export function syncPlan(mode: MemorySyncMode, trigger: SyncTrigger): SyncPlan {
  if (mode === 'auto') return { steps: { commit: true, pull: trigger !== 'turn', push: true }, pullMode: 'rebase' };
  if (mode === 'pull') return { steps: { commit: false, pull: trigger !== 'turn', push: false }, pullMode: 'ff-only' };
  const asked = trigger === 'manual';
  return { steps: { commit: asked, pull: asked, push: asked }, pullMode: 'rebase' };
}

/** A plan that only looks. */
export function looksOnly(p: SyncPlan): boolean {
  return !p.steps.commit && !p.steps.pull && !p.steps.push;
}

/** Sorts a failed git call by what the person can do about it. */
export function classifyGitError(stderr: string): 'offline' | 'auth' | 'rejected' | 'busy' | 'identity' | 'failed' {
  const s = stderr;
  if (/index\.lock|unable to create '.*\.lock'|Another git process|cannot lock ref/i.test(s)) return 'busy';
  if (/please tell me who you are|unable to auto-detect email|empty ident/i.test(s)) return 'identity';
  if (/\[rejected\]|non-fast-forward|fetch first|updates were rejected/i.test(s)) return 'rejected';
  if (
    /authentication failed|could not read (?:username|password)|permission denied|repository not found|returned error: 40[134]|access denied|invalid credentials/i.test(
      s,
    )
  )
    return 'auth';
  if (
    /could not resolve host|unable to access|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|temporary failure in name resolution|operation timed out|could not read from remote/i.test(
      s,
    )
  )
    return 'offline';
  return 'failed';
}

function firstLine(s: string): string {
  return (
    s
      .split('\n')
      .map((l) => l.replace(/^(?:fatal|error|hint): /, '').trim())
      .find(Boolean) ?? ''
  ).slice(0, 300);
}

/** One sync of the store. Never throws: every failure is an outcome with a detail line. */
export async function syncMemory(r: Runner, input: SyncInput): Promise<SyncResult> {
  const res: SyncResult = {
    repo: false,
    commit: 'skipped',
    committed: 0,
    held: [],
    pull: 'skipped',
    push: 'skipped',
    conflicts: [],
    ahead: null,
    behind: null,
    pulled: [],
    index: null,
    head: null,
    detail: '',
  };
  const git = async (args: readonly string[], timeoutMs = 15_000) => {
    try {
      const out = await r.run([input.gitCommand ?? 'git', '-C', input.dir, ...args], { cwd: input.dir, timeoutMs, env: { ...GIT_ENV } });
      return { ok: out.exitCode === 0, out: out.stdout, err: out.stderr };
    } catch (err) {
      const text = String((err as Error)?.message ?? err);
      // A call that ran out of time on the network is the network's.
      return { ok: false, out: '', err: /timed? ?out|ETIMEDOUT|killed/i.test(text) ? `operation timed out: ${text}` : text };
    }
  };
  const note = (s: string) => {
    if (!res.detail && s) res.detail = firstLine(s);
  };

  // The store may be a folder inside a larger repository: what is committed is the store's, by paths from the top.
  const top = await git(['rev-parse', '--show-toplevel']);
  if (!top.ok || !top.out.trim()) {
    note(top.err || 'not a git work tree');
    return res;
  }
  res.repo = true;
  const headNow = async () => {
    const h = await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return h.ok && h.out.trim() ? h.out.trim() : null;
  };

  // Where the store stood before this sync touched it: what arrived since `since` by another hand is told too.
  const before = await headNow();
  if (input.steps.commit) await commitStep(git, input, top.out.trim(), res, note);

  // Where it stood before anything came in now: what the pulls bring is told to Claude (its index may predate it).
  const pre = input.remote ? await headNow() : null;
  const mode = input.pullMode ?? 'rebase';
  let upstream = input.remote ? await upstreamOf(git) : null;
  if (input.remote && input.steps.pull) {
    if (upstream === null) upstream = await adoptUpstream(git);
    if (upstream === null) res.pull = 'none';
    else res.pull = mode === 'ff-only' ? await fastForward(git, res, note) : await pullStep(git, res, note);
  }
  if (input.remote && input.steps.push && res.pull !== 'conflict' && res.pull !== 'diverged') {
    res.push = await pushStep(git, upstream, res, note, input.outgoing);
    if (res.push === 'ok' && upstream === null) upstream = await upstreamOf(git);
  }
  res.head = await headNow();
  let arrived: Pulled | null = null;
  const since = input.since?.trim() || null;
  if (since && before && since !== before && (await git(['merge-base', '--is-ancestor', since, before])).ok) arrived = await broughtIn(git, since, before);
  // Only a pull moves where the store stands after the commit: what lies between is what it brought.
  if (pre && res.head && res.head !== pre) {
    const now = await broughtIn(git, pre, res.head);
    if (now) arrived = mergePulled(arrived, now);
  }
  if (arrived) {
    res.pulled = arrived.files;
    res.index = arrived.index;
  }
  if (upstream !== null) {
    const counts = await git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    const m = /^(\d+)\s+(\d+)/.exec(counts.out.trim());
    if (counts.ok && m) {
      res.behind = parseInt(m[1]!, 10);
      res.ahead = parseInt(m[2]!, 10);
    }
  }
  return res;
}

type Git = (args: readonly string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string; err: string }>;

/** Paths per git call when staging, well under the length a command line may have on Windows. */
const CHUNK = 100;

async function commitStep(git: Git, input: SyncInput, top: string, res: SyncResult, note: (s: string) => void): Promise<void> {
  // Run in the store's folder, `-- .` keeps it to the store; git prints paths from the repository's top.
  const st = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  if (!st.ok) {
    res.commit = classifyGitError(st.err) === 'busy' ? 'busy' : 'failed';
    note(st.err);
    return;
  }
  const changes = parsePorcelainZ(st.out);
  if (!changes.length) {
    res.commit = 'none';
    return;
  }
  const ok: StoreChange[] = [];
  for (const c of changes) {
    if (isDeletion(c)) {
      ok.push(c);
      continue;
    }
    const text = await input.readFile(`${top.replace(/[\\/]+$/, '')}/${c.path}`);
    // A folder git lists as one untracked entry (a nested repository) or a file that cannot be read is left as it is.
    if (text === null) continue;
    if (new TextEncoder().encode(text).length > (input.maxBytes ?? MAX_NOTE_BYTES)) res.held.push({ path: c.path, reason: 'large' });
    else if (input.secrets(text) > 0) res.held.push({ path: c.path, reason: 'secret' });
    else ok.push(c);
  }
  if (!ok.length) {
    res.commit = res.held.length ? 'held' : 'none';
    return;
  }
  // Paths from the top of the repository, as git printed them; `:(top)` keeps them so from the store's folder.
  const paths = ok.map((c) => `:(top,literal)${c.path}`);
  for (let i = 0; i < paths.length; i += CHUNK) {
    const add = await git(['add', '-A', '--', ...paths.slice(i, i + CHUNK)]);
    if (!add.ok) {
      const k = classifyGitError(add.err);
      res.commit = k === 'busy' ? 'busy' : 'failed';
      note(add.err);
      return;
    }
  }
  // Only these files go in: anything else staged by hand stays staged. Past one chunk, the staged set is committed.
  const only = paths.length <= CHUNK ? ['--only', '--', ...paths] : [];
  const commit = await git(['commit', '--quiet', '-m', input.message(changeCounts(ok)), ...only], 30_000);
  if (!commit.ok) {
    const k = classifyGitError(commit.err + commit.out);
    res.commit = k === 'identity' ? 'identity' : k === 'busy' ? 'busy' : 'failed';
    note(commit.err || commit.out);
    return;
  }
  res.commit = 'ok';
  res.committed = ok.length;
}

async function upstreamOf(git: Git): Promise<string | null> {
  const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  return up.ok && up.out.trim() ? up.out.trim() : null;
}

/** A branch without an upstream follows origin's branch of the same name, when origin has one. */
async function adoptUpstream(git: Git): Promise<string | null> {
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const name = branch.out.trim();
  if (!branch.ok || !name) return null;
  const fetched = await git(['fetch', '--quiet', 'origin'], 30_000);
  if (!fetched.ok) return null;
  const remoteRef = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`]);
  if (!remoteRef.ok) return null;
  const set = await git(['branch', `--set-upstream-to=origin/${name}`]);
  return set.ok ? `origin/${name}` : null;
}

/**
 * Brings the upstream's commits in, without `git pull`: a pull reads FETCH_HEAD, which another fetch at the
 * same moment (the person's own start hook, a second session) fills with several heads, and git then refuses
 * with "Cannot fast-forward to multiple branches" or "Cannot rebase onto multiple branches" though both sides
 * are level (measured on the author's machine, 2026-10-13 and 2026-10-15). A fetch that leaves FETCH_HEAD
 * alone, then a join with the upstream branch by name, neither trips on another's fetch nor trips another's pull.
 */
async function fetchUpstream(git: Git): Promise<{ ok: boolean; out: string; err: string }> {
  const once = async () => {
    const f = await git(['fetch', '--quiet', '--no-write-fetch-head'], 60_000);
    // git before 2.29 does not know the flag: a plain fetch.
    return !f.ok && /unknown option/i.test(f.err) ? git(['fetch', '--quiet'], 60_000) : f;
  };
  const f = await once();
  // Two fetches moving the same remote branch at once: one finds the other's lock. Once more, after it.
  return !f.ok && classifyGitError(f.err + f.out) === 'busy' ? once() : f;
}

/** A join that met another git's lock (a second session joining the same commits) is made once more. */
async function joinOnce(git: Git, args: readonly string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const j = await git(args, 60_000);
  return !j.ok && classifyGitError(j.err + j.out) === 'busy' ? git(args, 60_000) : j;
}

/** What a pull that could not be made is, by what the person can do about it. */
function pullFailure(text: string): PullOutcome {
  const k = classifyGitError(text);
  return k === 'offline' || k === 'auth' || k === 'busy' ? k : 'failed';
}

async function pullStep(git: Git, res: SyncResult, note: (s: string) => void): Promise<PullOutcome> {
  const fetched = await fetchUpstream(git);
  if (!fetched.ok) {
    note(fetched.err || fetched.out);
    return pullFailure(fetched.err + fetched.out);
  }
  // Without an argument, rebase takes the configured upstream and its fork point, as `git pull --rebase` does.
  const pull = await joinOnce(git, ['rebase', '--autostash', '--quiet']);
  if (pull.ok) return 'ok';
  const conflicted = await git(['diff', '--name-only', '--diff-filter=U']);
  const files = conflicted.ok
    ? conflicted.out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  if (files.length) {
    res.conflicts = files;
    await git(['rebase', '--abort']);
    note(`could not join the changes in ${files.join(', ')}`);
    return 'conflict';
  }
  // A rebase left half done for another reason is undone too: the folder stays as it was.
  const inRebase = await git(['rev-parse', '--verify', '--quiet', 'REBASE_HEAD']);
  if (inRebase.ok) await git(['rebase', '--abort']);
  note(pull.err || pull.out);
  return pullFailure(pull.err + pull.out);
}

/** What changed in the store from one commit to another: the files (store-relative, renames as a removal and an addition), and the index's lines. */
async function broughtIn(git: Git, from: string, to: string): Promise<Pulled | null> {
  const names = await git(['diff', '--name-only', '--no-renames', '--relative', '-z', from, to, '--', '.']);
  if (!names.ok) return null;
  const files = names.out.split('\0').filter(Boolean);
  if (!files.length) return null;
  if (!files.includes(INDEX_FILE)) return { files, index: null };
  const diff = await git(['diff', '--unified=0', '--no-color', '--no-ext-diff', '--relative', from, to, '--', INDEX_FILE]);
  return { files, index: diff.ok ? indexChange(diff.out) : null };
}

/**
 * A pull that only fast-forwards, for a store its owner commits and pushes: nothing of theirs is rebased or
 * merged. Local changes in the way, or both sides having moved, leave the folder as it was and say so.
 */
async function fastForward(git: Git, res: SyncResult, note: (s: string) => void): Promise<PullOutcome> {
  const fetched = await fetchUpstream(git);
  if (!fetched.ok) {
    note(fetched.err || fetched.out);
    return pullFailure(fetched.err + fetched.out);
  }
  const pull = await joinOnce(git, ['merge', '--ff-only', '--quiet', '@{upstream}']);
  if (pull.ok) return 'ok';
  const text = pull.err + pull.out;
  note(text);
  // git names the files a fast-forward would overwrite, one per line, indented.
  if (/would be overwritten by (?:merge|checkout)/i.test(text)) {
    res.conflicts = text
      .split('\n')
      .filter((l) => /^\s+\S/.test(l) && !/^\s*(?:please|aborting)/i.test(l))
      .map((l) => l.trim());
    return 'conflict';
  }
  if (/not possible to fast-forward|diverging branches|cannot fast-forward/i.test(text)) return 'diverged';
  return pullFailure(text);
}

async function pushStep(git: Git, upstream: string | null, res: SyncResult, note: (s: string) => void, outgoing?: SyncInput['outgoing']): Promise<PushOutcome> {
  if (upstream !== null) {
    const ahead = await git(['rev-list', '--count', '@{upstream}..HEAD']);
    if (ahead.ok && ahead.out.trim() === '0') return 'none';
  } else {
    // A first push: there must be something to send.
    const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (!head.ok) return 'none';
  }
  if (outgoing) {
    // Every commit that would go, each with what it adds: a secret added and removed again is still in the history sent.
    const patch = await git(['log', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=', upstream === null ? 'HEAD' : '@{upstream}..HEAD'], 30_000);
    if (!patch.ok) {
      // What cannot be read is not sent.
      note(patch.err || 'the commits to send could not be read');
      return 'failed';
    }
    const found = outgoing(addedLines(patch.out));
    if (found.length) {
      for (const s of found) res.held.push({ path: s.path, reason: 'secret', kind: s.kind, fingerprint: s.fingerprint });
      return 'held';
    }
  }
  const args = upstream === null ? ['push', '--quiet', '--set-upstream', 'origin', 'HEAD'] : ['push', '--quiet'];
  let push = await git(args, 60_000);
  if (!push.ok && classifyGitError(push.err) === 'rejected') {
    // The remote moved on since the pull: bring that in once, then try once more.
    const again = await pullStep(git, res, note);
    if (again === 'conflict') return 'rejected';
    if (again === 'ok') push = await git(args, 60_000);
  }
  if (push.ok) return 'ok';
  note(push.err || push.out);
  const k = classifyGitError(push.err + push.out);
  return k === 'identity' ? 'failed' : k;
}

/** The last sync a writer made, kept in its own file (layout.memorySyncFile). */
export interface SyncRecord {
  at: number;
  trigger: 'start' | 'turn' | 'manual' | 'setup';
  session: string | null;
  result: SyncResult;
}

/** A sync record read back; null when it is missing or not one. */
export function parseSyncRecord(text: string | null): SyncRecord | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Partial<SyncRecord>;
    if (typeof o.at !== 'number' || typeof o.result !== 'object' || o.result === null) return null;
    const r = o.result as Partial<SyncResult>;
    if (typeof r.commit !== 'string' || typeof r.pull !== 'string' || typeof r.push !== 'string') return null;
    return {
      at: o.at,
      trigger: o.trigger === 'start' || o.trigger === 'turn' || o.trigger === 'manual' || o.trigger === 'setup' ? o.trigger : 'manual',
      session: typeof o.session === 'string' ? o.session : null,
      result: {
        repo: r.repo === true,
        commit: r.commit,
        committed: typeof r.committed === 'number' ? r.committed : 0,
        held: Array.isArray(r.held) ? r.held.filter((h) => h && typeof h.path === 'string') : [],
        pull: r.pull,
        push: r.push,
        conflicts: Array.isArray(r.conflicts) ? r.conflicts.filter((c): c is string => typeof c === 'string') : [],
        ahead: typeof r.ahead === 'number' ? r.ahead : null,
        behind: typeof r.behind === 'number' ? r.behind : null,
        // Which files came in is the person's to see; the index's lines were for the session that pulled them.
        pulled: Array.isArray(r.pulled) ? r.pulled.filter((f): f is string => typeof f === 'string') : [],
        index: null,
        head: typeof r.head === 'string' && /^[0-9a-f]{7,64}$/.test(r.head) ? r.head : null,
        detail: typeof r.detail === 'string' ? r.detail : '',
      },
    };
  } catch {
    return null;
  }
}

/** The newest of several writers' records. */
export function newestRecord(records: readonly (SyncRecord | null)[]): SyncRecord | null {
  return records.reduce<SyncRecord | null>((a, b) => (b && (!a || b.at > a.at) ? b : a), null);
}

/** What went wrong in a sync, for the person: the step that failed, or null when every step is fine. */
export function syncProblem(r: SyncResult): 'conflict' | 'diverged' | 'held' | 'offline' | 'auth' | 'rejected' | 'identity' | 'failed' | null {
  if (r.pull === 'conflict') return 'conflict';
  if (r.pull === 'diverged') return 'diverged';
  if (r.commit === 'identity') return 'identity';
  for (const o of [r.pull, r.push, r.commit]) if (o === 'auth') return 'auth';
  if (r.push === 'rejected') return 'rejected';
  for (const o of [r.pull, r.push]) if (o === 'offline') return 'offline';
  for (const o of [r.pull, r.push, r.commit]) if (o === 'failed') return 'failed';
  if (r.held.length) return 'held';
  return null;
}

/** Where a writer last saw the store: a commit, and when (layout.memorySeenFile). */
export interface SeenRecord {
  head: string;
  at: number;
}

export function parseSeen(text: string | null): SeenRecord | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Partial<SeenRecord>;
    return typeof o.head === 'string' && /^[0-9a-f]{7,64}$/.test(o.head) && typeof o.at === 'number' ? { head: o.head, at: o.at } : null;
  } catch {
    return null;
  }
}

/** The commit this computer last saw the store at, the newest of the writers': the next sync's `since`. */
export function lastSeen(records: readonly (SeenRecord | null)[]): string | null {
  return records.reduce<SeenRecord | null>((a, b) => (b && (!a || b.at > a.at) ? b : a), null)?.head ?? null;
}

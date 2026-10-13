// SPDX-License-Identifier: Apache-2.0
/**
 * Keeping the memory store in sync (docs/memory.md): commit what changed (holding back files that look like
 * they hold a secret), bring in what changed elsewhere, send what is new. One function over an injected
 * command runner, so the plugin ($.process.run), the safety-net hook and the command line (child processes)
 * run the same steps. Nothing is ever forced: a conflict is undone and reported, a rejected push is
 * retried once after a pull, an unreachable remote is left for the next time.
 */
import { changeCounts, isDeletion, parsePorcelainZ, type StoreChange } from './memory.js';

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
export type PullOutcome = Outcome | 'conflict';
export type PushOutcome = Outcome | 'rejected';
export type CommitOutcome = 'ok' | 'none' | 'skipped' | 'held' | 'identity' | 'busy' | 'failed';

export interface HeldFile {
  path: string;
  reason: 'secret' | 'large';
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
}

/** Sorts a failed git call by what the person can do about it. */
export function classifyGitError(stderr: string): 'offline' | 'auth' | 'rejected' | 'busy' | 'identity' | 'failed' {
  const s = stderr;
  if (/index\.lock|unable to create '.*\.lock'|Another git process/i.test(s)) return 'busy';
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

  if (input.steps.commit) await commitStep(git, input, top.out.trim(), res, note);

  let upstream = input.remote ? await upstreamOf(git) : null;
  if (input.remote && input.steps.pull) {
    if (upstream === null) upstream = await adoptUpstream(git);
    if (upstream === null) res.pull = 'none';
    else res.pull = await pullStep(git, res, note);
  }
  if (input.remote && input.steps.push && res.pull !== 'conflict') {
    res.push = await pushStep(git, upstream, res, note);
    if (res.push === 'ok' && upstream === null) upstream = await upstreamOf(git);
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
    if (new TextEncoder().encode(text).length > MAX_NOTE_BYTES) res.held.push({ path: c.path, reason: 'large' });
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

async function pullStep(git: Git, res: SyncResult, note: (s: string) => void): Promise<PullOutcome> {
  const pull = await git(['pull', '--rebase', '--autostash', '--quiet'], 60_000);
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
  const k = classifyGitError(pull.err + pull.out);
  return k === 'offline' || k === 'auth' || k === 'busy' ? k : 'failed';
}

async function pushStep(git: Git, upstream: string | null, res: SyncResult, note: (s: string) => void): Promise<PushOutcome> {
  if (upstream !== null) {
    const ahead = await git(['rev-list', '--count', '@{upstream}..HEAD']);
    if (ahead.ok && ahead.out.trim() === '0') return 'none';
  } else {
    // A first push: there must be something to send.
    const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (!head.ok) return 'none';
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
export function syncProblem(r: SyncResult): 'conflict' | 'held' | 'offline' | 'auth' | 'rejected' | 'identity' | 'failed' | null {
  if (r.pull === 'conflict') return 'conflict';
  if (r.commit === 'identity') return 'identity';
  for (const o of [r.pull, r.push, r.commit]) if (o === 'auth') return 'auth';
  if (r.push === 'rejected') return 'rejected';
  for (const o of [r.pull, r.push]) if (o === 'offline') return 'offline';
  for (const o of [r.pull, r.push, r.commit]) if (o === 'failed') return 'failed';
  if (r.held.length) return 'held';
  return null;
}

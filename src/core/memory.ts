// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store (docs/memory.md): the folder Claude Code keeps its auto memory in, where it lives (this
 * computer, the person's GitHub, or both), and what terminal-code adds to it (handoff notes, a README, a
 * .gitignore). Pure: names, paths, checks and texts; the git work is in memory-sync.ts, the disk and the
 * network in the node layer.
 */
import { APP_NAME, PREVIOUS_NAMES } from './app.js';
import type { Config } from './config.js';
import { tIn, type Lang } from './i18n/index.js';
import { joinPath } from './paths.js';
import { maskSecrets } from './secrets/scan.js';
import { truncate } from './text.js';

/** Folders terminal-code keeps inside the store. */
export const HANDOFF_DIR = 'handoffs';
export const PROJECTS_DIR = 'projects';

/** The index Claude Code loads into every session, at the store's top. */
export const INDEX_FILE = 'MEMORY.md';

/** GitHub's limits for a repository's name. */
export const REPO_NAME_MAX = 100;

export type RepoNameProblem = 'empty' | 'long' | 'chars' | 'dots' | 'gitSuffix';

/**
 * Checks a repository name the way GitHub accepts it: letters, digits, `.`, `-` and `_`, at most 100, not
 * `.` or `..`, not ending in `.git` (GitHub would drop the suffix and name it something else).
 */
export function repoNameProblems(name: string): RepoNameProblem[] {
  const out: RepoNameProblem[] = [];
  if (!name) return ['empty'];
  if (name.length > REPO_NAME_MAX) out.push('long');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) out.push('chars');
  if (name === '.' || name === '..') out.push('dots');
  if (/\.git$/i.test(name)) out.push('gitSuffix');
  return out;
}

/** What a typed name becomes on GitHub: spaces and other characters turned into hyphens, as GitHub suggests. */
export function suggestRepoName(typed: string): string {
  const s = typed
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.git$/i, '');
  return s.slice(0, REPO_NAME_MAX) || 'claude-memory';
}

/** owner/name of a GitHub remote (https, ssh, scp-like), or null for another host or another form. */
export function githubRepoOf(remote: string): string | null {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    );
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The address git pushes to for a GitHub repository (https: the GitHub CLI's sign-in serves it). */
export function githubRemote(repo: string): string {
  return `https://github.com/${repo}.git`;
}

/**
 * The name a project's handoffs are kept under, the same on every computer: the project's id in the
 * settings, else its GitHub repository (owner-name), else its folder's name. Lowercase letters, digits,
 * `.`, `-` and `_`; never empty, never `.` or `..`.
 */
export function projectKey(p: { id?: string | null; remote?: string | null; folder: string }): string {
  const repo = p.remote ? githubRepoOf(p.remote) : null;
  const other = p.remote && !repo ? /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(p.remote.trim()) : null;
  const raw =
    p.id ||
    (repo
      ? repo.replace('/', '-')
      : other
        ? `${other[1]}-${other[2]}`
        : p.folder
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop() || '');
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return key || 'project';
}

/** Where things are inside a store. */
export function storePaths(dir: string): { index: string; readme: string; gitignore: string; handoffs: string; projects: string } {
  return {
    index: joinPath(dir, INDEX_FILE),
    readme: joinPath(dir, 'README.md'),
    gitignore: joinPath(dir, '.gitignore'),
    handoffs: joinPath(dir, HANDOFF_DIR),
    projects: joinPath(dir, PROJECTS_DIR),
  };
}

/** What a new store's .gitignore keeps out: system litter and editor files, never notes. */
export const STORE_GITIGNORE = ['.DS_Store', 'Thumbs.db', 'desktop.ini', '*.swp', '*~', '.~lock.*', 'node_modules/', ''].join('\n');

/** The README of a new store: what the folder is, for whoever opens it (on GitHub too). */
export function storeReadme(place: 'local' | 'github' | 'both'): string {
  return [
    '# Claude Code memory',
    '',
    "This folder is Claude Code's auto memory (its `autoMemoryDirectory`): `MEMORY.md` is the index Claude reads at the start of every session, the other files are its notes.",
    '',
    `It is managed with terminal-code${place === 'local' ? '' : ' and kept in sync with a private GitHub repository'}. \`${HANDOFF_DIR}/\` holds handoff notes, written when a session ends or compacts so that the next one can go on; they are not memory entries. \`${PROJECTS_DIR}/\` holds memories brought in from Claude Code's per-project folders.`,
    '',
    'Keep secrets out of this folder: terminal-code holds back a file that looks like it holds a key or a token, but it cannot recognise every secret.',
    '',
  ].join('\n');
}

/**
 * A store's README says terminal-code set the folder up (storeReadme), under this name or an earlier one:
 * it is terminal-code's to keep in sync.
 */
export function managedByUs(readme: string | null, names: readonly string[] = [APP_NAME, ...PREVIOUS_NAMES.map((p) => p.name)]): boolean {
  return readme !== null && /^# Claude Code memory\r?\n/.test(readme) && names.some((n) => readme.includes(`It is managed with ${n}`));
}

/** The README of the handoffs folder: what Claude should know when it finds the folder. */
export const HANDOFF_README = [
  '# Handoff notes',
  '',
  'Written by terminal-code when a session ends, compacts, or is asked to hand off: where the work on a project stands, so that the next session can go on. One folder per project, one file per note, newest last by name.',
  '',
  'These are not memory entries: do not add them to MEMORY.md and do not edit them. terminal-code keeps the newest ones and hands the right one to a new session.',
  '',
].join('\n');

/** An index line for memories brought in from Claude Code's per-project folder `slug` (kept under projects/<name>). */
export function importedIndexLine(name: string, from: string): string {
  return `- [${name}](${PROJECTS_DIR}/${name}/MEMORY.md) — memories of ${from}, brought in from Claude Code's per-project memory`;
}

/** A per-project memory folder's name inside the store: Claude Code's slug made short and safe. */
export function importedName(slug: string, taken: ReadonlySet<string>): string {
  const base =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(-60)
      .replace(/^[-.]+/, '') || 'project';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

/** One file git reports as changed in the store. */
export interface StoreChange {
  /** Porcelain v1 status letters (`??`, ` M`, `A `, ` D`, `R `…). */
  status: string;
  path: string;
}

/** Changed files from `git status --porcelain=v1 -z`: renames carry their old name after a NUL, which is skipped. */
export function parsePorcelainZ(out: string): StoreChange[] {
  const parts = out.split('\0');
  const changes: StoreChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length < 4) continue;
    const status = p.slice(0, 2);
    changes.push({ status, path: p.slice(3) });
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return changes;
}

/** A change removes the file (nothing to read or scan). */
export function isDeletion(c: StoreChange): boolean {
  return c.status.includes('D');
}

/** The message of a commit terminal-code makes in the store, in the person's language: what changed, in which session. */
export function commitMessage(counts: { added: number; changed: number; removed: number }, session: string | null, lang: Lang): string {
  const parts: string[] = [];
  if (counts.added) parts.push(tIn(lang, 'memory.commit.added', { n: counts.added }));
  if (counts.changed) parts.push(tIn(lang, 'memory.commit.changed', { n: counts.changed }));
  if (counts.removed) parts.push(tIn(lang, 'memory.commit.removed', { n: counts.removed }));
  const what = parts.join(', ') || tIn(lang, 'memory.commit.changed', { n: 0 });
  return session ? tIn(lang, 'memory.commit', { what, session: session.slice(0, 8) }) : tIn(lang, 'memory.commit.noSession', { what });
}

/** The counts a commit message says: added, changed, removed. */
export function changeCounts(changes: readonly StoreChange[]): { added: number; changed: number; removed: number } {
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const c of changes) {
    if (isDeletion(c)) removed++;
    else if (c.status === '??' || c.status.includes('A')) added++;
    else changed++;
  }
  return { added, changed, removed };
}

/**
 * Where handoff notes are kept: in the memory store when it keeps them, else in the sync's shared place when
 * it takes them (docs/sync.md), else in terminal-code's own folder.
 */
export function handoffRoot(config: Pick<Config, 'memory' | 'sync'>, fallback: string): string {
  const store = config.memory.store;
  if (store && store.handoffs) return joinPath(store.dir, HANDOFF_DIR);
  if (config.sync && config.sync.handoffs) return joinPath(config.sync.dir, HANDOFF_DIR);
  return fallback;
}

/** What a sync brought in from the remote: the files, by their paths in the store, and the index's changed lines. */
export interface Pulled {
  files: string[];
  /** The lines removed from and added to the index, or null when it did not change or its change could not be read. */
  index: { removed: string[]; added: string[] } | null;
}

/** The lines a diff of the index (git diff --unified=0) removes and adds; blank lines are left out. */
export function indexChange(diff: string): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  let body = false;
  for (const raw of diff.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // The file's header (---, +++) comes before the first hunk.
    if (line.startsWith('@@')) body = true;
    else if (body && line.slice(1).trim()) {
      if (line.startsWith('-')) removed.push(line.slice(1));
      else if (line.startsWith('+')) added.push(line.slice(1));
    }
  }
  return { removed, added };
}

/** Two syncs before the next prompt: their files joined; two changes to the index are not joined line by line. */
export function mergePulled(a: Pulled | null, b: Pulled): Pulled {
  if (!a) return b;
  const both = a.files.includes(INDEX_FILE) && b.files.includes(INDEX_FILE);
  return { files: [...new Set([...a.files, ...b.files])], index: both ? null : (a.index ?? b.index) };
}

/** Index lines shown to Claude at most; past that it is asked to read the file again. */
export const PULLED_LINES = 30;

/**
 * Told to Claude with the next prompt when a sync brought in changes made elsewhere. Claude Code loads the
 * index as a session starts, and the pull at the start can land after that (measured), so its copy may be old.
 */
export function pulledContext(p: Pulled, dir: string): string | null {
  if (!p.files.length) return null;
  const shown = p.files.slice(0, 8).join(', ') + (p.files.length > 8 ? ` and ${p.files.length - 8} more` : '');
  const parts = [`[${APP_NAME}] The memory was brought up to date with changes made elsewhere: ${shown}.`];
  if (p.files.includes(INDEX_FILE)) {
    const lines = p.index ? [...p.index.removed.map((l) => `- ${l}`), ...p.index.added.map((l) => `+ ${l}`)] : [];
    parts.push(
      lines.length && lines.length <= PULLED_LINES
        ? `The index (${INDEX_FILE}) in your context may have been loaded before that; these lines changed in it (- removed, + added):\n${lines.map((l) => maskSecrets(truncate(l, 300))).join('\n')}\n`
        : `The index (${INDEX_FILE}) in your context may have been loaded before that: read ${joinPath(dir, INDEX_FILE)} again before relying on it.`,
    );
  }
  if (p.files.some((f) => f !== INDEX_FILE)) parts.push('A file read earlier in this session may have changed: read it again when you need it.');
  return parts.join(' ');
}

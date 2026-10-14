// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store on disk (docs/memory.md): Claude Code's autoMemoryDirectory setting (read, and written
 * with a backup), the memories Claude Code keeps per project, a folder's facts, the files mode-code
 * adds to a new store, and bringing existing notes in. Nothing here deletes or moves a note.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_README, importedIndexLine, importedName, PROJECTS_DIR, STORE_GITIGNORE, storePaths, storeReadme } from '../core/memory.js';
import type { MemoryPlace } from '../core/config.js';
import { expandHome } from '../core/paths.js';
import { ensureDir, readText, writeAtomic } from './fsx.js';
import { toolPath } from './env.js';

/** Claude Code's user settings file in a config folder. */
export function userSettingsFile(claudeDir: string): string {
  return join(claudeDir, 'settings.json');
}

/** The autoMemoryDirectory of the user settings, as a path (`~/` expanded); null when unset or unreadable. */
export function readMemorySetting(claudeDir: string): string | null {
  const text = readText(userSettingsFile(claudeDir));
  if (!text) return null;
  try {
    const v = (JSON.parse(text) as Record<string, unknown>).autoMemoryDirectory;
    return typeof v === 'string' && v.trim() ? toolPath(expandHome(v.trim(), homedir())) : null;
  } catch {
    return null;
  }
}

/**
 * Writes autoMemoryDirectory into the user settings, keeping every other key as it is; the file is backed up
 * first. A file that is not valid JSON is left alone (null is returned with the reason): it is the person's.
 */
export function writeMemorySetting(claudeDir: string, dir: string, backupsDir: string, now = Date.now()): { backup: string | null; error: string | null } {
  const file = userSettingsFile(claudeDir);
  const text = readText(file);
  let settings: Record<string, unknown> = {};
  if (text && text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { backup: null, error: `${file} does not hold a settings object` };
      settings = parsed as Record<string, unknown>;
    } catch (err) {
      return { backup: null, error: `${file} is not valid JSON: ${(err as Error).message}` };
    }
  }
  let backup: string | null = null;
  if (text !== null) {
    backup = join(backupsDir, `settings.json.memory.${now}`);
    writeAtomic(backup, text);
  }
  // Native separators on Windows, as Claude Code's own examples write paths there; an absolute path either way.
  const native = process.platform === 'win32' ? dir.replace(/\//g, '\\') : dir;
  writeAtomic(file, JSON.stringify({ ...settings, autoMemoryDirectory: native }, null, 2) + '\n');
  return { backup, error: null };
}

/** What a folder holds, for the setup's questions. */
export interface FolderFacts {
  exists: boolean;
  /** Files in it (not counting a .git folder), up to a cap. */
  files: number;
  hasIndex: boolean;
}

export function folderFacts(dir: string): FolderFacts {
  try {
    if (!statSync(dir).isDirectory()) return { exists: true, files: 1, hasIndex: false };
  } catch {
    return { exists: false, files: 0, hasIndex: false };
  }
  return { exists: true, files: countFiles(dir, 10_000), hasIndex: readText(join(dir, 'MEMORY.md')) !== null };
}

function countFiles(dir: string, cap: number): number {
  let n = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (n >= cap) return;
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

/** Claude Code's per-project memories: `<config>/projects/<slug>/memory/` folders that hold notes. */
export function perProjectMemories(claudeDir: string): { slug: string; dir: string; files: number }[] {
  const root = join(claudeDir, 'projects');
  let slugs: string[] = [];
  try {
    slugs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: { slug: string; dir: string; files: number }[] = [];
  for (const slug of slugs.sort()) {
    const dir = join(root, slug, 'memory');
    const files = countFiles(dir, 10_000);
    if (files > 0) out.push({ slug, dir, files });
  }
  return out;
}

/** The files mode-code adds to a store, each only when it is missing: a README, a .gitignore, the handoffs folder's README. */
export function scaffoldStore(dir: string, place: MemoryPlace, what: { readme: boolean; handoffs: boolean } = { readme: true, handoffs: true }): string[] {
  const p = storePaths(dir);
  ensureDir(dir);
  const written: string[] = [];
  const add = (path: string, text: string) => {
    if (readText(path) !== null) return;
    writeAtomic(path, text);
    written.push(path);
  };
  if (what.readme) {
    add(p.readme, storeReadme(place));
    add(p.gitignore, STORE_GITIGNORE);
  }
  if (what.handoffs) add(join(p.handoffs, 'README.md'), HANDOFF_README);
  return written;
}

/** Copies a folder's files into another, never over a file that is there, never a .git folder. */
export function copyNotes(from: string, to: string): { copied: number; skipped: string[] } {
  let copied = 0;
  const skipped: string[] = [];
  const walk = (src: string, dst: string, rel: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(src, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const s = join(src, e.name);
      const d = join(dst, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(s, d, r);
      else if (e.isFile()) {
        if (existsAny(d)) {
          skipped.push(r);
          continue;
        }
        mkdirSync(dst, { recursive: true });
        copyFileSync(s, d);
        copied++;
      }
    }
  };
  walk(from, to, '');
  return { copied, skipped };
}

function existsAny(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Brings Claude Code's per-project memories into the store under projects/<name>/, with one line for each in
 * MEMORY.md, so what Claude learned in each project stays reachable from the shared index.
 */
export function importProjects(
  store: string,
  list: readonly { slug: string; dir: string }[],
  describe: (slug: string) => string,
): { name: string; copied: number }[] {
  const taken = new Set<string>();
  try {
    for (const e of readdirSync(join(store, PROJECTS_DIR), { withFileTypes: true })) if (e.isDirectory()) taken.add(e.name);
  } catch {
    /* no projects folder yet */
  }
  const out: { name: string; copied: number }[] = [];
  const lines: string[] = [];
  for (const p of list) {
    const name = importedName(p.slug, taken);
    taken.add(name);
    const r = copyNotes(p.dir, join(store, PROJECTS_DIR, name));
    out.push({ name, copied: r.copied });
    if (r.copied) lines.push(importedIndexLine(name, describe(p.slug)));
  }
  if (lines.length) {
    const index = join(store, 'MEMORY.md');
    const text = readText(index);
    const base = text === null ? '# Memory\n' : text.endsWith('\n') || text === '' ? text : `${text}\n`;
    writeAtomic(index, `${base}${lines.join('\n')}\n`);
  }
  return out;
}

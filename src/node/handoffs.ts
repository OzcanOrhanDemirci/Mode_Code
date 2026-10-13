// SPDX-License-Identifier: Apache-2.0
/**
 * Handoff notes on disk (docs/memory.md), for the hook and the command line: the project a folder belongs
 * to, the notes kept for it, the newest one, and pruning past the configured number (the git history keeps
 * the rest). The plugin reads the same folders through Claude Code's own file access.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../core/config.js';
import { isHandoffName, newestName, parseHandoff, pruneNames, type Handoff } from '../core/handoff.js';
import type { Layout } from '../core/layout.js';
import { handoffRoot, projectKey } from '../core/memory.js';
import { pathKey } from '../core/paths.js';
import { platform, toolPath } from './env.js';
import { readText } from './fsx.js';
import { git } from './git.js';

/** The project key of a folder: the project the settings register there, its origin, else its top folder's name. */
export function projectKeyAt(config: Config, cwd: string, named: string | null = null): string {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  const folder = top.ok && top.out ? toolPath(top.out) : toolPath(cwd);
  const registered = config.projects.find((p) => p.path && pathKey(toolPath(p.path), platform) === pathKey(folder, platform));
  const remote = top.ok ? git(folder, ['config', '--get', 'remote.origin.url']) : null;
  return projectKey({ id: named ?? registered?.id ?? null, remote: remote?.ok ? remote.out : null, folder });
}

export function handoffDir(config: Config, l: Layout, key: string): string {
  return join(handoffRoot(config, l.handoffsDir), key).replace(/\\/g, '/');
}

/** A project's notes, oldest first. */
export function handoffList(config: Config, l: Layout, key: string): { name: string; path: string }[] {
  const dir = handoffDir(config, l, key);
  try {
    return readdirSync(dir)
      .filter(isHandoffName)
      .sort()
      .map((name) => ({ name, path: `${dir}/${name}` }));
  } catch {
    return [];
  }
}

/** A project's newest note, read back. */
export function newestHandoffAt(config: Config, l: Layout, key: string): { path: string; text: string; note: Handoff } | null {
  const list = handoffList(config, l, key);
  const name = newestName(list.map((h) => h.name));
  const item = list.find((h) => h.name === name);
  const text = item ? readText(item.path) : null;
  const note = text ? parseHandoff(text) : null;
  return item && text && note ? { path: item.path, text, note } : null;
}

/** Removes every project's notes past the newest `keep` from the folder; how many went. */
export function pruneHandoffs(config: Config, l: Layout): number {
  const root = handoffRoot(config, l.handoffsDir);
  let projects: string[] = [];
  try {
    projects = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const p of projects) {
    const names = handoffList(config, l, p).map((h) => h.name);
    for (const name of pruneNames(names, config.memory.handoff.keep)) {
      try {
        rmSync(join(root, p, name));
        removed++;
      } catch {
        /* left for the next time */
      }
    }
  }
  return removed;
}

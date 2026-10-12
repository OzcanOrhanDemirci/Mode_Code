// SPDX-License-Identifier: Apache-2.0
/** Running git for facts: short, bounded calls that never prompt and never throw. */
import { spawnSync } from 'node:child_process';
import type { GitFacts } from '../core/belt/types.js';
import type { MemoryStatus } from '../core/footer.js';

export interface GitRun {
  ok: boolean;
  out: string;
}

/** Runs git with a time limit, no pager, no prompts, no window. */
export function git(dir: string, args: readonly string[], timeoutMs = 3000): GitRun {
  try {
    const r = spawnSync('git', ['-C', dir, '--no-pager', ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

/** The GitFacts the belt asks for, answered by running git; cached for the life of one process. */
export function gitFacts(): GitFacts {
  const cache = new Map<string, string | null>();
  const memo = (key: string, f: () => string | null): string | null => {
    if (!cache.has(key)) cache.set(key, f());
    return cache.get(key) ?? null;
  };
  return {
    currentBranch: async (dir) =>
      memo(`b\0${dir}`, () => {
        const r = git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
        return r.ok && r.out ? r.out : null;
      }),
    remoteUrl: async (dir, remote = 'origin') =>
      memo(`r\0${dir}\0${remote}`, () => {
        const r = git(dir, ['remote', 'get-url', '--', remote]);
        return r.ok && r.out ? r.out : null;
      }),
    alias: async (dir, name) =>
      memo(`a\0${dir}\0${name}`, () => {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return null;
        const r = git(dir, ['config', '--get', `alias.${name}`]);
        return r.ok && r.out ? r.out : null;
      }),
  };
}

export interface RepoStatus {
  isRepo: boolean;
  dirty: number;
  /** Commits not on the upstream; null when there is no upstream or it could not be read. */
  ahead: number | null;
  /** True when the branch has an upstream to push to. */
  hasUpstream: boolean;
  /** Commit time of HEAD, epoch ms. */
  headTime: number | null;
}

export function repoStatus(dir: string): RepoStatus {
  const top = git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (!top.ok || top.out !== 'true') return { isRepo: false, dirty: 0, ahead: null, hasUpstream: false, headTime: null };
  const st = git(dir, ['status', '--porcelain=v1', '--untracked-files=normal']);
  const dirty = st.ok ? st.out.split('\n').filter(Boolean).length : 0;
  const up = git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const hasUpstream = up.ok && up.out.length > 0;
  const ah = hasUpstream ? git(dir, ['rev-list', '--count', '@{upstream}..HEAD']) : { ok: false, out: '' };
  const ahead = ah.ok && /^\d+$/.test(ah.out) ? parseInt(ah.out, 10) : null;
  const ht = git(dir, ['log', '-1', '--format=%ct']);
  const headTime = ht.ok && /^\d+$/.test(ht.out) ? parseInt(ht.out, 10) * 1000 : null;
  return { isRepo: true, dirty, ahead, hasUpstream, headTime };
}

/**
 * The footer's memory line for a set of memory folders, relative to when the turn started.
 * pushed: a commit made during the turn is on the upstream and nothing is left · dirty / ahead: work left
 * · unchanged: nothing happened · null: none of the folders is a git repository (the line is hidden).
 */
export function memoryStatus(dirs: readonly string[], turnStartedAt: number | null): MemoryStatus {
  let any = false;
  let dirty = 0;
  let ahead = 0;
  let pushed = false;
  let unknown = false;
  let noUpstream = false;
  for (const d of dirs) {
    const s = repoStatus(d);
    if (!s.isRepo) continue;
    any = true;
    dirty += s.dirty;
    if (!s.hasUpstream) noUpstream = true;
    else if (s.ahead === null) unknown = true;
    else ahead += s.ahead;
    if (turnStartedAt !== null && s.headTime !== null && s.headTime >= turnStartedAt - 1000) pushed = true;
  }
  if (!any) return { state: null };
  if (dirty > 0) return { state: 'dirty', count: dirty };
  if (ahead > 0) return { state: 'ahead', count: ahead };
  if (unknown) return { state: 'unknown' };
  if (noUpstream) return { state: 'noUpstream' };
  return { state: pushed ? 'pushed' : 'unchanged' };
}

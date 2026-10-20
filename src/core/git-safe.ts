// SPDX-License-Identifier: Apache-2.0
/**
 * Mode_Code's own git calls, made so that the folder they run in cannot choose a program for them. A
 * repository's own settings can name programs git runs while it only reads (a file system monitor, a
 * filter over the files' content, a converter or an outside program for diffs, a signature check), and a
 * folder can hold a program named git. The belt asks git for the facts it decides on, and the plugin, the
 * hook and the control center read a project's state by themselves, before anyone has looked at the folder:
 * none of them may run what the folder names. Pure: the arguments, where git may be, and how to read the
 * answer about filters; the callers run git.
 */
import type { Platform } from './paths.js';

/** Settings given on every call, above every file's: no file system monitor, no signature check. */
export const SAFE_GIT_CONFIG: readonly string[] = ['core.fsmonitor=false', 'log.showSignature=false'];

/** The calls that read the work tree's files, where git runs the filters the repository's attributes name. */
const READS_WORK_TREE = new Set(['status', 'diff', 'ls-files']);

/** The calls that can show a diff, where git runs a converter or an outside diff program. */
const SHOWS_DIFFS = new Set(['diff', 'show', 'log']);

/** A filter driver's programs: empty, with nothing required, git leaves the content as it is. */
const FILTER_PROGRAMS = ['clean', 'smudge', 'process'] as const;

function configArgs(settings: readonly string[]): string[] {
  return settings.flatMap((s) => ['-c', s]);
}

/** Whether a call reads the work tree, so the repository's filter drivers are asked for first. */
export function needsFilterDrivers(args: readonly string[]): boolean {
  return READS_WORK_TREE.has(args[0] ?? '');
}

/**
 * The call that lists the filter drivers every settings file defines, each key with where it is set (a
 * file the repository's own includes counts as the repository's). Exit 1 says there is none.
 */
export function filterDriversQuery(dir: string): string[] {
  return ['-C', dir, '--no-pager', ...configArgs(SAFE_GIT_CONFIG), 'config', '--show-scope', '--name-only', '--get-regexp', '^filter\\.'];
}

/**
 * The names of the filter drivers the repository sets (scope local or worktree), from the query's answer.
 * Those the person set for themselves (global, system) keep working, Git LFS among them. null when a name
 * cannot be switched off on the command line (it holds "="): then the call must not run.
 */
export function repoFilterDrivers(out: string): string[] | null {
  const names = new Set<string>();
  for (const line of out.split('\n')) {
    const m = /^(?:local|worktree)\tfilter\.(.+)\.[^.]+$/.exec(line);
    if (!m) continue;
    if (m[1]!.includes('=')) return null;
    names.add(m[1]!);
  }
  return [...names];
}

/**
 * The arguments of one of Mode_Code's git calls in `dir`: no pager and the safe settings; for a call that
 * reads the work tree, each of the repository's filter drivers switched off; for one that can show a
 * diff, no converter and no outside diff program; for status, no look inside submodules (each has
 * settings of its own).
 */
export function safeGitArgs(dir: string, args: readonly string[], drivers: readonly string[] = []): string[] {
  const [cmd, ...rest] = args;
  if (cmd === undefined) return ['-C', dir, '--no-pager', ...configArgs(SAFE_GIT_CONFIG)];
  const settings = [...SAFE_GIT_CONFIG];
  if (READS_WORK_TREE.has(cmd)) for (const d of drivers) settings.push(...FILTER_PROGRAMS.map((k) => `filter.${d}.${k}=`), `filter.${d}.required=false`);
  const own = SHOWS_DIFFS.has(cmd) ? ['--no-ext-diff', '--no-textconv'] : cmd === 'status' ? ['--ignore-submodules=dirty'] : [];
  return ['-C', dir, '--no-pager', ...configArgs(settings), cmd, ...own, ...rest];
}

/**
 * Where git may be, in PATH order: git's file in each absolute folder on PATH. A relative entry (".", an
 * empty one, "bin") names a place under whatever folder the call runs in, so it is never looked at.
 */
export function gitCandidates(pathValue: string, platform: Platform): string[] {
  const win = platform === 'win32';
  const out: string[] = [];
  for (const raw of pathValue.split(win ? ';' : ':')) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    const absolute = win ? /^[A-Za-z]:[\\/]/.test(dir) || /^[\\/]{2}[^\\/]/.test(dir) : dir.startsWith('/');
    if (absolute) out.push(dir.replace(/[\\/]+$/, '') + (win ? '\\git.exe' : '/git'));
  }
  return out;
}

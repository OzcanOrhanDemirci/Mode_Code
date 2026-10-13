// SPDX-License-Identifier: Apache-2.0
/**
 * git and the GitHub CLI for the memory setup (docs/memory.md): finding them, the command that installs a
 * missing one on this system, and the few GitHub calls the setup makes (who is signed in, whether a
 * repository exists and is private, creating one). Every call goes through a Runner, so tests answer them
 * with a stand-in `gh` and a local "GitHub".
 */
import { existsSync } from 'node:fs';
import type { Platform } from '../core/paths.js';
import type { Runner } from '../core/memory-sync.js';
import { GIT_ENV } from '../core/memory-sync.js';

export type ToolName = 'git' | 'gh';

export interface ToolFound {
  /** What to run it as: its name when it is on the PATH, else the full path where it was found. */
  command: string;
  version: string;
}

/** Where installers put the programs when the PATH of an already open terminal does not know them yet. */
export const KNOWN_PLACES: Record<ToolName, Partial<Record<string, string[]>>> = {
  git: { win32: ['C:/Program Files/Git/cmd/git.exe', 'C:/Program Files (x86)/Git/cmd/git.exe'], darwin: ['/opt/homebrew/bin/git', '/usr/local/bin/git'] },
  gh: { win32: ['C:/Program Files/GitHub CLI/gh.exe', 'C:/Program Files (x86)/GitHub CLI/gh.exe'], darwin: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'] },
};

/** The version line's number: "git version 2.47.1.windows.2" → "2.47.1", "gh version 2.63.0 (2024-11-27)" → "2.63.0". */
export function versionOf(out: string): string | null {
  const m = /version (\d+\.\d+(?:\.\d+)?)/.exec(out);
  return m ? m[1]! : null;
}

/** Finds a tool: on the PATH, else where its installer puts it on this platform. */
export async function findTool(r: Runner, tool: ToolName, platform: Platform, exists: (p: string) => boolean = existsSync): Promise<ToolFound | null> {
  for (const command of [tool, ...(KNOWN_PLACES[tool][platform] ?? []).filter(exists)]) {
    try {
      const out = await r.run([command, '--version'], { cwd: '.', timeoutMs: 10_000, env: { ...GIT_ENV } });
      const version = out.exitCode === 0 ? versionOf(out.stdout) : null;
      if (version) return { command, version };
    } catch {
      /* not there under this name */
    }
  }
  return null;
}

/** A command that installs a tool here, run in the person's terminal; or only a page to download it from. */
export interface InstallPlan {
  argv: string[] | null;
  /** Where to get it by hand. */
  page: string;
}

export const DOWNLOAD_PAGES: Record<ToolName, string> = { git: 'https://git-scm.com/downloads', gh: 'https://cli.github.com' };

/**
 * How to install a missing tool: winget on Windows, Homebrew on macOS (git also through Apple's command line
 * tools), the system's package manager on Linux. `has` says whether a program is on the PATH.
 */
export function installPlan(tool: ToolName, platform: Platform, has: (program: string) => boolean): InstallPlan {
  const page = DOWNLOAD_PAGES[tool];
  if (platform === 'win32') {
    if (!has('winget')) return { argv: null, page };
    const id = tool === 'git' ? 'Git.Git' : 'GitHub.cli';
    return { argv: ['winget', 'install', '--id', id, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'], page };
  }
  if (platform === 'darwin') {
    if (has('brew')) return { argv: ['brew', 'install', tool], page };
    return tool === 'git' ? { argv: ['xcode-select', '--install'], page } : { argv: null, page };
  }
  // Package names: the GitHub CLI is "gh" everywhere but Arch, where it is "github-cli".
  if (has('apt-get')) return { argv: ['sudo', 'apt-get', 'install', '-y', tool], page };
  if (has('dnf')) return { argv: ['sudo', 'dnf', 'install', '-y', tool], page };
  if (has('pacman')) return { argv: ['sudo', 'pacman', '-S', '--noconfirm', tool === 'gh' ? 'github-cli' : 'git'], page };
  if (has('zypper')) return { argv: ['sudo', 'zypper', 'install', '-y', tool], page };
  return { argv: null, page };
}

// ── GitHub, through its CLI ───────────────────────────────────────────────────────────────────────

export interface GhRepo {
  nameWithOwner: string;
  private: boolean;
  empty: boolean;
  url: string;
}

async function gh(r: Runner, ghCommand: string, args: readonly string[], timeoutMs = 30_000) {
  try {
    const out = await r.run([ghCommand, ...args], { cwd: '.', timeoutMs, env: { ...GIT_ENV, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    return { ok: out.exitCode === 0, out: out.stdout.trim(), err: out.stderr.trim() };
  } catch (err) {
    return { ok: false, out: '', err: String((err as Error)?.message ?? err) };
  }
}

/** The signed-in account's login and id (for a commit identity GitHub keeps private), or null when nobody is signed in. */
export async function ghUser(r: Runner, ghCommand: string): Promise<{ login: string; id: number } | null> {
  const status = await gh(r, ghCommand, ['auth', 'status', '--hostname', 'github.com']);
  if (!status.ok) return null;
  const user = await gh(r, ghCommand, ['api', 'user', '--jq', '[.login, .id] | @tsv']);
  const m = /^([A-Za-z0-9-]+)\t(\d+)$/.exec(user.out);
  return user.ok && m ? { login: m[1]!, id: parseInt(m[2]!, 10) } : null;
}

/** A repository as GitHub reports it; null when it does not exist (or this account cannot see it). */
export async function ghRepo(r: Runner, ghCommand: string, repo: string): Promise<GhRepo | null> {
  const out = await gh(r, ghCommand, ['repo', 'view', repo, '--json', 'nameWithOwner,visibility,isEmpty,url']);
  if (!out.ok) return null;
  try {
    const j = JSON.parse(out.out) as { nameWithOwner?: string; visibility?: string; isEmpty?: boolean; url?: string };
    if (!j.nameWithOwner) return null;
    return { nameWithOwner: j.nameWithOwner, private: String(j.visibility).toUpperCase() !== 'PUBLIC', empty: j.isEmpty === true, url: j.url ?? '' };
  } catch {
    return null;
  }
}

/** Creates a private repository; null on success, else what GitHub said. */
export async function ghCreatePrivate(r: Runner, ghCommand: string, repo: string, description: string): Promise<string | null> {
  const out = await gh(r, ghCommand, ['repo', 'create', repo, '--private', '--description', description], 60_000);
  return out.ok ? null : out.err || out.out || 'gh repo create failed';
}

/** The noreply address GitHub gives every account, so a commit never shows the person's own address. */
export function noreplyEmail(login: string, id: number): string {
  return `${id}+${login}@users.noreply.github.com`;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Whether a `gh` call goes to a repository of the person's own (docs/safety-belt.md "Evidence"). Own means its owner
 * is the account `gh` is signed in to on github.com: a clone of someone else's project is not, and neither is a
 * repository only the session read about. gh picks the repository itself: `-R`, else GH_REPO, else the folder's
 * remotes in an order of its own, or the one `gh repo set-default` chose. So without `-R` every GitHub remote of the
 * folder must be the person's, and anything that only says where it goes when it runs is not known to be theirs.
 */
import type { BeltContext } from './types.js';

const GITHUB_REMOTE = /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i;
/** `OWNER/REPO` or `github.com/OWNER/REPO`, as `-R` takes them; a URL goes through GITHUB_REMOTE. */
const REPO_OPTION = /^(?:github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/i;
/** The commands on a repository that send: a gist belongs to no repository, and `gh api` names its own path. */
const ON_A_REPOSITORY = /^(?:issue|pr|discussion|release)$/;
/** What points gh elsewhere from outside the call: read in the environment and anywhere in the script. */
const REDIRECTED = /\bGH_(?:REPO|HOST)\b/i;

/** The owner/name of a remote's address on github.com, or null for any other address. */
export function repoOfRemote(url: string): string | null {
  return GITHUB_REMOTE.exec(url.trim())?.[1] ?? null;
}

/** The repositories named with `-R`, `--repo=` or `-Rowner/name`; null when one is on another host or only known when it runs. */
function namedRepos(args: readonly string[], dynamic: readonly boolean[]): string[] | null {
  const named: string[] = [];
  for (const [i, arg] of args.entries()) {
    const separate = arg === '-R' || arg === '--repo';
    const attached = /^(?:--repo=|-R)(.+)$/.exec(arg)?.[1];
    if (!separate && attached === undefined) continue;
    const index = separate ? i + 1 : i;
    const value = separate ? args[index] : attached;
    if (value === undefined || dynamic[index]) return null;
    const repo = repoOfRemote(value) ?? REPO_OPTION.exec(value)?.[1];
    if (!repo) return null;
    named.push(repo);
  }
  return named;
}

/**
 * The owner/name a `gh` call sends to, when that repository is the person's own; null when it is not, or not known.
 * `dir` is the folder the call runs in, null when only known at run time.
 */
export async function ownGitHubRepo(
  call: { args: readonly string[]; dynamic: readonly boolean[] },
  where: { dir: string | null; script: string },
  ctx: Pick<BeltContext, 'git' | 'env'>,
): Promise<string | null> {
  if (!ON_A_REPOSITORY.test(call.args[0] ?? '')) return null;
  if (ctx.env.GH_REPO || ctx.env.GH_HOST || REDIRECTED.test(where.script)) return null;
  const user = (await ctx.git?.githubUser?.())?.toLowerCase();
  if (!user) return null;
  const isOwn = (repo: string) => repo.split('/')[0]!.toLowerCase() === user;
  const named = namedRepos(call.args, call.dynamic);
  if (named === null) return null;
  if (named.length) return named.every(isOwn) ? named[0]! : null;
  if (where.dir === null) return null;
  const urls = (await ctx.git?.remoteUrls?.(where.dir)) ?? [];
  const repos = urls.map(repoOfRemote).filter((repo): repo is string => repo !== null);
  return repos.length && repos.every(isOwn) ? repos[0]! : null;
}

/** The account gh is signed in to on github.com, from its `hosts.yml`; only that line is read, never a token. */
export function githubUserIn(hostsFile: string): string | null {
  let onGitHub = false;
  for (const line of hostsFile.split(/\r?\n/)) {
    if (/^\S/.test(line)) onGitHub = /^github\.com:\s*$/.test(line);
    else if (onGitHub) {
      const user = /^\s+user:\s*([\w-]+)\s*$/.exec(line)?.[1];
      if (user) return user;
    }
  }
  return null;
}

/** Where gh keeps `hosts.yml`, in gh's own order. */
export function githubHostsPath(env: Readonly<Record<string, string | undefined>>, home: string, platform: BeltContext['platform']): string {
  if (env.GH_CONFIG_DIR) return `${env.GH_CONFIG_DIR}/hosts.yml`;
  if (env.XDG_CONFIG_HOME) return `${env.XDG_CONFIG_HOME}/gh/hosts.yml`;
  if (platform === 'win32' && env.APPDATA) return `${env.APPDATA}/GitHub CLI/hosts.yml`;
  return `${home}/.config/gh/hosts.yml`;
}

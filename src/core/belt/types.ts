// SPDX-License-Identifier: Apache-2.0
/** Shapes of the safety belt: the rule-based guard that stands between Claude and risky tool calls. */
import type { PathAlias, Platform } from '../paths.js';
import type { Lang } from '../i18n/index.js';

/** allow: nothing to say · warn: allowed, Claude gets a note · ask: the person must confirm · deny: blocked. */
export type Verdict = 'allow' | 'warn' | 'ask' | 'deny';

export const VERDICT_ORDER: Record<Verdict, number> = { allow: 0, warn: 1, ask: 2, deny: 3 };

export interface Finding {
  rule: RuleId;
  verdict: Verdict;
  /** One sentence in the person's language: what was found, with the concrete target. */
  reason: string;
  /** With bypass on: the verdict the rule would have given without it, when bypass changed it. */
  lifted?: Verdict;
}

export interface BeltDecision {
  verdict: Verdict;
  findings: Finding[];
  /** Analysis problems (unterminated quote, eval of a runtime value, …); see meta.unverifiable. */
  issues: string[];
  /**
   * With bypass on: what bypass let through or turned into a question, each with the verdict it had
   * without bypass. Empty when bypass is off or changed nothing. Recorded for the person to review.
   */
  lifted: Finding[];
}

export type RuleId =
  | 'git.force-push-protected'
  | 'git.force-push'
  | 'git.delete-remote-branch-protected'
  | 'git.delete-remote-branch'
  | 'git.mirror-or-prune'
  | 'git.push-pr-only'
  | 'git.single-branch'
  | 'git.history-rewrite'
  | 'git.hooks-path'
  | 'git.no-verify'
  | 'git.clean'
  | 'git.discard-work'
  | 'git.branch-force-delete'
  | 'fs.delete-critical'
  | 'fs.delete-outside-project'
  | 'fs.delete-git-dir'
  | 'fs.move-critical'
  | 'fs.disk'
  | 'self.claude-settings'
  | 'self.claude-settings-project'
  | 'self.disable-hooks'
  | 'self.tool-files'
  | 'self.plugin-cli'
  | 'self.nested-session'
  | 'claude.config-change'
  | 'self.memory-delete'
  | 'self.memory-shrink'
  | 'self.memory-history'
  | 'persist.scheduled-task'
  | 'persist.startup'
  | 'persist.shell-profile'
  | 'persist.ssh'
  | 'publish.package'
  | 'publish.visibility'
  | 'publish.deploy'
  | 'docker.volume-delete'
  | 'data.delete-cloud'
  | 'data.write-cloud'
  | 'data.reset-database'
  | 'system.security-off'
  | 'github.admin-merge'
  | 'github.delete'
  | 'outbound.send'
  | 'outbound.delete'
  | 'secrets.stage'
  | 'secrets.write'
  | 'secrets.exfil'
  | 'quality.check-config'
  | 'meta.unverifiable';

export interface RuleConfig {
  /** Rules switched off by the person (never applies to self.* rules, which cannot be switched off). */
  disabled?: RuleId[];
  /** Per-rule verdict overrides (self.* rules can only be made stricter). */
  verdicts?: Partial<Record<RuleId, Verdict>>;
  /** Branch names treated as protected in every repository. */
  protectedBranches?: string[];
  /** Repositories (remote URL substrings) where any push to a protected branch is refused: PR-only. */
  prOnlyRepos?: string[];
  /** Repositories (remote URL substrings) where creating a branch is refused: single-branch. */
  singleBranchRepos?: string[];
  /** Optional rule packs that are off unless the person turns them on. */
  packs?: { dockerVolumes?: boolean };
}

/** Facts about the repository a git command runs in; supplied by an adapter that can run git. */
export interface GitFacts {
  /** The current branch of the repository at `dir`, or null (detached, not a repo). */
  currentBranch(dir: string): Promise<string | null>;
  /** The URL of `remote` (default origin) for the repository at `dir`, or null. */
  remoteUrl(dir: string, remote?: string): Promise<string | null>;
  /** The expansion of `git <name>` when it is an alias, or null. */
  alias(dir: string, name: string): Promise<string | null>;
}

export interface BeltContext {
  platform: Platform;
  home: string;
  /** Working directory of the command (the hook's cwd). */
  cwd: string;
  /** Project root of the session (CLAUDE_PROJECT_DIR), used to tell "inside the project" from "outside". */
  projectDir: string;
  /** Folders the person registered as projects (config `projects[].path`, resolved): inside them is inside a project too. */
  knownProjects?: string[];
  /** Environment values used to expand $NAME / %NAME% / $env:NAME in paths. */
  env: Readonly<Record<string, string | undefined>>;
  /** The tool's own data folder (resolved). */
  dataDir: string;
  /** The shared place of sync across computers (docs/sync.md), when set up: its computers' folders are the tool's own too. */
  syncDir?: string;
  /** Memory folders the person asked to protect from deletion and shrinking (resolved). */
  memoryDirs: string[];
  /** Managed (organisation) settings files for this platform (resolved). */
  managedSettingsFiles: string[];
  lang: Lang;
  config: RuleConfig;
  /**
   * Bypass is on for this session (docs/autonomy.md): the person lifted the belt for a while. Rules then
   * give their bypass verdict (rules.ts): most allow, the floor still asks, self-protection stays.
   */
  bypass?: boolean;
  git?: GitFacts;
  /** Size in bytes of an existing file, or null. Used for the memory shrink rule. */
  fileSize?(path: string): Promise<number | null>;
  /**
   * Protected folders that are links, measured by an adapter that can touch the disk: a path inside the
   * place a link leads to is judged as the protected folder (a dotfiles repository behind `~/.claude`).
   */
  aliases?: readonly PathAlias[];
}

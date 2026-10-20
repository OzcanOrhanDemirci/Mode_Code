// SPDX-License-Identifier: Apache-2.0
/** Shapes of the safety belt: the rule-based guard that stands between Claude and risky tool calls. */
import type { PathAlias, Platform } from '../paths.js';
import type { Lang } from '../i18n/index.js';
import type { NetPlan } from '../net.js';
import type { Provenance, Unit } from '../provenance.js';

/** allow: nothing to say · warn: allowed, Claude gets a note · ask: the person must confirm · deny: blocked. */
export type Verdict = 'allow' | 'warn' | 'ask' | 'deny';

/** How much a way of working asks (rules.ts): Manual, Autonomous, full autonomy. */
export type Level = 'manual' | 'auto' | 'full';

/**
 * What a rule does at a level. pass: nothing to say · note: it runs, the person sees a line and Claude a note ·
 * ask: the person decides · self: refused and left to the person, with the command they would run · stop: refused,
 * and nobody is told to run it (a secret leaving the computer).
 */
export type Act = 'pass' | 'note' | 'ask' | 'self' | 'stop';

export const VERDICT_ORDER: Record<Verdict, number> = { allow: 0, warn: 1, ask: 2, deny: 3 };

export interface Finding {
  rule: RuleId;
  verdict: Verdict;
  /** One sentence in the person's language: what was found, with the concrete target. */
  reason: string;
  /** What the rule does at the session's level (set by decide). */
  act?: Act;
  /** What a safety net would keep before the call (src/core/net.ts), where the check could name it. */
  net?: NetPlan;
  /** What the call acts on, for the evidence that it is the person's (src/core/provenance.ts). */
  unit?: Unit;
  /** What the call carries to others (a message's text): read from outside, it is no evidence for the call. */
  carries?: string;
  /** Stopped because what it acts on came only from what was read from outside (set by decide). */
  outside?: true;
  /** The most this instance asks, found harmless by the check itself (a branch already merged): at most a note. */
  atMost?: Act;
}

export interface BeltDecision {
  verdict: Verdict;
  findings: Finding[];
  /** Analysis problems (unterminated quote, eval of a runtime value, …); see meta.unverifiable. */
  issues: string[];
  /** The safety nets this decision stands on: each is laid before the call, or the call is decided without them. */
  nets?: { rule: RuleId; plan: NetPlan }[];
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
  | 'persist.autorun'
  | 'persist.ssh'
  | 'publish.package'
  | 'publish.visibility'
  | 'publish.deploy'
  | 'publish.store'
  | 'docker.volume-delete'
  | 'data.delete-cloud'
  | 'data.write-cloud'
  | 'data.reset-database'
  | 'system.security-off'
  | 'github.admin-merge'
  | 'github.delete'
  | 'outbound.send'
  | 'outbound.network'
  | 'outbound.payment'
  | 'outbound.delete'
  | 'secrets.stage'
  | 'secrets.write'
  | 'secrets.exfil'
  | 'quality.check-config'
  | 'inject.tainted-act'
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
  /** Whether a branch's tip is in the current branch's history (merged: deleting it loses no commit); null when unknown. */
  merged?(dir: string, branch: string): Promise<boolean | null>;
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
  /** How much the session's way of working asks; Manual when not given. */
  level?: Level;
  /** Whether a safety net can be laid before the call (the safety-net hook lays it): rules that have one may then let it through. */
  net?: boolean;
  /** Where things came from in the session (src/core/provenance.ts): rules with evidence decide by it. */
  prov?: Provenance;
  git?: GitFacts;
  /** Size in bytes of an existing file, or null. Used for the memory shrink rule. */
  fileSize?(path: string): Promise<number | null>;
  /**
   * Protected folders that are links, measured by an adapter that can touch the disk: a path inside the
   * place a link leads to is judged as the protected folder (a dotfiles repository behind `~/.claude`).
   */
  aliases?: readonly PathAlias[];
}

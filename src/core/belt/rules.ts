// SPDX-License-Identifier: Apache-2.0
/**
 * The rule catalog: every rule the safety belt knows, its category, its default verdict, whether it is
 * locked, and what it does while bypass is on. A locked rule protects the protection itself (settings, the
 * tool's files, memory, nested sessions that would run without hooks, secrets leaving the machine): it
 * cannot be switched off and its verdict can only be made stricter. Defaults follow one principle: a
 * protection that fires too often gets switched off, so only the clearly catastrophic is denied; what is
 * legitimate but dangerous asks the person; the rest warns.
 *
 * Bypass (decided with the person, 2026-10-15) lifts the belt for one session in three tiers:
 *  · keep: self-protection and secrets leaving the machine. Bypass changes nothing; there is no way around.
 *  · ask: what cannot be undone and is rarely needed (deleting a drive root, a system folder or data in the
 *    cloud, formatting a disk, turning security software off) is blocked without bypass and asked with it;
 *    deleting outside the project, a .git folder or a database is asked either way.
 *  · allow (the rest): no question, and each call is recorded for the person to review.
 */
import type { RuleConfig, RuleId, Verdict } from './types.js';
import { VERDICT_ORDER } from './types.js';

export type RuleCategory = 'git' | 'fs' | 'self' | 'claude' | 'persist' | 'publish' | 'docker' | 'data' | 'system' | 'outbound' | 'secrets' | 'meta';

/** What a rule does while bypass is on: its verdict stays, it asks, or it lets the call through. */
export type BypassTier = 'keep' | 'ask' | 'allow';

export interface RuleInfo {
  id: RuleId;
  category: RuleCategory;
  verdict: Verdict;
  locked: boolean;
  bypass: BypassTier;
  /** Rules in a pack apply only when the person turns the pack on. */
  pack?: keyof NonNullable<RuleConfig['packs']>;
}

const r = (id: RuleId, category: RuleCategory, verdict: Verdict, bypass: BypassTier = 'allow', locked = false, pack?: RuleInfo['pack']): RuleInfo => ({
  id,
  category,
  verdict,
  locked,
  bypass,
  ...(pack ? { pack } : {}),
});

export const RULES: Readonly<Record<RuleId, RuleInfo>> = Object.freeze({
  'git.force-push-protected': r('git.force-push-protected', 'git', 'deny'),
  'git.force-push': r('git.force-push', 'git', 'ask'),
  'git.delete-remote-branch-protected': r('git.delete-remote-branch-protected', 'git', 'deny'),
  'git.delete-remote-branch': r('git.delete-remote-branch', 'git', 'ask'),
  'git.mirror-or-prune': r('git.mirror-or-prune', 'git', 'ask'),
  'git.push-pr-only': r('git.push-pr-only', 'git', 'deny'),
  'git.single-branch': r('git.single-branch', 'git', 'deny'),
  'git.history-rewrite': r('git.history-rewrite', 'git', 'ask'),
  'git.hooks-path': r('git.hooks-path', 'git', 'deny'),
  'git.no-verify': r('git.no-verify', 'git', 'warn'),
  'git.clean': r('git.clean', 'git', 'ask'),
  'git.discard-work': r('git.discard-work', 'git', 'warn'),
  'git.branch-force-delete': r('git.branch-force-delete', 'git', 'ask'),
  'github.admin-merge': r('github.admin-merge', 'git', 'ask'),
  'github.delete': r('github.delete', 'git', 'ask'),
  'fs.delete-critical': r('fs.delete-critical', 'fs', 'deny', 'ask', true),
  'fs.delete-outside-project': r('fs.delete-outside-project', 'fs', 'ask', 'ask'),
  'fs.delete-git-dir': r('fs.delete-git-dir', 'fs', 'ask', 'ask'),
  'fs.move-critical': r('fs.move-critical', 'fs', 'deny', 'ask', true),
  'fs.disk': r('fs.disk', 'fs', 'deny', 'ask', true),
  'self.claude-settings': r('self.claude-settings', 'self', 'deny', 'keep', true),
  'self.claude-settings-project': r('self.claude-settings-project', 'self', 'ask', 'keep', true),
  'self.disable-hooks': r('self.disable-hooks', 'self', 'deny', 'keep', true),
  'self.tool-files': r('self.tool-files', 'self', 'deny', 'keep', true),
  'self.plugin-cli': r('self.plugin-cli', 'self', 'deny', 'keep', true),
  'self.nested-session': r('self.nested-session', 'self', 'deny', 'keep', true),
  'claude.config-change': r('claude.config-change', 'claude', 'ask'),
  'self.memory-delete': r('self.memory-delete', 'self', 'deny', 'keep', true),
  'self.memory-shrink': r('self.memory-shrink', 'self', 'ask', 'keep', true),
  'self.memory-history': r('self.memory-history', 'self', 'deny', 'keep', true),
  'persist.scheduled-task': r('persist.scheduled-task', 'persist', 'ask'),
  'persist.startup': r('persist.startup', 'persist', 'ask'),
  'persist.shell-profile': r('persist.shell-profile', 'persist', 'ask'),
  'persist.ssh': r('persist.ssh', 'persist', 'deny'),
  'publish.package': r('publish.package', 'publish', 'ask'),
  'publish.visibility': r('publish.visibility', 'publish', 'ask'),
  'publish.deploy': r('publish.deploy', 'publish', 'ask'),
  'docker.volume-delete': r('docker.volume-delete', 'docker', 'deny', 'ask', false, 'dockerVolumes'),
  'data.delete-cloud': r('data.delete-cloud', 'data', 'deny', 'ask'),
  'data.write-cloud': r('data.write-cloud', 'data', 'ask'),
  'data.reset-database': r('data.reset-database', 'data', 'ask', 'ask'),
  'system.security-off': r('system.security-off', 'system', 'deny', 'ask'),
  'outbound.send': r('outbound.send', 'outbound', 'ask'),
  'outbound.delete': r('outbound.delete', 'outbound', 'ask'),
  // A key pushed to a public repository is leaked the moment it lands: asked about even with bypass on.
  'secrets.stage': r('secrets.stage', 'secrets', 'ask', 'ask'),
  'secrets.write': r('secrets.write', 'secrets', 'warn'),
  'secrets.exfil': r('secrets.exfil', 'secrets', 'deny', 'keep', true),
  // What cannot be followed could be anything, the floor included: never let through unseen.
  'meta.unverifiable': r('meta.unverifiable', 'meta', 'ask', 'ask', true),
});

export const RULE_IDS = Object.keys(RULES) as RuleId[];

/**
 * The verdict a rule has under the person's configuration, or null when the rule does not apply.
 * Locked rules ignore "disabled" and accept only stricter overrides.
 */
export function effectiveVerdict(id: RuleId, config: RuleConfig): Verdict | null {
  const info = RULES[id];
  if (info.pack && !config.packs?.[info.pack]) return null;
  if (!info.locked && config.disabled?.includes(id)) return null;
  const override = config.verdicts?.[id];
  if (!override) return info.verdict;
  if (info.locked && VERDICT_ORDER[override] < VERDICT_ORDER[info.verdict]) return info.verdict;
  return override;
}

/**
 * The verdict while bypass is on, from the verdict without it. A note stays a note: it asks nothing.
 * The floor asks even where the person made the rule stricter (a deny they set becomes a question too).
 */
export function bypassVerdict(id: RuleId, verdict: Verdict): Verdict {
  const tier = RULES[id].bypass;
  if (tier === 'keep' || verdict === 'allow' || verdict === 'warn') return verdict;
  return tier === 'ask' ? 'ask' : 'allow';
}

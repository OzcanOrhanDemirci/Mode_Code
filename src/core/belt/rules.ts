// SPDX-License-Identifier: Apache-2.0
/**
 * The rule catalog: every rule the safety belt knows, its category, its default verdict, and whether it
 * is locked. A locked rule protects the protection itself (settings, the tool's files, memory, nested
 * sessions that would run without hooks): it cannot be switched off and its verdict can only be made
 * stricter. Defaults follow one principle: a protection that fires too often gets switched off, so only
 * the clearly catastrophic is denied; what is legitimate but dangerous asks the person; the rest warns.
 */
import type { RuleConfig, RuleId, Verdict } from './types.js';
import { VERDICT_ORDER } from './types.js';

export type RuleCategory = 'git' | 'fs' | 'self' | 'claude' | 'persist' | 'publish' | 'docker' | 'secrets' | 'meta';

export interface RuleInfo {
  id: RuleId;
  category: RuleCategory;
  verdict: Verdict;
  locked: boolean;
  /** Rules in a pack apply only when the person turns the pack on. */
  pack?: keyof NonNullable<RuleConfig['packs']>;
}

const r = (id: RuleId, category: RuleCategory, verdict: Verdict, locked = false, pack?: RuleInfo['pack']): RuleInfo => ({
  id,
  category,
  verdict,
  locked,
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
  'fs.delete-critical': r('fs.delete-critical', 'fs', 'deny', true),
  'fs.delete-outside-project': r('fs.delete-outside-project', 'fs', 'ask'),
  'fs.delete-git-dir': r('fs.delete-git-dir', 'fs', 'ask'),
  'fs.move-critical': r('fs.move-critical', 'fs', 'deny', true),
  'fs.disk': r('fs.disk', 'fs', 'deny', true),
  'self.claude-settings': r('self.claude-settings', 'self', 'deny', true),
  'self.claude-settings-project': r('self.claude-settings-project', 'self', 'ask', true),
  'self.disable-hooks': r('self.disable-hooks', 'self', 'deny', true),
  'self.tool-files': r('self.tool-files', 'self', 'deny', true),
  'self.plugin-cli': r('self.plugin-cli', 'self', 'deny', true),
  'self.nested-session': r('self.nested-session', 'self', 'deny', true),
  'claude.config-change': r('claude.config-change', 'claude', 'ask'),
  'self.memory-delete': r('self.memory-delete', 'self', 'deny', true),
  'self.memory-shrink': r('self.memory-shrink', 'self', 'ask', true),
  'self.memory-history': r('self.memory-history', 'self', 'deny', true),
  'persist.scheduled-task': r('persist.scheduled-task', 'persist', 'ask'),
  'persist.startup': r('persist.startup', 'persist', 'ask'),
  'persist.shell-profile': r('persist.shell-profile', 'persist', 'ask'),
  'persist.ssh': r('persist.ssh', 'persist', 'deny'),
  'publish.package': r('publish.package', 'publish', 'ask'),
  'publish.visibility': r('publish.visibility', 'publish', 'ask'),
  'publish.deploy': r('publish.deploy', 'publish', 'ask'),
  'docker.volume-delete': r('docker.volume-delete', 'docker', 'deny', false, 'dockerVolumes'),
  'secrets.stage': r('secrets.stage', 'secrets', 'ask'),
  'secrets.write': r('secrets.write', 'secrets', 'warn'),
  'meta.unverifiable': r('meta.unverifiable', 'meta', 'ask', true),
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

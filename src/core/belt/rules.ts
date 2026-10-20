// SPDX-License-Identifier: Apache-2.0
/**
 * The rule catalog: every rule the safety belt knows, its category, its default verdict, and whether it is
 * locked. A locked rule protects the protection itself (settings, the tool's files, memory, nested sessions
 * that would run without hooks, secrets leaving the machine) and what cannot be undone (a drive root, a system
 * folder, a disk): it cannot be switched off and its verdict can only be made stricter. Defaults follow one
 * principle: a protection that fires too often gets switched off, so only the clearly catastrophic is denied;
 * what is legitimate but dangerous asks the person; the rest warns.
 */
import type { RuleConfig, RuleId, Verdict } from './types.js';
import { VERDICT_ORDER } from './types.js';

export type RuleCategory =
  'git' | 'fs' | 'self' | 'claude' | 'persist' | 'publish' | 'docker' | 'data' | 'system' | 'outbound' | 'secrets' | 'quality' | 'inject' | 'meta';

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
  // Skipping the repository's own hooks (lint, tests, secret checks) is how a change slips past them: asked (A3-9).
  'git.no-verify': r('git.no-verify', 'git', 'ask'),
  'git.clean': r('git.clean', 'git', 'ask'),
  'git.discard-work': r('git.discard-work', 'git', 'warn'),
  'git.branch-force-delete': r('git.branch-force-delete', 'git', 'ask'),
  'github.admin-merge': r('github.admin-merge', 'git', 'ask'),
  'github.delete': r('github.delete', 'git', 'ask'),
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
  // An app store upload, submission or release, and a payment: always the person's (K5 of 1.2.0).
  'publish.store': r('publish.store', 'publish', 'ask'),
  'docker.volume-delete': r('docker.volume-delete', 'docker', 'deny', false, 'dockerVolumes'),
  'data.delete-cloud': r('data.delete-cloud', 'data', 'deny'),
  'data.write-cloud': r('data.write-cloud', 'data', 'ask'),
  'data.reset-database': r('data.reset-database', 'data', 'ask'),
  'system.security-off': r('system.security-off', 'system', 'deny'),
  'outbound.send': r('outbound.send', 'outbound', 'ask'),
  'outbound.delete': r('outbound.delete', 'outbound', 'ask'),
  'outbound.payment': r('outbound.payment', 'outbound', 'ask'),
  // A key pushed to a public repository is leaked the moment it lands: asked about.
  'secrets.stage': r('secrets.stage', 'secrets', 'ask'),
  'secrets.write': r('secrets.write', 'secrets', 'warn'),
  'secrets.exfil': r('secrets.exfil', 'secrets', 'deny', true),
  // The project's own lint and format settings: loosening a rule is how a failing check is made to pass.
  'quality.check-config': r('quality.check-config', 'quality', 'ask'),
  // After outside content was read (a page, an issue, a service's data): sending, persisting or writing the memory is
  // what an instruction hidden in it would ask for. Asked (src/core/taint.ts).
  'inject.tainted-act': r('inject.tainted-act', 'inject', 'ask'),
  // What cannot be followed could be anything, the floor included: never let through unseen.
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

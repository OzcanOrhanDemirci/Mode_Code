// SPDX-License-Identifier: Apache-2.0
/**
 * The rule catalog: every rule the safety belt knows, its category, what it does in each way of working, and
 * whether it is locked. A locked rule protects the protection itself (settings, the tool's files, memory, nested
 * sessions that would run without hooks, secrets leaving the machine) and what cannot be undone (a drive root, a
 * system folder, a disk): it cannot be switched off and what it does can only be made stricter.
 *
 * The same rules hold in every way of working; the way of working says how much is asked (docs/safety-belt.md,
 * "Ways of working"). Manual asks whatever is the person's to decide; Autonomous asks only what matters and
 * stops what is bad; full autonomy asks nothing and leaves to the person, with the command, what it would have
 * asked about. The table is the one the person approved on 2026-10-20 (the 1.2.0 core's decision table). Where it
 * lets a call through once a safety net has kept what the call takes away (src/core/net.ts), the rule says what it
 * does then, beside what it does when no net can be laid. Where it waits for the person's own words to name its
 * target, this catalog holds its answer without them until those are built: asked, or left to the person.
 */
import type { Act, Level, RuleConfig, RuleId, Verdict } from './types.js';
import { VERDICT_ORDER } from './types.js';

export type RuleCategory =
  'git' | 'fs' | 'self' | 'claude' | 'persist' | 'publish' | 'docker' | 'data' | 'system' | 'outbound' | 'secrets' | 'quality' | 'inject' | 'meta';

/** What a rule does in Manual, Autonomous and full autonomy. */
export type LevelActs = readonly [manual: Act, auto: Act, full: Act];

export interface RuleInfo {
  id: RuleId;
  category: RuleCategory;
  /** What it does in each way of working. */
  acts: LevelActs;
  /** What it does once a safety net has kept what the call takes away; `acts` hold when no net can be laid. */
  net?: LevelActs;
  /**
   * What it does when what the call acts on is the person's own (they wrote it, or the session's start record
   * holds it: src/core/provenance.ts); with `withNet`, only once a safety net is laid as well. Found only in what
   * was read from outside, the call is stopped in every way of working.
   */
  evidence?: { acts: LevelActs; withNet?: true };
  /** A path this session made is its own to remove: the call passes (src/core/provenance.ts `made`). */
  own?: true;
  /** The verdict in Manual: what the rule is called by, in the lists and the settings. */
  verdict: Verdict;
  locked: boolean;
  /** Rules in a pack apply only when the person turns the pack on. */
  pack?: keyof NonNullable<RuleConfig['packs']>;
}

/** How strict an act is: a person's setting on a locked rule may only move it up. */
export const ACT_ORDER: Record<Act, number> = { pass: 0, note: 1, ask: 2, self: 3, stop: 4 };

/** The answer an act gives Claude Code: leaving a call to the person and stopping it are both refusals. */
export const VERDICT_OF: Record<Act, Verdict> = { pass: 'allow', note: 'warn', ask: 'ask', self: 'deny', stop: 'deny' };

const LEVEL_INDEX: Record<Level, 0 | 1 | 2> = { manual: 0, auto: 1, full: 2 };

/** Manual and Autonomous ask; full autonomy asks nothing and leaves it to the person. */
const ASK: LevelActs = ['ask', 'ask', 'self'];
/** Left to the person in every way of working, with the command they would run. */
const SELF: LevelActs = ['self', 'self', 'self'];

/** With a safety net: Manual still asks; Autonomous and full autonomy let it through and say so. */
const NET_NOTE: LevelActs = ['ask', 'note', 'note'];
/** With a safety net: Manual still asks; Autonomous and full autonomy let it through without a word. */
const NET_PASS: LevelActs = ['ask', 'pass', 'pass'];

/** With evidence: Manual still asks; Autonomous and full autonomy let it through and say so. */
const EVIDENCE_NOTE: RuleInfo['evidence'] = { acts: ['ask', 'note', 'note'] };
/** With evidence: Autonomous lets it through and says so; full autonomy waits for the person's clear request. */
const EVIDENCE_AUTO: RuleInfo['evidence'] = { acts: ['ask', 'note', 'self'] };

const r = (
  id: RuleId,
  category: RuleCategory,
  acts: LevelActs,
  locked = false,
  pack?: RuleInfo['pack'],
  net?: LevelActs,
  evidence?: RuleInfo['evidence'],
): RuleInfo => ({
  id,
  category,
  acts,
  verdict: VERDICT_OF[acts[0]],
  locked,
  ...(pack ? { pack } : {}),
  ...(net ? { net } : {}),
  ...(evidence ? { evidence } : {}),
});

export const RULES: Readonly<Record<RuleId, RuleInfo>> = Object.freeze({
  'git.force-push-protected': r('git.force-push-protected', 'git', SELF),
  'git.force-push': r('git.force-push', 'git', ASK, false, undefined, NET_NOTE),
  'git.delete-remote-branch-protected': r('git.delete-remote-branch-protected', 'git', SELF),
  'git.delete-remote-branch': r('git.delete-remote-branch', 'git', ASK, false, undefined, NET_NOTE),
  'git.mirror-or-prune': r('git.mirror-or-prune', 'git', ASK),
  'git.push-pr-only': r('git.push-pr-only', 'git', SELF),
  'git.single-branch': r('git.single-branch', 'git', SELF),
  'git.history-rewrite': r('git.history-rewrite', 'git', ASK, false, undefined, NET_NOTE),
  'git.hooks-path': r('git.hooks-path', 'git', ASK, false, undefined, undefined, EVIDENCE_NOTE),
  // Skipping the repository's own hooks (lint, tests, secret checks) is the project's gate, not one of the four
  // kinds the core decides on: asked in Manual, a line for the person otherwise (the decision table, answer 4).
  'git.no-verify': r('git.no-verify', 'git', ['ask', 'note', 'note']),
  'git.clean': r('git.clean', 'git', ASK, false, undefined, NET_PASS),
  // Uncommitted work thrown away: a note, as before, until the safety net keeps it; Manual asks.
  'git.discard-work': r('git.discard-work', 'git', ['ask', 'note', 'note'], false, undefined, NET_PASS),
  'git.branch-force-delete': r('git.branch-force-delete', 'git', ASK, false, undefined, NET_NOTE),
  'github.admin-merge': r('github.admin-merge', 'git', ASK),
  'github.delete': r('github.delete', 'git', ASK, false, undefined, undefined, EVIDENCE_NOTE),
  'fs.delete-critical': r('fs.delete-critical', 'fs', SELF, true),
  'fs.delete-outside-project': { ...r('fs.delete-outside-project', 'fs', ASK, false, undefined, NET_NOTE), own: true },
  'fs.delete-git-dir': r('fs.delete-git-dir', 'fs', ASK, false, undefined, NET_NOTE),
  'fs.move-critical': r('fs.move-critical', 'fs', SELF, true),
  'fs.disk': r('fs.disk', 'fs', SELF, true),
  'self.claude-settings': r('self.claude-settings', 'self', SELF, true),
  'self.claude-settings-project': r('self.claude-settings-project', 'self', ASK, true),
  'self.disable-hooks': r('self.disable-hooks', 'self', SELF, true),
  'self.tool-files': r('self.tool-files', 'self', SELF, true),
  'self.plugin-cli': r('self.plugin-cli', 'self', SELF, true),
  'self.nested-session': r('self.nested-session', 'self', SELF, true),
  'claude.config-change': r('claude.config-change', 'claude', ASK),
  // The memory is a git repository: deleting or shrinking it is asked, never left unseen (the decision table, answer 2).
  'self.memory-delete': r('self.memory-delete', 'self', ASK, true, undefined, undefined, { acts: ['ask', 'note', 'self'], withNet: true }),
  'self.memory-shrink': r('self.memory-shrink', 'self', ASK, true, undefined, undefined, { acts: ['ask', 'note', 'self'], withNet: true }),
  'self.memory-history': r('self.memory-history', 'self', SELF, true),
  'persist.scheduled-task': r('persist.scheduled-task', 'persist', ASK, false, undefined, undefined, EVIDENCE_AUTO),
  'persist.startup': r('persist.startup', 'persist', ASK, false, undefined, undefined, EVIDENCE_AUTO),
  'persist.shell-profile': r('persist.shell-profile', 'persist', ASK, false, undefined, undefined, EVIDENCE_AUTO),
  'persist.ssh': r('persist.ssh', 'persist', SELF),
  'publish.package': r('publish.package', 'publish', ASK),
  'publish.visibility': r('publish.visibility', 'publish', ASK),
  'publish.deploy': r('publish.deploy', 'publish', ASK),
  // An app store upload, submission or release, and a payment: always the person's (K5 of 1.2.0).
  'publish.store': r('publish.store', 'publish', ASK),
  'docker.volume-delete': r('docker.volume-delete', 'docker', SELF, false, 'dockerVolumes'),
  'data.delete-cloud': r('data.delete-cloud', 'data', SELF),
  'data.write-cloud': r('data.write-cloud', 'data', ASK),
  'data.reset-database': r('data.reset-database', 'data', ASK),
  'system.security-off': r('system.security-off', 'system', SELF),
  'outbound.send': r('outbound.send', 'outbound', ASK, false, undefined, undefined, EVIDENCE_NOTE),
  'outbound.delete': r('outbound.delete', 'outbound', ASK, false, undefined, undefined, EVIDENCE_AUTO),
  'outbound.payment': r('outbound.payment', 'outbound', ASK),
  // A key pushed to a public repository is leaked the moment it lands: asked about.
  'secrets.stage': r('secrets.stage', 'secrets', ASK),
  'secrets.write': r('secrets.write', 'secrets', ['note', 'note', 'note']),
  // A secret leaving the computer: stopped, in every way of working; nobody is told to run it instead.
  'secrets.exfil': r('secrets.exfil', 'secrets', ['stop', 'stop', 'stop'], true),
  // The project's own lint and format settings: loosening a rule is how a failing check is made to pass. Asked;
  // full autonomy goes on and says so in its report (the decision table, answer 3).
  'quality.check-config': r('quality.check-config', 'quality', ['ask', 'ask', 'note']),
  // After outside content was read (a page, an issue, a service's data): sending, persisting or writing the memory is
  // what an instruction hidden in it would ask for (src/core/taint.ts).
  'inject.tainted-act': r('inject.tainted-act', 'inject', ASK),
  // What cannot be followed could be anything, the floor included: never let through unseen.
  'meta.unverifiable': r('meta.unverifiable', 'meta', ASK, true),
});

export const RULE_IDS = Object.keys(RULES) as RuleId[];

/** The level a way of working decides at: a session that chose none is manual, as Claude Code is by default. */
export function levelOf(interaction: string | null | undefined): Level {
  return interaction === 'autonomous' ? 'auto' : interaction === 'full' ? 'full' : 'manual';
}

/** A way of working named on the command line, in English or Turkish; Manual when none is named, null for a word it is not. */
export function levelNamed(word: string | undefined): Level | null {
  const w = (word ?? 'manual').trim().toLowerCase();
  if (['manual', 'manuel'].includes(w)) return 'manual';
  if (['autonomous', 'auto', 'otonom'].includes(w)) return 'auto';
  if (['full', 'full-auto', 'tam', 'tam-otonom'].includes(w)) return 'full';
  return null;
}

/**
 * The verdict a rule has under the person's configuration, in Manual, or null when the rule does not apply.
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
 * What a rule does at a level under the person's configuration, or null when it does not apply. A verdict the
 * person set holds at every level, except that full autonomy asks nobody: a question becomes the person's to do.
 * On a locked rule the person's verdict counts only where it is stricter than the rule's own.
 */
/**
 * What a rule does at a level once a safety net is laid; null where a net changes nothing: the rule has none, the
 * person gave it a verdict of their own (which holds as it is), it is off, or at this level it asks all the same.
 */
export function netAct(id: RuleId, level: Level, config: RuleConfig): Act | null {
  const info = RULES[id];
  if (!info.net || config.verdicts?.[id] || effectiveAct(id, level, config) === null) return null;
  const withNet = info.net[LEVEL_INDEX[level]];
  return withNet === info.acts[LEVEL_INDEX[level]] ? null : withNet;
}

/**
 * What a rule does at a level when what the call acts on is the person's own; null where evidence changes nothing:
 * the rule has none, the person gave it a verdict of their own, it is off, it needs a safety net that is not laid,
 * or at this level it is the same. A locked rule loosens only where the approved table says (the memory's two).
 */
export function evidenceAct(id: RuleId, level: Level, config: RuleConfig, netLaid: boolean): Act | null {
  const info = RULES[id];
  if (!info.evidence || config.verdicts?.[id] || effectiveAct(id, level, config) === null) return null;
  if (info.evidence.withNet && !netLaid) return null;
  const withEvidence = info.evidence.acts[LEVEL_INDEX[level]];
  return withEvidence === info.acts[LEVEL_INDEX[level]] ? null : withEvidence;
}

/**
 * The steps no clear request hands to Claude, even in full autonomy: the protection itself, a payment, a disk, the
 * home or a system folder (the approved table's short list). The person's project locks are left to them by their
 * own acts already.
 */
const NO_REQUEST = new Set<RuleId>(['claude.config-change', 'system.security-off', 'outbound.payment', 'fs.disk', 'fs.delete-critical', 'fs.move-critical']);

/**
 * What a rule does in full autonomy when the person clearly asked for the step (Claude quoted their sentence and
 * code found it): a note, where Autonomous would ask and full autonomy would leave it to them; else null.
 */
export function requestAct(id: RuleId, level: Level, config: RuleConfig): Act | null {
  const info = RULES[id];
  // Locked rules (the protection itself among them) take none.
  if (level !== 'full' || info.locked || NO_REQUEST.has(id) || config.verdicts?.[id]) return null;
  if (effectiveAct(id, level, config) !== 'self' || info.acts[1] !== 'ask') return null;
  return 'note';
}

export function effectiveAct(id: RuleId, level: Level, config: RuleConfig): Act | null {
  const info = RULES[id];
  if (info.pack && !config.packs?.[info.pack]) return null;
  if (!info.locked && config.disabled?.includes(id)) return null;
  const own = info.acts[LEVEL_INDEX[level]];
  const override = config.verdicts?.[id];
  if (!override) return own;
  const theirs: Act = override === 'allow' ? 'pass' : override === 'warn' ? 'note' : override === 'ask' && level !== 'full' ? 'ask' : 'self';
  return info.locked && ACT_ORDER[theirs] < ACT_ORDER[own] ? own : theirs;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The start checks of full autonomy: whether a run may begin here, decided from facts the caller measured
 * (the platform, WSL's own files, Claude Code's merged settings, the permission mode, the safety-net hook's
 * state, git, the budget). Pure, so the plugin, the command line and the doctor decide identically.
 *
 * Every check says what failed and what to do about it. A fact that could not be measured fails its check:
 * a run never starts on a guess.
 */
import type { MessageKey } from './i18n/index.js';
import type { Platform } from './paths.js';
import type { QuotaAssessment } from './quota.js';

export type GateCheckId = 'enabled' | 'budget' | 'platform' | 'wsl' | 'sandbox' | 'probe' | 'permission' | 'hook' | 'modes' | 'project' | 'alone';

export const GATE_CHECKS: readonly GateCheckId[] = [
  'enabled',
  'budget',
  'platform',
  'wsl',
  'sandbox',
  'probe',
  'permission',
  'hook',
  'modes',
  'project',
  'alone',
];

export interface GateCheck {
  id: GateCheckId;
  /** true passed, false failed, null not measured here (the live probe outside a session) or not applicable. */
  ok: boolean | null;
  /** What was found, or what to do about it, in the person's language. */
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface GateResult {
  ok: boolean;
  checks: GateCheck[];
}

/** What WSL's own files say, read by the caller; null fields are files that could not be read. */
export interface WslFacts {
  /** `/proc/sys/kernel/osrelease`. */
  osrelease: string | null;
  /** `/proc/sys/fs/binfmt_misc/WSLInterop` (absent when interop is off), or null when absent. */
  interop: string | null;
  /** `/proc/mounts`. */
  mounts: string | null;
}

export interface GateFacts {
  enabled: boolean;
  budget: { explicit: boolean; target: number | null; quota: QuotaAssessment };
  platform: Platform;
  /** Present on Linux when the system is WSL (an environment variable or the kernel's release says so). */
  wsl: WslFacts | null;
  /** Claude Code's settings merged over every source, as it runs under them; null when they could not be read. */
  settings: Readonly<Record<string, unknown>> | null;
  /** The live probe: a write outside the project through Claude Code's shell tool. Null when not measured. */
  probe: { ran: boolean; refused: boolean; detail: string } | null;
  /**
   * Claude Code's permission mode as the safety-net hook received it with this prompt; null when it did not.
   * Claude Code runs the plugin's prompt hook before the safety-net hook, so at the prompt itself the mode on
   * record is an earlier prompt's or none: it is measured from the run's first step on (`permissionMeasured`).
   */
  permissionMode: string | null;
  /** Whether `permissionMode` is this prompt's: false at the prompt itself and in the terminal. */
  permissionMeasured: boolean;
  hookRan: boolean;
  modes: boolean;
  git: { topLevel: string | null; cwd: string; tracked: number; sameFolder: boolean };
  /**
   * What else is open: a flow in this session, a run of this session, a live session running one in this
   * folder, a paused run in this folder (a new run would leave it behind), with the words that resume or end it.
   */
  alone: { flow: boolean; ownRun: boolean; elsewhere: boolean; paused: { id: string; cont: string; cancel: string } | null };
}

// ── WSL ───────────────────────────────────────────────────────────────────────────────────────────────

/** 1 or 2 when the kernel's release names WSL, null when it is not WSL. */
export function wslVersion(osrelease: string | null): 1 | 2 | null {
  if (!osrelease) return null;
  const s = osrelease.toLowerCase();
  if (!s.includes('microsoft')) return null;
  // WSL2's kernels are built by Microsoft and say so ("6.6.87.2-microsoft-standard-WSL2"); WSL1 reports the
  // Windows build with "-Microsoft" ("4.4.0-19041-Microsoft").
  return /wsl2|microsoft-standard/.test(s) ? 2 : 1;
}

/** Interop is on when its binfmt entry exists and does not say "disabled". */
export function interopOn(interop: string | null): boolean {
  if (interop === null) return false;
  return !/^\s*disabled\b/m.test(interop);
}

/** Mount points of Windows drives in `/proc/mounts`: drvfs, over 9p or virtiofs (WSL's own driver share is not one). */
export function windowsMounts(mounts: string | null): string[] {
  if (!mounts) return [];
  const out: string[] = [];
  for (const line of mounts.split('\n')) {
    const [device, point, type, options = ''] = line.trim().split(/\s+/);
    if (!device || !point || !type) continue;
    const drvfs = type === 'drvfs' || /(?:^|[,;])aname=drvfs(?:[,;]|$)/.test(options) || ((type === '9p' || type === 'virtiofs') && /^[A-Za-z]:/.test(device));
    if (drvfs) out.push(point.replace(/\\040/g, ' '));
  }
  return out;
}

// ── Claude Code's sandbox ─────────────────────────────────────────────────────────────────────────────

function obj(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/** What keeps Claude Code's sandbox from being strict, as setting names; empty when it is strict. */
export function sandboxGaps(settings: Readonly<Record<string, unknown>>): string[] {
  const s = obj(settings.sandbox);
  const net = obj(s.network);
  const gaps: string[] = [];
  if (s.enabled !== true) gaps.push('sandbox.enabled');
  if (s.failIfUnavailable !== true) gaps.push('sandbox.failIfUnavailable');
  if (s.allowUnsandboxedCommands !== false) gaps.push('sandbox.allowUnsandboxedCommands');
  if (Array.isArray(s.excludedCommands) && s.excludedCommands.length) gaps.push('sandbox.excludedCommands');
  if (net.allowAllUnixSockets === true) gaps.push('sandbox.network.allowAllUnixSockets');
  if (Array.isArray(net.allowUnixSockets) && net.allowUnixSockets.length) gaps.push('sandbox.network.allowUnixSockets');
  if (s.enableWeakerNestedSandbox === true) gaps.push('sandbox.enableWeakerNestedSandbox');
  return gaps;
}

/** Permission modes in which nothing waits for an answer; acceptEdits only with a strict network allowlist. */
export function asksNobody(mode: string | null, settings: Readonly<Record<string, unknown>> | null): boolean {
  if (mode === 'bypassPermissions' || mode === 'dontAsk' || mode === 'auto') return true;
  if (mode === 'acceptEdits') return obj(obj(obj(settings).sandbox).network).strictAllowlist === true;
  return false;
}

// ── the checks ────────────────────────────────────────────────────────────────────────────────────────

const pass = (id: GateCheckId, key: MessageKey, params?: Record<string, string | number>): GateCheck => ({ id, ok: true, key, ...(params ? { params } : {}) });
const no = (id: GateCheckId, key: MessageKey, params?: Record<string, string | number>): GateCheck => ({ id, ok: false, key, ...(params ? { params } : {}) });
const skip = (id: GateCheckId, key: MessageKey, params?: Record<string, string | number>): GateCheck => ({ id, ok: null, key, ...(params ? { params } : {}) });

function budgetCheck(b: GateFacts['budget']): GateCheck {
  if (!b.explicit || b.target === null) return no('budget', 'auto.gate.budget.missing');
  const q = b.quota;
  if (!q.usable) return no('budget', q.stale ? 'auto.gate.budget.stale' : 'auto.gate.budget.noReading');
  const week = Math.round(q.week?.used ?? 0);
  if (q.level !== 'ok' || week >= b.target) return no('budget', 'auto.gate.budget.reached', { used: week, target: b.target });
  return pass('budget', 'auto.gate.budget.ok', { used: week, target: b.target });
}

function wslCheck(f: GateFacts): GateCheck {
  if (f.platform !== 'linux' || !f.wsl) return skip('wsl', 'auto.gate.wsl.notWsl');
  const v = wslVersion(f.wsl.osrelease);
  if (v === null) return no('wsl', 'auto.gate.wsl.unreadable');
  if (v === 1) return no('wsl', 'auto.gate.wsl.v1');
  const problems: string[] = [];
  if (interopOn(f.wsl.interop)) problems.push('interop');
  // An empty mount table is an unread one: every Linux system mounts something.
  if (!f.wsl.mounts?.trim()) return no('wsl', 'auto.gate.wsl.unreadable');
  const drives = windowsMounts(f.wsl.mounts);
  if (problems.length && drives.length) return no('wsl', 'auto.gate.wsl.both', { mounts: drives.join(', ') });
  if (problems.length) return no('wsl', 'auto.gate.wsl.interop');
  if (drives.length) return no('wsl', 'auto.gate.wsl.mounts', { mounts: drives.join(', ') });
  return pass('wsl', 'auto.gate.wsl.ok');
}

function probeCheck(f: GateFacts): GateCheck {
  if (f.platform === 'win32') return skip('probe', 'auto.gate.probe.notHere');
  if (!f.probe) return skip('probe', 'auto.gate.probe.notMeasured');
  if (!f.probe.ran) return no('probe', 'auto.gate.probe.didNotRun', { detail: f.probe.detail });
  if (!f.probe.refused) return no('probe', 'auto.gate.probe.wrote');
  return pass('probe', 'auto.gate.probe.ok');
}

function projectCheck(g: GateFacts['git']): GateCheck {
  if (!g.topLevel) return no('project', 'auto.gate.project.noGit', { cwd: g.cwd });
  if (!g.sameFolder) return no('project', 'auto.gate.project.notTop', { top: g.topLevel });
  if (g.tracked > 0) return no('project', 'auto.gate.project.dirty', { n: g.tracked });
  return pass('project', 'auto.gate.project.ok', { top: g.topLevel });
}

/** Every check, in a fixed order. The run may start only when none failed and the live probe passed. */
export function checkGate(f: GateFacts): GateResult {
  const checks: GateCheck[] = [
    f.enabled ? pass('enabled', 'auto.gate.enabled.ok') : no('enabled', 'auto.gate.enabled.off'),
    budgetCheck(f.budget),
    f.platform === 'win32' ? no('platform', 'auto.gate.platform.windows') : pass('platform', 'auto.gate.platform.ok', { platform: f.platform }),
    wslCheck(f),
    f.platform === 'win32'
      ? skip('sandbox', 'auto.gate.sandbox.notHere')
      : f.settings === null
        ? no('sandbox', 'auto.gate.sandbox.unreadable')
        : sandboxGaps(f.settings).length
          ? no('sandbox', 'auto.gate.sandbox.gaps', { settings: sandboxGaps(f.settings).join(', ') })
          : pass('sandbox', 'auto.gate.sandbox.ok'),
    probeCheck(f),
    !f.permissionMeasured
      ? skip('permission', 'auto.gate.permission.atStart')
      : asksNobody(f.permissionMode, f.settings)
        ? pass('permission', 'auto.gate.permission.ok', { mode: f.permissionMode ?? '' })
        : f.permissionMode === 'acceptEdits'
          ? no('permission', 'auto.gate.permission.network')
          : no('permission', f.permissionMode ? 'auto.gate.permission.asks' : 'auto.gate.permission.unknown', { mode: f.permissionMode ?? '' }),
    f.hookRan ? pass('hook', 'auto.gate.hook.ok') : no('hook', 'auto.gate.hook.missing'),
    f.modes ? pass('modes', 'auto.gate.modes.ok') : no('modes', 'auto.gate.modes.off'),
    projectCheck(f.git),
    f.alone.flow
      ? no('alone', 'auto.gate.alone.flow')
      : f.alone.ownRun
        ? no('alone', 'auto.gate.alone.run')
        : f.alone.elsewhere
          ? no('alone', 'auto.gate.alone.elsewhere')
          : f.alone.paused
            ? no('alone', 'auto.gate.alone.paused', f.alone.paused)
            : pass('alone', 'auto.gate.alone.ok'),
  ];
  // The probe and the permission mode are measured only at the run's first step: unmeasured is not passed.
  const ok = checks.every((c) => c.ok !== false) && AT_FIRST_STEP.every((id) => checks.find((c) => c.id === id)?.ok === true);
  return { ok, checks };
}

/** The checks measured only at the run's first step, once Claude Code has handed the prompt to the safety-net hook. */
export const AT_FIRST_STEP: readonly GateCheckId[] = ['probe', 'permission'];

/** Nothing measured so far failed: the run may go on to its first step, where the rest is measured. */
export function gateOpen(g: GateResult): boolean {
  return g.checks.every((c) => c.ok !== false);
}

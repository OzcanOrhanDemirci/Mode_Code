// SPDX-License-Identifier: Apache-2.0
/**
 * Modes: what kind of work a session is doing, and what each kind may change. Pure.
 *
 * Free and code add nothing to the safety belt. Chat, research and plan are restricted: they write only
 * into allowed folders (temporary folders always; the flow's work folder in research and plan; Claude
 * Code's plan file in plan) and run only commands that can be placed there (see shell/effects.ts).
 *
 * The mode in force for a call is, in order: a mode the person gave this turn only; the mode of the
 * flow's current step; plan while Claude Code's own plan mode is on; the session's mode.
 */
import { isUnder, resolvePath, type PathEnv, type Platform } from './paths.js';

export type WorkMode = 'free' | 'chat' | 'research' | 'plan' | 'code';

export const WORK_MODES: readonly WorkMode[] = ['free', 'chat', 'research', 'plan', 'code'];

export function isWorkMode(x: unknown): x is WorkMode {
  return typeof x === 'string' && (WORK_MODES as readonly string[]).includes(x);
}

/** Modes that change nothing outside their allowed folders. */
export function isRestricted(m: WorkMode): boolean {
  return m === 'chat' || m === 'research' || m === 'plan';
}

/** The mark shown beside a mode's name. */
export const MODE_ICON: Record<WorkMode, string> = { free: '', chat: '💬', research: '🔍', plan: '📐', code: '🔨' };

export interface EffectiveModeInput {
  session: WorkMode;
  /** A mode the person gave for this turn only (a mode keyword ending a message while a flow runs). */
  turn: WorkMode | null;
  /** The mode of the running flow's current step, or null when no flow runs. */
  flowStep: WorkMode | null;
  /** Claude Code's own plan mode is on. */
  nativePlan: boolean;
}

export function effectiveMode(i: EffectiveModeInput): WorkMode {
  return i.turn ?? i.flowStep ?? (i.nativePlan ? 'plan' : i.session);
}

/** Folders (or files) a restricted mode may write, resolved. */
export interface ModeZones {
  /** Temporary folders: TEMP, TMP, TMPDIR, /tmp. */
  temp: string[];
  /** The flows' work folder (reports and plan drafts). */
  work: string[];
  /** Claude Code's plan files: its plans folder and the plan file its plan mode named. */
  plan: string[];
}

/** Where a mode may write; null when it may write anywhere the belt allows. */
export function writableIn(mode: WorkMode, z: ModeZones): string[] | null {
  switch (mode) {
    case 'chat':
      return z.temp;
    case 'research':
      return [...z.temp, ...z.work];
    case 'plan':
      return [...z.temp, ...z.work, ...z.plan];
    default:
      return null;
  }
}

export function inZones(path: string, zones: readonly string[], platform: Platform): boolean {
  return zones.some((z) => isUnder(path, z, platform));
}

/** The temporary folders of an environment, resolved; duplicates removed. */
export function tempZones(env: Readonly<Record<string, string | undefined>>, p: PathEnv): string[] {
  const raw = [env.TEMP, env.TMP, env.TMPDIR, p.platform === 'win32' ? undefined : '/tmp', p.platform === 'win32' ? '/tmp' : undefined];
  const out: string[] = [];
  for (const r of raw) {
    if (!r) continue;
    const x = resolvePath(r, p);
    if (!out.some((o) => isUnder(o, x, p.platform) && isUnder(x, o, p.platform))) out.push(x);
  }
  return out;
}

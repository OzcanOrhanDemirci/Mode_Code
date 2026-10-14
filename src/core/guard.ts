// SPDX-License-Identifier: Apache-2.0
/**
 * Guards that depend on the session's state rather than on the command alone: the restricted modes (chat,
 * research, plan: no change outside their allowed folders) and the quota guard (no new heavy work after the
 * budget). They answer with a refusal or nothing. The safety belt is separate and never depends on state,
 * so it holds even when state cannot be read.
 */
import { classifyTurn, OUTWARD_MCP, type ClassifyEnv } from './footer.js';
import { isBeltTool, isFileTool, shellOf } from './belt/tools.js';
import { commandEffects, hidingIssues, type Effect } from './shell/effects.js';
import { inZones, isRestricted, MODE_ICON, writableIn, type ModeZones, type WorkMode } from './modes.js';
import { resolvePath, type PathEnv } from './paths.js';
import { truncate } from './text.js';
import type { QuotaAssessment } from './quota.js';
import { tIn, type Lang, type MessageKey } from './i18n/index.js';

export interface GuardRefusal {
  kind: 'mode' | 'quota';
  /** For a mode refusal: the mode, and what was refused (file, write, dynamic, local, unknown, outside, unreadable, tool). */
  mode?: WorkMode;
  what?: string;
  reason: string;
}

export interface ModeGuard {
  /** The mode in force for this call (see modes.effectiveMode). */
  mode: WorkMode;
  zones: ModeZones;
  /** Environment variables, for paths written with $TMPDIR or %TEMP%. */
  env: Readonly<Record<string, string | undefined>>;
  /** The flow step's name in the person's language, when the mode comes from a flow's step. */
  flowStep: string | null;
  /** What the refusal ends with instead of the flow's or the mode's own advice (a full-autonomy run's plan phase). */
  tail?: string;
  /** What the person types to switch to code or free, in their language. */
  words: { code: string; free: string };
}

/** Tools that start more work rather than finishing the current one. */
const HEAVY = /^(?:Agent|Task|Workflow|WebSearch|WebFetch)$/;
/** Tools that only read or record, always allowed while stopping. */
const QUIET = /^(?:Read|Glob|Grep|LS|TodoWrite|ToolSearch|AskUserQuestion|ExitPlanMode|EnterPlanMode)$/;
/**
 * Claude Code tools that act outside the session or the machine (a worktree, a schedule, a publication, a
 * message to another session), refused in restricted modes unless their input only reads.
 */
const OUTWARD_TOOLS = /^(?:EnterWorktree|ExitWorktree|CronCreate|CronDelete|RemoteTrigger|Artifact|ArtifactData|ArtifactComments|DesignSync|SendMessage)$/;
const READING_ACTION = /^(?:read|list|get|query|open|quickstart|status|info)$/i;

function zoneText(mode: WorkMode, z: ModeZones, lang: Lang): string {
  const parts = [tIn(lang, 'mode.zone.temp')];
  if (mode !== 'chat') for (const w of z.work) parts.push(tIn(lang, 'mode.zone.work', { path: w }));
  if (mode === 'plan' && z.plan.length) parts.push(tIn(lang, 'mode.zone.plan'));
  return parts.join(tIn(lang, 'mode.zone.or'));
}

function refuse(g: ModeGuard, lang: Lang, what: string, key: MessageKey, params: Record<string, string>): GuardRefusal {
  const head = tIn(lang, 'mode.refuse.head', { icon: MODE_ICON[g.mode], mode: tIn(lang, `mode.name.${g.mode}` as MessageKey) }).trim();
  const tail = g.tail ?? (g.flowStep ? tIn(lang, 'mode.refuse.tailFlow', { step: g.flowStep }) : tIn(lang, 'mode.refuse.tail', g.words));
  return { kind: 'mode', mode: g.mode, what, reason: `${head} ${tIn(lang, key, params)} ${tail}` };
}

/** Why one program cannot run here, or null when it can. */
function judgeEffect(e: Effect, allowed: readonly string[], g: ModeGuard, p: PathEnv, lang: Lang): GuardRefusal | null {
  const zones = zoneText(g.mode, g.zones, lang);
  const program = truncate(e.program, 60);
  const why = tIn(lang, `mode.why.${e.why}` as MessageKey);
  if (e.kind === 'outside') return refuse(g, lang, 'outside', 'mode.refuse.outside', { program, why });
  for (const t of e.targets) {
    if (t === null) return refuse(g, lang, 'dynamic', 'mode.refuse.dynamic', { program });
    if (!inZones(t, allowed, p.platform)) return refuse(g, lang, 'write', 'mode.refuse.write', { program, target: t, zones });
  }
  if (e.kind === 'local' || e.kind === 'unknown') {
    if (e.cwd === null || !inZones(e.cwd, allowed, p.platform))
      return refuse(g, lang, e.kind, e.kind === 'local' ? 'mode.refuse.local' : 'mode.refuse.unknown', { program, why, zones });
  }
  return null;
}

/** The refusal of a restricted mode for a tool call, or null when the mode allows it (or is not restricted). */
export function checkMode(tool: string, input: Readonly<Record<string, unknown>>, g: ModeGuard, p: PathEnv, lang: Lang): GuardRefusal | null {
  if (!isRestricted(g.mode)) return null;
  const allowed = writableIn(g.mode, g.zones) ?? [];
  const dialect = shellOf(tool);
  if (dialect) {
    const r = commandEffects(String(input.command ?? ''), dialect, { ...p, env: g.env });
    const hidden = hidingIssues(r.issues);
    if (hidden.length) return refuse(g, lang, 'unreadable', 'mode.refuse.unreadable', { issues: hidden.join(', ') });
    for (const e of r.effects) {
      const no = judgeEffect(e, allowed, g, p, lang);
      if (no) return no;
    }
    return null;
  }
  if (isFileTool(tool)) {
    const raw = String(input.file_path ?? input.notebook_path ?? '');
    const path = resolvePath(raw, p);
    if (!raw || !inZones(path, allowed, p.platform))
      return refuse(g, lang, 'file', 'mode.refuse.file', { path: raw || '?', zones: zoneText(g.mode, g.zones, lang) });
    return null;
  }
  if (tool.startsWith('mcp__mode-code__')) return null;
  if ((tool.startsWith('mcp__') && OUTWARD_MCP.test(tool)) || (OUTWARD_TOOLS.test(tool) && !READING_ACTION.test(String(input.action ?? ''))))
    return refuse(g, lang, 'tool', 'mode.refuse.tool', { tool });
  return null;
}

export function checkGuards(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  mode: ModeGuard | null,
  quota: QuotaAssessment | null,
  env: ClassifyEnv,
  lang: Lang,
): GuardRefusal | null {
  if (mode) {
    const refusal = checkMode(tool, input, mode, env, lang);
    if (refusal) return refusal;
  }
  if (quota && quota.usable) {
    if (quota.level !== 'ok' && HEAVY.test(tool)) return { kind: 'quota', reason: tIn(lang, 'guard.quota.heavy') };
    if (quota.level === 'stop' && !QUIET.test(tool) && isBeltTool(tool)) {
      const acts = classifyTurn([{ name: tool, input }], env);
      const changes = acts.files + acts.settings + acts.shell + acts.external;
      if (changes > 0)
        return {
          kind: 'quota',
          reason: tIn(lang, 'guard.quota.stop'),
        };
    }
  }
  return null;
}

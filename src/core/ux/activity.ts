// SPDX-License-Identifier: Apache-2.0
/**
 * The activity (docs/design.md, No invisible work): every kind of event Mode_Code writes as it works in the
 * background, as one line a person reads: what happened, its class (done, waits for you, blocked, a note), why (the
 * rule or the setting behind it) and where to change that. The control center's Activity page draws these lines; a
 * kind of event that has no line here fails test/core/ux-activity.test.ts. Pure.
 */
import { tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { ago } from '../format.js';
import { nameOf, type SettingPath } from './catalog.js';
import type { Meaning } from './tokens.js';

/** An event as the log holds it (src/app/data.ts reads it): its kind, its time, its session, and its own fields. */
export interface ActivityEvent {
  at: number;
  kind: string;
  session?: string;
  [field: string]: unknown;
}

/** Done; waits for you; was blocked or failed; a note of work nobody needs to act on. */
export type ActivityClass = 'done' | 'waiting' | 'blocked' | 'note';

export interface ActivityLine {
  at: number;
  session: string | null;
  cls: ActivityClass;
  meaning: Meaning;
  text: string;
  /** Why it happened: the rule or the setting behind it, in words; null when nothing but the work itself. */
  why: string | null;
  /** The control center's page where that rule or setting is changed, or where the work is seen. */
  address: string | null;
  /** Work that happens all the time (a quota reading, the notes sent with a prompt): shown when asked for. */
  quiet: boolean;
}

const MEANING: Record<ActivityClass, Meaning> = { done: 'on', waiting: 'ask', blocked: 'bad', note: 'off' };

/** Every kind of event the plugin and the hook write; the test holds the sources to this list. */
export const ACTIVITY_KINDS = [
  'belt',
  'freeze',
  'mode',
  'quota',
  'modeDisagree',
  'invisible',
  'startCap',
  'notes',
  'hint',
  'keyword',
  'reading',
  'resume',
  'skill',
  'mcpChanged',
  'packs',
  'pack',
  'memory',
  'sync',
  'handoff',
  'center',
  'agents',
  'close',
  'conflict',
  'flow',
  'run',
  'bypass',
  'permission',
  'flagged',
] as const;

const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').slice(0, max);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean) : []);

/** One event as a line. A kind this version does not know reads as a note of its kind, never as nothing. */
export function activityOf(e: ActivityEvent, lang: Lang): ActivityLine {
  const t = (k: string, p?: Record<string, string | number>) => tIn(lang, k as MessageKey, p);
  const line = (cls: ActivityClass, text: string, why: string | null = null, address: string | null = null, quiet = false): ActivityLine => ({
    at: e.at,
    session: typeof e.session === 'string' ? e.session : null,
    cls,
    meaning: MEANING[cls],
    text,
    why,
    address,
    quiet,
  });
  const on = (path: SettingPath) => t('act.why.on', { name: nameOf(path, lang) });
  const tool = str(e.tool, 40) || '?';
  switch (e.kind) {
    case 'belt': {
      const rules = list(e.rules);
      const rule = rules[0];
      const why = rule ? t('act.why.rule', { rule: t(`rulename.${rule}`) }) : null;
      const at = rule ? `protection/rules/${rule}` : 'protection/events';
      const reason = list(e.reasons)[0] ?? '';
      if (e.verdict === 'deny') return line('blocked', t('act.belt.deny', { tool, reason }), why, at);
      if (e.verdict === 'warn') return line('note', t('act.belt.warn', { tool, reason }), why, at, true);
      if (e.answer === 'deferred') return line('waiting', t('act.belt.deferred', { tool, reason }), why, at);
      if (e.answer === 'allow' || e.answer === 'third') return line('done', t('act.belt.allowed', { tool, reason }), why, at);
      return line('blocked', t('act.belt.declined', { tool, reason }), why, at);
    }
    case 'freeze':
      return line('blocked', t('act.freeze', { tool }), t('act.why.freeze'));
    case 'mode':
      return line('blocked', t('act.mode', { tool, mode: t(`mode.name.${str(e.mode, 20)}`) }), t('act.why.mode'));
    case 'quota':
      if (e.verdict === 'deny') return line('blocked', t('act.quota.held', { tool }), t('act.why.budget'), 'quota/limits');
      return line(
        e.level === 'ok' ? 'done' : 'waiting',
        t(`act.quota.${e.level === 'stop' ? 'stop' : e.level === 'ok' ? 'ok' : 'wrapUp'}`),
        t('act.why.budget'),
        'quota/limits',
      );
    case 'modeDisagree':
      return line('note', t('act.modeDisagree', { mode: t(`mode.name.${str(e.mode, 20)}`) }), null, null, true);
    case 'invisible':
      return line('note', t('act.invisible', { tool, n: num(e.removed) }));
    case 'startCap':
      return line('note', t('act.startCap', { before: num(e.before), after: num(e.after) }), null, null, true);
    case 'notes':
      return line('note', t('act.notes', { n: num(e.count) }), null, null, true);
    case 'hint':
      return line('note', t('act.hint', { hint: str(e.hint, 40) }), null, null, true);
    case 'keyword':
      return line('done', t('act.keyword', { keyword: t(`kw.kind.${str(e.keyword, 20)}`) }), null, 'work/keywords');
    case 'reading':
      return line('note', t('act.reading', { five: num(e.five), week: num(e.week) }), null, 'quota/usage', true);
    case 'resume':
      return line('done', t('act.resume'), on('quota.autoResume'), 'quota/limits');
    case 'skill':
      return line('done', t('act.skill', { skill: str(e.skill, 80) }), null, 'claude-code/skills');
    case 'mcpChanged':
      return line('waiting', t('act.mcpChanged', { tools: list(e.tools).join(', ') }), null, 'claude-code/mcp');
    case 'packs':
      return line(
        'done',
        t(e.by === 'claude' ? 'act.packs.claude' : 'act.packs.auto', { packs: list(e.on).join(', ') }),
        on('packs.autoUse'),
        'claude-code/packs',
      );
    case 'pack':
      return line('note', t('act.pack', { pack: str(e.pack, 40) }), null, 'claude-code/packs', true);
    case 'memory': {
      const trouble = num(e.conflicts) > 0 || num(e.held) > 0 || e.pull === 'conflict' || e.pull === 'diverged';
      if (trouble) return line('blocked', t('act.memory.held'), null, 'memory/store');
      return line('done', t('act.memory.synced', { n: num(e.pulled) }), null, 'memory/store', !num(e.pulled) && e.commit !== 'ok');
    }
    case 'sync':
      if (e.error === true) return line('blocked', t('act.sync.failed'), null, 'memory/sync');
      return line('done', t('act.sync.done'), null, 'memory/sync', true);
    case 'handoff':
      return line('done', t('act.handoff', { project: str(e.project, 60) || '?' }), on('memory.handoff.enabled'), 'memory/handoffs');
    case 'center':
      return e.ok === false ? line('blocked', t('act.center.failed')) : line('done', t('act.center.opened'), null, null, true);
    case 'agents': {
      const why = t('act.why.agents');
      if (e.action === 'deny') return line('blocked', t('act.agents.deny'), why, 'work/agents');
      if (e.action === 'set') return line('done', t('act.agents.set', { mode: t(`agents.mode.${str(e.mode, 20)}`) }), why, 'work/agents');
      if (e.action === 'stop') return line('done', t('act.agents.stop', { n: num(e.stopped) }), null, 'work/agents');
      if (e.action === 'batchDone') return line('done', t('act.agents.batchDone', { n: num(e.started) }), why, 'work/agents');
      return line('note', t('act.agents.note'), why, 'work/agents', true);
    }
    case 'close':
      return line('done', t('act.close'));
    case 'conflict':
      return line('waiting', t('act.conflict', { n: list(e.sessions).length }), null, 'now');
    case 'flow': {
      const flow = str(e.flow, 60);
      const status = str(e.status, 20);
      return line(
        status === 'waiting' ? 'waiting' : e.action === 'refused' ? 'blocked' : 'done',
        t('act.flow', { flow, status: t(`flow.status.${status}`) }),
        null,
        flow ? `work/flows/${flow}` : null,
      );
    }
    case 'run': {
      const run = str(e.run, 60);
      if (e.action === 'gate' && e.ok === false)
        return line('blocked', t('act.run.refused', { checks: list(e.failed).join(', ') }), t('act.why.autonomy'), 'work/full-auto');
      if (e.action === 'gate') return line('note', t('act.run.checked'), null, 'work/full-auto', true);
      const status = str(e.status, 20) || 'active';
      return line(
        status === 'paused' || e.defer ? 'waiting' : status === 'stuck' ? 'blocked' : 'done',
        t('act.run', { run, status: t(`auto.status.${status}`) }),
        null,
        run ? `work/runs/${run}` : 'work/runs',
      );
    }
    case 'bypass':
      if (e.action === 'on')
        return line('note', t('act.bypass.on', { hours: num(e.hours) }), t('act.why.bypass', { name: nameOf('bypass.enabled', lang) }), 'work/bypass');
      if (e.action === 'off')
        return line('done', t('act.bypass.off', { n: num(e.count) }), t('act.why.bypass', { name: nameOf('bypass.enabled', lang) }), 'work/bypassed');
      return line('note', t('act.bypass.call', { tool }), t('act.why.bypass', { name: nameOf('bypass.enabled', lang) }), 'work/bypassed');
    case 'permission':
      return line('done', t('act.permission', { tool }), t('act.why.permission'), 'claude-code/permissions', true);
    case 'flagged': {
      const category = str(e.category, 40);
      return line('blocked', category ? t('act.flagged.named', { category }) : t('act.flagged'), t('act.why.flagged'));
    }
    default:
      return line('note', t('act.unknown', { kind: str(e.kind, 30) }), null, null, true);
  }
}

/**
 * The lines to show: what waits for you first (of the last day), then the rest, newest first; the quiet ones only when
 * asked for.
 */
export function activityLines(events: readonly ActivityEvent[], lang: Lang, now: number, opts: { quiet?: boolean; limit?: number } = {}): ActivityLine[] {
  const lines = events.map((e) => activityOf(e, lang)).filter((l) => opts.quiet || !l.quiet);
  const waiting = lines.filter((l) => l.cls === 'waiting' && now - l.at < 86_400_000).sort((a, b) => b.at - a.at);
  const rest = lines.filter((l) => !waiting.includes(l)).sort((a, b) => b.at - a.at);
  return [...waiting, ...rest].slice(0, opts.limit ?? 300);
}

/** "12 min ago · ✗ Blocked Bash: …", the line as a plain sentence (the command line, a tool's answer). */
export function activityText(l: ActivityLine, now: number, lang: Lang): string {
  return `${ago(l.at, now, lang)} · ${l.text}${l.why ? ` (${l.why})` : ''}`;
}

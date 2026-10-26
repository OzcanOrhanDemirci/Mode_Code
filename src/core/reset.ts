// SPDX-License-Identifier: Apache-2.0
/**
 * The reset at a task boundary (docs/quota.md, "Reset at a task boundary"). In autonomous work every call reads the
 * whole conversation again, so a long run pays for its past on every step: measured over the author's 30 days, a
 * reset where a piece of work ends (a commit or a push) with more than 200K of context saves 14 to 19% of the whole
 * quota, half of it at the boundaries where the model goes on to the next task without the person typing. So the
 * reset is the plugin's: a commit or a push arms it, the first call that is not part of finishing that work (the
 * memory's commit, the push, the pull request) is refused, a note is written from the conversation itself
 * ($.model.fork), and the conversation goes on in a fresh one with the note, the way of working and what the safety
 * layer knows (the outside content read, where things came from) carried over. Pure: the decisions, the note's prompt
 * and its reading, what is carried; the plugin runs the steps.
 */
import { APP_NAME, PLUGIN_NAME } from './app.js';
import { PART_KEYS, type HandoffParts } from './handoff.js';
import { isUnder, pathKey, resolvePath, type PathEnv, type Platform } from './paths.js';
import { analyzeCommand, type Invocation } from './shell/analyze.js';
import { shellOf } from './belt/tools.js';
import type { Interaction, ModSessionState } from './session.js';
import type { Provenance } from './provenance.js';
import type { Lang } from './i18n/index.js';

/** The threshold and its range are the settings' (quota.resetTokens). */
export { RESET_TOKENS, RESET_TOKENS_MAX, RESET_TOKENS_MIN } from './config.js';
/** At most one reset in this long: a run of small tasks over a large context does not reset at each. */
export const RESET_GAP_MS = 15 * 60_000;
/** What is carried waits this long for the conversation after the /clear; older, it is not taken up. */
export const CARRY_TTL_MS = 2 * 60_000;

/** A commit or a push of the main conversation ended a piece of work with a large context: the reset waits for the next task. */
export interface ResetArm {
  kind: 'commit' | 'push';
  /** The context's size at that moment. */
  tokens: number;
  at: number;
}

/**
 * Whether a commit or a push arms the reset: in autonomous work and full autonomy only (in manual the person types
 * /clear on the strip's hint), with the setting on, and a context of `threshold` or more.
 */
export function armOnBoundary(o: {
  /** The git subcommands of the call that ran. */
  kinds: readonly string[];
  tokens: number;
  interaction: Interaction;
  autoReset: boolean;
  threshold: number;
  now: number;
}): ResetArm | null {
  if (!o.autoReset || (o.interaction !== 'autonomous' && o.interaction !== 'full')) return null;
  if (o.tokens < o.threshold) return null;
  if (o.kinds.includes('push')) return { kind: 'push', tokens: o.tokens, at: o.now };
  return o.kinds.includes('commit') ? { kind: 'commit', tokens: o.tokens, at: o.now } : null;
}

/** git subcommands that finish a piece of work rather than start the next: its commit, its push, a look at either. */
export const CLUSTER_GIT: ReadonlySet<string> = new Set(['add', 'commit', 'push', 'status', 'log', 'diff', 'show', 'fetch', 'pull', 'tag']);
/** gh's pull requests and their runs: the work's review and checks. */
const CLUSTER_GH: ReadonlySet<string> = new Set(['pr', 'run']);
/** Programs that only move about or wait: `cd x && git commit` is a commit. */
const NEUTRAL: ReadonlySet<string> = new Set([
  'cd',
  'pushd',
  'popd',
  'pwd',
  'true',
  'echo',
  'sleep',
  'set-location',
  'push-location',
  'pop-location',
  'get-location',
  'write-output',
  'start-sleep',
]);
const FILE_WRITES: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Mode_Code's own tools that close a piece of work: its handoff note, a flow's step, a clear request for the push. */
const OWN_FINISHING: ReadonlySet<string> = new Set(['handoff', 'flow_step', 'request'].map((t) => `mcp__${PLUGIN_NAME}__${t}`));
const FILE_READS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob']);

/** The subcommand of a git invocation: its first word past git's own options (`-C <dir>` and `-c <k=v>` take one). */
export function gitSubcommand(args: readonly string[]): string | null {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  return args[i] ?? null;
}

/** Where a call that finishes a piece of work may write and read: the memory's folders and the handoff notes'. */
export interface ClusterEnv extends PathEnv {
  memoryDirs: readonly string[];
  handoffDir: string;
}

function inPlaces(path: unknown, env: ClusterEnv, places: readonly string[]): boolean {
  if (typeof path !== 'string' || !path) return false;
  const p = resolvePath(path, env);
  return places.some((d) => isUnder(p, d, env.platform));
}

function finishing(inv: Invocation, env: ClusterEnv): boolean {
  if (inv.programDynamic || inv.writes.some((w, i) => inv.writeDynamic[i] || !inPlaces(w, env, [...env.memoryDirs, env.handoffDir]))) return false;
  if (inv.program === 'git') return CLUSTER_GIT.has(gitSubcommand(inv.args) ?? '');
  if (inv.program === 'gh') return CLUSTER_GH.has(inv.args[0] ?? '');
  return NEUTRAL.has(inv.program);
}

/**
 * Whether a call is part of finishing the piece of work a commit or a push armed the reset for, so the reset waits
 * past it: the memory's notes and their commit, the push, the pull request and its checks, the to-do list. A chain
 * such as "the memory's commit, then the project's commit, then both pushes" is never cut in two.
 */
export function inCluster(tool: string, input: Readonly<Record<string, unknown>>, env: ClusterEnv): boolean {
  if (OWN_FINISHING.has(tool) || tool === 'TodoWrite') return true;
  const places = [...env.memoryDirs, env.handoffDir];
  if (FILE_WRITES.has(tool)) return inPlaces(input.file_path ?? input.notebook_path, env, places);
  // Reading the memory is how its notes are brought up to date: part of the same chain.
  if (FILE_READS.has(tool)) return inPlaces(input.file_path ?? input.path, env, env.memoryDirs);
  const dialect = shellOf(tool);
  if (!dialect) return false;
  const a = analyzeCommand(String(input.command ?? ''), dialect);
  return a.invocations.some((i) => i.program === 'git' || i.program === 'gh') && a.invocations.every((i) => finishing(i, env));
}

export type ResetSkip = 'busy' | 'recent' | 'quota' | 'wrapUp';
export type ResetVerdict = { go: true } | { go: false; why: ResetSkip };

/**
 * Whether the armed reset goes on now: not while an agent or a background task works (it would lose the
 * conversation it reports to), not twice in RESET_GAP_MS, not at the quota's stop (the work stops there anyway), not
 * while the work wraps up (it ends there). A reset that does not go on leaves the strip's hint, for the next boundary.
 */
export function resetVerdict(o: { busy: boolean; lastResetAt: number; now: number; quotaStop: boolean; wrapUp: boolean }): ResetVerdict {
  if (o.busy) return { go: false, why: 'busy' };
  if (o.quotaStop) return { go: false, why: 'quota' };
  if (o.wrapUp) return { go: false, why: 'wrapUp' };
  // Never reset is 0: epochs away, never within the gap.
  if (o.now - o.lastResetAt < RESET_GAP_MS) return { go: false, why: 'recent' };
  return { go: true };
}

/**
 * What the conversation is asked for its note, just before the reset: the four parts of a handoff note, as JSON, in
 * the person's language. Asked of the conversation itself, from its cache, with every tool denied; never taken from
 * its last answer (a stop hook may have cut that answer to its answer summary).
 */
export function forkPrompt(): string {
  return [
    `[${APP_NAME}] ${APP_NAME} is about to reset this conversation to save tokens: the work goes on at once in a new conversation that sees only the note you write now (and the files, git and the memory).`,
    'Do not call any tool. Reply with one JSON object only, with four string fields, each a few lines (at most about 200 words), in the language the person writes in:',
    'summary: what was done in this conversation, with the results that matter (measured numbers, what passed and what failed);',
    'open: what is still open or half done;',
    'decisions: what the person decided, in their own words where they gave them, and what you decided and why;',
    'next: the next step, concrete enough to start on at once (the files, the commands).',
    'No keys, tokens or passwords.',
  ].join('\n');
}

const asText = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map((x) => `- ${x}`).join('\n');
  return null;
};

/**
 * The four parts in the fork's reply: a JSON object (in a fenced block or bare, lists joined as lines), or headings
 * named after the parts (`## Summary`, `next:`). Null when the reply holds no part at all; a missing part is the
 * caller's to find (handoff.ts partProblems).
 */
export function parseForkParts(text: string): Partial<HandoffParts> | null {
  const object = /\{[\s\S]*\}/.exec(text);
  if (object) {
    try {
      const o = JSON.parse(object[0]) as Record<string, unknown>;
      const out: Partial<HandoffParts> = {};
      for (const k of PART_KEYS) {
        const v = asText(o[k]);
        if (v !== null) out[k] = v.trim();
      }
      if (Object.keys(out).length) return out;
    } catch {
      /* read as headings below */
    }
  }
  const out: Partial<HandoffParts> = {};
  let current: keyof HandoffParts | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (current) out[current] = lines.join('\n').trim();
    lines.length = 0;
  };
  for (const line of text.split(/\r?\n/)) {
    const h = /^\s*(?:#{1,4}\s*|\*\*)?(summary|open|decisions|next)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(.*)$/i.exec(line);
    if (h) {
      flush();
      current = h[1]!.toLowerCase() as keyof HandoffParts;
      if (h[2]!.trim()) lines.push(h[2]!.trim());
    } else if (current) lines.push(line);
  }
  flush();
  return Object.keys(out).length ? out : null;
}

/** The session's state a reset carries into the new conversation (a person's own /clear carries none of it). */
export type CarriedState = Pick<
  ModSessionState,
  'mode' | 'interaction' | 'flowId' | 'project' | 'weeklyTarget' | 'weeklyTargetSource' | 'wrapUp' | 'resumeAt' | 'agents' | 'frozen' | 'tainted'
>;

/**
 * What the state carries: the mode and the way of working (full autonomy too: the reset is the plugin's, not the
 * person's choice), the flow, the project, the budget, the quota's resume (its time, not a new one), the agents, the
 * frozen folder, and the outside content read: a reset never clears what the safety layer knows. Not carried: the
 * approvals (each for one call), the blocks counted and the turn's own counts.
 */
export function carriedState(s: ModSessionState): CarriedState {
  return {
    mode: s.mode,
    interaction: s.interaction,
    flowId: s.flowId,
    project: s.project,
    weeklyTarget: s.weeklyTarget,
    weeklyTargetSource: s.weeklyTargetSource,
    wrapUp: s.wrapUp,
    resumeAt: s.resumeAt,
    agents: s.agents,
    frozen: s.frozen,
    tainted: s.tainted,
  };
}

/** The new conversation's state with what was carried; an outside content it had read already is kept too. */
export function withCarried(fresh: ModSessionState, c: CarriedState): ModSessionState {
  return { ...fresh, ...c, turnMode: null, tainted: c.tainted ?? fresh.tainted };
}

/** What a reset hands to the conversation after its /clear. */
export interface Carry {
  /** The session that reset, and the folder it worked in. */
  from: string;
  cwd: string;
  at: number;
  state: CarriedState;
  /** Where things came from (src/core/provenance.ts), whole: the person's words, the start record, what was read from outside. */
  prov: Provenance;
  /** The person's last request, for the next notes. */
  request: string | null;
  /** The note's file, where it was kept; null when handoff notes are off (it then goes in the prompt alone). */
  note: string | null;
  /** The context it reset from, and how many resets in a row the work has had. */
  tokens: number;
  resets: number;
  /** The prompt that goes on with the work: Mode_Code's, never taken for the person's words. */
  prompt: string;
}

/** Whether a carry is for this conversation: made by another session in the same folder, a moment ago. */
export function carryFits(c: Carry, o: { sessionId: string; cwd: string; now: number; platform: Platform }): boolean {
  return c.from !== o.sessionId && pathKey(c.cwd, o.platform) === pathKey(o.cwd, o.platform) && o.now >= c.at && o.now - c.at <= CARRY_TTL_MS;
}

/** The prompt the new conversation starts with: why it was reset, what to do and not do, the state, and the note whole. */
export function continuationPrompt(o: { tokens: string; note: string; path: string | null; state: string; lang: Lang }): string {
  const tr = o.lang === 'tr';
  const lead = tr
    ? `[${APP_NAME}] Konuşma, token tasarrufu için bir görev sınırında sıfırlandı: bağlam ${o.tokens} idi ve her çağrı hepsini yeniden okuyordu. İş burada, yeni bir konuşmada sürüyor. Aşağıdaki not sıfırlamadan hemen önce bu konuşmadan yazıldı${o.path ? ` (dosyası: ${o.path})` : ''}. Biten adımları yeniden yapma (commit'lenenleri git gösterir); kuralları ve hafızayı yalnız sonraki adımın gerektirdiği kadar oku. Sonra nottaki sonraki adımla devam et.`
    : `[${APP_NAME}] The conversation was reset at a task boundary to save tokens: it had ${o.tokens} of context, and every call read all of it again. The work goes on here, in a new conversation. The note below was written from that conversation just before the reset${o.path ? ` (its file: ${o.path})` : ''}. Do not redo finished steps (git shows what is committed); read the rules and the memory only as far as the next step needs. Then go on with the note's next step.`;
  return [lead, o.state, o.note.trim()].filter(Boolean).join('\n\n');
}

// SPDX-License-Identifier: Apache-2.0
/**
 * What a task costs of the quota, and how the work went, from what is already on this computer: Claude Code's
 * transcripts (`~/.claude/projects/**\/*.jsonl`, one line per content block, so one API call can take several lines)
 * and Mode_Code's quota readings (`~/.mode-code/events/<month>/*.jsonl`, `kind: "reading"`). Pure: node/measure.ts
 * reads the files and hands their lines here (A7 of 1.2.0; before, scripts/measure).
 *
 * Each call is priced at the API's per-token rates and weighed by what the quota was measured to count
 * (2026-10-16, a regression of 533 readings on the calls between them, R² 0.99): per API dollar, a cache
 * write counts 1, a cache read 0.76 and output 1.92. Uncached input is taken as a write. The result is in
 * quota units, "weighed API dollars"; the readings say how many units a weekly point took.
 */

export interface Price {
  input: number;
  output: number;
  read: number;
  longPrompt?: number;
  longFactor?: number;
}

/**
 * Per million tokens, US dollars (the Claude API's first-party rates, 2026-10). A cache write costs 1.25
 * times the input for five minutes and twice for an hour; reads are each model's own rate. Haiku 5.5's
 * read rate is not listed, so it is the usual tenth of its input; above 100K tokens of prompt it costs
 * five times as much.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01, longPrompt: 100_000, longFactor: 5 },
};

/** The measured weights, per API dollar, against a cache write. */
export const WEIGHTS = { input: 1, write: 1, read: 0.76, output: 1.92 } as const;

/** A prompt this large is past what most of the window's attention covers well (the plan's 400k line). */
export const LARGE_PROMPT = 400_000;

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const SUBCOMMANDS = new Set(['commit', 'push']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** A command that runs a project's tests or checks. */
const TESTS =
  /(?:^|[\s;&|(])(?:npm (?:run )?(?:test|check|verify)|pnpm (?:run )?test|yarn test|bun test|node --test|pytest|cargo test|go test|flutter test|dart test|vitest|jest|mvn test|gradlew? test|dotnet test|make test)\b/;
/** What a refused call's result says: a hook's block, a permission denied, a mode's refusal. */
const REFUSED = /hook|blocked|denied|refused|permission|not allowed|safety belt/i;

type Line = Record<string, unknown> & { type?: unknown; message?: Record<string, unknown> };

/**
 * The git subcommands a command line runs: git where a command starts (at the start, or after `;`, `&`, `|`,
 * a bracket or a line break outside quotes), past git's own options (`-C "my dir"`, `-c k=v`, `--no-pager`).
 * Inside a string (`echo "git commit"`) git is text. A walk, not a pattern: nested optional parts in one
 * regular expression backtrack without end on some lines.
 */
export function gitSubcommands(command: string): string[] {
  const out: string[] = [];
  let words: string[] = [];
  let word = '';
  let quoted = false;
  let quote = '';
  const endWord = () => {
    if (word || quoted) words.push(word);
    word = '';
    quoted = false;
  };
  const endCommand = () => {
    endWord();
    if (words[0] === 'git') {
      let i = 1;
      while (i < words.length && words[i]!.startsWith('-')) i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
      if (i < words.length) out.push(words[i]!);
    }
    words = [];
  };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = '';
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
    } else if (';&|(){}\n'.includes(ch)) endCommand();
    else if (/\s/.test(ch)) endWord();
    else word += ch;
  }
  endCommand();
  return out;
}

/** The JSON objects of a JSONL text; a line that is not JSON is left out. */
export function jsonLines(text: string): Line[] {
  const out: Line[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Line);
    } catch {
      /* a line cut short while the file was written */
    }
  }
  return out;
}

/** The price row of a model id (`claude-opus-5-5`, or a longer id that starts with one), or null. */
export function priceOf(model: string | null | undefined): Price | null {
  if (!model) return null;
  if (Object.hasOwn(PRICES, model)) return PRICES[model]!;
  const key = Object.keys(PRICES).find((k) => model.startsWith(`${k}-`) || model.startsWith(`${k}[`));
  return key ? PRICES[key]! : null;
}

export interface Call {
  key: string;
  session: string;
  at: number;
  model: string;
  cwd: string;
  /** A subagent's call. */
  sidechain: boolean;
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

const keyOf = (o: Line, m: Record<string, unknown>) => `${String(o.requestId ?? '')}|${String(m.id ?? o.uuid)}`;
const sessionOf = (o: Line) => String(o.sessionId ?? o.session_id ?? '');
// JSON has no NaN or Infinity: a number read from a transcript is finite.
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
/** An assistant line's message, or null for any other line. */
const messageOf = (o: Line | null) => (o?.type === 'assistant' && o.message ? o.message : null);

/**
 * The API calls in a transcript's lines, each once: Claude Code writes a line per content block, all
 * carrying the same request and message ids and the same usage. A line with no usage, or the engine's
 * own `<synthetic>` answer, is not a call.
 */
export function callsOf(lines: readonly (Line | null)[]): Call[] {
  const byId = new Map<string, Call>();
  for (const o of lines) {
    const m = messageOf(o);
    const u = m?.usage as Record<string, unknown> | undefined;
    if (!m || !u || !m.model || m.model === '<synthetic>') continue;
    const line = o!;
    const at = Date.parse(String(line.timestamp));
    if (!Number.isFinite(at)) continue;
    const key = keyOf(line, m);
    const created = num(u.cache_creation_input_tokens);
    const split = u.cache_creation as Record<string, unknown> | undefined;
    const hour = typeof split?.ephemeral_1h_input_tokens === 'number' ? split.ephemeral_1h_input_tokens : undefined;
    const five = typeof split?.ephemeral_5m_input_tokens === 'number' ? split.ephemeral_5m_input_tokens : undefined;
    const call: Call = {
      key,
      session: sessionOf(line),
      at,
      model: String(m.model),
      cwd: String(line.cwd ?? ''),
      sidechain: line.isSidechain === true,
      input: num(u.input_tokens),
      // Without the split, a write is taken as five minutes (the API's default).
      write5m: five ?? (hour === undefined ? created : Math.max(0, created - hour)),
      write1h: hour ?? 0,
      read: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
    };
    const had = byId.get(key);
    if (!had || call.output > had.output) byId.set(key, had ? { ...call, at: had.at } : call);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

export interface Boundary {
  session: string;
  key: string;
  at: number;
  kind: 'commit' | 'push';
}

/**
 * The calls whose commands committed or pushed, from a transcript's lines: where tasks end. Each is named
 * by its call's key (callsOf), as the block that ran the command is one of that call's lines.
 */
export function boundariesOf(lines: readonly (Line | null)[]): Boundary[] {
  const out: Boundary[] = [];
  for (const u of usesOf(lines)) {
    if (!COMMAND_TOOLS.has(u.name)) continue;
    // `git commit -m x && git push` is a push.
    const kinds = gitSubcommands(String(u.input.command ?? '')).filter((s) => SUBCOMMANDS.has(s));
    if (kinds.length) out.push({ session: u.session, key: u.key, at: u.at, kind: kinds.includes('push') ? 'push' : 'commit' });
  }
  return out;
}

/** A tool call Claude made: its call's key, and what it named. */
export interface ToolUse {
  id: string;
  key: string;
  session: string;
  at: number;
  name: string;
  input: Record<string, unknown>;
}

/** The tool calls in a transcript's lines, each once. */
export function usesOf(lines: readonly (Line | null)[]): ToolUse[] {
  const seen = new Set<string>();
  const out: ToolUse[] = [];
  for (const o of lines) {
    const m = messageOf(o);
    if (!m || !Array.isArray(m.content)) continue;
    const line = o!;
    const at = Date.parse(String(line.timestamp));
    if (!Number.isFinite(at)) continue;
    for (const b of m.content as Record<string, unknown>[]) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      const id = typeof b.id === 'string' ? b.id : `${keyOf(line, m)}#${out.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const input = b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {};
      out.push({ id, key: keyOf(line, m), session: sessionOf(line), at, name: b.name, input });
    }
  }
  return out;
}

/** What a tool call answered: how long, and whether it was refused. */
export interface ToolResult {
  id: string;
  chars: number;
  error: boolean;
  refused: boolean;
}

/** The tool results in a transcript's lines (the person's side of the conversation), each once. */
export function resultsOf(lines: readonly (Line | null)[]): ToolResult[] {
  const byId = new Map<string, ToolResult>();
  for (const o of lines) {
    const m = o?.type === 'user' ? o.message : null;
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content as Record<string, unknown>[]) {
      if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
      const text =
        typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((x) => String((x as { text?: unknown })?.text ?? '')).join('\n')
            : '';
      const error = b.is_error === true;
      byId.set(b.tool_use_id, { id: b.tool_use_id, chars: text.length, error, refused: error && REFUSED.test(text.slice(0, 600)) });
    }
  }
  return [...byId.values()];
}

/** A call's API dollars and quota units; a model with no price row costs null. */
export function costOf(call: Call): { dollars: number; units: number } | null {
  const p = priceOf(call.model);
  if (!p) return null;
  const prompt = promptOf(call);
  const f = p.longPrompt && prompt > p.longPrompt ? p.longFactor! : 1;
  const usd = (tokens: number, rate: number) => (tokens * rate * f) / 1e6;
  const input = usd(call.input, p.input);
  const write = usd(call.write5m, p.input * 1.25) + usd(call.write1h, p.input * 2);
  const read = usd(call.read, p.read);
  const output = usd(call.output, p.output);
  return {
    dollars: input + write + read + output,
    units: input * WEIGHTS.input + write * WEIGHTS.write + read * WEIGHTS.read + output * WEIGHTS.output,
  };
}

/** A call's whole prompt: what it sent, cached or not. */
export const promptOf = (c: Call) => c.input + c.write5m + c.write1h + c.read;

/**
 * A call that wrote most of a large prompt into the cache again, past a session's first: the cache had run out
 * (a pause past its time, a changed tool set, a compaction), and the whole context was paid for as new.
 */
export const rebuiltCache = (c: Call) => promptOf(c) > 20_000 && c.write5m + c.write1h > promptOf(c) / 2;

/** How the work of a task went, as far as the transcript shows it (the plan's quality traces). */
export interface Traces {
  /** A test or check ran in the task. */
  tested: boolean;
  /** Reads of the same part of a file already read in the task, with no write to it in between. */
  rereads: number;
  /** Tool calls refused (a hook, a permission, a mode). */
  refused: number;
  /** Calls that paid for a large context anew (rebuiltCache). */
  cacheRebuilds: number;
  /** Calls whose prompt was past LARGE_PROMPT. */
  large: number;
  /** Subagents' units, by model. */
  subagents: Record<string, number>;
  /** Tool output, in characters, by tool. */
  output: Record<string, number>;
  /** Files the task wrote. */
  files: string[];
  /** Of those, the ones a later task wrote again within 48 hours (filled by measureTasks). */
  touchedAgain: string[];
  /** The commands that committed, as written (the first 600 characters): what tells the task's own commits by their subject. */
  committed: string[];
  /** The task began a conversation that a reset at a task boundary started: what it read again before its first change. */
  reset: { before: number; ready: number | null } | null;
  /**
   * A later commit fixed or took back what the task committed (a `fix:` or `revert:` sharing a code file) within 48
   * hours, and within 14 days; null where the task committed nothing found or the time has not passed yet.
   */
  fixed: { in48h: boolean | null; in14d: boolean | null };
}

export interface Task {
  session: string;
  cwd: string;
  from: number;
  to: number;
  endedBy: 'commit' | 'push' | 'open';
  calls: number;
  /** Calls of a model with no price row, left out of the cost. */
  unpriced: number;
  dollars: number;
  units: number;
  /** The task's largest prompt. */
  context: number;
  traces: Traces;
}

const emptyTraces = (): Traces => ({
  tested: false,
  rereads: 0,
  refused: 0,
  cacheRebuilds: 0,
  large: 0,
  subagents: {},
  output: {},
  files: [],
  touchedAgain: [],
  committed: [],
  reset: null,
  fixed: { in48h: null, in14d: null },
});

/** A model id without its date or bracket (`claude-opus-5-5`), for grouping. */
export const modelName = (model: string) => Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(`${k}[`)) ?? model;

/**
 * A session's calls cut into tasks: each ends at a commit or a push (the call that ran it is the task's
 * last), and what follows the last one is a task still open. A task's context is its largest prompt. A
 * subagent's calls carry its session's id, so a commit a subagent runs ends the session's task too: the
 * work is cut where it was committed, whoever ran the command. The tool calls and results, when given, are
 * read into each task's traces by the call they belong to.
 */
export function tasksOf(calls: readonly Call[], boundaries: readonly Boundary[], uses: readonly ToolUse[] = [], results: readonly ToolResult[] = []): Task[] {
  const sessions = new Map<string, Call[]>();
  for (const c of calls) (sessions.get(c.session) ?? sessions.set(c.session, []).get(c.session)!).push(c);
  // A call that both committed and pushed ends its task with the push.
  const ends = new Map<string, 'commit' | 'push'>();
  for (const b of boundaries) if (ends.get(b.key) !== 'push') ends.set(b.key, b.kind);
  const usesByKey = new Map<string, ToolUse[]>();
  for (const u of uses) (usesByKey.get(u.key) ?? usesByKey.set(u.key, []).get(u.key)!).push(u);
  const resultById = new Map(results.map((r) => [r.id, r]));
  const tasks: Task[] = [];
  for (const [session, list] of sessions) {
    list.sort((a, b) => a.at - b.at);
    let task: Task | null = null;
    let read = new Set<string>();
    let first = true;
    for (const c of list) {
      if (!task) {
        task = { session, cwd: c.cwd, from: c.at, to: c.at, endedBy: 'open', calls: 0, unpriced: 0, dollars: 0, units: 0, context: 0, traces: emptyTraces() };
        read = new Set();
      }
      const t: Task = task;
      t.to = c.at;
      t.calls++;
      t.context = Math.max(t.context, promptOf(c));
      if (promptOf(c) > LARGE_PROMPT) t.traces.large++;
      if (!first && rebuiltCache(c)) t.traces.cacheRebuilds++;
      first = false;
      const cost = costOf(c);
      if (cost) {
        t.dollars += cost.dollars;
        t.units += cost.units;
        if (c.sidechain) t.traces.subagents[modelName(c.model)] = (t.traces.subagents[modelName(c.model)] ?? 0) + cost.units;
      } else t.unpriced++;
      for (const u of usesByKey.get(c.key) ?? []) {
        const r = resultById.get(u.id);
        if (r) {
          t.traces.output[u.name] = (t.traces.output[u.name] ?? 0) + r.chars;
          if (r.refused) t.traces.refused++;
        }
        const file = typeof u.input.file_path === 'string' ? u.input.file_path : typeof u.input.notebook_path === 'string' ? u.input.notebook_path : null;
        // The same part of a file read again: another part of it is no re-read.
        const part = `${file}#${String(u.input.offset ?? '')}:${String(u.input.limit ?? '')}`;
        if (u.name === 'Read' && file) {
          if (read.has(part)) t.traces.rereads++;
          read.add(part);
        }
        if (WRITE_TOOLS.has(u.name) && file && !r?.refused) {
          for (const k of [...read]) if (k.startsWith(`${file}#`)) read.delete(k);
          if (!t.traces.files.includes(file)) t.traces.files.push(file);
        }
        if (COMMAND_TOOLS.has(u.name) && TESTS.test(String(u.input.command ?? ''))) t.traces.tested = true;
        if (COMMAND_TOOLS.has(u.name) && !r?.refused && gitSubcommands(String(u.input.command ?? '')).includes('commit'))
          t.traces.committed.push(String(u.input.command).slice(0, 600));
      }
      // The command is in the call's answer, so the call is the task's last.
      const kind = ends.get(c.key);
      if (kind) {
        t.endedBy = kind;
        tasks.push(t);
        task = null;
      }
    }
    if (task) tasks.push(task);
  }
  tasks.sort((a, b) => a.from - b.from);
  // A file written again by a later task within two days: the first change may not have held.
  for (const [i, t] of tasks.entries())
    t.traces.touchedAgain = t.traces.files.filter((f) => tasks.slice(i + 1).some((n) => n.from - t.to <= 48 * 3600_000 && n.traces.files.includes(f)));
  return tasks;
}

export interface Reading {
  at: number;
  week: number;
  weekResetsAt: number;
}

/**
 * The calls and readings of the days measured, from `since` on. A call found in two files (a forked
 * session copies its history) is kept once, where it was first found. A file changed in these days holds
 * older readings too, which would set a week's earlier rise against none of its calls.
 */
export function windowOf(calls: readonly Call[], readings: readonly Reading[], since: number): { calls: Call[]; readings: Reading[] } {
  const seen = new Set<string>();
  const kept: Call[] = [];
  for (const c of calls) {
    if (c.at < since || seen.has(c.key)) continue;
    seen.add(c.key);
    kept.push(c);
  }
  return { calls: kept, readings: readings.filter((r) => r.at >= since) };
}

/** The quota readings in Mode_Code's event lines, oldest first, one per moment. */
export function readingsOf(lines: readonly (Line | null)[]): Reading[] {
  const seen = new Map<number, Reading>();
  for (const o of lines)
    if (o?.kind === 'reading' && Number.isFinite(o.at) && Number.isFinite(o.week) && Number.isFinite(o.weekResetsAt))
      seen.set(o.at as number, { at: o.at as number, week: o.week as number, weekResetsAt: o.weekResetsAt as number });
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

/**
 * How many quota units one weekly point took: within each week (readings with the same reset time), the
 * units of the calls between its first and last reading over the points it rose. Calls made elsewhere
 * (another computer, the web) raise the readings too, so this is a floor on what a point costs here.
 */
export function unitsPerPoint(readings: readonly Reading[], calls: readonly Call[]): { units: number; points: number; perPoint: number } | null {
  const weeks = new Map<number, Reading[]>();
  for (const r of readings) (weeks.get(r.weekResetsAt) ?? weeks.set(r.weekResetsAt, []).get(r.weekResetsAt)!).push(r);
  let units = 0;
  let points = 0;
  for (const list of weeks.values()) {
    if (list.length < 2) continue;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (last.week <= first.week) continue;
    points += last.week - first.week;
    for (const c of calls) if (c.at > first.at && c.at <= last.at) units += costOf(c)?.units ?? 0;
  }
  return points > 0 ? { units, points, perPoint: units / points } : null;
}

/** MCP servers named in tool calls (`mcp__<server>__<tool>`), with each one's last use. */
export function serversUsed(uses: readonly ToolUse[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of uses) {
    const m = /^mcp__(.+?)__/.exec(u.name);
    if (m) out[m[1]!] = Math.max(out[m[1]!] ?? 0, u.at);
  }
  return out;
}

/** A reset at a task boundary (src/core/reset.ts), as Mode_Code's events keep it. */
export interface Reset {
  at: number;
  /** The conversation the work went on in, and the one it was reset from. */
  session: string;
  from: string;
  /** The context it was reset from; in the new conversation, the context at its first call and at its first change. */
  before: number;
  first: number | null;
  ready: number | null;
}

/** The resets in Mode_Code's event lines, oldest first: each one carried into a new conversation, with what that read again. */
export function resetsOf(lines: readonly (Line | null)[]): Reset[] {
  const reads = new Map<string, Line>();
  for (const o of lines) if (o?.kind === 'resetRead' && typeof o.session === 'string') reads.set(o.session, o);
  const found = new Map<string, Reset>();
  for (const o of lines)
    if (o?.kind === 'reset' && o.phase === 'carried' && typeof o.session === 'string' && Number.isFinite(o.at)) {
      const r = reads.get(o.session);
      found.set(o.session, {
        at: o.at as number,
        session: o.session,
        from: typeof o.from === 'string' ? o.from : '',
        before: num(o.tokens),
        first: r ? num(r.first) : null,
        ready: r ? num(r.ready) : null,
      });
    }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

/**
 * What a reset saved, in quota units: an estimate. Each call of the new conversation's own no longer read what the
 * reset left behind (the context it was reset from, less the new start), at its model's cache read rate; the new
 * conversation wrote its start into the cache once instead of reading it. Null where its start was not measured.
 */
export function resetSaving(r: Reset, calls: readonly Call[]): number | null {
  if (r.first === null) return null;
  const own = calls.filter((c) => c.session === r.session && !c.sidechain);
  let units = 0;
  for (const c of own) {
    const p = priceOf(c.model);
    if (p) units += ((Math.max(0, r.before - r.first) * p.read) / 1e6) * WEIGHTS.read;
  }
  const p = own.length ? priceOf(own[0]!.model) : null;
  if (p) units -= (r.first * (p.input * 1.25 * WEIGHTS.write - p.read * WEIGHTS.read)) / 1e6;
  return units;
}

/** A commit as `git log` lists it, with the files it changed. */
export interface Commit {
  hash: string;
  at: number;
  subject: string;
  files: string[];
}

/** The format commitsOf reads, with `--name-only`: a record per commit, its files after it. */
export const LOG_FORMAT = '--format=%x1e%H%x1f%ct%x1f%s';

/** The commits in `git log --name-only` output written with LOG_FORMAT, oldest first. */
export function commitsOf(text: string): Commit[] {
  const out: Commit[] = [];
  for (const record of text.split('\x1e').slice(1)) {
    const [head = '', ...files] = record.split('\n');
    const [hash = '', ct = '', ...subject] = head.split('\x1f');
    if (!/^[0-9a-f]{7,64}$/.test(hash) || !/^\d+$/.test(ct)) continue;
    out.push({ hash, at: Number(ct) * 1000, subject: subject.join('\x1f'), files: files.map((f) => f.trim()).filter(Boolean) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A commit that fixes or takes back an earlier one: `fix:`, `fix(scope):`, `fix!:`, `revert:`, git's own "Revert …". */
const FIX = /^(?:fix|revert)[(:!]|^revert\b/i;
/** Files nearly every commit touches (notes, logs, lock files, the changelog): sharing one ties two commits to nothing. */
const NOT_CODE = /\.(?:md|txt|lock|log)$|(?:^|\/)package(?:-lock)?\.json$|changelog/i;

/** Whether a later commit within `windowMs` fixed or took back what `c` changed: a fix that shares a code file with it. */
export function fixedWithin(c: Commit, commits: readonly Commit[], windowMs: number): boolean {
  const code = c.files.filter((f) => !NOT_CODE.test(f));
  return commits.some((n) => n.at > c.at && n.at - c.at <= windowMs && FIX.test(n.subject) && n.files.some((f) => code.includes(f)));
}

/**
 * The commits a task made in its repository: those whose subject one of its commit commands spells, from a minute
 * before its first call (clocks differ) until a quarter of an hour past its last (a commit lands after the call that
 * ran it), never into the next task (`until`). Another session's commits in the same minutes are not the task's.
 */
export function commitsOfTask(t: { from: number; to: number; committed: readonly string[] }, commits: readonly Commit[], until = Infinity): Commit[] {
  return commits.filter(
    (c) =>
      c.at >= t.from - 60_000 &&
      c.at <= Math.min(t.to + 15 * 60_000, until) &&
      c.subject.trim() !== '' &&
      t.committed.some((cmd) => cmd.includes(c.subject.slice(0, 30))),
  );
}

/** Whether what a task committed was fixed within `windowMs`: true, false once that long has passed (at `now`), else null. */
export function fixedAfter(own: readonly Commit[], commits: readonly Commit[], windowMs: number, now: number): boolean | null {
  if (!own.length) return null;
  if (own.some((c) => fixedWithin(c, commits, windowMs))) return true;
  return own.every((c) => now - c.at >= windowMs) ? false : null;
}

/** Several repositories' answers as one: a fix in any is a fix; any not known yet leaves it unknown; none at all is null. */
export function fixedAnywhere(answers: readonly (boolean | null)[]): boolean | null {
  if (answers.includes(true)) return true;
  return answers.length && !answers.includes(null) ? false : null;
}

/**
 * The folders a commit command works in, as written: `git -C <dir>` and `cd <dir>` (a session opened in the home folder
 * commits elsewhere that way). Quotes are taken off; the caller resolves the folders against the session's own.
 */
export function commandDirs(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/\bgit[ \t]+-C[ \t]+("[^"]+"|'[^']+'|[^\s;&|]+)|(?:^|&&|;|\|\||\n)[ \t]*cd[ \t]+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const dir = (m[1] ?? m[2]!).replace(/^(["'])(.*)\1$/, '$2');
    if (!out.includes(dir)) out.push(dir);
  }
  return out;
}

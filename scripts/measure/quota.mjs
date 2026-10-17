// SPDX-License-Identifier: Apache-2.0
/**
 * What a task costs of the quota, from what is already on this computer: Claude Code's transcripts
 * (`~/.claude/projects/**\/*.jsonl`, one line per content block, so one API call can take several lines)
 * and Mode_Code's quota readings (`~/.mode-code/events/<month>/*.jsonl`, `kind: "reading"`). Pure: the
 * command line (tasks.mjs) reads the files and hands their text here.
 *
 * Each call is priced at the API's per-token rates and weighed by what the quota was measured to count
 * (2026-10-16, a regression of 533 readings on the calls between them, R² 0.99): per API dollar, a cache
 * write counts 1, a cache read 0.76 and output 1.92. Uncached input is taken as a write. The result is in
 * quota units, "weighed API dollars"; the readings say how many units a weekly point took.
 */

/**
 * Per million tokens, US dollars (the Claude API's first-party rates, 2026-10). A cache write costs 1.25
 * times the input for five minutes and twice for an hour; reads are each model's own rate. Haiku 5.5's
 * read rate is not listed, so it is the usual tenth of its input; above 100K tokens of prompt it costs
 * five times as much.
 */
export const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01, longPrompt: 100_000, longFactor: 5 },
};

/** The measured weights, per API dollar, against a cache write. */
export const WEIGHTS = { input: 1, write: 1, read: 0.76, output: 1.92 };

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
// A commit or a push, with git's own options before it (`git -C dir commit`, `git -c k=v push`).
const BOUNDARY = /\bgit(?:\s+(?:-C|-c)\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+(commit|push)(?![\w-])/g;

/** The JSON objects of a JSONL text; a line that is not JSON is left out. */
export function jsonLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a line cut short while the file was written */
    }
  }
  return out;
}

/** The price row of a model id (`claude-opus-5-5`, or a longer id that starts with one), or null. */
export function priceOf(model) {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES).find((k) => model.startsWith(`${k}-`) || model.startsWith(`${k}[`));
  return key ? PRICES[key] : null;
}

/**
 * The API calls in a transcript's lines, each once: Claude Code writes a line per content block, all
 * carrying the same request and message ids and the same usage. A line with no usage, or the engine's
 * own `<synthetic>` answer, is not a call.
 */
export function callsOf(lines) {
  const byId = new Map();
  for (const o of lines) {
    const m = o?.type === 'assistant' ? o.message : null;
    const u = m?.usage;
    if (!u || !m.model || m.model === '<synthetic>') continue;
    const at = Date.parse(o.timestamp);
    if (!Number.isFinite(at)) continue;
    const key = `${o.requestId ?? ''}|${m.id ?? o.uuid}`;
    const created = u.cache_creation_input_tokens ?? 0;
    const hour = u.cache_creation?.ephemeral_1h_input_tokens;
    const five = u.cache_creation?.ephemeral_5m_input_tokens;
    const call = {
      key,
      session: o.sessionId ?? o.session_id ?? '',
      at,
      model: m.model,
      cwd: o.cwd ?? '',
      sidechain: o.isSidechain === true,
      input: u.input_tokens ?? 0,
      // Without the split, a write is taken as five minutes (the API's default).
      write5m: five ?? (hour === undefined ? created : Math.max(0, created - hour)),
      write1h: hour ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    };
    const had = byId.get(key);
    if (!had || call.output > had.output) byId.set(key, had ? { ...call, at: had.at } : call);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

/**
 * The calls whose commands committed or pushed, from a transcript's lines: where tasks end. Each is named
 * by its call's key (callsOf), as the block that ran the command is one of that call's lines.
 */
export function boundariesOf(lines) {
  const out = [];
  for (const o of lines) {
    if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    const at = Date.parse(o.timestamp);
    if (!Number.isFinite(at)) continue;
    for (const b of o.message.content) {
      if (b?.type !== 'tool_use' || !COMMAND_TOOLS.has(b.name)) continue;
      // `git commit -m x && git push` is a push.
      const kinds = [...String(b.input?.command ?? '').matchAll(BOUNDARY)].map((m) => m[1]);
      if (kinds.length)
        out.push({
          session: o.sessionId ?? o.session_id ?? '',
          key: `${o.requestId ?? ''}|${o.message.id ?? o.uuid}`,
          at,
          kind: kinds.includes('push') ? 'push' : 'commit',
        });
    }
  }
  return out;
}

/** A call's API dollars and quota units; a model with no price row costs null. */
export function costOf(call) {
  const p = priceOf(call.model);
  if (!p) return null;
  const prompt = call.input + call.write5m + call.write1h + call.read;
  const f = p.longPrompt && prompt > p.longPrompt ? p.longFactor : 1;
  const usd = (tokens, rate) => (tokens * rate * f) / 1e6;
  const input = usd(call.input, p.input);
  const write = usd(call.write5m, p.input * 1.25) + usd(call.write1h, p.input * 2);
  const read = usd(call.read, p.read);
  const output = usd(call.output, p.output);
  return {
    dollars: input + write + read + output,
    units: input * WEIGHTS.input + write * WEIGHTS.write + read * WEIGHTS.read + output * WEIGHTS.output,
  };
}

/**
 * A session's calls cut into tasks: each ends at a commit or a push (the call that ran it is the task's
 * last), and what follows the last one is a task still open. A task's context is its largest prompt.
 */
export function tasksOf(calls, boundaries) {
  const sessions = new Map();
  for (const c of calls) (sessions.get(c.session) ?? sessions.set(c.session, []).get(c.session)).push(c);
  // A call that both committed and pushed ends its task with the push.
  const ends = new Map();
  for (const b of boundaries) if (ends.get(b.key) !== 'push') ends.set(b.key, b.kind);
  const tasks = [];
  for (const [session, list] of sessions) {
    list.sort((a, b) => a.at - b.at);
    let task = null;
    for (const c of list) {
      task ??= { session, cwd: c.cwd, from: c.at, to: c.at, endedBy: 'open', calls: 0, unpriced: 0, dollars: 0, units: 0, context: 0 };
      task.to = c.at;
      task.calls++;
      task.context = Math.max(task.context, c.input + c.write5m + c.write1h + c.read);
      const cost = costOf(c);
      if (cost) {
        task.dollars += cost.dollars;
        task.units += cost.units;
      } else task.unpriced++;
      // The command is in the call's answer, so the call is the task's last.
      const kind = ends.get(c.key);
      if (kind) {
        task.endedBy = kind;
        tasks.push(task);
        task = null;
      }
    }
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => a.from - b.from);
}

/** The quota readings in Mode_Code's event lines, oldest first, one per moment. */
export function readingsOf(lines) {
  const seen = new Map();
  for (const o of lines)
    if (o?.kind === 'reading' && Number.isFinite(o.at) && Number.isFinite(o.week) && Number.isFinite(o.weekResetsAt))
      seen.set(o.at, { at: o.at, week: o.week, weekResetsAt: o.weekResetsAt });
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

/**
 * How many quota units one weekly point took: within each week (readings with the same reset time), the
 * units of the calls between its first and last reading over the points it rose. Calls made elsewhere
 * (another computer, the web) raise the readings too, so this is a floor on what a point costs here.
 */
export function unitsPerPoint(readings, calls) {
  const weeks = new Map();
  for (const r of readings) (weeks.get(r.weekResetsAt) ?? weeks.set(r.weekResetsAt, []).get(r.weekResetsAt)).push(r);
  let units = 0;
  let points = 0;
  for (const list of weeks.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    if (last.week <= first.week) continue;
    points += last.week - first.week;
    for (const c of calls) if (c.at > first.at && c.at <= last.at) units += costOf(c)?.units ?? 0;
  }
  return points > 0 ? { units, points, perPoint: units / points } : null;
}

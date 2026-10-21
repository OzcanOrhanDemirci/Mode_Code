// SPDX-License-Identifier: Apache-2.0
/**
 * Replays tool calls through today's belt and prints totals only (the core protection's method, step 5:
 * false alarms on everyday work, protection on attack sets). Field mappings and the summary are in
 * scripts/replay/cases.ts; the sets live outside this repository.
 *
 *   node --import tsx scripts/belt-replay.ts convert <format> <rows.jsonl> <cases.jsonl> --source <name>
 *        --version <v> --license <spdx> --label attack|benign [--category <c>] [--cwd <dir>] [--platform linux] [--home <dir>]
 *     formats: claude-code (a row's `trajectory` holds Claude Code's records, or the file is a transcript),
 *              openhands (a row's `trajectory` or `messages`), swe-agent-xml (a row's `messages`)
 *     --platform names the system the calls ran on when it is not this computer's; --home (only with it) is that system's
 *     home folder, an absolute path there, which its calls are judged with. A case that names none gets a stand-in for its
 *     platform (cases.ts, homeOf). In Git Bash on Windows a path that starts with / needs MSYS_NO_PATHCONV=1.
 *   node --import tsx scripts/belt-replay.ts run [--sessions] [--set <cases.jsonl>]... [--config mine|default] [--out <dir>]
 *        [--level manual|autonomous|full] [--no-net]
 *
 * `run` judges each call as the safety-net hook would, in the way of working given (Manual by default; a safety net
 * counted as laid unless --no-net), keeps the plugin's provenance record along each trajectory (what the person
 * wrote, what was read from outside, the files the session made, and for your own sessions the project's remotes)
 * and its outside-content rule (what is still asked there: the memory written with what was read), and prints per source: calls, judged, verdicts by label, by rule and by category, the digests
 * of attack cases let through, and how many everyday cases were asked about or stopped. With --out, those
 * everyday cases are written there for a reviewer (everyday-stopped.jsonl), and of the attack cases let
 * through only ids, verdicts and rules (attack-missed.jsonl). Files ending in .gz are read compressed.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { appContext } from '../src/app/context.js';
import { decide, evaluateToolCall, mergeDecisions } from '../src/core/belt/evaluate.js';
import { isBeltTool, isOutwardTool } from '../src/core/belt/tools.js';
import type { BeltContext, BeltDecision, GitFacts } from '../src/core/belt/types.js';
import { DEFAULT_CONFIG, type Config } from '../src/core/config.js';
import { beltConfigOf } from '../src/core/settings-view.js';
import { levelNamed } from '../src/core/belt/rules.js';
import { taintedAct, taintMatters, taintSource } from '../src/core/taint.js';
import { emptyProvenance, madePaths, withMade, withSaid, withSeen, withStart, type Provenance } from '../src/core/provenance.js';
import { beltContext } from '../src/node/context.js';
import { managedSettingsFiles } from '../src/node/env.js';
import {
  fromClaudeCode,
  fromOpenHands,
  fromSweAgentXml,
  homeOf,
  homeProblem,
  summarize,
  type CaseMeta,
  type Judged,
  type Label,
  type ReplayCase,
  type ReplayPlatform,
} from './replay/cases.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const all = (name: string): string[] => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]!] : []));

async function* lines(file: string): AsyncGenerator<string> {
  const raw = createReadStream(file);
  const input = file.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line.trim()) yield line;
}

async function convert(): Promise<void> {
  const [, format, src, out] = argv;
  const label = opt('label');
  if (!format || !src || !out || (label !== 'attack' && label !== 'benign'))
    throw new Error('usage: convert <format> <rows.jsonl> <cases.jsonl> --source … --label attack|benign');
  const platform = opt('platform') as ReplayPlatform | null;
  const home = opt('home');
  const problem = home ? homeProblem(platform, home) : null;
  if (problem) throw new Error(problem);
  const meta: CaseMeta = {
    source: opt('source') ?? basename(src),
    version: opt('version') ?? 'unknown',
    license: opt('license') ?? 'unknown',
    label: label as Label,
    category: opt('category') ?? 'none',
    ...(opt('cwd') ? { cwd: opt('cwd')! } : {}),
    ...(platform ? { platform } : {}),
    ...(home ? { home } : {}),
  };
  const w = createWriteStream(out);
  const tools: Record<string, number> = {};
  let rows = 0;
  let cases = 0;
  const emit = (list: ReplayCase[]) => {
    for (const c of list) {
      tools[c.tool_name] = (tools[c.tool_name] ?? 0) + 1;
      w.write(JSON.stringify(c) + '\n');
    }
    cases += list.length;
  };
  // A transcript file: every line a record of one session.
  const transcript: unknown[] = [];
  for await (const line of lines(src)) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    rows++;
    const id = String(row.trajectory_id ?? row.traj_id ?? row.id ?? row.instance_id ?? rows);
    if (format === 'claude-code') {
      if ('type' in row && !('trajectory' in row)) {
        transcript.push(row);
        continue;
      }
      const t = typeof row.trajectory === 'string' ? JSON.parse(row.trajectory) : row.trajectory;
      emit(fromClaudeCode(Array.isArray(t) ? t : [], id, meta));
    } else if (format === 'openhands') {
      const t = row.trajectory ?? row.messages;
      emit(fromOpenHands(Array.isArray(t) ? t : [], id, meta));
    } else if (format === 'swe-agent-xml') {
      emit(fromSweAgentXml(Array.isArray(row.messages) ? row.messages : [], id, meta));
    } else throw new Error(`unknown format ${format}`);
  }
  if (transcript.length) emit(fromClaudeCode(transcript, basename(src, '.jsonl'), meta));
  await new Promise<void>((done) => w.end(done));
  console.log(JSON.stringify({ rows, cases, tools }));
}

const NO_GIT: GitFacts = { currentBranch: async () => null, remoteUrl: async () => null, alias: async () => null };

/** Where a call of another system ran: its home (the case's own, else a stand-in) and folders, no git, nothing on this disk. */
function foreignContext(c: ReplayCase, start: string | undefined, config: Config): BeltContext {
  const platform = c.platform!;
  const home = homeOf(c);
  const cwd = c.cwd ?? home;
  return {
    platform,
    home,
    cwd,
    projectDir: start ?? cwd,
    env: { HOME: home },
    dataDir: `${home}/.mode-code`,
    memoryDirs: [],
    managedSettingsFiles: managedSettingsFiles(platform),
    lang: 'en',
    config: beltConfigOf(config),
    git: NO_GIT,
    fileSize: async () => null,
    aliases: [],
  };
}

/** What a call writes, as the plugin weighs it: a file's content, an edit's new text. */
function writtenBy(input: Readonly<Record<string, unknown>>): string {
  const edits = Array.isArray(input.edits) ? input.edits.map((x) => (x as { new_string?: unknown })?.new_string) : [];
  return [input.content, input.new_string, ...edits].filter((x): x is string => typeof x === 'string').join('\n');
}

const remotes = new Map<string, string>();

/**
 * A trajectory's start record: for a session of this computer, the remotes of the folder it started in, read now
 * (the plugin reads them at the first prompt); none for another system's.
 */
function startOf(first: ReplayCase | undefined, start: string | undefined): Provenance {
  if (!first || !start || (first.platform && first.platform !== process.platform)) return emptyProvenance();
  if (!remotes.has(start)) {
    let out = '';
    try {
      out = execFileSync('git', ['-C', start, 'remote', '-v'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      /* not a repository, or gone */
    }
    remotes.set(start, out);
  }
  const listed = remotes.get(start)!;
  return listed ? withStart(emptyProvenance(), listed) : emptyProvenance();
}

async function* ownSessions(): AsyncGenerator<ReplayCase[]> {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  const meta: CaseMeta = { source: 'sessions', version: 'local', license: 'own', label: 'benign', category: 'own' };
  for (const d of readdirSync(root)) {
    const dir = join(root, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const records: unknown[] = [];
      for await (const line of lines(join(dir, f))) {
        // The calls, and the person's prompts and the calls' results for the provenance record.
        if (!line.includes('"tool_use"') && !line.includes('"type":"user"')) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          /* a torn line */
        }
      }
      yield fromClaudeCode(records, f.replace(/\.jsonl$/, ''), meta);
    }
  }
}

async function* setCases(file: string): AsyncGenerator<ReplayCase[]> {
  let batch: ReplayCase[] = [];
  let at = '';
  for await (const line of lines(file)) {
    const c = JSON.parse(line) as ReplayCase;
    const key = `${c.source}\0${c.origin.trajectory}`;
    if (key !== at && batch.length) {
      yield batch;
      batch = [];
    }
    at = key;
    batch.push(c);
  }
  if (batch.length) yield batch;
}

async function run(): Promise<void> {
  const app = appContext();
  const config = opt('config') === 'default' ? (DEFAULT_CONFIG as Config) : app.config;
  const outDir = opt('out');
  const sources: AsyncGenerator<ReplayCase[]>[] = [...(argv.includes('--sessions') ? [ownSessions()] : []), ...all('set').map(setCases)];
  if (!sources.length) throw new Error('usage: run [--sessions] [--set <cases.jsonl>]… [--config mine|default] [--out <dir>]');
  const judged: Judged[] = [];
  // One context per folder, as `mode-code belt replay` keeps them: git is asked about each repository once.
  const contexts = new Map<string, BeltContext>();
  // The way of working judged, and whether a safety net is counted as laid (the hook lays it where it runs).
  const level = levelNamed(opt('level') ?? 'manual') ?? 'manual';
  const net = !argv.includes('--no-net');
  // The project is where the session started, as Claude Code's project folder is: its first call's folder.
  const contextOf = (c: ReplayCase, start: string | undefined): BeltContext => {
    if (c.platform && c.platform !== process.platform) return { ...foreignContext(c, start, config), level, net };
    const cwd = c.cwd ?? homedir();
    const key = JSON.stringify([start ?? cwd, cwd]);
    let ctx = contexts.get(key);
    if (!ctx) contexts.set(key, (ctx = { ...beltContext({ cwd, projectDir: start ?? cwd, config, layout: app.layout, lang: 'en' }), level, net }));
    return ctx;
  };
  const kept: string[] = [];
  const missed: string[] = [];
  const started = Date.now();
  for (const source of sources) {
    // One trajectory at a time, in order: outside content read at one step taints the steps after it.
    for await (const trajectory of source) {
      let tainted = false;
      const start = trajectory[0]?.cwd;
      let prov = startOf(trajectory[0], start);
      // Whether the trajectory kept what was said and read (a set converted before that has neither).
      const recorded = trajectory.some((c) => c.said !== undefined || c.seen !== undefined);
      // Claude Code's Write refuses a file it has not read: one written before any read or write of it is new.
      const touched = new Set<string>();
      for (const c of trajectory) {
        for (const text of c.said ?? []) prov = withSaid(prov, text);
        const ctx = { ...contextOf(c, start), prov };
        let d: BeltDecision | null = isBeltTool(c.tool_name) || isOutwardTool(c.tool_name) ? await evaluateToolCall(c.tool_name, c.tool_input, ctx) : null;
        // What a session that read outside content still asks: the memory written with what it read. Without what
        // was read (a set converted before it was kept), every such write counts.
        const found = tainted
          ? taintedAct(c.tool_name, c.tool_input, { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd, memoryDirs: ctx.memoryDirs })
          : null;
        if (found && (recorded ? taintMatters(found, writtenBy(c.tool_input), prov) : found.act === 'memory')) {
          const t = decide([{ rule: 'inject.tainted-act', verdict: 'ask', reason: '' }], [], ctx);
          d = d ? mergeDecisions(d, t) : t;
        }
        if (taintSource(c.tool_name, c.tool_input)) tainted = true;
        if (c.seen) prov = withSeen(prov, c.seen);
        const file = typeof c.tool_input.file_path === 'string' ? c.tool_input.file_path : null;
        const made = madePaths(c.tool_name, c.tool_input, { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd }, file !== null && !touched.has(file));
        if (made.length) prov = withMade(prov, made);
        if (file !== null) touched.add(file);
        const rules = d ? d.findings.map((f) => f.rule) : [];
        // What the summary needs, not the call: a set's calls can be large.
        const slim = { ...c, tool_input: {}, said: undefined, seen: undefined };
        judged.push({ c: slim, verdict: d?.verdict ?? null, rules });
        const stopped = d !== null && (d.verdict === 'ask' || d.verdict === 'deny');
        if (outDir && c.label === 'benign' && stopped)
          kept.push(JSON.stringify({ ...c, said: undefined, seen: undefined, verdict: d?.verdict, rules, reasons: d?.findings.map((f) => f.reason) }));
        if (outDir && c.label === 'attack' && d !== null && !stopped)
          missed.push(JSON.stringify({ case_id: c.case_id, category: c.category, verdict: d.verdict, rules }));
      }
    }
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const write = (name: string, list: string[]) => writeFileSync(join(outDir, name), list.join('\n') + (list.length ? '\n' : ''));
    write('everyday-stopped.jsonl', kept);
    write('attack-missed.jsonl', missed);
  }
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), config: opt('config') ?? 'mine', sources: summarize(judged) }, null, 1));
}

delete process.env.MODE_CODE_DEV_BELT_OFF;
if (argv[0] === 'convert') await convert();
else if (argv[0] === 'run') await run();
else throw new Error('usage: belt-replay.ts convert … | run …');

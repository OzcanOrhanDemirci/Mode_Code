// SPDX-License-Identifier: Apache-2.0
/**
 * The session index: what the control center knows about past sessions, kept in one SQLite file in the
 * data folder (Node's built-in `node:sqlite`, no dependency). Built from Claude Code's transcripts and
 * updated incrementally: each file is read from where the last pass stopped.
 *
 * What is stored is numbers and short, secret-masked text: token counts per API message (deduplicated
 * by message id, because a transcript repeats a message's usage on every content block), tool calls and
 * their errors, and per session its title, first prompt, folder and times. Claude Code deletes old
 * transcripts (30 days by default); the index keeps these figures after that, which is what makes the
 * history views possible. Nothing leaves the machine.
 */
import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { maskSecrets } from '../core/secrets/scan.js';
import { truncate } from '../core/text.js';
import { isHumanPrompt } from '../core/transcript.js';
import { ensureDir } from './fsx.js';

export const INDEX_SCHEMA = 2;

const T_ASSISTANT = Buffer.from('"type":"assistant"');
const T_USER = Buffer.from('"type":"user"');
const T_TITLE = Buffer.from('"type":"ai-title"');

export interface IndexProgress {
  files: number;
  done: number;
  bytes: number;
}

export interface IndexResult {
  scanned: number;
  updated: number;
  bytes: number;
  ms: number;
  messages: number;
}

type Row = Record<string, unknown>;

export interface TokenTotals {
  messages: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** Part of `output` the API reported as thinking. */
  thinking: number;
  /** Tokens spent by subagents (all four kinds). */
  agentTokens: number;
}

export interface SessionRow {
  id: string;
  cwd: string | null;
  title: string | null;
  firstPrompt: string | null;
  firstTs: number;
  lastTs: number;
  prompts: number;
  version: string | null;
  branch: string | null;
  entrypoint: string | null;
  file: string | null;
  tokens: number;
  output: number;
  tools: number;
  toolErrors: number;
  model: string | null;
}

export interface ToolStat {
  name: string;
  calls: number;
  errors: number;
  byAgents: number;
}

export interface FolderRow {
  cwd: string;
  sessions: number;
  lastTs: number;
  prompts: number;
  tokens: number;
}

function normalizeTotals(r: Partial<TokenTotals> | undefined): TokenTotals {
  const n = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : 0);
  return {
    messages: n(r?.messages),
    input: n(r?.input),
    output: n(r?.output),
    cacheWrite: n(r?.cacheWrite),
    cacheRead: n(r?.cacheRead),
    thinking: n(r?.thinking),
    agentTokens: n(r?.agentTokens),
  };
}

/** Share of input served from the prompt cache: cache reads over all input the model read. */
export function cacheHitRate(t: TokenTotals): number | null {
  const all = t.input + t.cacheWrite + t.cacheRead;
  return all > 0 ? t.cacheRead / all : null;
}

export class SessionIndex {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') ensureDir(dirname(path));
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const v = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined;
    if (v && Number(v.value) === INDEX_SCHEMA) return;
    // The index is a cache of the transcripts: on a schema change it is rebuilt, never migrated by hand.
    this.db.exec(`
      DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS tool_uses;
      CREATE TABLE files (path TEXT PRIMARY KEY, session TEXT, size INTEGER, mtime INTEGER, offset INTEGER, sidechain INTEGER);
      CREATE TABLE messages (id TEXT PRIMARY KEY, session TEXT, ts INTEGER, model TEXT, input INTEGER, output INTEGER,
        cache_write INTEGER, cache_read INTEGER, thinking INTEGER, sidechain INTEGER, cwd TEXT);
      CREATE INDEX messages_ts ON messages (ts);
      CREATE INDEX messages_session ON messages (session);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, title TEXT, first_prompt TEXT, first_ts INTEGER, last_ts INTEGER,
        prompts INTEGER DEFAULT 0, version TEXT, branch TEXT, entrypoint TEXT, file TEXT);
      CREATE INDEX sessions_last ON sessions (last_ts);
      CREATE TABLE tool_uses (id TEXT PRIMARY KEY, session TEXT, name TEXT, ts INTEGER, error INTEGER DEFAULT 0, sidechain INTEGER);
      CREATE INDEX tool_uses_session ON tool_uses (session);
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(INDEX_SCHEMA));
  }

  /** Every transcript under Claude Code's projects folder, main sessions and their subagents. */
  static transcripts(projectsDir: string): { path: string; session: string; sidechain: boolean }[] {
    const out: { path: string; session: string; sidechain: boolean }[] = [];
    const walk = (dir: string, depth: number, session: string | null) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory() && depth < 8) walk(p, depth + 1, session ?? (depth >= 1 ? e.name : null));
        else if (e.isFile() && e.name.endsWith('.jsonl')) {
          const own = basename(e.name, '.jsonl');
          out.push({ path: p, session: session ?? own, sidechain: session !== null });
        }
      }
    };
    walk(projectsDir, 0, null);
    return out;
  }

  /** Brings the index up to date. Returns what it did; `onProgress` is called between files. */
  update(projectsDir: string, onProgress?: (p: IndexProgress) => void): IndexResult {
    const started = Date.now();
    const files = SessionIndex.transcripts(projectsDir);
    const known = new Map<string, { size: number; mtime: number; offset: number }>();
    for (const r of this.db.prepare('SELECT path, size, mtime, offset FROM files').all() as { path: string; size: number; mtime: number; offset: number }[])
      known.set(r.path, r);
    let updated = 0;
    let bytes = 0;
    let messages = 0;
    const p: IndexProgress = { files: files.length, done: 0, bytes: 0 };
    for (const f of files) {
      let st: { size: number; mtimeMs: number };
      try {
        st = statSync(f.path);
      } catch {
        p.done++;
        continue;
      }
      const k = known.get(f.path);
      const mtime = Math.floor(st.mtimeMs);
      if (k && k.size === st.size && k.mtime === mtime) {
        p.done++;
        continue;
      }
      const from = k && st.size >= k.offset ? k.offset : 0;
      const r = this.ingest(f.path, f.session, f.sidechain, from, st.size, mtime);
      updated++;
      bytes += r.bytes;
      messages += r.messages;
      p.done++;
      p.bytes += r.bytes;
      onProgress?.(p);
    }
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('updatedAt', ?)").run(String(Date.now()));
    return { scanned: files.length, updated, bytes, ms: Date.now() - started, messages };
  }

  // ── queries ──

  lastUpdate(): number | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'updatedAt'").get() as { value: string } | undefined;
    return r ? Number(r.value) : null;
  }

  totals(since: number): TokenTotals {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS messages, COALESCE(SUM(input),0) AS input, COALESCE(SUM(output),0) AS output, COALESCE(SUM(cache_write),0) AS cacheWrite,
         COALESCE(SUM(cache_read),0) AS cacheRead, COALESCE(SUM(thinking),0) AS thinking, COALESCE(SUM(sidechain * (input + output + cache_write + cache_read)),0) AS agentTokens
         FROM messages WHERE ts >= ?`,
      )
      .get(since) as unknown as TokenTotals;
    return normalizeTotals(r);
  }

  /** Token totals per local day, model or folder since a time. */
  breakdown(by: 'day' | 'model' | 'cwd', since: number, limit = 400): (TokenTotals & { key: string })[] {
    const key = by === 'day' ? "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')" : by === 'model' ? 'model' : "COALESCE(cwd, '?')";
    const rows = this.db
      .prepare(
        `SELECT ${key} AS key, COUNT(*) AS messages, SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead,
         SUM(thinking) AS thinking, SUM(sidechain * (input + output + cache_write + cache_read)) AS agentTokens
         FROM messages WHERE ts >= ? GROUP BY key ORDER BY ${by === 'day' ? 'key DESC' : 'SUM(input + output + cache_write + cache_read) DESC'} LIMIT ?`,
      )
      .all(since, limit) as unknown as (TokenTotals & { key: string })[];
    return rows.map((r) => ({ ...normalizeTotals(r), key: String(r.key) }));
  }

  sessions(opts: { since?: number; limit?: number; search?: string; cwd?: string } = {}): SessionRow[] {
    const where: string[] = ['s.first_ts IS NOT NULL'];
    const args: (string | number)[] = [];
    if (opts.since !== undefined) {
      where.push('s.last_ts >= ?');
      args.push(opts.since);
    }
    if (opts.search) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.first_prompt LIKE ? ESCAPE '\\' OR s.cwd LIKE ? ESCAPE '\\')");
      const like = `%${opts.search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      args.push(like, like, like);
    }
    if (opts.cwd) {
      where.push('s.cwd = ?');
      args.push(opts.cwd);
    }
    args.push(opts.limit ?? 200);
    const rows = this.db
      .prepare(
        `SELECT s.id, s.cwd, s.title, s.first_prompt AS firstPrompt, s.first_ts AS firstTs, s.last_ts AS lastTs, s.prompts, s.version, s.branch, s.entrypoint, s.file,
           (SELECT COALESCE(SUM(input + output + cache_write + cache_read), 0) FROM messages m WHERE m.session = s.id) AS tokens,
           (SELECT COALESCE(SUM(output), 0) FROM messages m WHERE m.session = s.id) AS output,
           (SELECT COUNT(*) FROM tool_uses t WHERE t.session = s.id) AS tools,
           (SELECT COUNT(*) FROM tool_uses t WHERE t.session = s.id AND t.error = 1) AS toolErrors,
           (SELECT model FROM messages m WHERE m.session = s.id AND m.sidechain = 0 GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) AS model
         FROM sessions s WHERE ${where.join(' AND ')} ORDER BY s.last_ts DESC LIMIT ?`,
      )
      .all(...args) as unknown as SessionRow[];
    return rows;
  }

  session(id: string): SessionRow | null {
    const r = this.sessionsWhere('s.id = ?', [id]);
    return r[0] ?? null;
  }

  private sessionsWhere(cond: string, args: (string | number)[]): SessionRow[] {
    return this.db
      .prepare(
        `SELECT s.id, s.cwd, s.title, s.first_prompt AS firstPrompt, s.first_ts AS firstTs, s.last_ts AS lastTs, s.prompts, s.version, s.branch, s.entrypoint, s.file,
           (SELECT COALESCE(SUM(input + output + cache_write + cache_read), 0) FROM messages m WHERE m.session = s.id) AS tokens,
           (SELECT COALESCE(SUM(output), 0) FROM messages m WHERE m.session = s.id) AS output,
           (SELECT COUNT(*) FROM tool_uses t WHERE t.session = s.id) AS tools,
           (SELECT COUNT(*) FROM tool_uses t WHERE t.session = s.id AND t.error = 1) AS toolErrors,
           (SELECT model FROM messages m WHERE m.session = s.id AND m.sidechain = 0 GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) AS model
         FROM sessions s WHERE ${cond}`,
      )
      .all(...args) as unknown as SessionRow[];
  }

  sessionTotals(id: string): TokenTotals {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS messages, COALESCE(SUM(input),0) AS input, COALESCE(SUM(output),0) AS output, COALESCE(SUM(cache_write),0) AS cacheWrite,
         COALESCE(SUM(cache_read),0) AS cacheRead, COALESCE(SUM(thinking),0) AS thinking, COALESCE(SUM(sidechain * (input + output + cache_write + cache_read)),0) AS agentTokens
         FROM messages WHERE session = ?`,
      )
      .get(id) as unknown as TokenTotals;
    return normalizeTotals(r);
  }

  tools(opts: { since?: number; session?: string; limit?: number } = {}): ToolStat[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.since !== undefined) {
      where.push('ts >= ?');
      args.push(opts.since);
    }
    if (opts.session) {
      where.push('session = ?');
      args.push(opts.session);
    }
    args.push(opts.limit ?? 50);
    return this.db
      .prepare(
        `SELECT name, COUNT(*) AS calls, SUM(error) AS errors, SUM(sidechain) AS byAgents FROM tool_uses ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         GROUP BY name ORDER BY calls DESC, name LIMIT ?`,
      )
      .all(...args) as unknown as ToolStat[];
  }

  /** Folders that sessions ran in, newest first, with how much happened there. */
  folders(since = 0): FolderRow[] {
    return this.db
      .prepare(
        `SELECT s.cwd AS cwd, COUNT(*) AS sessions, MAX(s.last_ts) AS lastTs, SUM(s.prompts) AS prompts,
           (SELECT COALESCE(SUM(input + output + cache_write + cache_read), 0) FROM messages m WHERE m.cwd = s.cwd AND m.ts >= ?) AS tokens
         FROM sessions s WHERE s.cwd IS NOT NULL AND s.last_ts >= ? GROUP BY s.cwd ORDER BY lastTs DESC`,
      )
      .all(since, since) as unknown as FolderRow[];
  }

  private ingest(path: string, session: string, sidechain: boolean, from: number, size: number, mtime: number): { bytes: number; messages: number } {
    const db = this.db;
    const insMsg = db.prepare(
      'INSERT OR IGNORE INTO messages (id, session, ts, model, input, output, cache_write, cache_read, thinking, sidechain, cwd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insTool = db.prepare('INSERT OR IGNORE INTO tool_uses (id, session, name, ts, sidechain) VALUES (?, ?, ?, ?, ?)');
    const errTool = db.prepare('UPDATE tool_uses SET error = 1 WHERE id = ?');
    const upSession = db.prepare(`
      INSERT INTO sessions (id, cwd, title, first_prompt, first_ts, last_ts, prompts, version, branch, entrypoint, file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cwd = COALESCE(sessions.cwd, excluded.cwd),
        title = COALESCE(excluded.title, sessions.title),
        first_prompt = COALESCE(sessions.first_prompt, excluded.first_prompt),
        first_ts = MIN(COALESCE(sessions.first_ts, excluded.first_ts), COALESCE(excluded.first_ts, sessions.first_ts)),
        last_ts = MAX(COALESCE(sessions.last_ts, 0), COALESCE(excluded.last_ts, 0)),
        prompts = sessions.prompts + excluded.prompts,
        version = COALESCE(excluded.version, sessions.version),
        branch = COALESCE(excluded.branch, sessions.branch),
        entrypoint = COALESCE(sessions.entrypoint, excluded.entrypoint),
        file = COALESCE(sessions.file, excluded.file)`);
    const upFile = db.prepare('INSERT OR REPLACE INTO files (path, session, size, mtime, offset, sidechain) VALUES (?, ?, ?, ?, ?, ?)');

    const agg = {
      cwd: null as string | null,
      title: null as string | null,
      firstPrompt: null as string | null,
      firstTs: null as number | null,
      lastTs: null as number | null,
      prompts: 0,
      version: null as string | null,
      branch: null as string | null,
      entrypoint: null as string | null,
    };
    let messages = 0;
    let offset = from;
    const fd = openSync(path, 'r');
    db.exec('BEGIN');
    try {
      const CHUNK = 4 * 1024 * 1024;
      let carry = Buffer.alloc(0);
      let pos = from;
      // `base` is the file offset of data[0]; `offset` only moves past complete lines, so a line being written
      // right now is read again, whole, on the next pass.
      let base = from;
      while (pos < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
        const n = readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        pos += n;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
        let start = 0;
        for (;;) {
          const nl = data.indexOf(10, start);
          if (nl === -1) break;
          const line = data.subarray(start, nl);
          start = nl + 1;
          // Most bytes are rows the index does not need (attachments, file snapshots): skip them unparsed.
          if (line.indexOf(T_ASSISTANT) === -1 && line.indexOf(T_USER) === -1 && line.indexOf(T_TITLE) === -1) continue;
          let row: Row;
          try {
            row = JSON.parse(line.toString('utf8')) as Row;
          } catch {
            continue;
          }
          messages += this.row(row, session, sidechain, agg, insMsg, insTool, errTool);
        }
        offset = base + start;
        base += start;
        carry = Buffer.from(data.subarray(start));
      }
      if (!sidechain || agg.lastTs !== null)
        upSession.run(
          session,
          sidechain ? null : agg.cwd,
          sidechain ? null : agg.title,
          sidechain ? null : agg.firstPrompt,
          agg.firstTs,
          agg.lastTs,
          sidechain ? 0 : agg.prompts,
          agg.version,
          agg.branch,
          agg.entrypoint,
          sidechain ? null : path,
        );
      upFile.run(path, session, size, mtime, offset, sidechain ? 1 : 0);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      closeSync(fd);
    }
    return { bytes: offset - from, messages };
  }

  private row(
    row: Row,
    session: string,
    sidechain: boolean,
    agg: {
      cwd: string | null;
      title: string | null;
      firstPrompt: string | null;
      firstTs: number | null;
      lastTs: number | null;
      prompts: number;
      version: string | null;
      branch: string | null;
      entrypoint: string | null;
    },
    insMsg: ReturnType<DatabaseSync['prepare']>,
    insTool: ReturnType<DatabaseSync['prepare']>,
    errTool: ReturnType<DatabaseSync['prepare']>,
  ): number {
    if (row.type === 'ai-title') {
      if (typeof row.aiTitle === 'string' && row.aiTitle.trim()) agg.title = truncate(maskSecrets(row.aiTitle.trim()), 120);
      return 0;
    }
    const ts = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (agg.firstTs === null || ts < agg.firstTs) agg.firstTs = ts;
      if (agg.lastTs === null || ts > agg.lastTs) agg.lastTs = ts;
    }
    if (typeof row.cwd === 'string' && !agg.cwd) agg.cwd = row.cwd;
    if (typeof row.version === 'string') agg.version = row.version;
    if (typeof row.gitBranch === 'string' && row.gitBranch) agg.branch = row.gitBranch;
    if (typeof row.entrypoint === 'string' && !agg.entrypoint) agg.entrypoint = row.entrypoint;
    const msg = row.message as Row | undefined;
    const content = msg?.content;
    const t = Number.isFinite(ts) ? ts : null;

    if (row.type === 'user') {
      if (!sidechain && isHumanPrompt(row)) {
        agg.prompts++;
        if (!agg.firstPrompt) {
          const text =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? (content as Row[]).map((b) => (b?.type === 'text' ? String(b.text ?? '') : '')).join(' ')
                : '';
          if (text.trim()) agg.firstPrompt = truncate(maskSecrets(text.replace(/\s+/g, ' ').trim()), 200);
        }
      }
      if (Array.isArray(content))
        for (const b of content as Row[]) if (b?.type === 'tool_result' && b.is_error === true && typeof b.tool_use_id === 'string') errTool.run(b.tool_use_id);
      return 0;
    }
    if (row.type !== 'assistant' || !msg) return 0;
    if (Array.isArray(content))
      for (const b of content as Row[])
        if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') insTool.run(b.id, session, b.name, t, sidechain ? 1 : 0);
    const id = typeof msg.id === 'string' ? msg.id : typeof row.requestId === 'string' ? row.requestId : null;
    const u = msg.usage as Row | undefined;
    if (!id || !u || typeof msg.model !== 'string' || msg.model === '<synthetic>') return 0;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const details = u.output_tokens_details as Row | undefined;
    const r = insMsg.run(
      id,
      session,
      t,
      msg.model,
      num(u.input_tokens),
      num(u.output_tokens),
      num(u.cache_creation_input_tokens),
      num(u.cache_read_input_tokens),
      num(details?.thinking_tokens),
      sidechain ? 1 : 0,
      typeof row.cwd === 'string' ? row.cwd : null,
    );
    return Number(r.changes);
  }
}

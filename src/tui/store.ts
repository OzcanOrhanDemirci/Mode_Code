// SPDX-License-Identifier: Apache-2.0
/**
 * Everything the control center shows comes through this store: cached for a few seconds, refreshed on
 * demand, and replaceable in tests. Every value carries the time it was read, so screens can say how old
 * a number is.
 */
import { setConfigValue, serializeConfig, type Config, type ConfigProblem } from '../core/config.js';
import type { Lang } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { join } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { readJson, readText, writeAtomic, writeJsonAtomic } from '../node/fsx.js';
import { readChanges, saveConfig } from '../node/changes.js';
import type { ChangeRow, ChangeWho } from '../core/ux/changes.js';
import { git } from '../node/git.js';
import { appliedTemplates, repoKey, templateById, withTemplates } from '../core/templates.js';
import { claudeDir } from '../node/env.js';
import type { SessionIndex, SessionRow, TokenTotals, ToolStat, FolderRow } from '../node/index-db.js';
import { claudeSessionsVia, readClaudeEnv, realClaude, type ClaudeEnv, type ClaudeSession, type PluginInfo } from '../node/claude-env.js';
import { appContext, reloadConfig, type AppContext } from '../app/context.js';
import {
  closedSessionIds,
  loadEvents,
  loadQuota,
  openIndex,
  recentModStates,
  scanPaths,
  type QuotaView,
  type ToolEvent,
  type SecretFinding,
} from '../app/data.js';
import { checkHealth, type Health } from '../app/health.js';
import { buildReport, type Report } from '../app/report.js';
import { loadSummary, type DoctorSummary } from '../app/doctor/doctor.js';
import type { UpdateState } from '../core/update.js';
import { readUpdateState } from '../node/update.js';
import { syncKeptSkills } from '../node/skills.js';
import type { ModSessionState } from '../core/session.js';
import type { Flow } from '../core/flow.js';
import { flowFiles, loadFlows, type FlowFiles } from '../app/flows.js';
import { autonomyCheck, loadRuns, runFiles, type RunFiles } from '../app/runs.js';
import type { Run } from '../core/run.js';
import type { GateResult } from '../core/run-gate.js';
import { parseAutoPrompts, type AutoPrompt } from '../core/auto-prompts.js';
import { copyText, type CopyResult } from '../node/clipboard.js';
import { allHandoffs, memoryView, recentMorning, type HandoffItem, type MemoryView } from '../app/memory.js';
import { morningLines } from '../core/morning.js';
import { syncView, type SyncView } from '../app/sync.js';

export interface Timed<T> {
  at: number;
  value: T;
}

/** The data the control center reads. LiveData reads the machine; tests pass their own. */
export interface DataSource {
  readonly lang: Lang;
  readonly layout: Layout;
  readonly cwd: string;
  config(): Config;
  configProblems(): ConfigProblem[];
  /** Changes a setting and records who did (src/core/ux/changes.ts); several at once are one save. */
  setConfig(path: string, value: unknown, who?: ChangeWho): ConfigProblem[];
  setConfigMany(values: readonly { path: string; value: unknown }[], who: ChangeWho): ConfigProblem[];
  /** The record of changes, oldest first. */
  changes(): ChangeRow[];
  health(): Health;
  quota(): QuotaView;
  events(days: number): ToolEvent[];
  modStates(): ModSessionState[];
  /** Sessions over though their record is recent: ended, or closed without ending (their Claude Code gone). */
  closedSessions(): ReadonlySet<string>;
  totals(days: number): TokenTotals | null;
  totalsSince(since: number): TokenTotals | null;
  breakdown(by: 'day' | 'model' | 'cwd', days: number): (TokenTotals & { key: string })[];
  sessions(opts: { search?: string; limit?: number; cwd?: string }): SessionRow[];
  session(id: string): SessionRow | null;
  sessionTotals(id: string): TokenTotals | null;
  tools(opts: { days?: number; session?: string }): ToolStat[];
  folders(days: number): FolderRow[];
  report(days: number): Report;
  /** Templates applied in this folder, and whether the folder has a remote (some templates need one). */
  templates(): { applied: string[]; remote: string | null };
  setTemplate(id: string, on: boolean): string | null;
  claude(): ClaudeEnv;
  plugins(): PluginInfo[] | null;
  /** The Claude Code sessions running on this computer (`claude agents --json`), or null when unreadable. */
  claudeSessions(): ClaudeSession[] | null;
  scanMemory(): { findings: SecretFinding[]; files: number; skipped: number };
  lastSeen(): number | null;
  markSeen(at: number): void;
  /** The last maintenance check's summary, written by `mode-code doctor`. */
  doctorSummary(): DoctorSummary | null;
  /** What the last check for a newer release found (`mode-code update`, the daily check). */
  updateState(): UpdateState | null;
  /** Every flow on record, the most recently changed first. */
  flows(): Flow[];
  /** Where a flow's drafts and checked copies are. */
  flowFiles(f: Flow): FlowFiles;
  /** Every full-autonomy run on record, the most recently changed first. */
  runs(): Run[];
  /** Where a run's record, accepted plan, report and drafts are. */
  runFiles(r: Run): RunFiles;
  /** The start checks of full autonomy that can be measured from here (see app/runs.ts). */
  autonomyCheck(): GateResult;
  /** The last tasks given full autonomy, newest first (src/core/auto-prompts.ts). */
  autoPrompts(): AutoPrompt[];
  /** Puts a text on the clipboard (src/node/clipboard.ts). */
  copy(text: string): CopyResult;
  /** Where the memory lives and how it stands (docs/memory.md). */
  memory(): MemoryView;
  /** Every project's handoff notes, newest first. */
  handoffs(): HandoffItem[];
  /** The morning report of the last long gap while it is recent; null otherwise. */
  morning(): { since: number; lines: { label: string; text: string }[] } | null;
  /** Sync across computers: where, the computers, what waits for the person (docs/sync.md). */
  sync(): SyncView;
  refresh(): void;
  /**
   * Calls `onChange` soon after what the control center shows changes on disk (a session's state, an event, the quota,
   * the settings, a flow or a run); returns what stops it. Absent: the screen refreshes on its clock and on r.
   */
  watch?(onChange: () => void): () => void;
  close(): void;
}

export class LiveData implements DataSource {
  private ctx: AppContext;
  private idx: SessionIndex | null = null;
  private idxError: string | null = null;
  private cache = new Map<string, Timed<unknown>>();

  constructor(ctx: AppContext = appContext()) {
    this.ctx = ctx;
  }

  get lang(): Lang {
    return this.ctx.lang;
  }
  get layout(): Layout {
    return this.ctx.layout;
  }
  get cwd(): string {
    return this.ctx.cwd;
  }

  private memo<T>(key: string, ttlMs: number, f: () => T): T {
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < ttlMs) return hit.value as T;
    const value = f();
    this.cache.set(key, { at: now, value });
    return value;
  }

  private index(): SessionIndex | null {
    if (this.idx || this.idxError) return this.idx;
    try {
      this.idx = openIndex(this.ctx);
    } catch (err) {
      this.idxError = (err as Error).message;
    }
    return this.idx;
  }

  config(): Config {
    return this.ctx.config;
  }
  configProblems(): ConfigProblem[] {
    return this.ctx.problems;
  }
  changes(): ChangeRow[] {
    return readChanges(this.ctx.layout);
  }
  setConfig(path: string, value: unknown, who: ChangeWho = 'center'): ConfigProblem[] {
    return this.setConfigMany([{ path, value }], who);
  }
  setConfigMany(values: readonly { path: string; value: unknown }[], who: ChangeWho): ConfigProblem[] {
    let next = this.ctx.config;
    for (const { path, value } of values) {
      const r = setConfigValue(next, path, value);
      const mine = r.problems.filter((p) => p.path === path || p.path.startsWith(path + '.') || path.startsWith(p.path + '.'));
      if (mine.length) return mine;
      next = r.config;
    }
    saveConfig(this.ctx.layout, this.ctx.config, next, who);
    this.ctx = reloadConfig(this.ctx);
    this.cache.clear();
    // A skill turned on or off, a memory set up: the plugin's folder follows (docs/skills.md).
    if (values.some(({ path }) => /^(?:skills|memory)(?:\.|$)/.test(path))) {
      try {
        syncKeptSkills(this.ctx.layout, this.ctx.config);
      } catch {
        /* the next session's start puts it in line */
      }
    }
    return [];
  }
  health(): Health {
    return this.memo('health', 15_000, () => checkHealth(this.ctx));
  }
  quota(): QuotaView {
    return this.memo('quota', 5_000, () => loadQuota(this.ctx));
  }
  events(days: number): ToolEvent[] {
    return this.memo(`events:${days}`, 5_000, () => loadEvents(this.ctx, days));
  }
  modStates(): ModSessionState[] {
    return this.memo('mods', 5_000, () => recentModStates(this.ctx, 50));
  }
  closedSessions(): ReadonlySet<string> {
    // Looking processes up takes a moment each: less often than the rest.
    return this.memo('closed', 30_000, () => closedSessionIds(this.ctx));
  }
  totals(days: number): TokenTotals | null {
    return this.memo(`totals:${days}`, 30_000, () => this.index()?.totals(Date.now() - days * 86400_000) ?? null);
  }
  totalsSince(since: number): TokenTotals | null {
    return this.memo(`since:${since}`, 30_000, () => this.index()?.totals(since) ?? null);
  }
  breakdown(by: 'day' | 'model' | 'cwd', days: number) {
    return this.memo(`bd:${by}:${days}`, 30_000, () => this.index()?.breakdown(by, Date.now() - days * 86400_000) ?? []);
  }
  sessions(opts: { search?: string; limit?: number; cwd?: string }): SessionRow[] {
    return this.memo(`sessions:${JSON.stringify(opts)}`, 30_000, () => this.index()?.sessions(opts) ?? []);
  }
  session(id: string): SessionRow | null {
    return this.memo(`session:${id}`, 30_000, () => this.index()?.session(id) ?? null);
  }
  sessionTotals(id: string): TokenTotals | null {
    return this.memo(`stotals:${id}`, 30_000, () => this.index()?.sessionTotals(id) ?? null);
  }
  tools(opts: { days?: number; session?: string }): ToolStat[] {
    return this.memo(
      `tools:${JSON.stringify(opts)}`,
      30_000,
      () =>
        this.index()?.tools({ ...(opts.days ? { since: Date.now() - opts.days * 86400_000 } : {}), ...(opts.session ? { session: opts.session } : {}) }) ?? [],
    );
  }
  folders(days: number): FolderRow[] {
    return this.memo(`folders:${days}`, 30_000, () => this.index()?.folders(Date.now() - days * 86400_000) ?? []);
  }
  templates(): { applied: string[]; remote: string | null } {
    const r = git(this.ctx.cwd, ['remote', 'get-url', 'origin']);
    return { applied: appliedTemplates(readText(join(this.ctx.cwd, 'CLAUDE.md'))), remote: r.ok && r.out ? repoKey(r.out) : null };
  }
  /** Applies or removes a template in this folder; returns an error message key, or null. */
  setTemplate(id: string, on: boolean): string | null {
    const t = templateById(id);
    if (!t) return 'template.unknown';
    const { applied, remote } = this.templates();
    if (on && t.needsRemote && !remote) return 'template.noRemote';
    let cfg = this.ctx.config;
    const changes = on ? (t.changes?.(remote) ?? []) : [];
    for (const ch of changes) cfg = setConfigValue(cfg, ch.path, ch.apply(cfg)).config;
    if (changes.length) saveConfig(this.ctx.layout, this.ctx.config, cfg, 'template');
    const md = join(this.ctx.cwd, 'CLAUDE.md');
    const ids = on ? [...new Set([...applied, id])] : applied.filter((x) => x !== id);
    writeAtomic(md, withTemplates(readText(md), ids, this.ctx.lang));
    this.ctx = reloadConfig(this.ctx);
    this.cache.clear();
    return null;
  }
  report(days: number): Report {
    return this.memo(`report:${days}`, 30_000, () => buildReport(this.index(), loadEvents(this.ctx, days + 1), Date.now() - days * 86400_000, Date.now()));
  }
  claude(): ClaudeEnv {
    return this.memo('claude', 30_000, () => readClaudeEnv(this.ctx.cwd));
  }
  plugins(): PluginInfo[] | null {
    return this.memo('plugins', 120_000, () => readClaudeEnv(this.ctx.cwd, { withPlugins: true }).plugins);
  }
  claudeSessions(): ClaudeSession[] | null {
    return this.memo('claude-sessions', 15_000, () => claudeSessionsVia(realClaude));
  }
  scanMemory() {
    return this.memo('scan', 60_000, () => scanPaths(this.ctx.config.memory.dirs));
  }
  doctorSummary(): DoctorSummary | null {
    return loadSummary(this.ctx.layout);
  }
  updateState(): UpdateState | null {
    return readUpdateState(this.ctx.layout);
  }
  flows(): Flow[] {
    return this.memo('flows', 3_000, () => loadFlows(this.ctx));
  }
  flowFiles(f: Flow): FlowFiles {
    return flowFiles(this.ctx, f);
  }
  runs(): Run[] {
    return this.memo('runs', 3_000, () => loadRuns(this.ctx));
  }
  runFiles(r: Run): RunFiles {
    return runFiles(this.ctx, r);
  }
  autonomyCheck(): GateResult {
    return this.memo('autonomyCheck', 30_000, () => autonomyCheck(this.ctx, this.cwd));
  }
  autoPrompts(): AutoPrompt[] {
    return this.memo('autoPrompts', 3_000, () => parseAutoPrompts(readText(this.ctx.layout.autoPrompts)));
  }
  copy(text: string): CopyResult {
    return copyText(text);
  }
  memory(): MemoryView {
    return this.memo('memory', 5_000, () => memoryView(this.ctx, this.cwd));
  }
  handoffs(): HandoffItem[] {
    return this.memo('handoffs', 5_000, () => allHandoffs(this.ctx));
  }
  sync(): SyncView {
    return this.memo('sync', 5_000, () => syncView(this.ctx));
  }
  morning(): { since: number; lines: { label: string; text: string }[] } | null {
    return this.memo('morning', 30_000, () => {
      const m = recentMorning(this.ctx, Date.now());
      return m ? { since: m.since, lines: morningLines(m.facts, this.ctx.lang) } : null;
    });
  }
  lastSeen(): number | null {
    const s = readJson<{ lastSeenAt?: number }>(this.ctx.layout.stateDir + '/ui.json');
    return typeof s?.lastSeenAt === 'number' ? s.lastSeenAt : null;
  }
  markSeen(at: number): void {
    try {
      writeJsonAtomic(this.ctx.layout.stateDir + '/ui.json', { lastSeenAt: at });
    } catch {
      /* the inbox simply shows more next time */
    }
  }
  refresh(): void {
    this.cache.clear();
    if (this.idx) {
      try {
        this.idx.update(join(claudeDir(), 'projects'));
      } catch {
        /* keep the last good index */
      }
    }
  }
  watch(onChange: () => void): () => void {
    const l = this.ctx.layout;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Writes come in bursts (a session writes its state, its event and the quota at once): one refresh for each burst.
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        this.cache.clear();
        onChange();
      }, 300);
    };
    const watchers: FSWatcher[] = [];
    for (const [path, recursive] of [
      [l.stateDir, true],
      [l.eventsDir, true],
      [l.flowsDir, true],
      [l.runsDir, true],
      [l.root, false],
    ] as const) {
      try {
        watchers.push(
          watch(path, { recursive, persistent: false }, (_e, name) => (name && /\.(?:db|db-journal|db-wal|lock)$/.test(String(name)) ? undefined : changed())),
        );
      } catch {
        /* not there yet, or no watching here: the clock and r still refresh */
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    };
  }
  close(): void {
    this.idx?.close();
    this.idx = null;
  }
}

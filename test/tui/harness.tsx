// SPDX-License-Identifier: Apache-2.0
/**
 * Draws the control center into a fake terminal and drives it with keys. Ink runs in debug mode, so every
 * frame is written whole and the last write is the screen as a person would see it.
 */
import { render } from 'ink';
import type { HandoffItem, MemoryView } from '../../src/app/memory.js';
import type { SyncView } from '../../src/app/sync.js';
import { EventEmitter } from 'node:events';
import { App, type AppProps } from '../../src/tui/app.js';
import { PointerHub, pointerInput } from '../../src/tui/pointer.js';
import type { PointerRegistry } from '../../src/tui/press.js';
import { textWidth } from '../../src/node/width.js';
import { cloneDefaults, setConfigValue, type Config, type ConfigProblem } from '../../src/core/config.js';
import { changeRows, type ChangeRow, type ChangeWho } from '../../src/core/ux/changes.js';
import { layout } from '../../src/core/layout.js';
import type { Lang } from '../../src/core/i18n/index.js';
import type { DataSource } from '../../src/tui/store.js';
import type { Health } from '../../src/app/health.js';
import type { QuotaView, ToolEvent } from '../../src/app/data.js';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits } from '../../src/core/quota.js';
import type { SessionRow, TokenTotals } from '../../src/node/index-db.js';
import type { ModSessionState } from '../../src/core/session.js';
import { buildReport } from '../../src/app/report.js';
import type { DoctorSummary } from '../../src/app/doctor/doctor.js';
import type { UpdateState } from '../../src/core/update.js';
import type { Flow } from '../../src/core/flow.js';
import type { ClaudeSession } from '../../src/node/claude-env.js';

export const NOW = Date.parse('2026-10-12T09:00:00Z');

const totals: TokenTotals = {
  messages: 120,
  input: 1500,
  output: 250_000,
  cacheWrite: 900_000,
  cacheRead: 40_000_000,
  thinking: 90_000,
  agentTokens: 2_000_000,
};

export const SESSION: SessionRow = {
  id: 'aaaa1111-2222-3333-4444-555566667777',
  cwd: 'C:/work/app',
  title: 'Fix the login bug',
  firstPrompt: 'fix the login bug please',
  firstTs: NOW - 3600_000,
  lastTs: NOW - 120_000,
  prompts: 4,
  version: '2.1.296',
  branch: 'main',
  entrypoint: 'cli',
  file: null,
  tokens: 41_000_000,
  output: 250_000,
  tools: 30,
  toolErrors: 2,
  model: 'claude-opus-5-5',
};

export class FakeData implements DataSource {
  readonly layout = layout('C:/Users/test/.mode-code');
  readonly cwd = 'C:/work/app';
  saved: { path: string; value: unknown }[] = [];
  seen: number | null = null;
  private cfg: Config;
  constructor(
    readonly lang: Lang = 'en',
    cfg: Partial<Config> = {},
    private beltState: 'ok' | 'red' | 'absent' = 'ok',
  ) {
    this.cfg = { ...cloneDefaults(), ...cfg };
  }
  config() {
    return this.cfg;
  }
  configProblems(): ConfigProblem[] {
    return [];
  }
  /** The record of changes this fake keeps, as the live one writes it (src/core/ux/changes.ts). */
  rows: ChangeRow[] = [];
  setConfig(path: string, value: unknown, who: ChangeWho = 'center') {
    return this.setConfigMany([{ path, value }], who);
  }
  setConfigMany(values: readonly { path: string; value: unknown }[], who: ChangeWho) {
    const before = this.cfg;
    for (const { path, value } of values) {
      this.cfg = setConfigValue(this.cfg, path, value).config;
      this.saved.push({ path, value });
    }
    this.rows.push(...changeRows(before, this.cfg, who, NOW + this.rows.length));
    return [];
  }
  changes() {
    return this.rows;
  }
  health(): Health {
    const f = (id: Health['features'][number]['id'], protection = false) => ({
      id,
      protection,
      state: id === 'belt' || id === 'selfProtection' ? this.beltState : ('ok' as const),
    });
    return {
      installed: this.beltState !== 'absent',
      manifest: null,
      claude: '2.1.296',
      modSeen: { at: NOW - 60_000, version: 'dev' },
      features: [
        f('belt', true),
        f('selfProtection', true),
        f('mod'),
        f('keywords'),
        f('quota'),
        f('footer'),
        f('quietWork'),
        f('memory'),
        f('index'),
        f('secrets'),
      ],
      env: {
        dir: 'C:/Users/test/.claude',
        version: '2.1.296',
        settings: [{ scope: 'user', path: 'C:/Users/test/.claude/settings.json', exists: true, json: { model: 'opus' } }],
        hooks: [
          {
            scope: 'user',
            event: 'PreToolUse',
            matcher: 'Bash',
            type: 'command',
            command: 'node',
            args: ['C:/Users/test/.mode-code/bin/hook.mjs', 'PreToolUse'],
            timeout: 15,
            onFailure: 'block',
            ours: true,
          },
        ],
        permissions: [{ scope: 'user', kind: 'deny', rule: 'Bash(git push --force*)' }],
        mcp: [],
        plugins: null,
        instructions: [{ kind: 'memory-index', path: 'C:/notes/MEMORY.md', exists: true, bytes: 15_000, lines: 90, limit: { lines: 200, bytes: 25_000 } }],
        memoryDir: 'C:/notes',
        memoryDirFromSetting: true,
        skills: [],
        agents: [],
        commands: [],
        hooksDisabledBy: [],
      },
    };
  }
  quota(): QuotaView {
    const reading = fromModRateLimits(
      [
        { kind: 'five_hour', percentUsed: 21, resetsAt: '2026-10-12T12:50:00Z' },
        { kind: 'seven_day', percentUsed: 27, resetsAt: '2026-10-18T06:00:00Z' },
      ],
      NOW - 60_000,
    );
    return { reading, assessment: assessQuota(reading, DEFAULT_BUDGET, NOW), target: null };
  }
  /** Events a test adds to the fixed ones. */
  extraEvents: ToolEvent[] = [];
  events(): ToolEvent[] {
    return [
      ...this.extraEvents,
      {
        v: 1,
        at: NOW - 600_000,
        kind: 'belt',
        source: 'mod',
        session: 's',
        tool: 'Bash',
        verdict: 'deny',
        rules: ['git.clean'],
        reasons: ['Deletes untracked files'],
      },
      {
        v: 1,
        at: NOW - 3 * 86400_000,
        kind: 'reading',
        source: 'mod',
        session: 's',
        five: 40,
        week: 12,
        fiveResetsAt: NOW - 3 * 86400_000 + 3600_000,
        weekResetsAt: NOW + 86400_000,
      },
      {
        v: 1,
        at: NOW - 3600_000,
        kind: 'reading',
        source: 'mod',
        session: 's',
        five: 21,
        week: 27,
        fiveResetsAt: NOW + 3600_000,
        weekResetsAt: NOW + 86400_000,
      },
    ];
  }
  modStates(): ModSessionState[] {
    return [];
  }
  closedSessions(): ReadonlySet<string> {
    return new Set();
  }
  totals() {
    return totals;
  }
  totalsSince() {
    return totals;
  }
  breakdown(by: 'day' | 'model' | 'cwd') {
    return by === 'model' ? [{ ...totals, key: 'claude-opus-5-5' }] : [{ ...totals, key: '2026-10-12' }];
  }
  sessions() {
    return [SESSION];
  }
  session(id: string) {
    return id === SESSION.id ? SESSION : null;
  }
  sessionTotals() {
    return totals;
  }
  tools() {
    return [{ name: 'Bash', calls: 20, errors: 2, byAgents: 3 }];
  }
  folders() {
    return [{ cwd: 'C:/work/app', sessions: 1, lastTs: NOW - 120_000, prompts: 4, tokens: 41_000_000 }];
  }
  applied: string[] = [];
  templates() {
    return { applied: this.applied, remote: 'github.com/me/app' };
  }
  setTemplate(id: string, on: boolean) {
    this.applied = on ? [...new Set([...this.applied, id])] : this.applied.filter((x) => x !== id);
    return null;
  }
  report(days: number) {
    return buildReport(null, this.events(), NOW - days * 86400_000, NOW);
  }
  claude() {
    return this.health().env;
  }
  plugins() {
    return [];
  }
  sessionsRunning: ClaudeSession[] | null = [];
  claudeSessions() {
    return this.sessionsRunning;
  }
  scanMemory() {
    return { findings: [], files: 3, skipped: 0 };
  }
  doctor: DoctorSummary | null = null;
  doctorSummary() {
    return this.doctor;
  }
  update: UpdateState | null = null;
  updateState() {
    return this.update;
  }
  flowList: Flow[] = [];
  flows() {
    return this.flowList;
  }
  flowFiles(f: Flow) {
    return { report: f.reportPath, plan: null, checkedReport: `${this.layout.flowsDir}/${f.id}/research.md`, approvedPlan: null };
  }
  copied: string[] = [];
  copyVia: 'system' | 'terminal' = 'system';
  copy(text: string) {
    this.copied.push(text);
    return { via: this.copyVia };
  }
  memoryState: MemoryView = {
    store: null,
    setting: null,
    inUse: false,
    last: null,
    local: null,
    project: 'app',
    handoff: null,
  };
  memory() {
    return this.memoryState;
  }
  handoffList: HandoffItem[] = [];
  handoffs() {
    return this.handoffList;
  }
  morningReport: { since: number; lines: { label: string; text: string }[] } | null = null;
  morning() {
    return this.morningReport;
  }
  syncState: SyncView = { setting: null, exists: false, machines: [], last: null, pending: [], applied: [], homeless: [], handoffs: 'local' };
  sync() {
    return this.syncState;
  }
  lastSeen() {
    return this.seen;
  }
  markSeen(at: number) {
    this.seen = at;
  }
  refresh() {}
  close() {}
}

class FakeStdout extends EventEmitter {
  isTTY = true;
  last = '';
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  /** Frames written so far: a key press waits for the frame it causes, however slow the machine. */
  frames = 0;
  write(s: string) {
    this.last = s;
    this.frames++;
    return true;
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private buf: string[] = [];
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read() {
    return this.buf.shift() ?? null;
  }
  send(s: string) {
    this.buf.push(s);
    this.emit('readable');
  }
}

export const KEY = { down: '\u001B[B', up: '\u001B[A', right: '\u001B[C', left: '\u001B[D', enter: '\r', esc: '\u001B', tab: '\t', ctrlK: '\u000B' } as const;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until `done()` holds or `cap` ms pass, checking every 5 ms. */
async function until(done: () => boolean, cap: number): Promise<boolean> {
  const end = Date.now() + cap;
  while (!done()) {
    if (Date.now() > end) return false;
    await wait(5);
  }
  return true;
}

/**
 * How long a key may take to show. A fixed pause was too short on a loaded CI runner (two tests failed
 * there with 40 ms); a key that changes nothing on the screen costs this much, so it stays modest.
 */
const FRAME_CAP_MS = 1500;

/** How long the screen at a start address may take to open; a screen that never opens fails the test. */
const START_CAP_MS = 10_000;

export interface Screen {
  /** The screen now, colors removed. */
  text(): string;
  /** The screen now as the terminal receives it, colors included (scripts/screenshots.ts draws it). */
  ansi(): string;
  press(...keys: string[]): Promise<void>;
  type(s: string): Promise<void>;
  /** The pointer, as a terminal reports it (SGR, 1006): a click (press and release), a rest, a wheel step at a cell. */
  click(x: number, y: number): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  wheel(x: number, y: number, dir: 'up' | 'down'): Promise<void>;
  /** The cell where `text` starts on the screen now (its `nth` time, from 0), or null. */
  find(text: string, nth?: number): { x: number; y: number } | null;
  /** What the pointer can reach on the screen now. */
  registry(): PointerRegistry;
  /** A click on the middle of `text` where it is on the screen now; fails when it is not there. */
  clickText(text: string, nth?: number): Promise<void>;
  hoverText(text: string, nth?: number): Promise<void>;
  close(): void;
}

/** The SGR sequence a terminal sends for a pointer event at a cell (0-based here, 1-based on the wire). */
export const sgr = (code: number, x: number, y: number, release = false) => `\u001B[<${code};${x + 1};${y + 1}${release ? 'm' : 'M'}`;

export async function draw(
  data: DataSource,
  opts: {
    columns?: number;
    rows?: number;
    address?: string | null;
    plain?: boolean;
    noColor?: boolean;
    onLeave?: AppProps['onLeave'];
    onQuit?: AppProps['onQuit'];
    /** The address the screen opens at, when it is not the one asked for (an old address leads to its page's new one). */
    opens?: string;
    /** What the terminal takes beyond drawing, and where its sequences go. */
    terminal?: AppProps['terminal'];
    /** What a setup the control center left for came to, said as it comes back. */
    notice?: AppProps['notice'];
  } = {},
): Promise<Screen> {
  const stdout = new FakeStdout(opts.columns ?? 110, opts.rows ?? 32);
  const stdin = new FakeStdin();
  const hub = new PointerHub();
  let registry: PointerRegistry | null = null;
  let shown = '';
  const inst = render(
    <App
      data={data}
      size={{ columns: stdout.columns, rows: stdout.rows }}
      address={opts.address ?? null}
      plain={opts.plain ?? false}
      noColor={opts.noColor ?? false}
      now={() => NOW}
      pointer={hub}
      {...(opts.onLeave ? { onLeave: opts.onLeave } : {})}
      {...(opts.onQuit ? { onQuit: opts.onQuit } : {})}
      onRegistry={(r) => (registry = r)}
      onAddress={(a) => (shown = a)}
      {...(opts.terminal ? { terminal: opts.terminal } : {})}
      {...(opts.notice ? { notice: opts.notice } : {})}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: pointerInput(stdin as unknown as NodeJS.ReadStream, hub),
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await until(() => stdout.frames > 0, FRAME_CAP_MS);
  // The start address is applied after the first frame, so the screen asked for comes a frame later. On a
  // loaded CI runner that frame once came after the pause below, and a test read the home screen instead
  // and passed: the screen it meant to check never drew (seen as coverage falling on one run in two). The
  // app says the address of the screen it drew once it is open (the bar may be too narrow to show it whole).
  const opens = opts.opens ?? opts.address;
  if (opens && !(await until(() => shown === opens || shown.startsWith(`${opens}/`), START_CAP_MS))) {
    // Unmounted, a screen that did not open ends its test instead of keeping the process alive.
    inst.unmount();
    throw new Error(`the screen at ${opts.address} did not open within ${START_CAP_MS} ms (at ${shown || 'nothing'})`);
  }
  await wait(80);
  // eslint-disable-next-line no-control-regex
  const text = () => stdout.last.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
  const press = async (...keys: string[]) => {
    for (const k of keys) {
      const before = stdout.frames;
      stdin.send(k);
      // The frame the key causes, then a moment for the renders that follow from it (effects, data).
      if (await until(() => stdout.frames > before, FRAME_CAP_MS)) await wait(25);
    }
  };
  const find = (s: string, nth = 0) => {
    let n = 0;
    const lines = text().split('\n');
    for (let y = 0; y < lines.length; y++) {
      let from = 0;
      for (;;) {
        const i = lines[y]!.indexOf(s, from);
        if (i < 0) break;
        if (n++ === nth) return { x: textWidth(lines[y]!.slice(0, i)), y };
        from = i + 1;
      }
    }
    return null;
  };
  // What a press shows may come a frame later (a screen's keys reach the bar after its effect): wait for it a while.
  const at = async (s: string, nth = 0) => {
    await until(() => find(s, nth) !== null, FRAME_CAP_MS);
    const p = find(s, nth);
    if (!p) throw new Error(`"${s}" is not on the screen:\n${text()}`);
    return { x: p.x + Math.floor(textWidth(s) / 2), y: p.y };
  };
  const click = (x: number, y: number) => press(sgr(0, x, y) + sgr(0, x, y, true));
  const hover = (x: number, y: number) => press(sgr(35, x, y));
  return {
    text,
    ansi: () => stdout.last,
    press,
    click,
    hover,
    wheel: (x, y, dir) => press(sgr(dir === 'up' ? 64 : 65, x, y)),
    find,
    registry: () => registry!,
    clickText: async (s, nth) => {
      const p = await at(s, nth);
      return click(p.x, p.y);
    },
    hoverText: async (s, nth) => {
      const p = await at(s, nth);
      return hover(p.x, p.y);
    },
    async type(s: string) {
      for (const ch of s) {
        const before = stdout.frames;
        stdin.send(ch);
        await until(() => stdout.frames > before, FRAME_CAP_MS);
      }
      await wait(30);
    },
    close: () => inst.unmount(),
  };
}

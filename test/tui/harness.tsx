// SPDX-License-Identifier: Apache-2.0
/**
 * Draws the control center into a fake terminal and drives it with keys. Ink runs in debug mode, so every
 * frame is written whole and the last write is the screen as a person would see it.
 */
import React from 'react';
import { render } from 'ink';
import { EventEmitter } from 'node:events';
import { App } from '../../src/tui/app.js';
import { cloneDefaults, setConfigValue, type Config, type ConfigProblem } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import type { Lang } from '../../src/core/i18n/index.js';
import type { DataSource } from '../../src/tui/store.js';
import type { Health } from '../../src/app/health.js';
import type { QuotaView, ToolEvent } from '../../src/app/data.js';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits } from '../../src/core/quota.js';
import type { SessionRow, TokenTotals } from '../../src/node/index-db.js';

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
  readonly layout = layout('C:/Users/test/.terminal-code');
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
  setConfig(path: string, value: unknown) {
    const r = setConfigValue(this.cfg, path, value);
    this.cfg = r.config;
    this.saved.push({ path, value });
    return [];
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
            args: ['C:/Users/test/.terminal-code/bin/hook.mjs', 'PreToolUse'],
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
  events(): ToolEvent[] {
    return [
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
  modStates() {
    return [];
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
  claude() {
    return this.health().env;
  }
  plugins() {
    return [];
  }
  scanMemory() {
    return { findings: [], files: 3, skipped: 0 };
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
  write(s: string) {
    this.last = s;
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

export interface Screen {
  /** The screen now, colors removed. */
  text(): string;
  press(...keys: string[]): Promise<void>;
  type(s: string): Promise<void>;
  close(): void;
}

export async function draw(data: DataSource, opts: { columns?: number; rows?: number; address?: string | null; plain?: boolean } = {}): Promise<Screen> {
  const stdout = new FakeStdout(opts.columns ?? 110, opts.rows ?? 32);
  const stdin = new FakeStdin();
  const inst = render(
    <App data={data} size={{ columns: stdout.columns, rows: stdout.rows }} address={opts.address ?? null} plain={opts.plain ?? false} now={() => NOW} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await wait(80);
  return {
    // eslint-disable-next-line no-control-regex
    text: () => stdout.last.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, ''),
    async press(...keys: string[]) {
      for (const k of keys) {
        stdin.send(k);
        await wait(40);
      }
    },
    async type(s: string) {
      for (const ch of s) {
        stdin.send(ch);
        await wait(15);
      }
      await wait(30);
    },
    close: () => inst.unmount(),
  };
}

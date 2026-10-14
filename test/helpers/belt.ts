// SPDX-License-Identifier: Apache-2.0
/**
 * Belt contexts for tests: a Windows, a macOS and a Linux machine with a home folder, a project, the
 * tool's data folder and a memory folder. Nothing here touches the disk; git and file sizes are answered
 * from the options.
 */
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext, BeltDecision, GitFacts, RuleConfig, Verdict } from '../../src/core/belt/types.js';

export interface FakeGit {
  branch?: string | null;
  remote?: string | null;
  aliases?: Record<string, string>;
}

export function fakeGit(o: FakeGit = {}): GitFacts {
  return {
    currentBranch: async () => (o.branch === undefined ? 'feature' : o.branch),
    remoteUrl: async () => (o.remote === undefined ? 'https://github.com/ada/app.git' : o.remote),
    alias: async (_d, name) => o.aliases?.[name] ?? null,
  };
}

export function winCtx(over: Partial<BeltContext> = {}, config: RuleConfig = {}): BeltContext {
  return {
    platform: 'win32',
    home: 'C:/Users/ada',
    cwd: 'C:/dev/app',
    projectDir: 'C:/dev/app',
    env: { TEMP: 'C:/Users/ada/AppData/Local/Temp', TMP: 'C:/Users/ada/AppData/Local/Temp', APPDATA: 'C:/Users/ada/AppData/Roaming' },
    dataDir: 'C:/Users/ada/.mode-code',
    memoryDirs: ['C:/dev/notes/memory'],
    managedSettingsFiles: ['C:/Program Files/ClaudeCode/managed-settings.json'],
    lang: 'en',
    config,
    git: fakeGit(),
    fileSize: async () => 4000,
    ...over,
  };
}

export function macCtx(over: Partial<BeltContext> = {}, config: RuleConfig = {}): BeltContext {
  return winCtx(
    {
      platform: 'darwin',
      home: '/Users/ada',
      cwd: '/Users/ada/dev/app',
      projectDir: '/Users/ada/dev/app',
      env: { TMPDIR: '/var/folders/xy/abc123/T/' },
      dataDir: '/Users/ada/.mode-code',
      memoryDirs: ['/Users/ada/dev/notes/memory'],
      managedSettingsFiles: ['/Library/Application Support/ClaudeCode/managed-settings.json'],
      ...over,
    },
    config,
  );
}

export function linuxCtx(over: Partial<BeltContext> = {}, config: RuleConfig = {}): BeltContext {
  return winCtx(
    {
      platform: 'linux',
      home: '/home/ada',
      cwd: '/home/ada/dev/app',
      projectDir: '/home/ada/dev/app',
      env: {},
      dataDir: '/home/ada/.mode-code',
      memoryDirs: ['/home/ada/dev/notes/memory'],
      managedSettingsFiles: ['/etc/claude-code/managed-settings.json'],
      ...over,
    },
    config,
  );
}

export const PLATFORMS = { win32: winCtx, darwin: macCtx, linux: linuxCtx } as const;

export async function bash(command: string, ctx: BeltContext = winCtx()): Promise<BeltDecision> {
  return evaluateToolCall('Bash', { command }, ctx);
}

export async function pwsh(command: string, ctx: BeltContext = winCtx()): Promise<BeltDecision> {
  return evaluateToolCall('PowerShell', { command }, ctx);
}

export async function write(file_path: string, content = 'x', ctx: BeltContext = winCtx()): Promise<BeltDecision> {
  return evaluateToolCall('Write', { file_path, content }, ctx);
}

export async function edit(file_path: string, old_string: string, new_string: string, ctx: BeltContext = winCtx()): Promise<BeltDecision> {
  return evaluateToolCall('Edit', { file_path, old_string, new_string }, ctx);
}

/** The verdict and the rules that fired, in one comparable line ("deny self.tool-files"). */
export function summary(d: BeltDecision): string {
  return [d.verdict, ...new Set(d.findings.map((f) => f.rule))].join(' ');
}

export function rulesOf(d: BeltDecision): string[] {
  return [...new Set(d.findings.map((f) => f.rule))];
}

export type { Verdict };

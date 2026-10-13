// SPDX-License-Identifier: Apache-2.0
/**
 * Made-up facts of a healthy, installed Windows machine for the doctor's checks. Each test changes the
 * one fact it is about, so a check is seen to react to exactly that.
 */
import { APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS, PLUGIN_ID } from '../../src/core/app.js';
import { BELT_MATCHER, HOOK_EVENTS } from '../../src/node/install.js';
import type { Facts, SettingsFileFacts } from '../../src/app/doctor/types.js';
import type { HookEntry } from '../../src/node/claude-env.js';

export const NOW = Date.parse('2026-10-12T12:00:00Z');
const DATA = 'C:/Users/ada/.terminal-code';
const NODE = 'C:/Program Files/nodejs/node.exe';
const HASH = 'a'.repeat(64);

export function settingsFile(over: Partial<SettingsFileFacts> = {}): SettingsFileFacts {
  return {
    scope: 'user',
    path: 'C:/Users/ada/.claude/settings.json',
    exists: true,
    error: null,
    disableAllHooks: false,
    allowManagedHooksOnly: false,
    pluginEnabled: null,
    ...over,
  };
}

export function ourHook(event: string, over: Partial<HookEntry> = {}): HookEntry {
  return {
    scope: 'user',
    event,
    matcher: event === 'PreToolUse' ? BELT_MATCHER : null,
    type: 'command',
    command: NODE,
    args: [`${DATA}/bin/hook.mjs`, event],
    timeout: 15,
    onFailure: event === 'PreToolUse' ? 'block' : null,
    ours: true,
    ...over,
  };
}

export function healthyFacts(over: Partial<Facts> = {}): Facts {
  return {
    measuredAt: NOW,
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.26200',
    appVersion: APP_VERSION,
    dataDir: DATA,
    claudeDir: 'C:/Users/ada/.claude',
    claudeDirFromEnv: false,
    underAgent: false,
    node: { version: '24.15.0', execPath: NODE, sqlite: true },
    hookNode: { path: NODE, exists: true, version: '24.15.0' },
    claude: { installs: ['C:/Users/ada/.local/bin/claude.exe'], version: MIN_CLAUDE_CODE_FOR_HOOKS },
    settings: [settingsFile()],
    hooks: HOOK_EVENTS.map((e) => ourHook(e)),
    plugins: [{ id: PLUGIN_ID, enabled: true, version: APP_VERSION, scope: 'user' }],
    manifest: {
      v: 1,
      app: 'terminal-code',
      version: APP_VERSION,
      installedAt: NOW - 86400_000,
      node: NODE,
      dataDir: DATA,
      settingsFile: 'C:/Users/ada/.claude/settings.json',
      settingsBackup: `${DATA}/install/backups/settings.json.1`,
      hooks: {},
      plugin: { id: PLUGIN_ID, installed: true, marketplaceDir: `${DATA}/marketplace` },
      createdConfig: true,
    },
    hookProgram: { path: `${DATA}/bin/hook.mjs`, exists: true, hash: HASH, shippedHash: HASH },
    pluginFiles: { dir: `${DATA}/marketplace/plugins/terminal-code`, missing: [], different: [], shipped: true },
    modSeen: { at: NOW - 600_000, version: APP_VERSION },
    aliases: [],
    shortNames: [{ long: DATA, short: 'C:/Users/ada/TERMIN~1', recognised: true }],
    memoryDirs: [{ path: 'C:/dev/notes/memory', exists: true, isRepo: true }],
    memorySetting: 'C:/dev/notes/memory',
    memoryStore: {
      place: 'both',
      dir: 'C:/dev/notes/memory',
      exists: true,
      isRepo: true,
      git: true,
      remote: 'https://github.com/ada/notes.git',
      hasOrigin: true,
      setting: 'C:/dev/notes/memory',
      inUse: true,
      last: null,
    },
    gitBash: { path: 'C:/Program Files/Git/bin/bash.exe', tmp: 'C:/Users/ada/AppData/Local/Temp', expectedTmp: 'C:/Users/ada/AppData/Local/Temp' },
    powershell: { pwsh: '7.6.6', windowsPowerShell: true },
    posixShell: null,
    terminal: { tty: true, columns: 120, term: 'xterm-256color', program: 'Windows Terminal', codePage: 65001, noColor: false },
    locale: { intl: 'en-US', lang: null, chosen: 'en' },
    data: {
      exists: true,
      writable: true,
      renameWorks: true,
      freeBytes: 100 * 1073741824,
      caseInsensitive: true,
      staleTemp: [],
      staleStates: 0,
      looseModes: [],
      missingDirs: [],
    },
    config: { problems: [], exists: true },
    index: { exists: true, ok: true, detail: null, sessions: 42 },
    quota: { exists: true, valid: true, measuredAt: NOW - 3600_000 },
    git: { version: '2.55.0', projects: [{ path: 'C:/dev/app', exists: true, readable: true, error: null, notRepo: false }] },
    transcripts: {
      files: 3,
      shape: {
        lines: 100,
        unreadable: 0,
        user: 40,
        assistant: 60,
        assistantWithBlocks: 60,
        assistantWithUsage: 60,
        timestamped: 100,
        sessionIds: ['0a81747c-ad2d-4fc0-97b9-5c3e560a8dd8'],
        tools: {
          Bash: { calls: 10, runsCommands: true, writesFiles: false },
          Edit: { calls: 3, runsCommands: false, writesFiles: true },
          Read: { calls: 9, runsCommands: false, writesFiles: false },
        },
      },
      badSessionIds: [],
    },
    selftest: [{ suite: 'belt', passed: 30, failed: 0, failures: [], ms: 3 }],
    hookAgreement: { samples: 30, agreed: 30, differences: [], error: null },
    autonomy: { enabled: false, checks: [] },
    ...over,
  };
}

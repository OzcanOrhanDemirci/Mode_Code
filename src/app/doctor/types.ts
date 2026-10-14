// SPDX-License-Identifier: Apache-2.0
/**
 * The maintenance check's shapes. Facts are measured once (facts.ts, the only part that touches the
 * machine); checks are pure functions of the facts (checks.ts), so every check is tested with made-up
 * facts and the same checks run on the person's machine; repairs (repairs.ts) change things, back up what
 * they change, and are counted only when the check passes again afterwards.
 */
import type { SyncRecord } from '../../core/memory-sync.js';
import type { SharedRecord } from '../../core/sync-export.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { TranscriptShape } from '../../core/transcript.js';
import type { PathAlias, Platform } from '../../core/paths.js';
import type { ConfigProblem } from '../../core/config.js';
import type { Manifest } from '../../node/install.js';
import type { HookEntry, PluginInfo, SettingsScope } from '../../node/claude-env.js';
import type { SuiteResult } from '../../core/selftest/types.js';
import type { GateCheck } from '../../core/run-gate.js';

export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail' | 'skip';

export type CheckGroup = 'node' | 'claude' | 'install' | 'protection' | 'shell' | 'files' | 'git' | 'data' | 'selftest';

export const GROUP_ORDER: readonly CheckGroup[] = ['node', 'claude', 'install', 'protection', 'shell', 'files', 'git', 'data', 'selftest'];

export type RepairId =
  | 'restore-hooks'
  | 'restore-hook-program'
  | 'repoint-node'
  | 'restore-plugin-files'
  | 'reinstall-plugin'
  | 'record-cli'
  | 'enable-plugin'
  | 'create-data-folders'
  | 'rebuild-index'
  | 'remove-stale-temp'
  | 'prune-session-state'
  | 'remove-bad-quota'
  | 'rewrite-config'
  | 'remove-duplicate-hooks'
  | 'tighten-permissions';

export interface Message {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface CheckResult {
  id: string;
  group: CheckGroup;
  status: CheckStatus;
  /** A failure here means a protection is weakened. */
  protection: boolean;
  /** One line with the measured value behind the status. */
  summary: Message;
  /** More lines, when the summary does not say enough. */
  details?: Message[];
  /** The repair that fixes it, when one exists and is safe to run. */
  repair?: RepairId;
  /** What the person can do when there is no repair. */
  hint?: Message;
}

/** One run of an external program, as measured. */
export interface ProgramRun {
  ok: boolean;
  /** First line of standard output, trimmed. */
  out: string;
  error?: string;
  ms: number;
}

export interface SettingsFileFacts {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  /** JSON parse error, with line and column when the parser gave them. */
  error: string | null;
  disableAllHooks: boolean;
  allowManagedHooksOnly: boolean;
  /** enabledPlugins[our id] in this file, when present. */
  pluginEnabled: boolean | null;
}

/** Everything the checks look at. Null means "could not be measured", which a check reports as such. */
export interface Facts {
  measuredAt: number;
  platform: Platform;
  arch: string;
  osRelease: string;
  appVersion: string;
  /** The tool's data folder and Claude Code's configuration folder, in the tool's path form. */
  dataDir: string;
  claudeDir: string;
  /** CLAUDE_CONFIG_DIR, MODE_CODE_HOME as set for this process. */
  claudeDirFromEnv: boolean;
  underAgent: boolean;

  node: { version: string; execPath: string; sqlite: boolean };
  hookNode: { path: string; exists: boolean; version: string | null } | null;

  claude: { installs: string[]; version: string | null };
  settings: SettingsFileFacts[];
  hooks: HookEntry[];
  /** `claude plugin list`, or null when it could not be run. */
  plugins: PluginInfo[] | null;

  manifest: Manifest | null;
  /**
   * An installation under an earlier name of the tool, beside this data folder: whether its manifest is
   * there, how many hooks in Claude Code's settings still run from its folder, whether its plugin is listed.
   */
  previous: { id: string; name: string; root: string; installed: boolean; hooks: number; plugin: boolean | null } | null;
  /** The tool's earlier names (PREVIOUS_NAMES), newest first. */
  previousNames: string[];
  /** The hook program in the data folder and the one this build ships, as sha256 hashes. */
  hookProgram: { path: string; exists: boolean; hash: string | null; shippedHash: string | null };
  /** Plugin files in the local marketplace against the ones this build ships: missing and different. */
  pluginFiles: { dir: string; missing: string[]; different: string[]; shipped: boolean };
  /** The command-line program the installation recorded for `/0` to open, and this build's own. */
  controlCenter: { recorded: string | null; exists: boolean; shipped: string | null };
  /** The newest time a session's mod reported in, and its version. */
  modSeen: { at: number; version: string } | null;

  /** Protected folders and files that are links, and the 8.3 short names Windows gave them. */
  aliases: PathAlias[];
  shortNames: { long: string; short: string; recognised: boolean }[];
  memoryDirs: { path: string; exists: boolean; isRepo: boolean }[];
  /** Claude Code's autoMemoryDirectory, set up or not by mode-code; null when it keeps one memory per project. */
  memorySetting: string | null;
  /** The memory store (docs/memory.md): its settings, its folder, Claude Code's setting, its last sync. */
  memoryStore: {
    place: string;
    dir: string;
    exists: boolean;
    isRepo: boolean;
    git: boolean;
    remote: string | null;
    hasOrigin: boolean;
    setting: string | null;
    inUse: boolean;
    last: SyncRecord | null;
  } | null;

  /** Sync across computers (docs/sync.md): where, whether it is there, git, the last sync, what waits. */
  sync: {
    place: string;
    dir: string;
    name: string;
    exists: boolean;
    isRepo: boolean;
    hasOrigin: boolean;
    others: number;
    last: SharedRecord | null;
    pending: string[];
  } | null;

  gitBash: { path: string | null; tmp: string | null; expectedTmp: string; error?: string } | null;
  powershell: { pwsh: string | null; windowsPowerShell: boolean } | null;
  posixShell: { shell: string | null; version: string | null } | null;
  terminal: { tty: boolean; columns: number | null; term: string | null; program: string | null; codePage: number | null; noColor: boolean };
  locale: { intl: string; lang: string | null; chosen: string };

  data: {
    exists: boolean;
    writable: boolean;
    renameWorks: boolean;
    freeBytes: number | null;
    /** True when a name in another case finds the same file in the data folder's volume. */
    caseInsensitive: boolean | null;
    staleTemp: string[];
    staleStates: number;
    /** POSIX permission bits of the data folder and config file, when group or others may write. */
    looseModes: string[];
    missingDirs: string[];
  };
  config: { problems: ConfigProblem[]; exists: boolean };
  index: { exists: boolean; ok: boolean | null; detail: string | null; sessions: number | null };
  quota: { exists: boolean; valid: boolean; measuredAt: number | null };

  git: { version: string | null; projects: { path: string; exists: boolean; readable: boolean; error: string | null; notRepo: boolean }[] };
  transcripts: { files: number; shape: TranscriptShape | null; badSessionIds: string[] };

  selftest: SuiteResult[] | null;
  /** The installed hook program run on the self-test samples: how many it answered as this build does. */
  hookAgreement: { samples: number; agreed: number; differences: { call: string; mine: string; theirs: string }[]; error: string | null } | null;
  /** Full autonomy: whether it is on, and the start checks measurable from here (app/runs.ts). */
  autonomy: { enabled: boolean; checks: GateCheck[] };
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The behavior layer inside Claude Code: a hooks module (a "mod") that Claude Code runs in its own
 * process. It guards tool calls with the safety belt, asks the person when a rule says so, reads the
 * keywords the person types, keeps the quota budget, draws the footer lines under each answer and keeps
 * long work quiet. The safety-net settings hook (src/hook) repeats the belt on every call, so protection
 * holds even when this module is not loaded.
 *
 * The environment has no Node: everything outside goes through `$`. Every function that receives `$`
 * is a top-level function of this file, as the engine's validator requires.
 */
import type { EngineInterface, EventName, Hook, On } from 'claude-code';
import { atom, read, update } from 'claude-code';
import type {
  ModeCodeAgentsPane,
  ModeCodeCockpit,
  ModeCodeCockpitUi,
  ModeCodeFlowPane,
  ModeCodeFooters,
  ModeCodeLabels,
  ModeCodeMo,
  ModeCodeQuotaPane,
  ModeCodeStripFocus,
} from './contract.js';
import {
  AGENT_KINDS,
  AGENT_MODELS,
  AGENT_MODES,
  agentCount,
  batchOver,
  closeBatch,
  countRunning,
  decideSpawn,
  MANY_AGENTS,
  modeNote,
  onPersonPrompt,
  rowsFor,
  setMode,
  withStarted,
  type AgentKind,
  type AgentMode,
  type AgentRow,
  type AgentsSettings,
} from '../core/agents.js';
import { APP_ID, APP_NAME, APP_VERSION, CLI_NAME, DATA_DIR_NAME, PLUGIN_NAME } from '../core/app.js';
import { parseConfig, serializeConfig, setConfigValue, type Config } from '../core/config.js';
import { layout, sessionFile, eventsFile, flowDir, memorySeenFile, memorySyncFile, provFile, syncRecordFile, type Layout } from '../core/layout.js';
import { SYNC_MAX_BYTES, syncCommitMessage, type Pending } from '../core/sync.js';
import { exportMachine, parseSharedRecord, settingsInEffect, syncDue, type SharedRecord, type SyncFs } from '../core/sync-export.js';
import { isUnder, joinPath, pathKey, resolvePath, type PathAlias, type Platform } from '../core/paths.js';
import { detectLanguage, tIn, setLanguage, type Lang, type MessageKey } from '../core/i18n/index.js';
import { CONTROLS, controlOf, controlText, optionLabel, valueIn, WINDOW_IDS, WINDOWS, type SettingPath, type WindowDef } from '../core/ux/catalog.js';
import { callLine, COCKPIT_COLUMNS, COCKPIT_PANE, COCKPIT_ROWS, cockpitData, type CockpitAct, type CockpitData, type ModeFrom } from '../core/ux/cockpit.js';
import { cockpitBody, type CockpitActs } from '../core/ux/cockpit-view.js';
import { appendChanges, changeRows, changeText, type ChangeWho } from '../core/ux/changes.js';
import { wrapText } from '../core/ux/text.js';
import { action, choices, notice, row as kitRow, windowFrame } from '../core/ux/kit.js';
import { cardLine, controlOfItem, moLine, stripNow } from '../core/ux/say.js';
import { COLORS, labelColumn, mark, TOAST_MS } from '../core/ux/tokens.js';
import { moState } from '../core/mo/state.js';
import { flagInText, flagLines, flagOfTurn, type Flag } from '../core/flagged.js';
import { why, whyAll, whyRule, whySubjectNamed, whyText, WHY_SUBJECTS, type WhyFacts } from '../core/ux/why.js';
import { activityOf, activityText, type ActivityEvent } from '../core/ux/activity.js';
import { levelOf, RULE_IDS } from '../core/belt/rules.js';
import { promisedIn } from '../core/manual.js';
import type { RuleId } from '../core/belt/types.js';
import { claudeHost } from './kit-host.js';
import { decide, evaluateToolCall, decisionText, mergeDecisions } from '../core/belt/evaluate.js';
import { taintedAct, taintMatters, taintSource, withoutInvisible } from '../core/taint.js';
import {
  madePaths,
  parseProvenance,
  requestCheck,
  typedText,
  withGrant,
  withMade,
  withSaid,
  withSeen,
  withStart,
  type Provenance,
} from '../core/provenance.js';
import { shellReadTool, shellTrap, wholeRead } from '../core/hygiene.js';
import { gitSubcommands } from '../core/measure.js';
import {
  catalogGuide,
  catalogList,
  catalogRefusal,
  CATEGORY_LABELS,
  introNote,
  missingProgram,
  modeOf,
  packById,
  packHint,
  packOfFile,
  packOfProgram,
  packOfTool,
  PACKS,
  packsInWords,
  type Pack,
  type PackRow,
} from '../core/packs.js';
import { analyzeCommand } from '../core/shell/analyze.js';
import { CORE_SKILLS, commandsText, LIST_COMMANDS, memorySetUp, shortCommands, type CoreSkill } from '../core/skills.js';
import { comparePins, parsePins } from '../core/mcp-pins.js';
import { partsAllowed, shellRules, type ShellRules } from '../core/permissions.js';
import { isFileTool, isOwnTool, shellOf } from '../core/belt/tools.js';
import type { BeltContext, BeltDecision, GitFacts } from '../core/belt/types.js';
import { checkFreeze, checkGuards, type ModeGuard } from '../core/guard.js';
import {
  detectKeyword,
  isModeKeyword,
  KEYWORD_LISTS,
  messageWithoutKeyword,
  MODE_KEYWORDS,
  nearKeyword,
  withoutSlash,
  type KeywordKind,
  type KeywordMatch,
  type NearKeyword,
} from '../core/keywords.js';
import {
  actionKeyword,
  budgetProblem,
  cells,
  CHOICE_LINE,
  choicesText,
  commandNamed,
  commandOf,
  COMMANDS,
  continueChoices,
  continuePhrase,
  controlsLine,
  FLOW_PRESETS,
  flowPhrase,
  flowPresetLine,
  lastChoice,
  menuText,
  budgetLabel,
  budgetTarget,
  parseBudget,
  pickChoice,
  splitBudget,
  stripRows,
  styleOf,
  type Budget,
  type ContinueChoice,
  type ControlAction,
  type StartableVariant,
  type StripItem,
  type StripView,
  type FlowView,
} from '../core/controls.js';
import { ago, compact, percent, shortPath } from '../core/format.js';
import { centerProgram, commandLine, LAUNCH_ENV, OPENS, terminalLaunch, windowsAppsDir, windowsTerminalProgram } from '../core/launch.js';
import { checkDue, newerThan, parseUpdateState } from '../core/update.js';
import { newsToSay } from '../core/news.js';
import { closeTabArgv, closeTabOutcome, type CloseTab } from '../core/close.js';
import { fold, truncate } from '../core/text.js';
import { MARK_W } from '../core/mo/marks.js';
import {
  conflictContext,
  continueFolderContext,
  restoredContext,
  flowNote,
  flowResumeContext,
  flowStartContext,
  flowTurnContext,
  keywordContext,
  nearKeywordNote,
  freezeNote,
  fullTurnNote,
  verifyNote,
  invisibleNote,
  mcpChangedNote,
  hygieneNote,
  trapNote,
  wholeReadNote,
  capStart,
  lessonNote,
  packsOnNote,
  skillRunPreamble,
  promptSecretNote,
  resumePrompt,
  stepGuidance,
  stepName,
  stepsLine,
  stopContext,
  wrapUpContext,
  type StepTexts,
} from '../core/guidance.js';
import {
  addApproval,
  applyKeyword,
  END_GRACE_MS,
  LIVE_WINDOW_MS,
  newModState,
  noteOwed,
  parseHookState,
  parseModState,
  sameFolderSessions,
  workingNow,
  type ModSessionState,
} from '../core/session.js';
import { hostGone, hostQuery, readHost } from '../core/host.js';
import { filterDriversQuery, needsFilterDrivers, repoFilterDrivers, safeGitArgs } from '../core/git-safe.js';
import { effectiveMode, isRestricted, MODE_ICON, tempZones, type ModeZones, type WorkMode } from '../core/modes.js';
import {
  approvePlan,
  cancelFlow,
  completeStep,
  currentStep,
  flowId,
  isOpen,
  isRunning,
  noteRefusal,
  parseFlow,
  pauseFlow,
  progress,
  resumeFlow,
  revisePlan,
  startFlow,
  stepMode,
  type Flow,
  type FlowResult,
  type StartableFlow,
} from '../core/flow.js';
import { checkPlan, checkReport, sourceProblems, type CheckProblem } from '../core/flow-checks.js';
import { count, evidenceText } from '../core/flow-view.js';
import { commandEffects, hidingIssues, strongest } from '../core/shell/effects.js';
import { assessQuota, fromModRateLimits, weeklyTargetFrom, type QuotaAssessment, type QuotaReading } from '../core/quota.js';
import { buildFooter, classifyTurn, type ClassifyEnv, type MemoryStatus, type ToolUse } from '../core/footer.js';
import { keywordTables, projectRefs, budgetOf, beltConfigOf } from '../core/settings-view.js';
import { maskSecrets, scanSecrets } from '../core/secrets/scan.js';
import {
  lastSeen,
  looksOnly,
  newestRecord,
  heldText,
  outgoingSecrets,
  parseAllowed,
  parseSeen,
  parseSyncRecord,
  syncMemory,
  syncPlan,
  syncProblem,
  type Runner,
  type SyncResult,
} from '../core/memory-sync.js';
import { commitMessage, handoffRoot, mergePulled, projectKey, pulledContext, type Pulled } from '../core/memory.js';
import {
  compactionSummary,
  composeHandoff,
  handoffAskContext,
  handoffFull,
  handoffLine,
  handoffName,
  isFresh,
  newestName,
  parseHandoff,
  partProblems,
  type Handoff,
  type HandoffFacts,
  type HandoffParts,
  type HandoffTrigger,
} from '../core/handoff.js';
import { morningSummary, nextActivity, parseActivity, type MorningFacts } from '../core/morning.js';
import {
  armOnBoundary,
  carriedState,
  carryFits,
  continuationPrompt,
  forkPrompt,
  inCluster,
  parseForkParts,
  resetVerdict,
  withCarried,
  type Carry,
  type ResetArm,
  type ResetSkip,
} from '../core/reset.js';
type $ = EngineInterface;
/** The input, `next` and result of a hook on event N, for handlers written as top-level functions. */
type In<N extends EventName> = Parameters<Hook<N>>[1];
type Nx<N extends EventName> = Parameters<Hook<N>>[2];
type Out<N extends EventName> = Promise<Awaited<ReturnType<Hook<N>>>>;

interface Ctx {
  layout: Layout;
  config: Config;
  lang: Lang;
  platform: Platform;
  home: string;
  env: Record<string, string | undefined>;
  sessionId: string;
  state: ModSessionState;
  reading: QuotaReading | null;
  /** The level the quota guard last announced, so each change is announced once. */
  announced: QuotaAssessment['level'];
  /** The person's turn: when it started, the main session's calls that ran, and whether one changed something. */
  turn: { startedAt: number | null; uses: ToolUse[]; changed: boolean };
  events: string[];
  eventsPath: string | null;
  resumeTimer: { cancel(): void } | null;
  /** Sessions in the same folder already announced, so each is said once. */
  conflictsSeen: Set<string>;
  /** Sessions whose Claude Code was found gone: a process that ended does not come back. */
  gone: Set<string>;
  /** Protected places that are links, measured at most once a minute (see BeltContext.aliases). */
  aliases: { at: number; list: PathAlias[] } | null;
  /** The flow this session works on (its record is the mod's to write). */
  flow: Flow | null;
  /** Steps left to the person in this turn (full autonomy): the turn's notification says they wait. */
  leftThisTurn: number;
  /** The safety-net hook has run in this session: it lays the safety nets (src/core/net.ts), so the belt may count on them. */
  hookSeen: boolean;
  /** Where things came from in this session (src/core/provenance.ts); null until read from its file. */
  prov: Provenance | null;
  /** What the person pasted into the prompt box since their last prompt: not their own words. */
  pastes: string[];
  // ── memory (docs/memory.md) ──
  /** When this session's context was loaded: the commits of the session are counted from here. */
  startedAt: number;
  /** The person's prompts in this session, and the last one (for a handoff note). */
  prompts: number;
  lastPrompt: string | null;
  /** When this session last wrote a handoff note, and last changed something (files, shell). */
  handoffAt: number;
  changedAt: number;
  memSyncing: boolean;
  /** Sync problems already told to the person in this session. */
  memWarned: Set<string>;
  // ── sync across computers (docs/sync.md) ──
  /** This computer's own settings, config.json as it is; `config` is the settings in effect. */
  local: Config;
  /** Settings from other computers that lower a protection here, waiting for the person; those already told. */
  syncPending: Pending[];
  syncSaid: Set<string>;
  /** The sync at the session's start while it runs: the first prompt waits for it (handoff notes may come with it). */
  sharedStart: Promise<void> | null;
  sharedSyncing: boolean;
  sharedWarned: Set<string>;
  /** The tool hygiene hints given in this session (core/hygiene.ts): each once. */
  hinted: Set<string>;
  /** A commit or a push ended a piece of work with a large context: the strip says /clear, until the next prompt. */
  boundary: { kind: 'commit' | 'push'; tokens: number } | null;
  /** In autonomous work, a commit or a push past quota.resetTokens: the next task starts in a new conversation (src/core/reset.ts). */
  resetArm: ResetArm | null;
  /** The reset runs: the session's end is the reset's, which wrote the note and keeps the flow going. */
  resetting: boolean;
  /** When the work last reset, carried from conversation to conversation, and how many resets in a row it has had. */
  lastResetAt: number;
  resets: number;
  /**
   * This conversation began with a reset: the prompt it began with (Mode_Code's, never the person's words), the note's
   * file, and what it read again before its first change (the measure of a reset's cost).
   */
  carried: { prompt: string | null; note: string | null; read: { before: number; first: number | null; calls: number } | null } | null;
  /** Work the main conversation left running in the background (a shell, a monitor) not reported back, and a wake-up it scheduled. */
  background: number;
  scheduled: boolean;
  /** Ultracode, as the person set it with /effort (null: not this session), the settings say, or their prompt asks. */
  ultracode: { command: boolean | null; settings: boolean; prompt: boolean };
  /** Agents at work now that count toward a free mode's N, for the strip. */
  agentsRunning: number;
  /** Notes the session's start found for the model (a changed MCP tool), told with the person's first prompt. */
  startNotes: string[];
  /** Tool packs loaded in this folder as the session started, and those whose use was logged (docs/packs.md). */
  packsOn: Set<string>;
  packsUsed: Set<string>;
  /** The session's first note (core/packs.ts introNote) is owed: a new session, after /clear, after a compaction. */
  introDue: boolean;
  /** The skills whose use was logged this session. */
  skillsUsed: Set<string>;
  /** The sync at the session's start while it runs: the first prompt waits for it. */
  memStart: Promise<unknown> | null;
  /** The notes of sessions closed without ending, written at the start: the first prompt waits for them. */
  closedStart: Promise<void> | null;
  /** What syncs brought in from elsewhere since the last prompt, told to Claude with the next one. */
  memPulled: Pulled | null;
  // ── the controls (docs/modes.md, "Controls") ──
  /** The session had no record of its own when it was loaded: a new session, or the one after /clear. */
  fresh: boolean;
  /** The session took up the person's last choice in this folder: the model is told with the first prompt. */
  restored: boolean;
  /** A flow asked for by `/6` without a task: the person's next message is its task. */
  armed: { kind: 'flow'; variant: StartableVariant } | null;
  /**
   * Notes of strip presses not told to Claude yet, the last of each kind: presses close together count as the
   * last one (the person, 2026-10-15). They go a moment after the last press, or with the next prompt.
   */
  heldPress: { notes: Partial<Record<'mode' | 'style' | 'flow', string[]>>; gen: number };
  /** When the settings file was last read (refreshConfig). */
  configReadAt: number;
  /** A folder chosen with `/devam` that is not a registered project: the "continue" just submitted is about it. */
  pendingContinue: { key: string; folder: string; label: string } | null;
  /** The text this plugin last sent as the person's (sendAsPerson): already applied, so not again if it comes back. */
  selfSent: string | null;
  /** The main loop's model turn while it runs (its `turn.start` id): Claude is working, `/00` asks first. */
  turnId: string | null;
  /** When a stopped answer was last explained (explainFlag): the other way the same stop comes is not said twice. */
  flagSaidAt: number;
  /** `/00` is closing the session; `closed` once its end steps ran, so the end itself does not run them again. */
  closing: boolean;
  closed: boolean;
  /** The lines of this session's activity a person reads (src/core/ux/activity.ts), counted under the strip. */
  activity: number;
  /** Those of them that wait for the person: the count under the strip turns to them, in the colour of a question. */
  waiting: number;
  /**
   * The cockpit (src/core/ux/cockpit.ts) is open in this session: what it shows is worked out while it is. `away`: the
   * window it stepped aside for, which brings it back when it closes.
   */
  cockpit: { open: boolean; away: string | null };
  /** The main conversation's calls at work, by their tool_use id: the cockpit's line of what runs now. */
  calls: Map<string, { tool: string; what: string; at: number }>;
  /** What Mo shows (src/core/mo/state.ts): the main conversation's calls running now, and when things last happened. */
  mo: {
    tools: number;
    agents: number;
    asking: number;
    blockAt: number | null;
    errorAt: number | null;
    doneAt: number | null;
    stoppedAt: number | null;
    backdrop: 'dark' | 'light';
    oneRow: boolean;
  };
}

let ctxPromise: Promise<Ctx> | null = null;
/**
 * A /clear ended the conversation `from`: Claude Code goes on under a new session id and fires no `session.start` for
 * it, so the next load under that id takes up what a new session's start would (afterClear).
 */
let cleared: { from: string; at: number } | null = null;
/** How long a prompt may still find the cleared session's id: past it, the host kept the id, and there is nothing to take up. */
const CLEAR_WAIT_MS = 10_000;
/**
 * What a reset at a task boundary hands to the conversation after its /clear (src/core/reset.ts). Kept in this module,
 * which the /clear does not reload: only the conversation it clears to takes it up, never another session.
 */
let pendingCarry: Carry | null = null;

/** Session state the drawings read (kept by Claude Code across reloads of this module). */
const footersAtom = atom({ plugin: 'mode-code', key: 'footers' } as const, {} as ModeCodeFooters);
const labelsAtom = atom({ plugin: 'mode-code', key: 'labels' } as const, { modes: [], tail: '', band: '', bandMeaning: null, strip: null } as ModeCodeLabels);
/** Below this width the strip keeps its room for the controls, and Mo steps aside. */
const MO_MIN_COLUMNS = 72;
const moAtom = atom(
  { plugin: 'mode-code', key: 'mo' } as const,
  {
    show: false,
    still: false,
    backdrop: 'dark',
    oneRow: false,
    tools: 0,
    agents: 0,
    asking: 0,
    waiting: false,
    auto: false,
    low: false,
    blockAt: null,
    errorAt: null,
    doneAt: null,
    stoppedAt: null,
    at: 0,
  } as ModeCodeMo,
);
/** The control of the strip under the keyboard's focus, its card shown under the strip (see ModeCodeStripFocus). */
const stripFocusAtom = atom({ plugin: 'mode-code', key: 'stripFocus' } as const, { id: null, at: 0 } as ModeCodeStripFocus);
/** How long a control's card stays under the strip after the focus last moved: Claude Code does not say when Esc took it back. */
const FOCUS_MS = 20_000;

/** Environment variables the belt may need to expand in paths; the API reads them one literal name at a time. */
async function readEnv($: $): Promise<Record<string, string | undefined>> {
  const [
    HOME,
    USERPROFILE,
    APPDATA,
    LOCALAPPDATA,
    TEMP,
    TMP,
    TMPDIR,
    CLAUDE_CONFIG_DIR,
    CLAUDE_PROJECT_DIR,
    XDG_CONFIG_HOME,
    PROGRAMDATA,
    SYSTEMROOT,
    WINDIR,
    OS,
    MODE_CODE_HOME,
    MODE_CODE_LANG,
    LANG,
    LC_ALL,
    LC_MESSAGES,
    WSL_DISTRO_NAME,
    COMPUTERNAME,
    HOSTNAME,
  ] = await Promise.all([
    $.env.get('HOME'),
    $.env.get('USERPROFILE'),
    $.env.get('APPDATA'),
    $.env.get('LOCALAPPDATA'),
    $.env.get('TEMP'),
    $.env.get('TMP'),
    $.env.get('TMPDIR'),
    $.env.get('CLAUDE_CONFIG_DIR'),
    $.env.get('CLAUDE_PROJECT_DIR'),
    $.env.get('XDG_CONFIG_HOME'),
    $.env.get('PROGRAMDATA'),
    $.env.get('SYSTEMROOT'),
    $.env.get('WINDIR'),
    $.env.get('OS'),
    $.env.get('MODE_CODE_HOME'),
    $.env.get('MODE_CODE_LANG'),
    $.env.get('LANG'),
    $.env.get('LC_ALL'),
    $.env.get('LC_MESSAGES'),
    $.env.get('WSL_DISTRO_NAME'),
    $.env.get('COMPUTERNAME'),
    $.env.get('HOSTNAME'),
  ]);
  return {
    HOME,
    USERPROFILE,
    APPDATA,
    LOCALAPPDATA,
    TEMP,
    TMP,
    TMPDIR,
    CLAUDE_CONFIG_DIR,
    CLAUDE_PROJECT_DIR,
    XDG_CONFIG_HOME,
    PROGRAMDATA,
    SYSTEMROOT,
    WINDIR,
    OS,
    MODE_CODE_HOME,
    MODE_CODE_LANG,
    LANG,
    LC_ALL,
    LC_MESSAGES,
    WSL_DISTRO_NAME,
    COMPUTERNAME,
    HOSTNAME,
  };
}

async function detectPlatform($: $, env: Record<string, string | undefined>, cwd: string): Promise<Platform> {
  if (env.OS === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(cwd)) return 'win32';
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 3000 });
    return r.stdout.trim() === 'Darwin' ? 'darwin' : 'linux';
  } catch {
    return 'linux';
  }
}

async function readFile($: $, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}

async function load($: $): Promise<Ctx> {
  const cwd = await $.session.cwd();
  const env = await readEnv($);
  const platform = await detectPlatform($, env, cwd);
  const rawHome = (platform === 'win32' ? env.USERPROFILE : env.HOME) ?? env.HOME ?? env.USERPROFILE ?? cwd;
  const home = resolvePath(rawHome, { platform, home: rawHome, cwd });
  const root = env.MODE_CODE_HOME ? resolvePath(env.MODE_CODE_HOME, { platform, home, cwd }) : joinPath(home, DATA_DIR_NAME);
  const l = layout(root);
  const { config: local } = parseConfig(await readFile($, l.config));
  // The settings in effect: this computer's own with the other computers' changes (docs/sync.md).
  const merged = await settingsInEffect(modSyncFs($), local, l.syncIgnored);
  const config = merged.config;
  const lang = detectLanguage({ configured: config.language === 'auto' ? null : config.language, env });
  setLanguage(lang);
  const sessionId = await $.session.id();
  const now = await $.clock.now();
  const path = sessionFile(l, sessionId, 'mod');
  const previous = path ? parseModState(await readFile($, path)) : null;
  const state: ModSessionState =
    previous && previous.sessionId === sessionId
      ? { ...previous, aliveAt: now, endedAt: null, modVersion: APP_VERSION }
      : newModState(sessionId, APP_VERSION, now);
  state.cwd = resolvePath(cwd, { platform, home, cwd });
  const reading = parseReading(await readFile($, l.quota));
  const eventsPath = eventsFile(l, sessionId, 'mod', now);
  const existing = await readFile($, eventsPath);
  const fdir = state.flowId ? flowDir(l, state.flowId) : null;
  const flow = fdir ? parseFlow(await readFile($, joinPath(fdir, 'flow.json'))) : null;
  return {
    layout: l,
    config,
    lang,
    platform,
    home,
    env,
    sessionId,
    state,
    reading,
    announced: 'ok',
    turn: { startedAt: null, uses: [], changed: false },
    events: existing ? existing.split('\n').filter(Boolean) : [],
    eventsPath,
    resumeTimer: null,
    conflictsSeen: new Set(),
    gone: new Set(),
    aliases: null,
    flow: flow && isOpen(flow) ? flow : null,
    leftThisTurn: 0,
    hookSeen: false,
    prov: null,
    pastes: [],
    startedAt: now,
    prompts: 0,
    lastPrompt: null,
    handoffAt: 0,
    changedAt: 0,
    memSyncing: false,
    memWarned: new Set(),
    memStart: null,
    closedStart: null,
    memPulled: null,
    fresh: !(previous && previous.sessionId === sessionId),
    restored: false,
    armed: null,
    heldPress: { notes: {}, gen: 0 },
    configReadAt: 0,
    pendingContinue: null,
    selfSent: null,
    turnId: null,
    flagSaidAt: 0,
    closing: false,
    closed: false,
    local,
    syncPending: merged.pending,
    syncSaid: new Set(),
    sharedStart: null,
    sharedSyncing: false,
    sharedWarned: new Set(),
    hinted: new Set(),
    boundary: null,
    resetArm: null,
    resetting: false,
    lastResetAt: 0,
    resets: 0,
    carried: null,
    background: 0,
    scheduled: false,
    ultracode: { command: null, settings: false, prompt: false },
    agentsRunning: 0,
    startNotes: [],
    packsOn: new Set(),
    packsUsed: new Set(),
    introDue: !(previous && previous.sessionId === sessionId),
    skillsUsed: new Set(),
    ...activityCounts(existing ? existing.split('\n') : [], lang),
    cockpit: { open: false, away: null },
    calls: new Map(),
    mo: {
      tools: 0,
      agents: 0,
      asking: 0,
      blockAt: null,
      errorAt: null,
      doneAt: null,
      stoppedAt: null,
      backdrop: await backdropOf($, home, env, platform, cwd),
      oneRow: (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal',
    },
  };
}

/**
 * The terminal's background as Claude Code's theme names it ("light", "light-daltonized", or a dark one):
 * Mo's faint light fades into it. Read once as the session loads; dark when the setting cannot be read.
 */
async function backdropOf($: $, home: string, env: Record<string, string | undefined>, platform: Platform, cwd: string): Promise<'dark' | 'light'> {
  try {
    const dir = env.CLAUDE_CONFIG_DIR ? resolvePath(env.CLAUDE_CONFIG_DIR, { platform, home, cwd }) : home;
    const m = /"theme"\s*:\s*"([^"]*)"/.exec((await readFile($, joinPath(dir, '.claude.json'))) ?? '');
    return m?.[1]?.startsWith('light') ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function parseReading(text: string | null): QuotaReading | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text) as QuotaReading;
    return Array.isArray(r.windows) && typeof r.measuredAt === 'number' ? r : null;
  } catch {
    return null;
  }
}

async function ctxOf($: $): Promise<Ctx> {
  const fresh = !ctxPromise;
  if (!ctxPromise) {
    const clear = cleared;
    // Inside the load, so that no hook works with the new session before it took up what it should.
    ctxPromise = clear ? load($).then((c) => afterClear($, c, clear)) : load($);
  }
  try {
    const c = await ctxPromise;
    // A fresh state (a new session, or a /clear) redraws the mode labels from it.
    if (fresh) await refreshStatus($, c);
    return c;
  } catch (err) {
    ctxPromise = null;
    throw err;
  }
}

/**
 * The context for a prompt. After a /clear a hook may have loaded the session between its end and the new id; the
 * conversation's first prompt then finds the new id and loads it, taking up what it should (afterClear).
 */
async function promptCtx($: $): Promise<Ctx> {
  if (cleared && ctxPromise) {
    try {
      const c = await ctxPromise;
      if ((await $.session.id()) !== c.sessionId) ctxPromise = null;
      else if ((await $.clock.now()) - cleared.at >= CLEAR_WAIT_MS) cleared = null;
    } catch {
      ctxPromise = null;
    }
  }
  return ctxOf($);
}

/** Marks this session as working now (other sessions and the control center read it). */
async function heartbeat($: $, c: Ctx): Promise<void> {
  c.state = { ...c.state, aliveAt: await $.clock.now() };
  await saveState($, c);
}

/**
 * Other sessions working in the same folder: a notice for the person the first time each is seen, and a
 * note for the model on every prompt while it lasts.
 */
async function sameFolderNotes($: $, c: Ctx): Promise<string[]> {
  const now = await $.clock.now();
  let entries: { name: string; mtimeMs: number }[] = [];
  try {
    entries = (await $.fs.list(c.layout.sessionsDir)).filter((x) => x.name.endsWith('.mod.json') && now - x.mtimeMs < LIVE_WINDOW_MS);
  } catch {
    return [];
  }
  const others: ModSessionState[] = [];
  for (const x of entries.slice(0, 40)) {
    const s = parseModState(await readFile($, joinPath(c.layout.sessionsDir, x.name)));
    if (s) others.push(s);
  }
  const found: ModSessionState[] = [];
  for (const s of sameFolderSessions(c.state, others, now, c.platform === 'win32' || c.platform === 'darwin'))
    if (!(await sessionGone($, c, s.sessionId))) found.push(s);
  const fresh = found.filter((s) => !c.conflictsSeen.has(s.sessionId));
  for (const s of fresh) c.conflictsSeen.add(s.sessionId);
  if (fresh.length) {
    $.ui.toast(tIn(c.lang, 'conflict.toast', { n: found.length }), { timeoutMs: 8000 });
    await logEvent($, c, { kind: 'conflict', sessions: found.map((s) => s.sessionId) });
  }
  return found.length ? [conflictContext(found.length)] : [];
}

/** Settings changed in the control center take effect at the next prompt, without restarting the session. */
async function refreshConfig($: $, c: Ctx): Promise<void> {
  c.configReadAt = await $.clock.now();
  const text = await readFile($, c.layout.config);
  const { config: local } = parseConfig(text);
  const merged = await settingsInEffect(modSyncFs($), local, c.layout.syncIgnored);
  c.local = local;
  c.syncPending = merged.pending;
  const config = merged.config;
  if (JSON.stringify(config) === JSON.stringify(c.config)) return;
  c.config = config;
  c.lang = detectLanguage({ configured: config.language === 'auto' ? null : config.language, env: c.env });
  setLanguage(c.lang);
  await refreshStatus($, c);
}

/**
 * Another session's Claude Code is surely gone: its window was shut without the session ending (host.ts). The
 * process its hook recorded is looked up; a session with no record, or a lookup that cannot tell, is kept.
 */
async function sessionGone($: $, c: Ctx, sessionId: string): Promise<boolean> {
  if (c.gone.has(sessionId)) return true;
  const path = sessionFile(c.layout, sessionId, 'hook');
  const host = path ? parseHookState(await readFile($, path), sessionId).host : null;
  if (!host) return false;
  let gone = false;
  try {
    const r = await $.process.run(hostQuery(c.platform, host.pid, c.env.SYSTEMROOT ?? c.env.WINDIR), { timeoutMs: 5000 });
    gone = hostGone(host, readHost(c.platform, host.pid, r.exitCode, r.stdout), c.platform);
  } catch {
    /* the lookup could not run: the session is kept as working */
  }
  if (gone) c.gone.add(sessionId);
  return gone;
}

/** Another session works on it now: open, alive within the window, and its Claude Code still running. */
async function workingElsewhere($: $, c: Ctx, other: ModSessionState): Promise<boolean> {
  return workingNow(other, await $.clock.now()) && !(await sessionGone($, c, other.sessionId));
}

async function saveState($: $, c: Ctx): Promise<void> {
  const path = sessionFile(c.layout, c.sessionId, 'mod');
  // What a note would be written from, should the session be closed without ending (closedNotes).
  if (c.changedAt > 0)
    c.state = {
      ...c.state,
      work: { startedAt: c.startedAt, changedAt: c.changedAt, handoffAt: c.handoffAt, project: c.state.work?.project ?? null, request: c.lastPrompt },
    };
  if (path) await $.fs.write(path, JSON.stringify(c.state, null, 2) + '\n');
}

async function logEvent($: $, c: Ctx, rec: Record<string, unknown>): Promise<void> {
  if (!c.eventsPath) return;
  const now = await $.clock.now();
  const line = JSON.stringify({ v: 1, at: now, source: 'mod', session: c.sessionId, app: APP_VERSION, ...rec });
  c.events.push(line);
  if (c.events.length > 5000) c.events = c.events.slice(-5000);
  // A line a person reads is counted under the strip at once (docs/design.md, No invisible work).
  const counted = activityCounts([line], c.lang);
  if (counted.activity) {
    c.activity += counted.activity;
    c.waiting += counted.waiting;
    await update($, labelsAtom, (x) => ({ ...x, activity: c.activity, waiting: c.waiting })).catch(() => undefined);
    await publishCockpit($, c);
  }
  try {
    await $.fs.write(c.eventsPath, c.events.join('\n') + '\n');
  } catch {
    /* the log never changes a decision */
  }
}

/**
 * How many of these event lines a person reads in the activity (the quiet ones, a quota reading or a note, not
 * counted), and how many of them wait for the person.
 */
function activityCounts(lines: readonly string[], lang: Lang): { activity: number; waiting: number } {
  let activity = 0;
  let waiting = 0;
  for (const l of lines) {
    if (!l) continue;
    try {
      const e = JSON.parse(l) as ActivityEvent;
      if (typeof e.kind !== 'string') continue;
      const a = activityOf(e, lang);
      if (a.quiet) continue;
      activity++;
      if (a.cls === 'waiting') waiting++;
    } catch {
      /* a torn line counts for nothing */
    }
  }
  return { activity, waiting };
}

/**
 * git as Mode_Code runs it (src/core/git-safe.ts): nothing the repository's settings name runs. null when a
 * filter driver of the repository cannot be switched off, so the call is not made. By name: Claude Code
 * looks programs up with the working folder left out, and runs git with the repository's hooks off.
 */
async function safeGit($: $, dir: string, args: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string } | null> {
  let drivers: string[] = [];
  if (needsFilterDrivers(args)) {
    const q = await $.process.run(['git', ...filterDriversQuery(dir)], { timeoutMs });
    const names = q.exitCode === 0 ? repoFilterDrivers(q.stdout) : q.exitCode === 1 ? [] : null;
    if (!names) return null;
    drivers = names;
  }
  return $.process.run(['git', ...safeGitArgs(dir, args, drivers)], { timeoutMs });
}

async function runGit($: $, dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await safeGit($, dir, args, 5000);
    return r ? { ok: r.exitCode === 0, out: r.stdout.trim() } : { ok: false, out: '' };
  } catch {
    return { ok: false, out: '' };
  }
}

async function gitFactsFor($: $): Promise<GitFacts> {
  const cache = new Map<string, string | null>();
  const memo = async (key: string, dir: string, args: string[]): Promise<string | null> => {
    if (!cache.has(key)) {
      const r = await runGit($, dir, args);
      cache.set(key, r.ok && r.out ? r.out : null);
    }
    return cache.get(key) ?? null;
  };
  return {
    currentBranch: (dir) => memo(`b\0${dir}`, dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    remoteUrl: (dir, remote = 'origin') => memo(`r\0${dir}\0${remote}`, dir, ['remote', 'get-url', '--', remote]),
    alias: (dir, name) => (/^[A-Za-z0-9._-]{1,64}$/.test(name) ? memo(`a\0${dir}\0${name}`, dir, ['config', '--get', `alias.${name}`]) : Promise.resolve(null)),
    // The local branches whose tips are in HEAD's history: deleting one loses no commit.
    merged: async (dir, branch) => {
      const list = await memo(`m\0${dir}`, dir, ['for-each-ref', '--merged', 'HEAD', '--format=%(refname:short)', 'refs/heads']);
      return list === null ? null : list.split('\n').includes(branch);
    },
  };
}

async function statSize($: $, path: string): Promise<number | null> {
  try {
    const s = await $.fs.stat(path);
    return s.kind === 'file' ? s.size : null;
  } catch {
    return null;
  }
}

function managedFiles(p: Platform): string[] {
  if (p === 'win32') return ['C:/Program Files/ClaudeCode/managed-settings.json'];
  if (p === 'darwin') return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
  return ['/etc/claude-code/managed-settings.json'];
}

function pathEnv(c: Ctx, cwd: string) {
  return { platform: c.platform, home: c.home, cwd: resolvePath(cwd, { platform: c.platform, home: c.home, cwd }) };
}

function memoryDirs(c: Ctx, cwd: string): string[] {
  return c.config.memory.dirs.map((d) => resolvePath(d, pathEnv(c, cwd)));
}

/** The protected places whose real location differs from their spelling: links, measured through `$.fs.stat`. */
async function aliasesFor($: $, c: Ctx, cwd: string): Promise<PathAlias[]> {
  const now = await $.clock.now();
  if (c.aliases && now - c.aliases.at < 60_000) return c.aliases.list;
  const env = pathEnv(c, cwd);
  const cdir = c.env.CLAUDE_CONFIG_DIR ? resolvePath(c.env.CLAUDE_CONFIG_DIR, env) : joinPath(c.home, '.claude');
  const globalConfig = c.env.CLAUDE_CONFIG_DIR ? joinPath(cdir, '.claude.json') : joinPath(c.home, '.claude.json');
  const list: PathAlias[] = [];
  for (const p of [c.layout.root, cdir, joinPath(cdir, 'settings.json'), joinPath(cdir, 'settings.local.json'), globalConfig, ...memoryDirs(c, cwd)]) {
    try {
      const real = (await $.fs.stat(p, { resolve: true })).realPath;
      if (!real) continue;
      const r = resolvePath(real, env);
      if (pathKey(r, c.platform) !== pathKey(p, c.platform)) list.push({ real: r, spelled: p });
    } catch {
      /* a place that does not exist has no other spelling */
    }
  }
  c.aliases = { at: now, list };
  return list;
}

/** The session's record of where things came from, read once from its file. */
async function provOf($: $, c: Ctx): Promise<Provenance> {
  if (!c.prov) {
    const path = provFile(c.layout, c.sessionId);
    c.prov = parseProvenance(path ? await readFile($, path) : null);
  }
  return c.prov;
}

/** Changes the record and writes it, for the hook to read before the next call. */
async function saveProv($: $, c: Ctx, change: (p: Provenance) => Provenance): Promise<void> {
  const before = await provOf($, c);
  const after = change(before);
  if (after === before) return;
  c.prov = after;
  const path = provFile(c.layout, c.sessionId);
  try {
    if (path) await $.fs.write(path, JSON.stringify(after) + '\n');
  } catch {
    /* without the file the hook decides without evidence: it asks */
  }
}

/**
 * Whether the safety-net hook runs in this session (it records the session the first time it sees it): only then is
 * a call let through on the strength of a safety net, which the hook lays before the call runs.
 */
async function hookSeen($: $, c: Ctx): Promise<boolean> {
  if (c.hookSeen) return true;
  const path = sessionFile(c.layout, c.sessionId, 'hook');
  c.hookSeen = !!path && (await readFile($, path)) !== null;
  return c.hookSeen;
}

async function beltContextFor($: $, c: Ctx): Promise<BeltContext> {
  const cwd = await $.session.cwd();
  const root = await $.session.root();
  const env = pathEnv(c, cwd);
  return {
    platform: c.platform,
    home: c.home,
    cwd: env.cwd,
    projectDir: resolvePath(c.env.CLAUDE_PROJECT_DIR ?? root, env),
    // The folders registered as projects count as projects here too, as in the hook and the CLI; without them a
    // session started in the home folder asked about every recursive delete in every project.
    knownProjects: c.config.projects.flatMap((p) => (p.path ? [resolvePath(p.path, env)] : [])),
    env: c.env,
    dataDir: c.layout.root,
    ...(c.config.sync ? { syncDir: resolvePath(c.config.sync.dir, env) } : {}),
    memoryDirs: memoryDirs(c, cwd),
    managedSettingsFiles: managedFiles(c.platform),
    lang: c.lang,
    config: beltConfigOf(c.config),
    level: levelOf(c.state.interaction),
    net: await hookSeen($, c),
    prov: await provOf($, c),
    git: await gitFactsFor($),
    fileSize: (p) => statSize($, p),
    aliases: await aliasesFor($, c, cwd),
  };
}

function classifyEnvFor(c: Ctx, cwd: string): ClassifyEnv {
  const env = pathEnv(c, cwd);
  const ignore = [c.env.TEMP, c.env.TMP, c.env.TMPDIR, c.platform === 'win32' ? undefined : '/tmp'].filter((x): x is string => !!x);
  return { ...env, memoryRoots: memoryDirs(c, cwd), ignore };
}

async function quotaNow($: $, c: Ctx): Promise<QuotaAssessment> {
  return assessQuota(c.reading, budgetOf(c.config, c.state), await $.clock.now());
}

// ── modes and flows ───────────────────────────────────────────────────────────────────────────────────

/** The flows' work folder: the setting, or mode-code/flows in the temporary folder. */
function workRoot(c: Ctx, cwd: string): string {
  const env = pathEnv(c, cwd);
  if (c.config.modes.workDir) return resolvePath(c.config.modes.workDir, env);
  return joinPath(tempZones(c.env, env)[0] ?? joinPath(c.home, '.cache'), APP_ID, 'flows');
}

function claudeDirOf(c: Ctx, cwd: string): string {
  return c.env.CLAUDE_CONFIG_DIR ? resolvePath(c.env.CLAUDE_CONFIG_DIR, pathEnv(c, cwd)) : joinPath(c.home, '.claude');
}

function zonesFor(c: Ctx, cwd: string): ModeZones {
  const env = pathEnv(c, cwd);
  const plan = [joinPath(claudeDirOf(c, cwd), 'plans')];
  const named = c.state.nativePlan?.planFile;
  if (named) plan.push(resolvePath(named, env));
  return { temp: tempZones(c.env, env), work: [workRoot(c, cwd)], plan };
}

/** The flow this session works on while it runs (not paused, not ended). */
function flowRunning(c: Ctx): Flow | null {
  return c.flow && isRunning(c.flow) ? c.flow : null;
}

function modeNow(c: Ctx): WorkMode {
  const step = flowRunning(c) ? currentStep(c.flow!) : null;
  return effectiveMode({
    session: c.state.mode,
    turn: c.state.turnMode,
    flowStep: step ? stepMode(step.kind) : null,
    nativePlan: c.state.nativePlan?.on === true,
  });
}

function modeGuardFor(c: Ctx, cwd: string): ModeGuard | null {
  if (!c.config.modules.modes) return null;
  const step = flowRunning(c) ? currentStep(c.flow!) : null;
  return {
    mode: modeNow(c),
    zones: zonesFor(c, cwd),
    env: c.env,
    flowStep: step && !c.state.turnMode ? stepName(step.kind, c.lang) : null,
    words: { code: tIn(c.lang, 'kw.kind.code'), free: tIn(c.lang, 'kw.kind.free') },
  };
}

function stepTexts(c: Ctx, f: Flow): StepTexts {
  return { copyDir: flowDir(c.layout, f.id) ?? c.layout.flowsDir, nativePlan: c.state.nativePlan?.on === true, approveWord: tIn(c.lang, 'kw.kind.approve') };
}

/** Writes the flow's record, attaches an open flow to the session (and lets an ended one go), redraws. */
async function saveFlow($: $, c: Ctx, f: Flow): Promise<void> {
  const dir = flowDir(c.layout, f.id);
  if (dir) await $.fs.write(joinPath(dir, 'flow.json'), JSON.stringify(f, null, 2) + '\n');
  c.flow = isOpen(f) ? f : null;
  c.state = { ...c.state, flowId: isOpen(f) ? f.id : null };
  await saveState($, c);
  await refreshStatus($, c);
}

/** A checked copy beside the record (the report, the approved plan), out of Claude's reach. */
async function keepCopy($: $, c: Ctx, f: Flow, name: string, text: string): Promise<string> {
  const dir = flowDir(c.layout, f.id) ?? c.layout.flowsDir;
  await $.fs.write(joinPath(dir, name), text);
  return joinPath(dir, name);
}

async function flowEvent($: $, c: Ctx, f: Flow, action: string, extra: Record<string, unknown> = {}): Promise<void> {
  await logEvent($, c, { kind: 'flow', action, flow: f.id, step: currentStep(f)?.kind ?? null, status: f.status, ...extra });
}

/** The open flows in the data folder, newest first (ids begin with their date). */
async function openFlows($: $, c: Ctx): Promise<Flow[]> {
  let names: string[] = [];
  try {
    names = (await $.fs.list(c.layout.flowsDir)).filter((e) => e.kind === 'dir').map((e) => e.name);
  } catch {
    return [];
  }
  const out: Flow[] = [];
  for (const n of names.sort().reverse().slice(0, 60)) {
    const dir = flowDir(c.layout, n);
    const f = dir ? parseFlow(await readFile($, joinPath(dir, 'flow.json'))) : null;
    if (f && isOpen(f)) out.push(f);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Another live session is working on this flow now. */
async function heldElsewhere($: $, c: Ctx, f: Flow): Promise<boolean> {
  if (!f.sessionId || f.sessionId === c.sessionId || !isRunning(f)) return false;
  const path = sessionFile(c.layout, f.sessionId, 'mod');
  const other = path ? parseModState(await readFile($, path)) : null;
  return !!other && other.flowId === f.id && (await workingElsewhere($, c, other));
}

/** The open flow a "continue" picks up: the named project's, else the one of this folder. */
async function flowToResume($: $, c: Ctx, project: string | null, cwd: string): Promise<Flow | null> {
  const here = resolvePath(cwd, pathEnv(c, cwd));
  const projPath = project ? c.config.projects.find((p) => p.id === project)?.path : undefined;
  const root = projPath ? resolvePath(projPath, pathEnv(c, cwd)) : null;
  for (const f of await openFlows($, c)) {
    const match = project
      ? f.project === project || (root !== null && isUnder(f.cwd, root, c.platform))
      : pathKey(f.cwd, c.platform) === pathKey(here, c.platform);
    if (match) return f;
  }
  return null;
}

/** The text of a file and its line count, or null when it cannot be read. */
async function textOf($: $, path: string): Promise<string | null> {
  return readFile($, path);
}

/** Runs the report's checks: its form, then the files it cites, measured on the disk. */
async function checkReportFile($: $, c: Ctx, f: Flow): Promise<{ text: string | null; problems: CheckProblem[]; findings: number; sources: number }> {
  const text = await textOf($, f.reportPath);
  if (text === null) return { text, problems: [{ key: 'flow.check.report.missing', params: { path: f.reportPath } }], findings: 0, sources: 0 };
  const r = checkReport(text);
  const root = resolvePath(await $.session.root(), pathEnv(c, f.cwd));
  const lines = new Map<string, number | null>();
  for (const s of r.sources) {
    if (s.kind !== 'file' || lines.has(s.path)) continue;
    const t = await textOf($, resolvePath(s.path, pathEnv(c, root)));
    lines.set(s.path, t === null ? null : t.split('\n').length - (t.endsWith('\n') ? 1 : 0));
  }
  return { text, problems: [...r.problems, ...sourceProblems(r.sources, (p) => lines.get(p) ?? null)], findings: r.findings, sources: r.sources.length };
}

/** Runs the plan's checks: its form, then each verification command as the belt would see it. */
async function checkPlanFile($: $, c: Ctx, path: string): Promise<{ text: string | null; problems: CheckProblem[]; steps: number; verification: string[] }> {
  const text = await textOf($, path);
  if (text === null) return { text, problems: [{ key: 'flow.check.plan.missing', params: { path } }], steps: 0, verification: [] };
  const p = checkPlan(text);
  const problems = [...p.problems];
  const ctx = await beltContextFor($, c);
  for (const command of p.verification) {
    const hidden = hidingIssues(commandEffects(command, 'bash', { ...pathEnv(c, ctx.cwd), env: c.env }).issues);
    if (hidden.length) {
      problems.push({ key: 'flow.check.plan.badCommand', params: { command, issues: hidden.join(', ') } });
      continue;
    }
    const d = await evaluateToolCall('Bash', { command }, ctx);
    if (d.verdict === 'deny')
      problems.push({ key: 'flow.check.plan.beltRefuses', params: { command, reason: d.findings.find((x) => x.verdict === 'deny')?.reason ?? '' } });
  }
  return { text, problems, steps: p.steps.length, verification: p.verification };
}

function problemsText(c: Ctx, step: string, problems: readonly CheckProblem[], path: string): string {
  return [
    tIn(c.lang, 'flow.step.refused', { step }),
    ...problems.map((p) => `• ${tIn(c.lang, p.key, p.params)}`),
    tIn(c.lang, 'flow.step.refusedTail', { path }),
  ].join('\n');
}

/** The plan file of the plan step: the one Claude Code's plan mode named while it is on, else the flow's. */
function planPathOf(c: Ctx, f: Flow): string {
  return c.state.nativePlan?.on && c.state.nativePlan.planFile ? resolvePath(c.state.nativePlan.planFile, pathEnv(c, f.cwd)) : f.planPath;
}

type PlanCheck = Awaited<ReturnType<typeof checkPlanFile>> & { path: string };

/**
 * The plan of the plan step, checked: Claude Code's plan file while its plan mode is on, else the flow's own.
 * A plan may have been written to either (plan mode can be switched on after the flow started), so when both
 * exist the one that passes its check is taken; otherwise the first that exists, with what it lacks.
 */
async function findPlan($: $, c: Ctx, f: Flow): Promise<PlanCheck> {
  const named = c.state.nativePlan?.planFile ? resolvePath(c.state.nativePlan.planFile, pathEnv(c, f.cwd)) : null;
  const order = named && named !== f.planPath ? (c.state.nativePlan?.on ? [named, f.planPath] : [f.planPath, named]) : [f.planPath];
  let found: PlanCheck | null = null;
  for (const path of order) {
    const check = { path, ...(await checkPlanFile($, c, path)) };
    if (check.text !== null && !check.problems.length) return check;
    if (!found && check.text !== null) found = check;
  }
  return found ?? { path: order[0]!, ...(await checkPlanFile($, c, order[0]!)) };
}

/** The person approved: the plan as it stands now passes its check, is kept, and its commands become the code step's. */
async function approveNow(
  $: $,
  c: Ctx,
  f: Flow,
  via: 'dialog' | 'plan-mode' | 'keyword',
  checked?: PlanCheck,
): Promise<FlowResult | { ok: false; problems: CheckProblem[]; flow: Flow }> {
  const check = checked ?? (await findPlan($, c, f));
  if (check.problems.length || check.text === null) return { ok: false, problems: check.problems, flow: f };
  const r = approvePlan(f, via, check.verification, await $.clock.now());
  if (r.ok) {
    await keepCopy($, c, r.flow, 'plan.md', check.text);
    await saveFlow($, c, r.flow);
    await flowEvent($, c, r.flow, 'approve', { via });
    $.ui.toast(tIn(c.lang, 'flow.toast.approved'));
  }
  return r;
}

/** Asks the person to approve the plan waiting for approval; the answer as the model reads it. */
async function askApproval($: $, c: Ctx, f: Flow, steps: number, verification: readonly string[]): Promise<string> {
  const approve = tIn(c.lang, 'flow.ask.approve');
  const revise = tIn(c.lang, 'flow.ask.revise');
  const pause = tIn(c.lang, 'flow.ask.pause');
  let answer: string | null = null;
  await moCount($, 'asking', 1);
  try {
    answer = await $.ui.ask(
      tIn(c.lang, 'flow.ask.question', {
        steps: count(c.lang, 'steps', steps),
        commands: verification.map((v) => `\`${v}\``).join(', '),
        path: planPathOf(c, f),
      }),
      {
        options: [approve, revise, pause],
        header: tIn(c.lang, 'flow.ask.header').slice(0, 12),
      },
    );
  } catch {
    answer = null;
  } finally {
    await moCount($, 'asking', -1);
  }
  const now = await $.clock.now();
  if (answer === approve) {
    const r = await approveNow($, c, f, 'dialog');
    if (!r.ok)
      return 'problems' in r
        ? problemsText(c, stepName('plan', c.lang), r.problems, planPathOf(c, f))
        : tIn(c.lang, 'flow.step.terminal', { status: f.status });
    return `${tIn(c.lang, 'flow.step.approved')}\n${stepGuidance(r.flow, c.lang, stepTexts(c, r.flow))}`;
  }
  if (answer === pause) {
    const r = pauseFlow(f, 'approval', now);
    await saveFlow($, c, r.flow);
    await flowEvent($, c, r.flow, 'pause', { reason: 'approval' });
    $.ui.toast(tIn(c.lang, 'flow.toast.paused', { step: stepName('approve', c.lang), cont: tIn(c.lang, 'kw.kind.continue') }));
    return tIn(c.lang, 'flow.step.pausedAtApproval');
  }
  if (answer !== null) {
    const note = answer === revise ? '' : answer;
    const r = revisePlan(f, note, now);
    await saveFlow($, c, r.flow);
    await flowEvent($, c, r.flow, 'revise');
    $.ui.toast(tIn(c.lang, 'flow.toast.revise'));
    return note ? tIn(c.lang, 'flow.step.revise', { note }) : tIn(c.lang, 'flow.step.reviseAsk');
  }
  // No one could be asked (a headless run, a dismissed dialog): the plan waits for the typed approval.
  if (c.config.modules.notifications) {
    try {
      await $.ui.notify(tIn(c.lang, 'flow.notify.waiting', { task: f.task || f.id }), { title: APP_NAME });
    } catch {
      /* the band and the label still say so */
    }
  }
  return tIn(c.lang, 'flow.step.waiting', { approve: tIn(c.lang, 'kw.kind.approve') });
}

/** One verification command's outcome, and what the model reads when it failed. */
interface CommandRun {
  results: { command: string; ok: boolean; seconds: number }[];
  /** What each command printed, by the index of its result (for the final review; not kept in the record). */
  outputs: string[];
  /** The first failure in words, or null when every command exited with 0. */
  failure: string | null;
  seconds: number;
}

/** Runs verification commands through Claude Code's own shell tool, in order, stopping at the first failure. */
async function runCommands($: $, c: Ctx, commands: readonly string[]): Promise<CommandRun> {
  const tools = new Set((await $.tool.list()).map((t) => t.name));
  const shell = tools.has('Bash') ? 'Bash' : tools.has('PowerShell') ? 'PowerShell' : null;
  // The commands run where the session's shell is: a failure says where, as a wrong folder is a common cause.
  const cwd = (await $.session.cwd()) ?? '?';
  const started = await $.clock.now();
  const results: CommandRun['results'] = [];
  const outputs: string[] = [];
  const done = async (failure: string | null): Promise<CommandRun> => ({
    results,
    outputs,
    failure,
    seconds: Math.round(((await $.clock.now()) - started) / 1000),
  });
  for (const [i, command] of commands.entries()) {
    if (!shell) return done(tIn(c.lang, 'flow.step.codeRefused', { command, reason: 'no shell tool' }));
    const at = await $.clock.now();
    let r: Awaited<ReturnType<typeof $.tool.call>>;
    try {
      r = await $.tool.call({ tool: shell, command, description: `Mode_Code: verification ${i + 1}/${commands.length}`, timeout: 600_000 } as never);
    } catch (err) {
      return done(tIn(c.lang, 'flow.step.codeRefused', { command, reason: String((err as Error)?.message ?? err) }));
    }
    const seconds = Math.round(((await $.clock.now()) - at) / 1000);
    if (r.deny !== undefined) {
      results.push({ command, ok: false, seconds });
      return done(tIn(c.lang, 'flow.step.codeRefused', { command, reason: r.deny }));
    }
    if (r.isError) {
      results.push({ command, ok: false, seconds });
      const out = String(r.text ?? r.result ?? '');
      const code = /Exit code (\d+)/.exec(out)?.[1] ?? '?';
      const tail = out.split('\n').slice(-25).join('\n').slice(-2000);
      return done(tIn(c.lang, 'flow.step.codeFailed', { command, code, cwd, tail }));
    }
    results.push({ command, ok: true, seconds });
    outputs.push(String(r.text ?? r.result ?? ''));
  }
  return done(null);
}

/** Runs the approved plan's verification commands through Claude Code's own shell tool, in order. */
async function runVerification($: $, c: Ctx, f: Flow): Promise<{ ok: true; seconds: number } | { ok: false; text: string }> {
  const r = await runCommands($, c, f.verification);
  return r.failure === null ? { ok: true, seconds: r.seconds } : { ok: false, text: r.failure };
}

/** The flow_step tool: the model finishes its current step; code checks it and says what comes next. */
async function onFlowStep($: $, e: any): Promise<any> {
  const c = await ctxOf($);
  const answer = (text: string) => ({ result: text });
  if (e.agentId !== undefined) return answer(tIn(c.lang, 'flow.step.agent'));
  const f = c.flow;
  if (!f) return answer(tIn(c.lang, 'flow.step.none', { flow: tIn(c.lang, 'kw.kind.flow') }));
  const asked = String(e.step ?? '');
  const step = currentStep(f);
  if (asked === 'status' || !step) return answer(`${stepsLine(f, c.lang)}\n${stepGuidance(f, c.lang, stepTexts(c, f))}`);
  if (f.status === 'paused') return answer(tIn(c.lang, 'flow.step.paused', { step: stepName(step.kind, c.lang), cont: tIn(c.lang, 'kw.kind.continue') }));
  const now = await $.clock.now();
  // A plan corrected while it waits is checked and put to the person again.
  const kind = step.kind === 'approve' && asked === 'plan' ? 'approve' : asked;
  if (kind !== step.kind) {
    const known = ['research', 'plan', 'code'].includes(asked) ? stepName(asked as 'research', c.lang) : asked;
    await saveFlow($, c, noteRefusal(f, step.kind, `flow_step(${asked}) at ${step.kind}`, now));
    return answer(
      `${tIn(c.lang, 'flow.step.notCurrent', { current: stepName(step.kind, c.lang), asked: known })}\n${stepGuidance(f, c.lang, stepTexts(c, f))}`,
    );
  }

  if (kind === 'research') {
    const check = await checkReportFile($, c, f);
    if (check.problems.length || check.text === null) {
      await saveFlow($, c, noteRefusal(f, 'research', check.problems.map((p) => p.key).join(', '), now));
      await flowEvent($, c, f, 'refused', { problems: check.problems.length });
      return answer(problemsText(c, stepName('research', c.lang), check.problems, f.reportPath));
    }
    const copy = await keepCopy($, c, f, 'research.md', check.text);
    const r = completeStep(f, 'research', { kind: 'research', findings: check.findings, sources: check.sources }, now);
    if (!r.ok) return answer(tIn(c.lang, 'flow.step.terminal', { status: f.status }));
    await saveFlow($, c, r.flow);
    await flowEvent($, c, r.flow, 'done', { done: 'research' });
    const done = tIn(c.lang, 'flow.step.doneResearch', {
      findings: count(c.lang, 'findings', check.findings),
      sources: count(c.lang, 'sources', check.sources),
      copy,
    });
    $.ui.toast(
      tIn(c.lang, r.flow.status === 'done' ? 'flow.toast.complete' : 'flow.toast.stepDone', {
        step: stepName('research', c.lang),
        evidence: evidenceText({ kind: 'research', findings: check.findings, sources: check.sources }, c.lang),
      }),
    );
    return answer(`${done}\n${stepGuidance(r.flow, c.lang, stepTexts(c, r.flow))}`);
  }

  if (kind === 'plan' || kind === 'approve') {
    const check = await findPlan($, c, f);
    if (check.problems.length || check.text === null) {
      await saveFlow($, c, noteRefusal(f, 'plan', check.problems.map((p) => p.key).join(', '), now));
      await flowEvent($, c, f, 'refused', { problems: check.problems.length });
      return answer(problemsText(c, stepName('plan', c.lang), check.problems, check.path));
    }
    let waiting = f;
    if (kind === 'plan') {
      const r = completeStep(f, 'plan', { kind: 'plan', steps: check.steps, commands: check.verification.length }, now);
      if (!r.ok) return answer(tIn(c.lang, 'flow.step.terminal', { status: f.status }));
      waiting = r.flow;
      await saveFlow($, c, waiting);
      await flowEvent($, c, waiting, 'done', { done: 'plan' });
      $.ui.toast(tIn(c.lang, 'flow.toast.waiting'));
    }
    const done = tIn(c.lang, 'flow.step.donePlan', {
      steps: count(c.lang, 'steps', check.steps),
      commands: count(c.lang, 'commands', check.verification.length),
    });
    // In Claude Code's plan mode the approval is its own dialog, which also ends plan mode.
    if (c.state.nativePlan?.on) return answer(`${done}\n${tIn(c.lang, 'flow.step.callExitPlanMode')}`);
    return answer(`${done}\n${await askApproval($, c, waiting, check.steps, check.verification)}`);
  }

  if (kind === 'code') {
    const run = await runVerification($, c, f);
    if (!run.ok) {
      await saveFlow($, c, noteRefusal(f, 'code', run.text.split('\n')[0] ?? '', await $.clock.now()));
      await flowEvent($, c, f, 'refused', {});
      return answer(run.text);
    }
    const r = completeStep(f, 'code', { kind: 'code', commands: f.verification.length, seconds: run.seconds }, await $.clock.now());
    if (!r.ok) return answer(tIn(c.lang, 'flow.step.terminal', { status: f.status }));
    await saveFlow($, c, r.flow);
    await flowEvent($, c, r.flow, 'done', { done: 'code' });
    $.ui.toast(tIn(c.lang, 'flow.toast.complete'));
    if (c.config.modules.notifications) {
      try {
        await $.ui.notify(tIn(c.lang, 'flow.toast.complete'), { title: APP_NAME });
      } catch {
        /* a convenience */
      }
    }
    return answer(tIn(c.lang, 'flow.step.doneCode', { commands: count(c.lang, 'commands', f.verification.length), seconds: run.seconds }));
  }
  return answer(tIn(c.lang, 'flow.step.notCurrent', { current: stepName(step.kind, c.lang), asked }));
}

/** Claude Code's plan dialog as the flow's approval: the plan is checked before the dialog is shown. */
async function onExitPlanMode($: $, c: Ctx, e: In<'tool.call'>, next: Nx<'tool.call'>): Out<'tool.call'> {
  const f = flowRunning(c);
  const step = f ? currentStep(f) : null;
  if (!f || !step || step.kind === 'code') {
    const r = await next(e);
    if (r.deny === undefined && !r.isError) {
      // Leaving Claude Code's plan mode with an approved plan ends the session's plan mode too.
      c.state = {
        ...c.state,
        nativePlan: { on: false, planFile: c.state.nativePlan?.planFile ?? null, at: await $.clock.now() },
        mode: c.state.mode === 'plan' ? 'free' : c.state.mode,
      };
      await saveState($, c);
      await refreshStatus($, c);
    }
    return r;
  }
  if (step.kind === 'research')
    return {
      deny: `${tIn(c.lang, 'flow.step.notCurrent', { current: stepName('research', c.lang), asked: stepName('plan', c.lang) })}\n${stepGuidance(f, c.lang, stepTexts(c, f))}`,
    };
  const check = await findPlan($, c, f);
  if (check.problems.length || check.text === null) return { deny: problemsText(c, stepName('plan', c.lang), check.problems, check.path) };
  let waiting = f;
  const now = await $.clock.now();
  if (step.kind === 'plan') {
    const done = completeStep(f, 'plan', { kind: 'plan', steps: check.steps, commands: check.verification.length }, now);
    if (done.ok) {
      waiting = done.flow;
      await saveFlow($, c, waiting);
      await flowEvent($, c, waiting, 'done', { done: 'plan' });
    }
  }
  const r = await next(e);
  if (r.deny !== undefined || r.isError) {
    // "Keep planning": the plan goes back to its step, with what the person said.
    const back = revisePlan(waiting, String(r.deny ?? r.text ?? '').slice(0, 500), await $.clock.now());
    if (back.ok) await saveFlow($, c, back.flow);
    return r;
  }
  c.state = { ...c.state, nativePlan: { on: false, planFile: c.state.nativePlan?.planFile ?? null, at: await $.clock.now() } };
  const approved = await approveNow($, c, waiting, 'plan-mode', check);
  if (!approved.ok) return r;
  return { ...r, context: [...(r.context ?? []), `${tIn(c.lang, 'flow.step.approved')}\n${stepGuidance(approved.flow, c.lang, stepTexts(c, approved.flow))}`] };
}

/** git in a folder with its output; diffs get a longer time. */
async function gitIn($: $, dir: string, args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const r = await safeGit($, dir, args, timeoutMs);
    if (!r) return { ok: false, out: '', err: 'a filter of the repository cannot be switched off' };
    return { ok: r.exitCode === 0, out: r.stdout.trim(), err: r.stderr.trim() };
  } catch (err) {
    return { ok: false, out: '', err: String((err as Error)?.message ?? err) };
  }
}

// ── telling the person (full autonomy, the safeguards) ──

/**
 * Tells the person, away from the computer too: a desktop notification, and their ntfy topic when they set one
 * (docs/autonomy.md), with curl, which every system this runs on has (Windows 10 and later too). The line is all
 * that is sent.
 */
async function notifyPerson($: $, c: Ctx, text: string): Promise<void> {
  if (!c.config.modules.notifications) return;
  try {
    await $.ui.notify(text, { title: APP_NAME });
  } catch {
    /* a convenience */
  }
  const topic = c.config.notify.ntfy;
  if (topic)
    try {
      await $.process.run(['curl', '-sS', '-m', '10', '-H', `Title: ${APP_NAME}`, '-d', text, topic], { timeoutMs: 15_000 });
    } catch {
      /* a convenience too: the desktop and the activity have it */
    }
}

/** A call in one line, for the person: the command, or the tool and its file, secrets masked. */
function callSummary(tool: string, input: Readonly<Record<string, unknown>>): string {
  const raw =
    typeof input.command === 'string' ? input.command : typeof input.file_path === 'string' ? `${tool} ${input.file_path}` : `${tool} ${JSON.stringify(input)}`;
  return maskSecrets(raw).slice(0, 600);
}

/** The person's allow rules for a shell tool: Claude Code's user and project settings, read as they are now. */
async function shellAllowRules($: $, c: Ctx, tool: 'Bash' | 'PowerShell', cwd: string): Promise<ShellRules> {
  const dir = c.env.CLAUDE_CONFIG_DIR ? resolvePath(c.env.CLAUDE_CONFIG_DIR, { platform: c.platform, home: c.home, cwd }) : joinPath(c.home, '.claude');
  const files = [joinPath(dir, 'settings.json'), joinPath(cwd, '.claude', 'settings.json'), joinPath(cwd, '.claude', 'settings.local.json')];
  const allow: unknown[] = [];
  for (const f of files) {
    try {
      const p = (JSON.parse((await readFile($, f)) ?? '{}') as { permissions?: { allow?: unknown } }).permissions?.allow;
      if (Array.isArray(p)) allow.push(...p);
    } catch {
      /* a settings file that does not read allows nothing */
    }
  }
  return shellRules(allow, tool);
}

/**
 * Claude Code's own permission question (docs/safety-belt.md, "Ways of working"). By the time it is asked, the safety
 * belt has let the call through or the person said yes to it. A question of the person's own (a rule in their
 * settings or their organisation's, another hook's, an option's check) stays theirs: put to them, never to a
 * classifier; in full autonomy, with nobody to ask, the step is left to them. One Claude Code's mode asks by itself
 * (an edit, a command) is answered in Autonomous and full autonomy; Manual leaves it to the person, a step at a time.
 * A compound command whose every part the person allowed is answered in every way of working.
 */
async function onToolCheck($: $, e: In<'tool.check'>, next: Nx<'tool.check'>): Out<'tool.check'> {
  const v = await next(e);
  if (v.decision !== 'ask' || !e.tool_use_id) return v;
  let c: Ctx;
  try {
    c = await ctxOf($);
  } catch {
    return v;
  }
  const tool = String(e.tool);
  const input = (typeof e.input === 'object' && e.input !== null ? e.input : {}) as Record<string, unknown>;
  const level = levelOf(c.state.interaction);
  if (v.rule || v.hook || v.setting) {
    // Up to Claude Code 2.1.307 an ask went to the person by its `decider`; from 2.1.308 an ask a hook answers is
    // theirs by itself (the engine stamps the plugin on it) and the field is dropped, so it is no longer in the type.
    if (level !== 'full') return { ...v, decider: 'person' } as typeof v;
    const what = callSummary(tool, input);
    const reason = maskSecrets(v.reason ?? v.rule ?? v.hook ?? v.setting ?? '');
    c.leftThisTurn++;
    await logEvent($, c, { kind: 'permission', tool, answer: 'left', what });
    return { decision: 'deny', reason: tIn(c.lang, 'belt.claude.left', { what, reason }) };
  }
  // A compound command whose every part the person allowed (`cd app && npm test`): what they said yes to already.
  const shellTool = tool === 'Bash' || tool === 'PowerShell' ? tool : null;
  if (shellTool) {
    const cwd = await $.session.cwd();
    const command = String(input.command ?? '');
    const rules = await shellAllowRules($, c, shellTool, cwd);
    const env = pathEnv(c, cwd);
    if (partsAllowed(command, shellTool === 'Bash' ? 'bash' : 'powershell', rules, env.cwd, env)) {
      await logEvent($, c, { kind: 'permission', tool: shellTool, answer: 'parts' });
      return { ...v, decision: 'allow' };
    }
  }
  if (level === 'manual') return v;
  await logEvent($, c, { kind: 'permission', tool, answer: level });
  return { ...v, decision: 'allow' };
}

/**
 * What the prompt footer shows: the session's mode as labels at the right of the footer (beside Claude
 * Code's own), and the quota dim at the end of the hint line. Drawn by render hooks, so no notice prefix.
 */
async function refreshStatus($: $, c: Ctx): Promise<void> {
  // A free mode's count of agents at work, and the agents window's list, as Claude Code has them now.
  if (c.config.agents.enabled && c.state.agents.mode !== 'off') {
    const seen = await agentList($);
    c.agentsRunning = countRunning(seen, agentsCfg(c));
    await update($, agentsPaneAtom, (x) => ({
      ...x,
      running: seen.filter((a) => AT_WORK.has(a.status)).map((a) => ({ id: a.id, label: `${a.description || a.type} · ${a.type}` })),
    }));
  }
  const strip = c.config.modules.modes ? { ...viewOf(c), lang: c.lang, still: c.config.accessibility.reduceMotion } : null;
  if (!c.config.modules.status) {
    await update($, labelsAtom, () => ({ modes: [], tail: '', band: '', bandMeaning: null, strip, activity: c.activity, waiting: c.waiting }));
    await publishMo($, c);
    return;
  }
  const q = await quotaNow($, c);
  const modes: string[] = [];
  let band = '';
  // What the band says, by meaning: drawn with its mark and colour (src/core/ux/kit.ts, notice).
  let bandMeaning: ModeCodeLabels['bandMeaning'] = null;
  if (c.config.modules.modes) {
    // The mode and the way of working are always in view, the defaults too (the person, 2026-10-13).
    modes.push(tIn(c.lang, `status.${modeNow(c)}` as MessageKey));
    if (c.flow) {
      const p = progress(c.flow);
      modes.push(c.flow.status === 'paused' ? tIn(c.lang, 'status.flowPaused') : tIn(c.lang, 'status.flow', { at: p.at, of: p.of }));
      if (c.flow.status === 'waiting') {
        band = tIn(c.lang, 'flow.band.waiting', { path: planPathOf(c, c.flow), approve: tIn(c.lang, 'kw.kind.approve') });
        bandMeaning = 'ask';
      }
    }
  }
  if (!band && c.boundary) {
    band = tIn(c.lang, 'quota.boundary', { kind: c.boundary.kind, tokens: compact(c.boundary.tokens, c.lang) });
    bandMeaning = 'on';
  }
  if (c.config.modules.modes || c.state.interaction !== 'default')
    modes.push(tIn(c.lang, c.state.interaction === 'full' ? 'status.full' : c.state.interaction === 'autonomous' ? 'status.autonomous' : 'status.manual'));
  if (c.state.wrapUp) modes.push(tIn(c.lang, 'status.wrapUp'));
  if (c.state.resumeAt) {
    const d = new Date(c.state.resumeAt);
    modes.push(tIn(c.lang, 'status.resume', { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }));
  }
  const quota: string[] = [];
  if (q.usable && q.five) quota.push(tIn(c.lang, 'status.five', { n: Math.round(q.five.used) }));
  if (q.usable && q.week)
    quota.push(
      c.state.weeklyTarget !== null
        ? tIn(c.lang, 'status.weekTarget', { n: Math.round(q.week.used), target: c.state.weeklyTarget })
        : tIn(c.lang, 'status.week', { n: Math.round(q.week.used) }),
    );
  await update($, labelsAtom, () => ({
    modes,
    // The quota alone: a line of text has no room for Mo's colors, and the shield it began with was drawn two cells
    // wide over a width of one, covering the word after it (the person, 2026-10-21).
    tail: quota.join(' · '),
    band,
    bandMeaning,
    strip,
    activity: c.activity,
    waiting: c.waiting,
  }));
  await publishMo($, c);
}

/**
 * What Mo knows, for the strip to draw (src/mod/mo-strip.ts). Mo is a picture: whatever fails here is left
 * out, and nothing it does stands in the way of a call, a turn or the belt.
 */
async function publishMo($: $, c: Ctx): Promise<void> {
  try {
    const m = c.mo;
    const value: ModeCodeMo = {
      show: c.config.modules.mascot && !c.config.accessibility.plain,
      still: c.config.accessibility.reduceMotion,
      backdrop: m.backdrop,
      oneRow: m.oneRow,
      tools: m.tools,
      agents: m.agents,
      asking: m.asking,
      waiting: c.flow?.status === 'waiting',
      auto: c.state.interaction === 'full',
      low: c.announced !== 'ok',
      blockAt: m.blockAt,
      errorAt: m.errorAt,
      doneAt: m.doneAt,
      stoppedAt: m.stoppedAt,
      at: await $.clock.now(),
    };
    await update($, moAtom, () => value);
  } catch {
    /* the strip keeps the last picture */
  }
  // What Mo knows, the cockpit says in words: what runs now.
  await publishCockpit($, c);
}

/** One more (or one fewer) of the main conversation's calls running, or of the questions waiting for the person. */
async function moCount($: $, kind: 'tools' | 'agents' | 'asking', by: 1 | -1, call?: In<'tool.call'>): Promise<void> {
  try {
    const c = await ctxOf($);
    c.mo[kind] = Math.max(0, c.mo[kind] + by);
    // The call itself, for the cockpit's line of what runs now: started, or done.
    if (call && by > 0)
      c.calls.set(call.tool_use_id, { tool: String(call.tool), what: callLine(String(call.tool), call as Record<string, unknown>), at: await $.clock.now() });
    else if (call) c.calls.delete(call.tool_use_id);
    await publishMo($, c);
  } catch {
    /* a picture only */
  }
}

/** Something happened that Mo shows for a few seconds: a refusal, a failed, stopped or finished turn. */
async function moMark($: $, c: Ctx, what: 'blockAt' | 'errorAt' | 'doneAt' | 'stoppedAt'): Promise<void> {
  try {
    c.mo[what] = await $.clock.now();
    await publishMo($, c);
  } catch {
    /* a picture only */
  }
}

/** What a call of the main conversation is to Mo: an agent at work, a question to the person, or a tool. */
function moKind(tool: string): 'tools' | 'agents' | 'asking' {
  if (tool === 'Agent' || tool === 'Task') return 'agents';
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return 'asking';
  return 'tools';
}

/** The gate of every call (onToolCall), with Mo counting the main conversation's call while it runs and showing a refusal. */
async function onToolCallWithMo($: $, e: In<'tool.call'>, next: Nx<'tool.call'>): Out<'tool.call'> {
  const kind = e.agentId === undefined ? moKind(String(e.tool)) : null;
  if (kind) await moCount($, kind, 1, e);
  try {
    const result = await onToolCall($, e, next);
    if (kind && result.deny !== undefined) await moRefused($);
    return result;
  } finally {
    if (kind) await moCount($, kind, -1, e);
  }
}

async function moRefused($: $): Promise<void> {
  try {
    await moMark($, await ctxOf($), 'blockAt');
  } catch {
    /* a picture only */
  }
}

/**
 * The session's state in one paragraph for the model, or '' when there is nothing beyond the defaults.
 * Claude Code reads it with the first message's context, which it reads again after a compaction: the
 * keyword context of the original prompt is summarized away there, this is not.
 */
async function sessionStateText($: $): Promise<string> {
  let c: Ctx;
  try {
    c = await ctxOf($);
  } catch {
    return '';
  }
  const parts = sessionStateParts(c);
  return parts.length ? `[${APP_NAME}] Session state, kept across compaction: ${parts.join('; ')}.` : '';
}

/** The session's state in short clauses for the model, beyond the defaults: kept across a compaction, carried by a reset. */
function sessionStateParts(c: Ctx): string[] {
  const s = c.state;
  const parts: string[] = [];
  const label = s.project ? (c.config.projects.find((p) => p.id === s.project)?.names[0] ?? s.project) : null;
  if (s.interaction === 'full')
    parts.push(
      `the person chose full autonomy${label ? ` on project "${label}"` : ''}: ask nothing; list each step left to them, with its command, at the end`,
    );
  else if (s.interaction === 'autonomous') parts.push(`the person asked for autonomous work${label ? ` on project "${label}"` : ''}`);
  else if (s.interaction === 'manual') parts.push(`the person asked to work step by step${label ? ` on project "${label}"` : ''}`);
  if (s.mode === 'chat') parts.push('chat mode is on: no project or memory writes and no commits until the person picks another mode');
  else if (s.mode !== 'free') parts.push(`${s.mode} mode is on (the safety layer enforces it)`);
  if (s.weeklyTarget !== null) parts.push(`the weekly quota budget is ${s.weeklyTarget}%`);
  if (s.wrapUp) parts.push('work is wrapping up: finish the current step, commit, report and stop');
  if (c.flow && c.config.modules.modes) {
    const step = currentStep(c.flow);
    parts.push(
      `a flow ${c.flow.status === 'paused' ? 'is paused' : 'runs'} (${c.flow.id}${c.flow.task ? `, task "${c.flow.task.slice(0, 200)}"` : ''}): ${stepsLine(c.flow, 'en')}; ` +
        (step?.kind === 'approve'
          ? "the plan waits for the person's approval"
          : `finish the ${step?.kind ?? ''} step and call mcp__mode-code__flow_step with its name; drafts are in ${c.flow.workDir}`),
    );
  }
  return parts;
}

/** Adds the state note to the conversation as a row the model reads and the person does not see as typed. */
async function restateSession($: $, text: string): Promise<void> {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } });
  } catch {
    /* the summary was asked to keep it too */
  }
}

/** A short, stable key for an answer's text (FNV-1a), to find the footer of the answer being drawn. */
function textKey(text: string): string {
  let h = 0x811c9dc5;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

async function footerFor($: $, text: string, isSummary: boolean): Promise<string[] | null> {
  if (isSummary || !text.trim()) return null;
  const map = await read($, footersAtom);
  return map[textKey(text)] ?? null;
}

async function modeLabels($: $): Promise<string[]> {
  return (await read($, labelsAtom)).modes;
}

async function quotaTail($: $): Promise<string> {
  return (await read($, labelsAtom)).tail;
}

/** Asks the person about a belt "ask" verdict. Resolves true only on an explicit "allow". */
async function askPerson($: $, c: Ctx, tool: string, d: BeltDecision): Promise<'allow' | 'block' | 'none'> {
  const reasons = d.findings
    .filter((f) => f.verdict === 'ask')
    // A reason that ends with the command has no full stop of its own; the question follows it.
    .map((f) => (/[.!?…]$/.test(f.reason) ? f.reason : `${f.reason}.`))
    .join(' ');
  const allow = tIn(c.lang, 'belt.ask.allow');
  const block = tIn(c.lang, 'belt.ask.block');
  await moCount($, 'asking', 1);
  try {
    const answer = await $.ui.ask(tIn(c.lang, 'belt.ask.question', { tool, reasons }), {
      options: [allow, block],
      header: tIn(c.lang, 'belt.ask.header').slice(0, 12),
    });
    return answer === allow ? 'allow' : 'block';
  } catch {
    return 'none';
  } finally {
    await moCount($, 'asking', -1);
  }
}

/**
 * What changed since the version an update replaced (core/news.ts), once on this computer, as the first session after
 * the update starts. Kept in state/once.json as the newest note said; a file that does not read says it again.
 */
async function newsOnce($: $, c: Ctx): Promise<void> {
  let from: unknown;
  let once: Record<string, unknown> = {};
  try {
    from = (JSON.parse((await readFile($, c.layout.manifest)) ?? '{}') as { updatedFrom?: unknown }).updatedFrom;
    once = JSON.parse((await readFile($, c.layout.once)) ?? '{}') as Record<string, unknown>;
  } catch {
    /* no installation record, or one that does not read: nothing to compare with */
  }
  const news = newsToSay(from, once.news, APP_VERSION);
  if (!news.length) return;
  $.ui.toast(news.map((n) => tIn(c.lang, n.short)).join(' '), { timeoutMs: TOAST_MS.attention });
  try {
    await $.fs.write(c.layout.once, JSON.stringify({ ...once, news: news.at(-1)!.since }, null, 2) + '\n');
  } catch {
    /* said again next time: better twice than never */
  }
}

/**
 * Full autonomy's card, the first time it is chosen on this computer (the person, 2026-10-20): it asks nothing, and
 * what cannot be undone it does not do but leaves to them. Kept in state/once.json; a file that does not read shows
 * the card again rather than never.
 */
async function fullCardOnce($: $, c: Ctx): Promise<void> {
  let once: Record<string, unknown> = {};
  try {
    once = JSON.parse((await readFile($, c.layout.once)) ?? '{}') as Record<string, unknown>;
  } catch {
    once = {};
  }
  if (typeof once.fullCard === 'number') return;
  $.ui.toast(tIn(c.lang, 'full.card'), { timeoutMs: TOAST_MS.attention });
  try {
    await $.fs.write(c.layout.once, JSON.stringify({ ...once, fullCard: await $.clock.now() }, null, 2) + '\n');
  } catch {
    /* said again next time: better twice than never */
  }
}

/** "commit", "push", "commit and push", in the person's language. */
function promisedWords(promised: readonly ('commit' | 'push')[], lang: Lang): string {
  return promised.map((p) => tIn(lang, `manual.what.${p}` as MessageKey)).join(tIn(lang, 'manual.and'));
}

/** Manual's question before a commit or a push: the command in full, allow once or not. */
async function askManual($: $, c: Ctx, promised: readonly ('commit' | 'push')[], command: string): Promise<'allow' | 'block' | 'none'> {
  const allow = tIn(c.lang, 'belt.ask.allow');
  const block = tIn(c.lang, 'belt.ask.block');
  await moCount($, 'asking', 1);
  try {
    const answer = await $.ui.ask(tIn(c.lang, 'manual.question', { what: promisedWords(promised, c.lang), command: truncate(maskSecrets(command), 300) }), {
      options: [allow, block],
      header: tIn(c.lang, 'manual.header').slice(0, 12),
    });
    return answer === allow ? 'allow' : 'block';
  } catch {
    return 'none';
  } finally {
    await moCount($, 'asking', -1);
  }
}

async function onToolCall($: $, e: In<'tool.call'>, next: Nx<'tool.call'>): Out<'tool.call'> {
  const c = await ctxOf($);
  const tool = String(e.tool);
  const { tool: _t, tool_use_id, agentId: _a, consent: _c, requestMeta: _m, ...input } = e as unknown as Record<string, unknown>;
  void [_t, _a, _c, _m];
  const cwd = await $.session.cwd();

  // In autonomous work a commit or a push with a large context armed a reset: the next task's first call starts it.
  if (e.agentId === undefined && c.resetArm) {
    const reset = await resetAtBoundary($, c, tool, input, cwd);
    if (reset) return { deny: reset };
  }
  // Full autonomy asks nobody: a question to the person, or Claude Code's plan mode, which waits for their approval,
  // is answered with what to do instead (docs/autonomy.md).
  if (c.state.interaction === 'full' && (tool === 'AskUserQuestion' || tool === 'EnterPlanMode')) {
    await logEvent($, c, { kind: 'full', tool });
    return { deny: tIn(c.lang, tool === 'AskUserQuestion' ? 'full.guard.ask' : 'full.guard.plan') };
  }
  const ctx = await beltContextFor($, c);
  let d = await evaluateToolCall(tool, input, ctx);
  // Outside content was read in this session: what an instruction hidden in it would ask for is asked (src/core/taint.ts).
  const found = c.state.tainted ? taintedAct(tool, input, { ...pathEnv(c, cwd), memoryDirs: ctx.memoryDirs }) : null;
  // What a call writes or sends, by where it came from: only what the session read from outside, or a host nobody named, asks.
  const written = [input.content, input.new_string, ...(Array.isArray(input.edits) ? input.edits.map((x) => (x as { new_string?: unknown })?.new_string) : [])]
    .filter((x): x is string => typeof x === 'string')
    .join('\n');
  const tainted = found && taintMatters(found, written, await provOf($, c)) ? found : null;
  if (tainted && c.state.tainted) {
    const act = tIn(c.lang, `belt.tainted.${tainted.act}` as MessageKey);
    const reason = tIn(c.lang, 'belt.reason.tainted', { source: c.state.tainted.source, act, what: truncate(maskSecrets(tainted.what), 160) });
    d = mergeDecisions(d, decide([{ rule: 'inject.tainted-act', verdict: 'ask', reason }], [], ctx));
  }
  const rules = d.findings.map((f) => f.rule);

  if (d.verdict === 'deny') {
    for (const r of new Set(d.findings.filter((f) => f.verdict === 'deny').map((f) => f.rule))) c.state.blocks[r] = (c.state.blocks[r] ?? 0) + 1;
    const repeat = Math.max(0, ...d.findings.filter((f) => f.verdict === 'deny').map((f) => c.state.blocks[f.rule] ?? 0));
    await saveState($, c);
    // Full autonomy asks nobody: what Autonomous would ask about is left to the person, with its command.
    const left = ctx.level === 'full' && d.findings.every((f) => f.verdict !== 'deny' || f.act === 'self');
    await logEvent($, c, {
      kind: 'belt',
      tool,
      verdict: 'deny',
      level: ctx.level,
      rules,
      reasons: d.findings.map((f) => maskSecrets(f.reason)),
      issues: d.issues,
      ...(left ? { left: true, what: callSummary(tool, input) } : {}),
    });
    if (left) c.leftThisTurn++;
    const command = typeof input.command === 'string' && shellOf(tool) ? input.command : null;
    return { deny: decisionText(d, ctx, { repeatCount: repeat, command }) };
  }

  if (d.verdict === 'ask') {
    const answer = await askPerson($, c, tool, d);
    await logEvent($, c, { kind: 'belt', tool, verdict: 'ask', answer, rules, reasons: d.findings.map((f) => maskSecrets(f.reason)) });
    if (answer !== 'allow') {
      const reasons = d.findings.filter((f) => f.verdict === 'ask').map((f) => `• ${f.reason} [${f.rule}]`);
      return { deny: [tIn(c.lang, answer === 'none' ? 'belt.head.noOne' : 'belt.head.declined'), ...reasons, tIn(c.lang, 'belt.tail.deny')].join('\n') };
    }
    if (typeof tool_use_id === 'string') {
      c.state = addApproval(c.state, { toolUseId: tool_use_id, at: await $.clock.now(), rules });
      await saveState($, c);
    }
  } else if (ctx.level === 'manual') {
    const shell = shellOf(tool);
    const promised = shell && typeof input.command === 'string' ? promisedIn(input.command, shell, pathEnv(c, cwd)) : [];
    if (promised.length) {
      const answer = await askManual($, c, promised, String(input.command));
      await logEvent($, c, { kind: 'manual', tool, what: promised, answer });
      if (answer !== 'allow') return { deny: tIn(c.lang, answer === 'none' ? 'manual.noOne' : 'manual.declined', { what: promisedWords(promised, c.lang) }) };
    }
  }

  // Edits frozen to one folder by the person (`/dondur`): a write named elsewhere is refused.
  if (c.state.frozen) {
    const frozen = checkFreeze(tool, input, c.state.frozen, zonesFor(c, cwd).temp, { ...pathEnv(c, cwd), env: c.env }, c.lang);
    if (frozen) {
      await logEvent($, c, { kind: 'freeze', tool, verdict: 'deny' });
      return { deny: frozen.reason };
    }
  }
  const guard = modeGuardFor(c, cwd);
  const refusal = checkGuards(tool, input, guard, c.config.modules.quota ? await quotaNow($, c) : null, classifyEnvFor(c, cwd), c.lang);
  if (refusal) {
    await logEvent($, c, { kind: refusal.kind, tool, verdict: 'deny', ...(refusal.mode ? { mode: refusal.mode, what: refusal.what } : {}) });
    return { deny: refusal.kind === 'mode' ? refusal.reason : `🛡 ${refusal.reason}` };
  }

  if (tool === 'ExitPlanMode' && c.config.modules.modes) return onExitPlanMode($, c, e, next);
  // A file Write makes anew is the session's own to remove later (src/core/provenance.ts `made`).
  const newFile = tool === 'Write' && typeof input.file_path === 'string' && (await statSize($, resolvePath(input.file_path, pathEnv(c, cwd)))) === null;
  const result = await next(e);
  // The footer counts what ran: a refused call changed nothing, and neither did a file tool that failed.
  const ran = result.deny === undefined && !(result.isError === true && isFileTool(tool));
  // What the call read came from outside the session (a page, an issue, a service): the session is tainted from now on.
  const source = ran && result.isError !== true && !c.state.tainted ? taintSource(tool, input) : null;
  if (source) {
    c.state = { ...c.state, tainted: { source, at: await $.clock.now() } };
    await saveState($, c);
  }
  if (ran && result.isError !== true) {
    const made = madePaths(tool, input, pathEnv(c, cwd), newFile);
    if (made.length) await saveProv($, c, (p) => withMade(p, made));
  }
  if (ran && e.agentId === undefined) {
    // Work left running in the background reports to this conversation: no reset until it has (busyNow).
    if ((shellOf(tool) && input.run_in_background === true) || tool === 'Monitor') c.background++;
    if (tool === 'CronCreate' || tool === 'ScheduleWakeup') c.scheduled = true;
    if (c.carried?.read) await measureReread($, c, tool, input);
  }
  if (ran && e.agentId === undefined) {
    c.turn.uses.push({ name: tool, input });
    // The turn's first change is kept at once: a session whose window is shut mid-turn still owes its note.
    if (!c.turn.changed) {
      const acts = classifyTurn([{ name: tool, input }], classifyEnvFor(c, cwd));
      if (acts.files + acts.shell + acts.settings > 0) await keepChange($, c);
    }
  }
  if (tool === 'EnterPlanMode' && ran && !result.isError) {
    c.state = { ...c.state, nativePlan: { on: true, planFile: c.state.nativePlan?.planFile ?? null, at: await $.clock.now() } };
    await saveState($, c);
    await refreshStatus($, c);
  }
  // In a restricted mode a command judged "only reads" ran: does Claude Code's own check agree? A gap is recorded.
  const dialect = shellOf(tool);
  if (dialect && guard && isRestricted(guard.mode) && ran && !result.isError && !result.isReadOnly) {
    const effects = commandEffects(String(input.command ?? ''), dialect, { ...pathEnv(c, cwd), env: c.env }).effects;
    if (strongest(effects) === 'read' && effects.length)
      await logEvent($, c, { kind: 'modeDisagree', mode: guard.mode, programs: [...new Set(effects.map((x) => x.program))].slice(0, 8) });
  }
  const extra: string[] = [];
  // Files read through the shell where Claude Code's own tool reads them: said once per tool in a session.
  const better = ran && result.isError !== true && e.agentId === undefined ? shellReadTool(tool, input) : null;
  if (better && !c.hinted.has(better)) {
    c.hinted.add(better);
    extra.push(hygieneNote(better));
    await logEvent($, c, { kind: 'hint', hint: better });
  }
  if (
    ran &&
    result.isError !== true &&
    e.agentId === undefined &&
    !c.hinted.has('whole-read') &&
    wholeRead(tool, input, typeof result.text === 'string' ? result.text.length : 0)
  ) {
    c.hinted.add('whole-read');
    extra.push(wholeReadNote());
    await logEvent($, c, { kind: 'hint', hint: 'whole-read' });
  }
  const trap = ran && e.agentId === undefined ? shellTrap(tool, input, c.platform) : null;
  if (trap && !c.hinted.has(trap)) {
    c.hinted.add(trap);
    extra.push(trapNote(trap));
    await logEvent($, c, { kind: 'hint', hint: trap });
  }
  if (ran && e.agentId === undefined) {
    const packs = await packNotes($, c, tool, input, result);
    if (packs.length) await logEvent($, c, { kind: 'hint', hint: 'pack' });
    extra.push(...packs);
  }
  if (ran && result.isError !== true && e.agentId === undefined) await workBoundary($, c, tool, input);
  if (d.verdict === 'warn' && result && result.deny === undefined) {
    await logEvent($, c, { kind: 'belt', tool, verdict: 'warn', level: ctx.level, rules, reasons: d.findings.map((f) => maskSecrets(f.reason)) });
    extra.push(decisionText(d, ctx));
  }
  // Outside content that hides text in characters nobody sees (instructions spelled in Unicode tags, reversed text):
  // the model reads it without them, and is told how many were taken out.
  if (result.deny === undefined && typeof result.text === 'string' && taintSource(tool, input)) {
    await saveProv($, c, (p) => withSeen(p, String(result.text)));
    const clean = withoutInvisible(result.text);
    if (clean.removed) {
      await logEvent($, c, { kind: 'invisible', tool, removed: clean.removed });
      return { deny: [invisibleNote(clean.removed), ...extra, clean.text].join('\n\n') };
    }
  }
  return extra.length && result.deny === undefined ? { ...result, context: [...(result.context ?? []), ...extra] } : result;
}

/**
 * A commit or a push ran: a piece of work is done, and the next starts on whatever context this one left (A7 of
 * 1.2.0). With a context of quota.resetTokens or more, autonomous work resets at the next task (src/core/reset.ts);
 * otherwise the strip says /clear would start it small, and the person types it.
 */
async function workBoundary($: $, c: Ctx, tool: string, input: Readonly<Record<string, unknown>>): Promise<void> {
  const q = c.config.quota;
  if ((!q.clearHint && !q.autoReset) || !shellOf(tool)) return;
  const kinds = gitSubcommands(String(input.command ?? '')).filter((k) => k === 'commit' || k === 'push');
  if (!kinds.length) return;
  let tokens = 0;
  try {
    tokens = (await $.session.usage()).context.tokens ?? 0;
  } catch {
    return;
  }
  if (tokens < q.resetTokens) return;
  const arm = armOnBoundary({ kinds, tokens, interaction: c.state.interaction, autoReset: q.autoReset, threshold: q.resetTokens, now: await $.clock.now() });
  // Armed, the strip says nothing yet: the hint comes only if the reset does not (the turn ends first, or it cannot).
  if (arm) c.resetArm = arm;
  else if (q.clearHint) await hintClear($, c, { kind: kinds.includes('push') ? 'push' : 'commit', tokens });
}

/** The strip's /clear hint, after a commit or a push with a large context, until the person types again. */
async function hintClear($: $, c: Ctx, at: { kind: 'commit' | 'push'; tokens: number }): Promise<void> {
  c.boundary = { kind: at.kind, tokens: at.tokens };
  await refreshStatus($, c);
}

/** The places a call that finishes a piece of work may write or read (src/core/reset.ts inCluster). */
function clusterEnvOf(c: Ctx, cwd: string) {
  const env = pathEnv(c, cwd);
  const store = c.config.memory.store?.dir;
  return { ...env, memoryDirs: [...memoryDirs(c, cwd), ...(store ? [resolvePath(store, env)] : [])], handoffDir: handoffRoot(c.config, c.layout.handoffsDir) };
}

/** Agents or background work that report to this conversation: a reset now would lose where they report. */
async function busyNow($: $, c: Ctx): Promise<boolean> {
  if (c.background > 0 || c.scheduled) return true;
  return (await agentList($)).some((a) => AT_WORK.has(a.status));
}

/**
 * The reset at a task boundary (src/core/reset.ts, docs/quota.md), at the main conversation's first call after the
 * armed commit or push that does not finish that work. The note is asked of the conversation itself and kept, what
 * is carried waits for the conversation after the /clear, and this call is refused; a timer then ends the turn, clears
 * and goes on (runReset). A reset that cannot go on leaves the conversation as it is, with the strip's hint. The
 * refusal's text, or null.
 */
async function resetAtBoundary($: $, c: Ctx, tool: string, input: Readonly<Record<string, unknown>>, cwd: string): Promise<string | null> {
  const arm = c.resetArm;
  if (!arm || c.resetting || inCluster(tool, input, clusterEnvOf(c, cwd))) return null;
  c.resetArm = null;
  const now = await $.clock.now();
  const quotaStop = c.config.modules.quota && (await quotaNow($, c)).level === 'stop';
  const v = resetVerdict({ busy: await busyNow($, c), lastResetAt: c.lastResetAt, now, quotaStop, wrapUp: c.state.wrapUp });
  if (!v.go) return noReset($, c, arm, v.why);
  let reply: Awaited<ReturnType<$['model']['fork']>>;
  try {
    reply = await $.model.fork({ prompt: forkPrompt() });
  } catch (err) {
    return noReset($, c, arm, 'fork', { reason: String((err as Error)?.message ?? err).slice(0, 120) });
  }
  if (!reply.isAnswered) return noReset($, c, arm, 'fork', { reason: reply.reason });
  const parts = parseForkParts(reply.text);
  const problems = partProblems(parts ?? {}, (t) => scanSecrets(t).length);
  if (!parts || problems.length) return noReset($, c, arm, 'note', { problems: problems.map((p) => `${p.part} ${p.kind}`) });
  const note = await handoffNote($, c, 'reset', { parts: parts as HandoffParts });
  const state = sessionStateParts(c);
  pendingCarry = {
    from: c.sessionId,
    cwd: c.state.cwd ?? pathEnv(c, cwd).cwd,
    at: now,
    state: carriedState(c.state),
    prov: await provOf($, c),
    request: c.lastPrompt,
    note: note.path,
    tokens: arm.tokens,
    resets: c.resets + 1,
    prompt: continuationPrompt({
      tokens: compact(arm.tokens, c.lang),
      note: note.text,
      path: note.path,
      state: state.length ? `[${APP_NAME}] Session state, carried over: ${state.join('; ')}.` : '',
      lang: c.lang,
    }),
  };
  c.resetting = true;
  const u = reply.usage;
  await logEvent($, c, {
    kind: 'reset',
    phase: 'start',
    tokens: arm.tokens,
    tool,
    noteChars: note.text.length,
    fork: { in: u.input_tokens, out: u.output_tokens, cached: u.cache_read_input_tokens ?? 0 },
  });
  // From a timer: the turn is ended and the command run once this hook has answered (a command run inside it is refused).
  $.clock.after(1, () => {
    void runReset($, c);
  });
  return tIn(c.lang, 'reset.deny');
}

/**
 * What the conversation after a reset read before its first change (a file written, a commit): the context at its first
 * call and at that change, logged once. A reset's real cost, and the data a threshold of a project's own would need.
 */
async function measureReread($: $, c: Ctx, tool: string, input: Readonly<Record<string, unknown>>): Promise<void> {
  const r = c.carried?.read;
  if (!r) return;
  r.calls++;
  const change = WRITES.has(tool) || (!!shellOf(tool) && gitSubcommands(String(input.command ?? '')).includes('commit'));
  if (r.first !== null && !change) return;
  let tokens = 0;
  try {
    tokens = (await $.session.usage()).context.tokens ?? 0;
  } catch {
    /* counted as nothing read */
  }
  if (r.first === null) r.first = tokens;
  if (!change) return;
  c.carried = { ...c.carried!, read: null };
  await logEvent($, c, { kind: 'resetRead', before: r.before, first: r.first, ready: tokens, calls: r.calls });
}

const WRITES: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** A reset that does not go on: why, in the activity (a failure in a toast too), and the strip's hint as at any large commit. */
async function noReset($: $, c: Ctx, arm: ResetArm, why: ResetSkip | 'fork' | 'note', extra: Record<string, unknown> = {}): Promise<null> {
  await logEvent($, c, { kind: 'reset', phase: 'skip', why, tokens: arm.tokens, ...extra });
  if (why === 'fork' || why === 'note')
    $.ui.toast(tIn(c.lang, 'reset.failed', { why: tIn(c.lang, `act.reset.why.${why}` as MessageKey) }), { timeoutMs: TOAST_MS.result });
  if (c.config.quota.clearHint) await hintClear($, c, arm);
  return null;
}

/**
 * The reset's steps once the call is refused: the turn ends, the conversation clears (its end writes no other note and
 * keeps the flow going), and the work goes on with the prompt the new conversation takes up with what was carried
 * (afterClear). A /clear that fails goes on here instead, as the turn was ended for it.
 */
async function runReset($: $, c: Ctx): Promise<void> {
  const carry = pendingCarry;
  if (c.turnId !== null) await $.turn.abort({ turnId: c.turnId }).catch(() => undefined);
  try {
    await $.command.run({ command: 'clear' });
  } catch (err) {
    pendingCarry = null;
    c.resetting = false;
    await logEvent($, c, { kind: 'reset', phase: 'skip', why: 'clear', detail: String((err as Error)?.message ?? err).slice(0, 200) });
    const why = tIn(c.lang, 'act.reset.why.clear');
    $.ui.toast(tIn(c.lang, 'reset.failed', { why }), { timeoutMs: TOAST_MS.result });
    const text = tIn(c.lang, 'reset.goOn', { why });
    c.selfSent = text;
    await $.prompt.submit({ text }).catch(() => undefined);
    return;
  }
  // The conversation it cleared to takes up what was carried at once, whichever hook its prompt reaches (afterClear).
  await ctxOf($).catch(() => undefined);
  if (carry)
    await $.prompt.submit({ text: carry.prompt }).catch((err: unknown) => $.ui.toast(`${APP_NAME}: ${String((err as Error)?.message ?? err).slice(0, 300)}`));
}

async function onPromptSubmit($: $, e: In<'prompt.submit'>, next: Nx<'prompt.submit'>): Out<'prompt.submit'> {
  const c = await promptCtx($);
  const kind = e.origin?.kind;
  // Typing at the prompt: the keyboard has left the strip, and the card of the control it was on goes.
  if (kind === 'composer') await update($, stripFocusAtom, (x) => (x.id ? { id: null, at: x.at } : x)).catch(() => undefined);
  // The person's own prompts, and this plugin's resume prompt (which ends with their continue keyword).
  const ours = kind === 'plugin' && (e.origin as { name?: string }).name === PLUGIN_NAME;
  const human = kind === 'composer' || kind === 'bridge' || kind === 'sdk' || ours;
  // A text this plugin sent for the person was applied when it was sent (sendAsPerson): a start it asked for stands.
  const applied = ours && c.selfSent !== null && String(e.text ?? '') === c.selfSent;
  if (ours) c.selfSent = null;
  // The prompt a reset started this conversation with (src/core/reset.ts): Mode_Code's, so no keyword is read in its note.
  const resumed = ours && c.carried?.prompt != null && String(e.text ?? '') === c.carried.prompt;
  if (resumed) c.carried = { ...c.carried!, prompt: null };
  // Background work reported back: a reset need not wait for it any more.
  if (kind === 'task-notification' && c.background > 0) c.background--;
  // Another session's message is outside content: the session is tainted from now on (src/core/taint.ts).
  if (kind === 'peer' && !c.state.tainted) {
    c.state = { ...c.state, tainted: { source: 'peer', at: await $.clock.now() } };
    await saveState($, c);
  }
  const extra: string[] = [];
  // What Mode_Code adds by itself, kept small together at a session's start (core/guidance.ts capStart).
  const byItself = new Set<string>();
  const own = (notes: readonly string[]) => {
    for (const n of notes) byItself.add(n);
    return notes;
  };
  // Strip presses not told yet go with this prompt, before its own keyword's note.
  if (human) extra.push(...takePressNotes(c), ...own(c.startNotes.splice(0)));
  // The session's first note: what Claude should know of this tool before anything happens (K12 of 1.2.0).
  const starting = human && c.introDue;
  if (starting) {
    c.introDue = false;
    extra.unshift(...own([introNote({ packs: true, modes: c.config.modules.modes })]));
  }
  if (human) {
    c.turn = { startedAt: await $.clock.now(), uses: [], changed: false };
    c.leftThisTurn = 0;
    // The person has typed what comes next: the /clear moment has passed, and the reset's with it.
    c.boundary = null;
    c.resetArm = null;
    c.prompts++;
    if (kind !== 'plugin') c.lastPrompt = maskSecrets(String(e.text ?? '')).slice(0, 2000);
    // What the person wrote is their evidence for what a call acts on; what they pasted is not (src/core/provenance.ts).
    if (kind !== 'plugin') {
      const pastes = c.pastes.splice(0);
      const first = (await provOf($, c)).start.length === 0 && (await provOf($, c)).said.length === 0;
      const listed = first ? await gitIn($, await $.session.cwd(), ['remote', '-v'], 5000) : null;
      const remotes = listed?.ok ? listed.out : null;
      await saveProv($, c, (p) => withSaid(remotes ? withStart(p, remotes) : p, typedText(String(e.text ?? ''), pastes)));
    }
    await refreshConfig($, c);
    await syncPermissionMode($, c);
    // A mode given for one turn ends with it.
    if (c.state.turnMode) c.state = { ...c.state, turnMode: null };
    await heartbeat($, c);
    extra.push(...own(await sameFolderNotes($, c)));
  }
  let flowSaid = false;
  // The first prompt after the session took up the folder's last choice: the model is told what holds,
  // once this prompt's own keyword is applied (the note goes first; a "continue" states it itself).
  const restoredAt = human && c.restored ? extra.length : -1;
  if (restoredAt >= 0) c.restored = false;
  let said: KeywordKind | null = null;
  let typed = String(e.text ?? '');
  // A key or token pasted into the message has gone to the model's provider with it: the person is told so, and the
  // model is told not to spread it further (A3-9). The kinds only, never the value.
  if (human && kind !== 'plugin' && c.config.modules.secrets) {
    const kinds = [
      ...new Set(
        scanSecrets(typed)
          .filter((m) => m.confidence === 'high')
          .map((m) => m.kind),
      ),
    ];
    if (kinds.length) {
      $.ui.toast(tIn(c.lang, 'secrets.inPrompt', { kinds: kinds.join(', ') }), { timeoutMs: 15_000 });
      extra.push(promptSecretNote(kinds));
    }
  }
  // A word of the person's that names a pack's work: a one-line hint, once per pack in a session (docs/packs.md).
  if (human && kind !== 'plugin') for (const p of packsInWords(typed)) extra.push(...own(packHintOnce(c, p, 'words')));
  // A keyword typed with a slash in front (`/akış iptal`) is that keyword; the person is told how it was read.
  if (human && kind !== 'plugin' && c.config.modules.keywords) {
    const bare = withoutSlash(typed, projectRefs(c.config), keywordTables(c.config));
    if (bare !== null) {
      $.ui.toast(tIn(c.lang, 'kw.slashTaken', { typed: typed.trim(), keyword: bare }));
      typed = bare;
    }
  }
  // `/6` without a task: the person's next own message is the task, unless it is a keyword itself.
  if (human && kind !== 'plugin' && c.armed) {
    const a = c.armed;
    c.armed = null;
    if (!detectKeyword(typed, projectRefs(c.config), keywordTables(c.config))) typed = `${typed}\n\n${flowPhrase(a.variant, c.lang)}`;
  }
  if (human && !applied && !resumed && (c.config.modules.keywords || typed !== String(e.text ?? ''))) {
    const turn = await keywordTurn($, c, typed);
    extra.push(...turn.context);
    flowSaid = turn.flow;
    said = turn.kind;
  }
  // One typo from a keyword: never applied, offered (the person, 2026-10-15: "others will make it too").
  if (human && kind !== 'plugin' && said === null && c.config.modules.keywords) {
    const near = nearKeyword(typed, keywordTables(c.config));
    if (near) {
      const keyword = nearLabel(near);
      $.ui.toast(tIn(c.lang, 'kw.didYouMean', { typed: typed.trim().slice(0, 60), keyword }), { timeoutMs: 10_000 });
      extra.push(nearKeywordNote(keyword));
    }
  }
  if (restoredAt >= 0 && said !== 'continue' && said !== 'manual') {
    const cwd = await $.session.cwd();
    extra.splice(restoredAt, 0, restoredContext(c.state.mode, c.state.interaction, workRoot(c, cwd)));
  }
  if (human) c.pendingContinue = null;
  // While a flow runs, every prompt carries where it stands (short), unless a flow keyword just said more.
  const running = flowRunning(c);
  if (human && running && !flowSaid && c.config.modules.modes) extra.push(flowTurnContext(running, c.lang, stepTexts(c, running)));
  // Full autonomy: every prompt carries what it means, and the project's own definition of done.
  if (human && c.state.interaction === 'full') {
    extra.push(...own([fullTurnNote()]));
    const verify = c.config.projects.find((p) => p.id === c.state.project)?.verify ?? [];
    if (verify.length) extra.push(...own([verifyNote(verify)]));
  }
  if (human) {
    try {
      const kw = c.config.modules.keywords ? detectKeyword(String(e.text ?? ''), projectRefs(c.config), keywordTables(c.config)) : null;
      // Wrapping up includes the handoff note: the tool is there, and Claude is told to write it.
      if (kw?.kind === 'wrapUp' && c.config.memory.handoff.enabled) {
        await registerHandoffTool($);
        extra.push(handoffAskContext(true));
      }
      // A lesson from the session, offered at its wrap-up when there is a memory to keep it in.
      if (kw?.kind === 'wrapUp' && memorySetUp(c.config)) extra.push(lessonNote());
      extra.push(...(await memoryPromptContext($, c, kw, own)));
    } catch {
      /* the memory's notes are a help, never a reason for a prompt not to go through */
    }
  }
  // Parallel agents: what the person set, told with this prompt; an assigned mode takes it as its batch.
  if (human) {
    try {
      extra.push(...(await agentsOnPrompt($, c, String(e.text ?? ''))));
    } catch {
      /* the strip still shows it; the next prompt tells */
    }
  }
  if (human) await refreshStatus($, c);
  extra.push(...(await quotaContext($, c)));
  const notes = human && (c.prompts === 1 || starting) ? capStart(extra, (n) => byItself.has(n)) : extra;
  if (notes !== extra && notes.join('').length < extra.join('').length)
    await logEvent($, c, { kind: 'startCap', before: extra.join('').length, after: notes.join('').length });
  // What went to Claude unseen with the prompt is no invisible work: its count is in the activity.
  if (human && notes.length) await logEvent($, c, { kind: 'notes', count: notes.length, chars: notes.join('').length });
  return notes.length ? next({ ...e, context: [...(e.context ?? []), ...notes] }) : next(e);
}

/**
 * Claude Code's permission mode as the safety-net hook last recorded it (Claude Code hands it to hooks, not
 * to plugins): the exact source of whether its plan mode is on, when it is newer than what the plugin saw.
 */
async function syncPermissionMode($: $, c: Ctx): Promise<void> {
  const path = sessionFile(c.layout, c.sessionId, 'hook');
  if (!path) return;
  const h = parseHookState(await readFile($, path), c.sessionId);
  if (!h.permissionMode || h.permissionModeAt <= (c.state.nativePlan?.at ?? 0)) return;
  c.state = { ...c.state, nativePlan: { on: h.permissionMode === 'plan', planFile: c.state.nativePlan?.planFile ?? null, at: h.permissionModeAt } };
}

/** Detects a keyword in the person's prompt, applies it to the session, and returns the context it adds. */
async function keywordTurn($: $, c: Ctx, text: string): Promise<{ context: string[]; flow: boolean; kind: KeywordKind | null }> {
  const kw: KeywordMatch | null = detectKeyword(text, projectRefs(c.config), keywordTables(c.config));
  if (!kw) return { context: [], flow: false, kind: null };
  return { ...(await applyKeywordTurn($, c, kw, text)), kind: kw.kind };
}

/**
 * Applies a keyword to the session and returns the context it adds: one typed, or one a slash command or a
 * press on the strip stands for (see actionKeyword), so all three do exactly the same.
 */
async function applyKeywordTurn($: $, c: Ctx, given: KeywordMatch, text: string): Promise<{ context: string[]; flow: boolean }> {
  let kw = given;
  // "continue" just after `/devam` chose a folder that is not a registered project: that folder's work.
  const folder = kw.kind === 'continue' && kw.project === undefined ? c.pendingContinue : null;
  c.pendingContinue = null;
  if (folder) kw = { ...kw, project: folder.key };
  const modes = c.config.modules.modes;
  if (!modes && (isModeKeyword(kw.kind) || kw.kind === 'flow' || kw.kind === 'approve')) return { context: [], flow: false };
  const now = await $.clock.now();
  const budget = kw.kind === 'quota' ? { n: kw.n ?? 0, plus: kw.plus ?? false } : kw.budget;
  const target = budget ? weeklyTargetFrom(budget, c.reading, now) : null;
  const running = flowRunning(c);
  // A mode keyword typed alone while a flow runs is the person's explicit choice: the flow pauses at its step.
  let pausedFor: string | null = null;
  if (running && isModeKeyword(kw.kind) && kw.standalone) {
    pausedFor = stepName(currentStep(running)!.kind, c.lang);
    await pauseAttached($, c, 'mode');
  }
  const wasFull = c.state.interaction === 'full';
  c.state = applyKeyword(c.state, kw, target);
  // Full autonomy chosen for the first time on this computer: what it means, once (docs/autonomy.md).
  if (!wasFull && c.state.interaction === 'full') await fullCardOnce($, c);
  if (kw.kind === 'continue' || kw.kind === 'manual') c.state = { ...c.state, resumeAt: null };
  if (kw.kind === 'stop' || kw.kind === 'wrapUp') {
    c.resumeTimer?.cancel();
    c.resumeTimer = null;
    if (running) await pauseAttached($, c, kw.kind);
  }
  if (kw.kind === 'continue' || kw.kind === 'quota') c.announced = 'ok';
  await saveState($, c);
  await logEvent($, c, { kind: 'keyword', keyword: kw.kind, project: kw.project ?? null, n: kw.n ?? null, ...(kw.flow ? { flow: kw.flow } : {}) });

  if (kw.kind === 'flow') return { context: await flowKeyword($, c, kw, text), flow: true };
  if (kw.kind === 'approve') return { context: await approveKeyword($, c), flow: true };
  // "<project> handoff": Claude writes the note's four parts through the handoff tool (docs/memory.md).
  if (kw.kind === 'handoff') {
    if (!c.config.memory.handoff.enabled) {
      $.ui.toast(tIn(c.lang, 'mod.handoff.off'));
      return { context: [], flow: false };
    }
    await registerHandoffTool($);
    $.ui.toast(tIn(c.lang, 'kw.toast', { kind: tIn(c.lang, 'kw.kind.handoff'), project: kw.project ? ` · ${kw.project}` : '' }));
    return { context: [handoffAskContext(false)], flow: false };
  }

  const label = kw.project ? (c.config.projects.find((p) => p.id === kw.project)?.names[0] ?? folder?.label ?? kw.project) : null;
  const kindLabel = tIn(c.lang, `kw.kind.${kw.kind}` as MessageKey);
  // A command's own output row says what changed; a typed keyword is confirmed by a toast.
  if (!kw.via)
    $.ui.toast(
      kw.project === null && kw.projectText
        ? tIn(c.lang, 'kw.toast.unknownProject', { kind: kindLabel, text: kw.projectText })
        : tIn(c.lang, 'kw.toast', { kind: kindLabel, project: label ? ` · ${label}` : '' }),
    );
  const cwd = await $.session.cwd();
  const context = keywordContext(kw, c.state, await quotaNow($, c), label, {
    workDir: workRoot(c, cwd),
    strip: modes,
    flow: running && isModeKeyword(kw.kind) ? { step: pausedFor ?? stepName(currentStep(running)!.kind, c.lang), paused: pausedFor !== null } : null,
  });
  if (folder) context.push(continueFolderContext(folder.folder, pathKey(folder.folder, c.platform) === pathKey(resolvePath(cwd, pathEnv(c, cwd)), c.platform)));
  // "Continue" resumes a paused flow: the one attached, or the project's or this folder's from an earlier session.
  if (modes && (kw.kind === 'continue' || kw.kind === 'manual')) {
    const resumed = await resumeFor($, c, kw.project ?? c.state.project, cwd);
    if (resumed) return { context: [...context, resumed], flow: true };
  }
  if (modes && kw.kind === 'status' && c.flow) context.push(`${stepsLine(c.flow, c.lang)} (${tIn(c.lang, `flow.status.${c.flow.status}` as MessageKey)})`);
  return { context, flow: false };
}

async function pauseAttached($: $, c: Ctx, reason: string): Promise<void> {
  if (!c.flow) return;
  const r = pauseFlow(c.flow, reason, await $.clock.now());
  if (!r.ok) return;
  await saveFlow($, c, r.flow);
  await flowEvent($, c, r.flow, 'pause', { reason });
  $.ui.toast(tIn(c.lang, 'flow.toast.paused', { step: stepName(currentStep(r.flow)?.kind ?? 'research', c.lang), cont: tIn(c.lang, 'kw.kind.continue') }));
}

/** Resumes the attached paused flow, or picks up the project's or this folder's; the context it adds, or null. */
async function resumeFor($: $, c: Ctx, project: string | null, cwd: string): Promise<string | null> {
  let f: Flow | null = c.flow && c.flow.status === 'paused' ? c.flow : null;
  if (!f && !c.flow) f = await flowToResume($, c, project, cwd);
  if (!f || (f.status !== 'paused' && f.sessionId === c.sessionId)) return null;
  if (await heldElsewhere($, c, f)) {
    $.ui.toast(tIn(c.lang, 'flow.toast.held'));
    return null;
  }
  const r = resumeFlow(f, c.sessionId, await $.clock.now());
  if (!r.ok) return null;
  await saveFlow($, c, r.flow);
  await flowEvent($, c, r.flow, 'resume');
  $.ui.toast(tIn(c.lang, 'flow.toast.resumed', { step: stepName(currentStep(r.flow)?.kind ?? 'research', c.lang) }));
  return flowResumeContext(r.flow, c.lang, stepTexts(c, r.flow));
}

/** A keyword as the person types it, in its own language: "akış iptal", "tam otonom", "serbest". */
function nearLabel(k: NearKeyword): string {
  const w = (key: string) => tIn(k.lang, key as MessageKey);
  if (k.kind === 'flow') {
    if (k.flow === 'cancel') return w('flow.word.cancel');
    const extra = k.flow === 'plan' ? 'kw.kind.plan' : k.flow === 'research' ? 'kw.kind.research' : null;
    return extra ? `${w('kw.kind.flow')} ${w(extra)}` : w('kw.kind.flow');
  }
  if (k.kind === 'fullAuto' && k.auto === 'cancel') return `${w('kw.kind.fullAuto')} ${w('kw.word.cancel')}`;
  return w(`kw.kind.${k.kind}`);
}

/** "flow", "flow plan", "flow research", "flow cancel". */
async function flowKeyword($: $, c: Ctx, kw: KeywordMatch, text: string): Promise<string[]> {
  const now = await $.clock.now();
  if (kw.flow === 'cancel') {
    if (!c.flow) {
      $.ui.toast(tIn(c.lang, 'flow.toast.noFlow'));
      return [];
    }
    const r = cancelFlow(c.flow, now);
    const f = r.flow;
    await saveFlow($, c, f);
    await flowEvent($, c, f, 'cancel');
    $.ui.toast(tIn(c.lang, 'flow.toast.canceled'));
    return [flowNote('canceled', f, c.lang, stepTexts(c, f))];
  }
  if (c.flow) {
    $.ui.toast(tIn(c.lang, 'flow.toast.running', { step: stepName(currentStep(c.flow)?.kind ?? 'research', c.lang), cancel: tIn(c.lang, 'flow.word.cancel') }));
    return [];
  }
  const cwd = await $.session.cwd();
  const taken = new Set<string>();
  try {
    for (const e of await $.fs.list(c.layout.flowsDir)) taken.add(e.name);
  } catch {
    /* no flows yet */
  }
  const task = messageWithoutKeyword(text);
  const f = startFlow({
    id: flowId(task, now, taken),
    variant: (kw.flow ?? 'full') as StartableFlow,
    task,
    project: c.state.project,
    cwd: resolvePath(cwd, pathEnv(c, cwd)),
    sessionId: c.sessionId,
    workDir: workRoot(c, cwd),
    now,
  });
  await saveFlow($, c, f);
  await flowEvent($, c, f, 'start', { variant: f.variant });
  $.ui.toast(tIn(c.lang, 'flow.toast.start', { steps: stepsLine(f, c.lang) }));
  return [flowStartContext(f, c.lang, stepTexts(c, f))];
}

/** "approve" typed alone: the plan waiting for approval is approved, if it still passes its check. */
async function approveKeyword($: $, c: Ctx): Promise<string[]> {
  const f = c.flow;
  if (!f || currentStep(f)?.kind !== 'approve') {
    $.ui.toast(tIn(c.lang, f ? 'flow.toast.notWaiting' : 'flow.toast.noFlow'));
    return [];
  }
  const resumed = f.status === 'paused' ? resumeFlow(f, c.sessionId, await $.clock.now()) : null;
  const r = await approveNow($, c, resumed?.ok ? resumed.flow : f, 'keyword');
  if (!r.ok) {
    if ('problems' in r) return [problemsText(c, stepName('plan', c.lang), r.problems, planPathOf(c, f))];
    return [];
  }
  return [flowNote('approved', r.flow, c.lang, stepTexts(c, r.flow))];
}

async function onMeasure($: $, e: In<'session.measure'>, next: Nx<'session.measure'>): Out<'session.measure'> {
  const c = await ctxOf($);
  if (Array.isArray(e.rateLimits) && e.rateLimits.length) {
    const now = await $.clock.now();
    c.reading = fromModRateLimits(e.rateLimits, now);
    try {
      await $.fs.write(c.layout.quota, JSON.stringify(c.reading) + '\n');
    } catch {
      /* the control center shows the last reading it has */
    }
    // The history the quota screen draws: one point each time a window moved (Claude Code raises this per whole point).
    if (Array.isArray(e.changed) && e.changed.includes('rateLimits')) {
      const f = c.reading.windows.find((w) => w.kind === 'five_hour');
      const w = c.reading.windows.find((x) => x.kind === 'seven_day');
      await logEvent($, c, {
        kind: 'reading',
        five: f?.used ?? null,
        week: w?.used ?? null,
        fiveResetsAt: f?.resetsAt ?? null,
        weekResetsAt: w?.resetsAt ?? null,
      });
    }
    if (c.config.modules.quota) await quotaGuard($, c);
  }
  await refreshStatus($, c);
  return next(e);
}

async function quotaGuard($: $, c: Ctx): Promise<void> {
  const q = await quotaNow($, c);
  if (q.level === c.announced) return;
  c.announced = q.level;
  if (q.level === 'ok') return;
  const r = q.reasons.find((x) => x.level === q.level) ?? q.reasons[0];
  const window = r ? tIn(c.lang, r.window === 'five_hour' ? 'quota.window.five_hour' : 'quota.window.seven_day') : '';
  $.ui.toast(tIn(c.lang, q.level === 'stop' ? 'quota.toast.stop' : 'quota.toast.wrapUp', { window, used: r?.used ?? 0 }), { timeoutMs: 8000 });
  c.state = { ...c.state, wrapUp: true };
  if (q.level === 'stop' && q.resumeAt && (c.state.interaction === 'autonomous' || c.state.interaction === 'full') && c.config.quota.autoResume) {
    c.state = { ...c.state, resumeAt: q.resumeAt + 60_000 };
    await scheduleResume($, c);
  }
  await saveState($, c);
  await logEvent($, c, { kind: 'quota', level: q.level, reasons: q.reasons, resumeAt: c.state.resumeAt });
  if (c.config.modules.notifications) {
    try {
      await $.ui.notify(tIn(c.lang, q.level === 'stop' ? 'quota.toast.stop' : 'quota.toast.wrapUp', { window, used: r?.used ?? 0 }), { title: APP_NAME });
    } catch {
      /* notifications are a convenience */
    }
  }
}

async function scheduleResume($: $, c: Ctx): Promise<void> {
  c.resumeTimer?.cancel();
  c.resumeTimer = null;
  const at = c.state.resumeAt;
  if (!at) return;
  const wait = Math.max(1000, at - (await $.clock.now()));
  c.resumeTimer = $.clock.after(wait, () => {
    void resume($);
  });
}

async function resume($: $): Promise<void> {
  const c = await ctxOf($);
  c.resumeTimer = null;
  if (!c.state.resumeAt) return;
  // A plan waiting for approval is the person's to move: tell them instead of resuming.
  if (c.flow?.status === 'waiting') {
    c.state = { ...c.state, resumeAt: null };
    await saveState($, c);
    if (c.config.modules.notifications) {
      try {
        await $.ui.notify(tIn(c.lang, 'flow.notify.waiting', { task: c.flow.task || c.flow.id }), { title: APP_NAME });
      } catch {
        /* ignore */
      }
    }
    return;
  }
  c.state = { ...c.state, resumeAt: null, wrapUp: false };
  c.announced = 'ok';
  await saveState($, c);
  await logEvent($, c, { kind: 'resume', project: c.state.project });
  if (c.config.modules.notifications) {
    try {
      await $.ui.notify(tIn(c.lang, 'quota.notify.resume'), { title: APP_NAME });
    } catch {
      /* ignore */
    }
  }
  const label = c.state.project ? (c.config.projects.find((p) => p.id === c.state.project)?.names[0] ?? c.state.project) : null;
  await $.prompt.submit({ text: resumePrompt(label, c.lang) });
}

async function memoryStatusFor($: $, c: Ctx, cwd: string): Promise<MemoryStatus> {
  let any = false;
  let dirty = 0;
  let ahead = 0;
  let unknown = false;
  let noUpstream = false;
  let pushed = false;
  for (const dir of memoryDirs(c, cwd)) {
    const inside = await runGit($, dir, ['rev-parse', '--is-inside-work-tree']);
    if (!inside.ok || inside.out !== 'true') continue;
    any = true;
    const st = await runGit($, dir, ['status', '--porcelain=v1']);
    dirty += st.ok ? st.out.split('\n').filter(Boolean).length : 0;
    const up = await runGit($, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!up.ok || !up.out) noUpstream = true;
    else {
      const ah = await runGit($, dir, ['rev-list', '--count', '@{upstream}..HEAD']);
      if (ah.ok && /^\d+$/.test(ah.out)) ahead += parseInt(ah.out, 10);
      else unknown = true;
    }
    const ht = await runGit($, dir, ['log', '-1', '--format=%ct']);
    if (ht.ok && c.turn.startedAt !== null && /^\d+$/.test(ht.out) && parseInt(ht.out, 10) * 1000 >= c.turn.startedAt - 1000) pushed = true;
  }
  if (!any) return { state: null };
  if (dirty) return { state: 'dirty', count: dirty };
  if (ahead) return { state: 'ahead', count: ahead };
  if (unknown) return { state: 'unknown' };
  if (noUpstream) return { state: 'noUpstream' };
  return { state: pushed ? 'pushed' : 'unchanged' };
}

/** A change in this turn: when, and what a note would be written from should the window be shut (closedNotes), kept at once. */
async function keepChange($: $, c: Ctx): Promise<void> {
  c.changedAt = await $.clock.now();
  c.turn.changed = true;
  try {
    if (!c.state.work?.project && c.config.memory.handoff.enabled) {
      const p = await projectOfSession($, c);
      c.state = { ...c.state, work: { startedAt: c.startedAt, changedAt: c.changedAt, handoffAt: c.handoffAt, project: p.key, request: c.lastPrompt } };
    }
    await saveState($, c);
  } catch {
    /* kept with the next save */
  }
}

async function onTurnComplete($: $, e: In<'turn.complete'>, next: Nx<'turn.complete'>): Out<'turn.complete'> {
  const result = await next(e);
  if (e.agentId !== undefined) {
    // An agent ended its turn: an assigned batch may be done, and the strip's count changed (its status settles a moment later).
    try {
      const c = await ctxOf($);
      if (c.config.agents.enabled && c.state.agents.mode !== 'off')
        $.clock.after(1500, () => {
          void (c.state.agents.mode === 'assigned' ? agentsCheck($, c) : refreshStatus($, c)).catch(() => undefined);
        });
    } catch {
      /* the next prompt checks */
    }
    return result;
  }
  const c = await ctxOf($);
  try {
    await agentsCheck($, c);
  } catch {
    /* the next prompt checks */
  }
  if (c.turnId === e.turnId) c.turnId = null;
  // The turn ended by itself after an armed commit: the person is waited for, so no reset; the strip says /clear.
  if (c.resetArm && !c.resetting) {
    const arm = c.resetArm;
    c.resetArm = null;
    if (c.config.quota.clearHint) await hintClear($, c, arm);
  }
  // The turn is over, so none of its calls runs any more; Mo shows how it ended for a few seconds.
  c.mo = { ...c.mo, tools: 0, agents: 0, asking: 0 };
  await moMark($, c, e.reason === 'answer' ? 'doneAt' : e.reason === 'error' ? 'errorAt' : 'stoppedAt');
  const flag = flagOfTurn(e);
  if (flag) await explainFlag($, c, flag, e.reason === 'refusal' ? 'refusal' : 'error');
  if (e.reason !== 'answer') return result;
  try {
    const cwdNow = await $.session.cwd();
    const acts = classifyTurn(c.turn.uses, classifyEnvFor(c, cwdNow));
    if (acts.files + acts.shell + acts.settings > 0) await keepChange($, c);
    await memorySync($, c, 'turn');
    await sharedSync($, c, 'turn');
  } catch {
    /* the next turn or session syncs again */
  }
  // Full autonomy: the turn is over, done, or with steps left to the person; they hear it, away from the computer too.
  if (c.state.interaction === 'full') {
    const task = maskSecrets((c.lastPrompt ?? '').split('\n')[0]!.slice(0, 120));
    await notifyPerson($, c, c.leftThisTurn ? tIn(c.lang, 'full.notify.waiting', { n: c.leftThisTurn, task }) : tIn(c.lang, 'full.notify.done', { task }));
  }
  if (!c.config.modules.footer || c.config.footer.mode !== 'draw') return result;
  const cwd = await $.session.cwd();
  const q = await quotaNow($, c);
  const footer = buildFooter(
    {
      memory: await memoryStatusFor($, c, cwd),
      acts: classifyTurn(c.turn.uses, classifyEnvFor(c, cwd)),
      five: q.usable ? (q.five?.used ?? null) : null,
      week: q.usable ? (q.week?.used ?? null) : null,
      weeklyTarget: c.state.weeklyTarget,
      showFiveFrom: c.config.footer.showFiveFrom,
      showWeekFrom: c.config.footer.showWeekFrom,
    },
    c.lang,
  );
  // Drawn under the answer by the AssistantMessage render hook: part of the drawing, never of the transcript the model reads.
  const key = textKey(e.answer);
  await update($, footersAtom, (m) => {
    const next: ModeCodeFooters = { ...m, [key]: footer.lines };
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete next[k];
    return next;
  });
  return result;
}

// ── when Anthropic's safeguards stop an answer (src/core/flagged.ts) ──

/**
 * Says what stopped the answer and the three ways on, under it, as a notice the model never reads (so it neither
 * costs context nor goes to the classifier again); the activity keeps it, and in full autonomy the person, away,
 * is told the work waits. Nothing else is done: the model stays the person's to pick. The two ways the same stop
 * comes (the turn's end, Claude Code's StopFailure) lead here, and the second, seconds later, is not said again.
 */
async function explainFlag($: $, c: Ctx, flag: Flag, via: 'refusal' | 'error' | 'stopFailure'): Promise<void> {
  const now = await $.clock.now();
  if (now - c.flagSaidAt < 15_000) return;
  c.flagSaidAt = now;
  try {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: flagLines(flag, c.lang).join('\n') }] } });
  } catch {
    /* the activity has it */
  }
  await logEvent($, c, { kind: 'flagged', category: flag.category, model: flag.model, via });
  // Nobody may be at the keyboard in full autonomy: the stop is said where they are.
  if (c.state.interaction === 'full') await notifyPerson($, c, tIn(c.lang, 'full.notify.flagged'));
}

/** Claude Code's StopFailure: an API error ended the turn. Its text is the flag's when the safeguards stopped it. */
async function onStopFailure($: $, e: In<'classic.StopFailure'>, next: Nx<'classic.StopFailure'>): Out<'classic.StopFailure'> {
  const result = await next(e);
  try {
    const flag = flagInText(e.last_assistant_message) ?? flagInText(e.error_details);
    if (flag) await explainFlag($, await ctxOf($), flag, 'stopFailure');
  } catch {
    /* the turn's end says it, or nothing is lost but the words */
  }
  return result;
}

/** The tool the model finishes a flow's step with. In the prompt's tool list from the start (no search first). */
const FLOW_TOOL = {
  name: 'flow_step',
  description: `Finishes the current step of a ${APP_NAME} flow (research ▶ plan → approval → code): code checks the step and answers what is missing or what comes next. Call it only while a flow runs and the step is complete; "status" shows the flow.`,
  inputSchema: {
    type: 'object',
    properties: { step: { type: 'string', enum: ['research', 'plan', 'code', 'status'], description: 'The step being finished, or status.' } },
    required: ['step'],
    additionalProperties: false,
  },
  isDeferred: false,
} as const;

// ── skills (docs/skills.md) ──

/** `mode-code …` run for this session's folder: its JSON answer, or null when the program is not there. */
async function centerCli($: $, c: Ctx, args: string[]): Promise<Record<string, unknown> | null> {
  try {
    const program = centerProgram(await readFile($, c.layout.manifest));
    if (!program) return null;
    const cwd = await $.session.cwd();
    const r = await $.process.run([...program, ...args], { cwd, timeoutMs: 60_000 });
    const o = JSON.parse(r.stdout) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The short commands of the person's skills by name, in both languages' reach: a name typed is taken as it is. */
const SHORT_COMMANDS = new Map(CORE_SKILLS.filter((s) => s.who === 'person').map((s) => [s.tr, s]));

/** A short command: a keyword's (sent as the person's word), one of Claude Code's own, or a skill (run as if typed). */
async function shortCommand($: $, skill: CoreSkill, args: string): Promise<{ text: string }> {
  const c = await ctxOf($);
  if (skill.kind === 'keyword' && skill.keyword) {
    const word = keywordTables(c.config)[c.lang][skill.keyword][0] ?? skill.id;
    const notes = await sendAsPerson($, c, args ? `${args} ${word}` : word);
    if (notes.length) await appendNotes($, notes);
    return { text: '' };
  }
  if (skill.kind === 'builtin' && skill.builtin) {
    // One of Claude Code's own commands, run a moment after this command's hook, which the run would otherwise wait on.
    const name = skill.builtin;
    $.clock.after(1, () => {
      $.command.run({ command: name, args } as never).catch(() => $.ui.toast(tIn(c.lang, 'skill.builtinFailed', { command: `/${name}` })));
    });
    return { text: tIn(c.lang, 'skill.builtin', { command: `/${name}` }) };
  }
  // The skill's own text, sent as the person's message: what `/mode-code:<skill>` does, measured in the real engine
  // (a command run from a plugin's hook does not reach a skill there). Its arguments go where the skill names them.
  const dir = joinPath($.plugin.root, 'skills', skill.id);
  const text = await readFile($, joinPath(dir, 'SKILL.md'));
  if (!text) return { text: tIn(c.lang, 'skill.missing', { skill: `/${PLUGIN_NAME}:${skill.id}` }) };
  // The skill's folder, as Claude Code fills it in a skill it loads (its scripts are run from there).
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/\$ARGUMENTS/g, args.trim() || '-')
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, dir)
    .trim();
  const prompt = `${skillRunPreamble(skill.id, skill.tr)}\n\n${body}`;
  c.selfSent = prompt;
  if (!c.skillsUsed.has(`${PLUGIN_NAME}:${skill.id}`)) {
    c.skillsUsed.add(`${PLUGIN_NAME}:${skill.id}`);
    await logEvent($, c, { kind: 'skill', skill: `${PLUGIN_NAME}:${skill.id}`, via: 'short' });
  }
  $.clock.after(1, () => {
    $.prompt.submit({ text: prompt, asUser: true }).catch((err: unknown) => $.ui.toast(`${APP_NAME}: ${String((err as Error)?.message ?? err).slice(0, 300)}`));
  });
  return { text: tIn(c.lang, 'skill.running', { skill: `/${PLUGIN_NAME}:${skill.id}` }) };
}

/** Every keyword, command and skill in the person's language, and how to run each. */
async function commandsList($: $): Promise<string> {
  const c = await ctxOf($);
  const lang = c.lang;
  const table = keywordTables(c.config)[lang];
  const own = (who: 'person' | 'model') =>
    CORE_SKILLS.filter((s) => s.who === who && (s.managed !== 'memory' || c.config.memory.store !== null || c.config.memory.dirs.length > 0)).map((s) => ({
      name: lang === 'tr' && who === 'person' ? `/${s.tr}` : s.kind === 'skill' ? `/${PLUGIN_NAME}:${s.id}` : `/${s.tr}`,
      text: tIn(lang, `skill.short.${s.id}` as MessageKey),
    }));
  return commandsText(
    [
      { head: tIn(lang, 'cmds.head.keywords'), rows: KEYWORD_LISTS.map((k) => ({ name: table[k][0] ?? k, text: table[k].slice(1, 4).join(' · ') })) },
      {
        head: tIn(lang, 'cmds.head.commands'),
        rows: COMMANDS.filter((x) => !/^\d+$/.test(x.name) || x.name.length === 1).map((x) => ({
          name: `/${x.name}`,
          text: commandDescription(x.action, lang),
        })),
      },
      { head: tIn(lang, 'cmds.head.skills'), rows: own('person') },
      { head: tIn(lang, 'cmds.head.claude'), rows: own('model') },
      {
        head: tIn(lang, 'cmds.head.others'),
        rows: Object.entries(c.config.skills.items)
          .filter(([, s]) => s !== 'off')
          .map(([id, s]) => ({ name: `/${PLUGIN_NAME}:${id}`, text: optionLabel('skills.items.*', s, lang) })),
      },
    ],
    tIn(lang, 'cmds.tail'),
  );
}

/** A skill's prompt as the engine expands it: its first use in a session is logged (the commands page's last use). */
async function onSkillPrompt($: $, e: any, next: any): Promise<any> {
  const r = await next(e);
  try {
    const c = await ctxOf($);
    const skill = String(e.skill ?? '');
    if (skill && !c.skillsUsed.has(skill)) {
      c.skillsUsed.add(skill);
      await logEvent($, c, { kind: 'skill', skill: skill.slice(0, 120) });
    }
  } catch {
    /* the log never changes a skill */
  }
  return r;
}

/** The MCP tools' descriptions against their pins: a changed one told to the person now and to the model with the first prompt. */
async function pinMcpTools($: $, c: Ctx): Promise<void> {
  try {
    const tools = (await $.tool.list()).filter((t) => t.mcp && !isOwnTool(t.name));
    if (!tools.length) return;
    const r = comparePins(parsePins(await readFile($, c.layout.mcpPins)), tools, await $.clock.now());
    if (r.changed.length) {
      $.ui.toast(tIn(c.lang, 'mcp.changed', { tools: r.changed.slice(0, 3).join(', '), n: r.changed.length }), { timeoutMs: 20_000 });
      c.startNotes.push(mcpChangedNote(r.changed));
      await logEvent($, c, { kind: 'mcpChanged', tools: r.changed.slice(0, 20) });
    }
    if (r.changed.length || r.added) await $.fs.write(c.layout.mcpPins, JSON.stringify(r.pins, null, 2) + '\n');
  } catch {
    /* the next session compares again */
  }
}

// ── tool packs (docs/packs.md) ──

/** `mode-code packs …` run for this session's folder: its JSON answer, or null when the program is not there. */
async function packsCli($: $, c: Ctx, args: string[]): Promise<Record<string, unknown> | null> {
  const program = centerProgram(await readFile($, c.layout.manifest));
  if (!program) return null;
  const cwd = await $.session.cwd();
  const r = await $.process.run([...program, 'packs', ...args, '--json', '--dir', cwd], { cwd, timeoutMs: 180_000 });
  try {
    const o = JSON.parse(r.stdout) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const packIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!packById(x)) : []);
const packName = (id: string) => packById(id)?.name ?? id;

/** As the session starts: Automatic use turns on the packs this folder's files call for; the ones loaded are kept. */
async function startPacks($: $, c: Ctx): Promise<void> {
  try {
    const o = await packsCli($, c, c.config.packs.autoUse && !c.state.tainted ? ['here', '--auto'] : ['here']);
    if (!o) return;
    const turned = (Array.isArray(o.on) ? o.on : []).flatMap((x) => {
      const r = x as { ok?: unknown; pack?: unknown } | null;
      return r && r.ok === true && typeof r.pack === 'string' && packById(r.pack) ? [r.pack] : [];
    });
    const listed = Array.isArray(o.onHere)
      ? packIds(o.onHere)
      : Array.isArray(o.packs)
        ? (o.packs as { id?: unknown; on?: unknown }[]).filter((p) => p?.on === true).map((p) => String(p.id))
        : [];
    // A pack turned on now loads at /reload-plugins or in the next session: not this one's yet.
    c.packsOn = new Set(listed.filter((id) => !turned.includes(id)));
    if (!turned.length) return;
    $.ui.toast(tIn(c.lang, 'packs.toast.on', { packs: turned.map(packName).join(', ') }), { timeoutMs: 15_000 });
    c.startNotes.push(packsOnNote(turned, 'auto'));
    await logEvent($, c, { kind: 'packs', on: turned, by: 'auto' });
  } catch {
    /* the next session looks again */
  }
}

/** A pack's hint, once per pack in a session; none for a pack the person refused. */
function packHintOnce(c: Ctx, p: Pack | undefined, why: 'words' | 'program' | 'missing' | 'file', program?: string): string[] {
  if (!p || c.hinted.has(`pack:${p.id}`) || modeOf(c.config.packs.items, p.id) === 'never') return [];
  // A pack already loaded here needs no hint, unless a program it uses is missing.
  if (why !== 'missing' && c.packsOn.has(p.id)) return [];
  c.hinted.add(`pack:${p.id}`);
  return [packHint(p, why, c.packsOn.has(p.id), program)];
}

/** After a call: a pack's use is logged once a session; a program or a file of a pack not on here, or a program the shell could not find, earns a hint. */
async function packNotes($: $, c: Ctx, tool: string, input: Record<string, unknown>, result: { text?: unknown; isError?: boolean }): Promise<string[]> {
  const used = packOfTool(tool, input);
  if (used && !c.packsUsed.has(used.id)) {
    c.packsUsed.add(used.id);
    await logEvent($, c, { kind: 'pack', pack: used.id, via: tool === 'Skill' ? 'skill' : 'tool' });
  }
  const dialect = shellOf(tool);
  if (dialect) {
    const out: string[] = [];
    const missing = typeof result.text === 'string' ? missingProgram(result.text) : null;
    if (missing) out.push(...packHintOnce(c, packOfProgram(missing), 'missing', missing));
    for (const inv of analyzeCommand(String(input.command ?? ''), dialect).invocations) {
      const p = packOfProgram(inv.program);
      if (p && c.packsOn.has(p.id) && !c.packsUsed.has(p.id)) {
        c.packsUsed.add(p.id);
        await logEvent($, c, { kind: 'pack', pack: p.id, via: 'program' });
      } else out.push(...packHintOnce(c, p, 'program'));
    }
    return out;
  }
  if (isFileTool(tool)) return packHintOnce(c, packOfFile(String(input.file_path ?? input.notebook_path ?? '')), 'file');
  return [];
}

/** The packs' catalog: the packs that match a need, a pack's guide, a pack turned on when the person allows it. */
const CATALOG_TOOL = {
  name: 'catalog',
  description: `${APP_NAME}'s tool packs, each for a kind of work (${[...new Set(PACKS.map((p) => CATEGORY_LABELS[p.category]))].join(', ')}). With "need": the packs that match. With "pack": its guide, what it needs installed. With "pack" and "turn_on": turns it on in this project when the person's Automatic use allows; it loads at /reload-plugins or the next session.`,
  inputSchema: {
    type: 'object',
    properties: {
      need: { type: 'string', description: 'The work, in a few words.' },
      pack: { type: 'string', enum: PACKS.map((p) => p.id), description: 'A pack, for its guide.' },
      turn_on: { type: 'boolean', description: 'Turn the pack on in this project.' },
    },
    additionalProperties: false,
  },
  isDeferred: true,
} as const;

/** Why something is as it is (src/core/ux/why.ts), asked by Claude: the answer comes from the settings and the log. */
const WHY_TOOL = {
  name: 'why',
  description: `Why ${APP_NAME} does what it does in this session, worked out from the person's settings and what happened: "last" for the last call refused and its rule, a part (${WHY_SUBJECTS.join(', ')}), a rule of the safety belt by its id, or nothing for every part. Use it before telling the person why something was blocked or is off.`,
  inputSchema: {
    type: 'object',
    properties: { about: { type: 'string', description: '"last", a part, or a rule id; empty for every part.' } },
    additionalProperties: false,
  },
  isDeferred: true,
} as const;

async function onWhyTool($: $, e: any): Promise<any> {
  const c = await ctxOf($);
  return { result: await whyAnswer($, c, typeof e.about === 'string' ? e.about.slice(0, 80) : '') };
}

async function onCatalogTool($: $, e: any): Promise<any> {
  const c = await ctxOf($);
  const p = typeof e.pack === 'string' ? packById(e.pack) : undefined;
  const listed = await packsCli($, c, ['list']);
  const entries = (Array.isArray(listed?.packs) ? listed.packs : []) as { id?: unknown; on?: unknown; found?: unknown }[];
  const rows: PackRow[] = PACKS.map((pack) => {
    const r = entries.find((x) => x?.id === pack.id);
    return {
      pack,
      mode: modeOf(c.config.packs.items, pack.id),
      on: r?.on === true,
      found: Array.isArray(r?.found) ? r.found.filter((s): s is string => typeof s === 'string') : [],
    };
  });
  if (!p) return { result: catalogList(rows, typeof e.need === 'string' ? e.need.slice(0, 200) : '') };
  const row = rows.find((r) => r.pack === p)!;
  const guide = await readFile($, joinPath(c.layout.marketplace, 'packs', 'guides', `${p.id}.md`));
  if (e.turn_on !== true || row.on) return { result: catalogGuide(row, guide) };
  const refused = (why: Parameters<typeof catalogRefusal>[1], detail?: string) => ({
    result: `${catalogRefusal(p.id, why, detail)}\n\n${catalogGuide(row, guide)}`,
  });
  if (e.agentId !== undefined) return refused('agent');
  // Outside content read in this session could be what asks for a new pack (core/taint.ts): it waits for the person.
  if (c.state.tainted) return refused('tainted');
  const o = await packsCli($, c, ['here', '--pack', p.id]);
  if (o?.ok !== true) {
    const reason = o?.reason;
    if (reason === 'auto-off' || reason === 'mode' || reason === 'risk') return refused(reason);
    const change = (Array.isArray(o?.changes) ? o.changes : [])[0] as { detail?: unknown } | undefined;
    return refused('failed', typeof change?.detail === 'string' ? change.detail.slice(0, 200) : '');
  }
  $.ui.toast(tIn(c.lang, 'packs.toast.claudeOn', { pack: p.name }), { timeoutMs: 15_000 });
  await logEvent($, c, { kind: 'packs', on: [p.id], by: 'claude' });
  return { result: `${packsOnNote([p.id], 'request')}\n\n${catalogGuide({ ...row, on: true }, guide)}` };
}

/**
 * The daily update check (core/update.ts), when the person said yes and one is due: the installed program asks the
 * release which version is the newest and keeps the answer, which the menu and the morning report then show.
 */
async function updateCheck($: $, c: Ctx): Promise<void> {
  try {
    if (!c.config.update.check || !checkDue(parseUpdateState(await readFile($, c.layout.updateState)), await $.clock.now())) return;
    const program = centerProgram(await readFile($, c.layout.manifest));
    if (program) await $.process.run([...program, 'update', '--check', '--json'], { timeoutMs: 60_000 });
  } catch {
    /* the next session asks again */
  }
}

async function onSessionStart($: $, e: In<'session.start'>, next: Nx<'session.start'>): Out<'session.start'> {
  ctxPromise = null;
  cleared = null;
  const c = await ctxOf($);
  // What changed in the memory elsewhere comes in as the session starts (docs/memory.md), then the sync across
  // computers (docs/sync.md). Both start first, so that a prompt typed at once finds them and waits: Claude Code
  // may have loaded the index already, and what came in is told with that first prompt.
  c.memStart = memorySync($, c, 'start');
  c.sharedStart = c.memStart.then(() => sharedSync($, c, 'start'));
  c.closedStart = c.memStart.then(() => closedNotes($, c));
  // The daily update check, when the person said yes: in the background, the session never waits for it.
  void updateCheck($, c);
  // What changed since the version an update replaced, once.
  void newsOnce($, c);
  // The MCP tools' descriptions against the ones first seen: a change is told (core/mcp-pins.ts).
  void pinMcpTools($, c);
  // Tool packs: Automatic use turns on what this folder's files call for; what is on here is kept for the hints.
  void startPacks($, c);
  // The skills kept in the plugin's folder, in line with the settings (a memory set up, a skill turned on elsewhere).
  void centerCli($, c, ['skills', 'sync', '--json']);
  if (c.fresh && c.config.modules.modes) await restoreLast($, c);
  if (c.config.agents.enabled) {
    await readUltracodeSetting($, c);
    c.state = { ...c.state, agents: { ...c.state.agents, ultracode: ultracodeOn(c) } };
  }
  await saveState($, c);
  if (c.state.resumeAt) await scheduleResume($, c);
  await refreshStatus($, c);
  const r = await next(e);
  const commands = registerCommands($, c);
  if (c.config.modules.modes) {
    try {
      await $.tool.register(FLOW_TOOL);
    } catch {
      /* flows then answer through the keywords alone; the doctor's live test notices */
    }
    // Full autonomy's clear request needs its tool from the first prompt, not only after a handoff keyword.
    try {
      await $.tool.register(REQUEST_TOOL_DEF);
    } catch {
      /* a step left to the person then stays with them */
    }
    // A paused flow in this folder is said once, so it is not forgotten.
    if (!c.flow) {
      const cwd = await $.session.cwd();
      const waiting = await flowToResume($, c, null, cwd);
      if (waiting && !(await heldElsewhere($, c, waiting)))
        $.ui.toast(
          tIn(c.lang, 'flow.toast.found', { step: stepName(currentStep(waiting)?.kind ?? 'research', c.lang), cont: tIn(c.lang, 'kw.kind.continue') }),
          { timeoutMs: 10_000 },
        );
    }
  }
  // The packs' catalog, behind tool search: its name costs nothing until Claude looks for it (docs/packs.md).
  try {
    await $.tool.register(CATALOG_TOOL);
  } catch {
    /* the packs then reach Claude through their hints alone */
  }
  // Why something is so, behind tool search too: its name costs nothing until Claude looks for it.
  try {
    await $.tool.register(WHY_TOOL);
  } catch {
    /* /neden still answers the person */
  }
  // The cockpit, where the person kept it open: beside the conversation again, where the screen leaves room.
  await reopenCockpit($, c);
  // The session's start waits for the memory's pull; the sync across computers goes on while the person types.
  await c.memStart;
  await commands;
  return r;
}

/** Claude Code's own plan mode, as its notes to the model say: on (with the plan file it names) or ended. */
async function planNote($: $, on: boolean, named: string | undefined): Promise<void> {
  try {
    const c = await ctxOf($);
    const planFile = named ?? c.state.nativePlan?.planFile ?? null;
    if (c.state.nativePlan?.on !== on || c.state.nativePlan?.planFile !== planFile) {
      c.state = { ...c.state, nativePlan: { on, planFile, at: await $.clock.now() } };
      // Leaving Claude Code's plan mode ends the session's own plan mode too (outside a flow).
      if (!on && c.state.mode === 'plan' && !flowRunning(c)) c.state = { ...c.state, mode: 'free' };
      await saveState($, c);
      await refreshStatus($, c);
    }
  } catch {
    /* a note the plugin could not read changes nothing */
  }
}

/** A session that ends pauses its flow, so the next one (after /clear too) can pick it up with "continue". */
async function onSessionEnd($: $, e: In<'session.end'>, next: Nx<'session.end'>): Out<'session.end'> {
  try {
    const c = await ctxOf($);
    // First, as the rest takes time Claude Code may not give: other sessions no longer count this one as working.
    c.state = { ...c.state, endedAt: await $.clock.now() };
    await saveState($, c);
    // A reset's own /clear: its note is written, and its flow goes on in the conversation it clears to (takeCarry).
    const reset = c.resetting && e.reason === 'clear';
    if (c.flow && isRunning(c.flow) && c.config.modules.modes && !reset) {
      const p = pauseFlow(c.flow, `session ${String(e.reason ?? 'ended')}`, await $.clock.now());
      if (p.ok) await saveFlow($, c, p.flow);
    }
    // A session closed with /00 handed off and synced before it asked to exit, with no clock running (closeSession).
    if (!c.closed) {
      // The work of a session that changed something is handed off, even without a note asked for (docs/memory.md).
      if (e.reason !== 'resume' && !reset) await endHandoff($, c, e.reason === 'clear' ? 'clear' : 'end');
      await sharedSync($, c, 'end');
    }
  } catch {
    /* the flow and the run stay as they were; "continue" in the next session takes them over */
  }
  const r = await next(e);
  if (e.reason === 'clear') {
    ctxPromise = null;
    cleared = { from: e.sessionId, at: await $.clock.now() };
  }
  return r;
}

async function bandText($: $): Promise<string> {
  return (await read($, labelsAtom)).band;
}

/** Adds the wrap-up or stop note to the model's context once the quota guard has spoken. */
async function quotaContext($: $, c: Ctx): Promise<string[]> {
  if (!c.config.modules.quota) return [];
  const q = await quotaNow($, c);
  if (q.level === 'stop') return [stopContext(q, c.state.resumeAt)];
  if (q.level === 'wrapUp') return [wrapUpContext(q)];
  return [];
}

/** Whether Claude Code's "the user has not heard from you" reminders are left out (long work stays quiet). */
async function quietWork($: $): Promise<boolean> {
  try {
    return (await ctxOf($)).config.modules.quietWork;
  } catch {
    return false;
  }
}

async function refuseToolCall($: $, e: any, next: any): Promise<any> {
  if (next.called) return next(e);
  let lang: Lang = 'en';
  try {
    lang = (await ctxOf($)).lang;
  } catch {
    /* fall back to English */
  }
  const tool = String(e?.tool ?? '');
  // Fail closed for tools that change things; let pure reads through so a broken guard does not freeze the session.
  if (/^(?:Read|Glob|Grep|LS|ToolSearch|TodoWrite|AskUserQuestion)$/.test(tool)) return next(e);
  return { deny: tIn(lang, 'belt.failed', { error: next.error?.kind ?? 'error' }) };
}

// ── memory: its sync, handoff notes, the morning line (docs/memory.md) ─────────────────────────────

/** Claude Code's own process runner, as the sync's Runner. */
function modRunner($: $): Runner {
  return {
    async run(argv, o) {
      const r = await $.process.run([...argv], { cwd: o.cwd, timeoutMs: o.timeoutMs, env: o.env });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    },
  };
}

/**
 * One sync of the memory store: at a session's start all three steps, after a turn only when the store
 * changed or holds commits not yet sent. Its record is kept, and a problem is told to the person once.
 */
async function memorySync($: $, c: Ctx, trigger: 'start' | 'turn'): Promise<SyncResult | null> {
  const s = c.config.memory.store;
  if (!s || !s.git || c.memSyncing) return null;
  c.memSyncing = true;
  try {
    const plan = syncPlan(s.sync, trigger);
    if (trigger === 'turn') {
      // A store its owner commits: only where it stands is noted, so the next session reports what arrives after.
      if (looksOnly(plan)) {
        await memoryLook($, c, s.dir);
        return null;
      }
      // One cheap look first: nothing changed in the store and nothing waits to be sent, nothing to do.
      const st = await gitIn($, s.dir, ['status', '--porcelain=v1', '--branch', '--', '.'], 10_000);
      const lines = st.out.split('\n').filter(Boolean);
      if (st.ok && lines.length <= 1 && !/\[ahead \d+/.test(lines[0] ?? '')) {
        await memoryLook($, c, s.dir);
        return null;
      }
    }
    const seen = await Promise.all((['mod', 'hook', 'cli'] as const).map(async (w) => parseSeen(await readFile($, memorySeenFile(c.layout, w)))));
    const r = await syncMemory(modRunner($), {
      dir: s.dir,
      remote: s.place !== 'local',
      steps: plan.steps,
      pullMode: plan.pullMode,
      since: lastSeen(seen),
      message: (counts) => commitMessage(counts, c.sessionId, c.lang),
      readFile: (p) => readFile($, p),
      secrets: (t) => scanSecrets(t).length,
      outgoing: outgoingSecrets(parseAllowed(await readFile($, c.layout.secretsAllow))),
    });
    if (r.pulled.length) c.memPulled = mergePulled(c.memPulled, { files: r.pulled, index: r.index });
    try {
      const at = await $.clock.now();
      await $.fs.write(memorySyncFile(c.layout, 'mod'), JSON.stringify({ at, trigger, session: c.sessionId, result: r }, null, 2) + '\n');
      if (r.head) await $.fs.write(memorySeenFile(c.layout, 'mod'), JSON.stringify({ head: r.head, at }) + '\n');
    } catch {
      /* the record is for the person's eyes; the sync itself happened */
    }
    await logEvent($, c, {
      kind: 'memory',
      action: 'sync',
      trigger,
      commit: r.commit,
      pull: r.pull,
      push: r.push,
      held: r.held.length,
      conflicts: r.conflicts.length,
      pulled: r.pulled.length,
    });
    const problem = syncProblem(r);
    if (problem && problem !== 'offline' && !c.memWarned.has(problem)) {
      c.memWarned.add(problem);
      const files = (problem === 'held' ? r.held.map(heldText) : r.conflicts).slice(0, 4).join(', ');
      $.ui.toast(tIn(c.lang, `mod.memory.${problem}` as MessageKey, { files, detail: r.detail.slice(0, 120) }), { timeoutMs: 12_000 });
    }
    return r;
  } catch {
    return null;
  } finally {
    c.memSyncing = false;
  }
}

/** The shared place through Claude Code's own file access. */
function modSyncFs($: $): SyncFs {
  return {
    read: (p) => readFile($, p),
    write: (p, t) => $.fs.write(p, t),
    async list(dir) {
      try {
        return (await $.fs.list(dir)).map((e) => ({ name: e.name, kind: e.kind, mtimeMs: e.mtimeMs }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * One sync across computers (docs/sync.md): this computer's files written into its own folder of the shared
 * place; with GitHub, committed, the others' brought in, sent. After a turn only when it is due. The settings
 * are read again afterwards (the others' changes), and a problem is told to the person once.
 */
async function sharedSync($: $, c: Ctx, trigger: 'start' | 'turn' | 'end'): Promise<void> {
  const s = c.local.sync;
  if (!s || c.sharedSyncing) return;
  try {
    const now = await $.clock.now();
    if (trigger === 'turn') {
      const records = await Promise.all((['mod', 'hook', 'cli'] as const).map(async (w) => parseSharedRecord(await readFile($, syncRecordFile(c.layout, w)))));
      if (!syncDue(records, now, s.everyMinutes)) return;
    }
    c.sharedSyncing = true;
    const record: SharedRecord = { at: now, trigger, session: c.sessionId, written: 0, result: null, error: null };
    try {
      const ex = await exportMachine(modSyncFs($), {
        dir: s.dir,
        machine: s.machine,
        platform: c.platform,
        app: APP_VERSION,
        now,
        layout: c.layout,
        local: c.local,
        keepMonths: s.keepMonths,
      });
      record.written = ex.written.length;
    } catch (err) {
      record.error = String((err as Error)?.message ?? err)
        .split('\n')[0]!
        .slice(0, 300);
    }
    if (s.place === 'github' && !record.error)
      record.result = await syncMemory(modRunner($), {
        dir: s.dir,
        remote: true,
        steps: { commit: true, pull: true, push: true },
        message: (counts) => syncCommitMessage(s.machine.name, counts),
        readFile: (p) => readFile($, p),
        secrets: (t) => scanSecrets(t).length,
        outgoing: outgoingSecrets(parseAllowed(await readFile($, c.layout.secretsAllow))),
        maxBytes: SYNC_MAX_BYTES,
      });
    try {
      await $.fs.write(syncRecordFile(c.layout, 'mod'), JSON.stringify(record, null, 2) + '\n');
    } catch {
      /* the record is for the person's eyes; the sync itself happened */
    }
    await logEvent($, c, {
      kind: 'sync',
      trigger,
      written: record.written,
      commit: record.result?.commit ?? null,
      pull: record.result?.pull ?? null,
      push: record.result?.push ?? null,
      error: !!record.error,
    });
    const problem = record.error ? 'failed' : record.result ? syncProblem(record.result) : null;
    if (problem && problem !== 'offline' && !c.sharedWarned.has(problem)) {
      c.sharedWarned.add(problem);
      const files = record.result ? (problem === 'held' ? record.result.held.map(heldText) : record.result.conflicts).slice(0, 4).join(', ') : '';
      $.ui.toast(tIn(c.lang, `mod.sync.${problem}` as MessageKey, { files, detail: (record.error ?? record.result?.detail ?? '').slice(0, 120) }), {
        timeoutMs: 12_000,
      });
    }
    // What the other computers changed is in effect from now on.
    await refreshConfig($, c);
  } catch {
    /* the next turn or session syncs again */
  } finally {
    c.sharedSyncing = false;
  }
}

/** Where the memory store stands now becomes where this session last saw it (a commit; written only when it moved). */
async function memoryLook($: $, c: Ctx, dir: string): Promise<void> {
  const head = await gitIn($, dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], 5000);
  if (!head.ok || !/^[0-9a-f]{7,64}$/.test(head.out)) return;
  const file = memorySeenFile(c.layout, 'mod');
  if (parseSeen(await readFile($, file))?.head === head.out) return;
  try {
    await $.fs.write(file, JSON.stringify({ head: head.out, at: await $.clock.now() }) + '\n');
  } catch {
    /* looked at again after the next turn */
  }
}

/** The project a note belongs to: the one the person named in this session, else the folder's (settings id, origin, name). */
async function projectOfSession($: $, c: Ctx): Promise<{ key: string; folder: string }> {
  return projectOf($, c, await $.session.cwd(), c.state.project);
}

/**
 * The project of a folder: the one named, else the folder's (settings id, origin, name). A named project
 * with a repository of its own on this computer is measured there, wherever the session was opened.
 */
async function projectOf($: $, c: Ctx, cwd: string, named: string | null): Promise<{ key: string; folder: string }> {
  const env = pathEnv(c, cwd);
  const own = named ? c.config.projects.find((p) => p.id === named)?.path : undefined;
  const ownTop = own ? await gitIn($, resolvePath(own, env), ['rev-parse', '--show-toplevel'], 5000) : null;
  const top = ownTop?.ok && ownTop.out ? ownTop : await gitIn($, cwd, ['rev-parse', '--show-toplevel'], 5000);
  const folder = top.ok && top.out ? resolvePath(top.out, env) : env.cwd;
  const registered = c.config.projects.find((p) => p.path && pathKey(resolvePath(p.path, env), c.platform) === pathKey(folder, c.platform));
  const remote = top.ok ? await gitIn($, folder, ['config', '--get', 'remote.origin.url'], 5000) : null;
  return { key: projectKey({ id: named ?? registered?.id ?? null, remote: remote?.ok ? remote.out : null, folder }), folder };
}

/** What code measures for a handoff note. */
async function handoffFacts($: $, c: Ctx, trigger: HandoffTrigger): Promise<HandoffFacts> {
  const p = await projectOfSession($, c);
  const at = await $.clock.now();
  const isRepo = (await gitIn($, p.folder, ['rev-parse', '--is-inside-work-tree'], 5000)).out === 'true';
  const branch = isRepo ? await gitIn($, p.folder, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 5000) : null;
  const head = isRepo ? await gitIn($, p.folder, ['rev-parse', 'HEAD'], 5000) : null;
  const log = isRepo ? await gitIn($, p.folder, ['log', `--since=${new Date(c.startedAt).toISOString()}`, '--format=%h %s', '-n', '40'], 10_000) : null;
  const status = isRepo ? await gitIn($, p.folder, ['status', '--porcelain=v1'], 10_000) : null;
  const q = await quotaNow($, c);
  return {
    project: p.key,
    cwd: p.folder,
    machine: c.env.COMPUTERNAME || c.env.HOSTNAME || c.env.WSL_DISTRO_NAME || '',
    session: c.sessionId,
    at,
    trigger,
    branch: branch?.ok && branch.out ? branch.out : null,
    head: head?.ok && head.out ? head.out : null,
    commits: log?.ok ? log.out.split('\n').filter(Boolean) : [],
    // The output comes trimmed, so the first line may have lost its leading status column: read the name after the status.
    uncommitted: status?.ok
      ? status.out
          .split('\n')
          .map((l) => /^[ MADRCUT?!]{1,2} (.+)$/.exec(l)?.[1] ?? '')
          .filter(Boolean)
      : [],
    flow: c.flow && isOpen(c.flow) ? `${c.flow.id}: ${stepName(currentStep(c.flow)?.kind ?? 'research', c.lang)} (${c.flow.status})` : null,
    quota: q.usable ? { five: q.five?.used ?? null, week: q.week?.used ?? null } : null,
    request: c.lastPrompt,
  };
}

/** Writes a handoff note into the memory (or mode-code's folder without one); its path, or null when turned off. */
async function writeHandoff($: $, c: Ctx, trigger: HandoffTrigger, body: { parts?: HandoffParts; summary?: string }): Promise<string | null> {
  return c.config.memory.handoff.enabled ? (await handoffNote($, c, trigger, body)).path : null;
}

/** A handoff note's text, kept as writeHandoff keeps it; its path is null when notes are off or it could not be written. */
async function handoffNote(
  $: $,
  c: Ctx,
  trigger: HandoffTrigger,
  body: { parts?: HandoffParts; summary?: string },
): Promise<{ text: string; path: string | null }> {
  const f = await handoffFacts($, c, trigger);
  const text = composeHandoff(f, body);
  if (!c.config.memory.handoff.enabled) return { text, path: null };
  const path = joinPath(handoffRoot(c.config, c.layout.handoffsDir), f.project, handoffName(f.at, c.sessionId));
  try {
    await $.fs.write(path, text);
  } catch {
    return { text, path: null };
  }
  c.handoffAt = f.at;
  await saveState($, c);
  await logEvent($, c, { kind: 'handoff', trigger, project: f.project });
  return { text, path };
}

/** The newest handoff note of the session's project that this session did not write, read back. */
async function waitingHandoff($: $, c: Ctx): Promise<{ path: string; text: string; note: Handoff } | null> {
  if (!c.config.memory.handoff.enabled) return null;
  const p = await projectOfSession($, c);
  const dir = joinPath(handoffRoot(c.config, c.layout.handoffsDir), p.key);
  let names: string[] = [];
  try {
    names = (await $.fs.list(dir)).map((e) => e.name);
  } catch {
    return null;
  }
  const name = newestName(names);
  if (!name) return null;
  const path = joinPath(dir, name);
  const text = await readFile($, path);
  const note = text ? parseHandoff(text) : null;
  if (!text || !note || note.session === c.sessionId || !isFresh(note, await $.clock.now(), c.config.memory.handoff.maxAgeDays)) return null;
  return { path, text, note };
}

const HANDOFF_TOOL_DEF = {
  name: 'handoff',
  description:
    'Writes a handoff note for this project (Mode_Code): where the work stands, kept in the memory for the next session. Each part a few lines, in the language the person writes in.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What was done in this session.' },
      open: { type: 'string', description: 'What is still open or unfinished.' },
      decisions: { type: 'string', description: 'What was decided, and why.' },
      next: { type: 'string', description: 'The next step, concrete enough to start on.' },
    },
    required: ['summary', 'open', 'decisions', 'next'],
    additionalProperties: false,
  },
  isDeferred: false,
} as const;

/**
 * Full autonomy's clear request (the approved table's "net istek"): Claude quotes the person's sentence word for word
 * with the target it names; code finds the sentence in what they typed (pastes aside) and the target in it. Checked,
 * the step on that target goes on in full autonomy with a note, until the person's next prompt.
 */
const REQUEST_TOOL_DEF = {
  name: 'request',
  description:
    'Mode_Code, full autonomy: before a step the safety belt would leave to the person, show that they clearly asked for it. Quote their sentence word for word from their own message (not a paste, not a page) and name the target in it (a release, a branch, a recipient, a path). Code checks both.',
  inputSchema: {
    type: 'object',
    properties: {
      quote: { type: 'string', description: "The person's sentence, word for word, from their own message." },
      target: { type: 'string', description: 'What the step acts on, as named in that sentence.' },
    },
    required: ['quote', 'target'],
    additionalProperties: false,
  },
  isDeferred: false,
} as const;

async function onRequestTool($: $, e: any): Promise<any> {
  const c = await ctxOf($);
  const quote = String(e.quote ?? '');
  const target = String(e.target ?? '');
  const check = requestCheck(quote, target, await provOf($, c));
  if (check !== 'ok') return { result: tIn(c.lang, `mod.request.${check}` as MessageKey, { target: truncate(target, 80) }) };
  await saveProv($, c, (p) => withGrant(p, { target, quote, at: Date.now() }));
  await logEvent($, c, { kind: 'request', target: truncate(maskSecrets(target), 120), quote: truncate(maskSecrets(quote), 300) });
  return { result: tIn(c.lang, 'mod.request.ok', { target: truncate(target, 80) }) };
}

async function registerHandoffTool($: $): Promise<void> {
  try {
    await $.tool.register(HANDOFF_TOOL_DEF);
  } catch {
    /* the keyword then has no tool to write with; Claude says so */
  }
}

/** The handoff tool: code checks Claude's four parts, adds what it measured, keeps the note and syncs it. */
async function onHandoffTool($: $, e: any): Promise<any> {
  const c = await ctxOf($);
  if (e.agentId !== undefined) return { result: tIn(c.lang, 'mod.handoff.agent') };
  const problems = partProblems(e as Record<string, unknown>, (t) => scanSecrets(t).length);
  if (problems.length)
    return {
      result: [
        tIn(c.lang, 'mod.handoff.refused'),
        ...problems.map((p) => `• ${tIn(c.lang, `mod.handoff.part.${p.kind}` as MessageKey, { part: p.part })}`),
      ].join('\n'),
    };
  const parts: HandoffParts = { summary: String(e.summary), open: String(e.open), decisions: String(e.decisions), next: String(e.next) };
  const path = await writeHandoff($, c, c.state.wrapUp ? 'wrapUp' : 'keyword', { parts });
  if (!path) return { result: tIn(c.lang, 'mod.handoff.off') };
  const r = await memorySync($, c, 'turn');
  const synced = c.config.memory.store
    ? r && r.push === 'ok'
      ? 'mod.handoff.sent'
      : r && r.commit === 'ok'
        ? 'mod.handoff.recorded'
        : 'mod.handoff.kept'
    : 'mod.handoff.local';
  $.ui.toast(tIn(c.lang, 'mod.handoff.toast'), { timeoutMs: 6000 });
  return { result: `${tIn(c.lang, 'mod.handoff.written', { path })} ${tIn(c.lang, synced as MessageKey)}` };
}

/** A note from what code measured when a session ends or clears, if it changed something since the last note. */
async function endHandoff($: $, c: Ctx, trigger: 'clear' | 'end'): Promise<void> {
  if (!c.config.memory.handoff.onEnd || c.changedAt === 0 || c.handoffAt >= c.changedAt) return;
  const path = await writeHandoff($, c, trigger, {});
  if (path) await memorySync($, c, 'turn');
}

/**
 * The end notes of sessions closed without ending (their window shut, or their end cut short): written here,
 * from what they kept as they went (SessionWork) and what code measures now, under the time they last changed
 * something. A session still running is left alone; a note already there is not written again.
 */
async function closedNotes($: $, c: Ctx): Promise<void> {
  const h = c.config.memory.handoff;
  if (!h.enabled || !h.onEnd) return;
  try {
    const now = await $.clock.now();
    const entries = (await $.fs.list(c.layout.sessionsDir))
      .filter((x) => x.name.endsWith('.mod.json') && now - x.mtimeMs <= h.maxAgeDays * 86_400_000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 60);
    let wrote = 0;
    for (const x of entries) {
      const s = parseModState(await readFile($, joinPath(c.layout.sessionsDir, x.name)));
      if (!s || !s.work || !s.cwd || !noteOwed(s, c.sessionId, now, h.maxAgeDays)) continue;
      const at = Math.max(s.aliveAt, s.work.changedAt);
      const project = s.work.project ?? (await projectOf($, c, s.cwd, s.project)).key;
      const path = joinPath(handoffRoot(c.config, c.layout.handoffsDir), project, handoffName(at, s.sessionId));
      if (await $.fs.exists(path)) continue;
      const closed = s.endedAt !== null ? now - s.endedAt >= END_GRACE_MS : await sessionGone($, c, s.sessionId);
      if (!closed) continue;
      try {
        await $.fs.write(path, composeHandoff(await closedFacts($, c, s, project, at), {}));
      } catch {
        continue;
      }
      wrote++;
      await logEvent($, c, { kind: 'handoff', trigger: 'closed', project, of: s.sessionId });
    }
    if (wrote) await memorySync($, c, 'turn');
  } catch {
    /* tried again at the next session's start */
  }
}

/** What code measures for a closed session's note: its project's folder now, its commits since it started, what it kept. */
async function closedFacts($: $, c: Ctx, s: ModSessionState, project: string, at: number): Promise<HandoffFacts> {
  const w = s.work!;
  const { folder } = await projectOf($, c, s.cwd!, s.project);
  const isRepo = (await gitIn($, folder, ['rev-parse', '--is-inside-work-tree'], 5000)).out === 'true';
  const branch = isRepo ? await gitIn($, folder, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 5000) : null;
  const head = isRepo ? await gitIn($, folder, ['rev-parse', 'HEAD'], 5000) : null;
  const log = isRepo ? await gitIn($, folder, ['log', `--since=${new Date(w.startedAt).toISOString()}`, '--format=%h %s', '-n', '40'], 10_000) : null;
  const status = isRepo ? await gitIn($, folder, ['status', '--porcelain=v1'], 10_000) : null;
  const fdir = s.flowId ? flowDir(c.layout, s.flowId) : null;
  const flow = fdir ? parseFlow(await readFile($, joinPath(fdir, 'flow.json'))) : null;
  return {
    project,
    cwd: folder,
    machine: c.env.COMPUTERNAME || c.env.HOSTNAME || c.env.WSL_DISTRO_NAME || '',
    session: s.sessionId,
    at,
    trigger: 'closed',
    branch: branch?.ok && branch.out ? branch.out : null,
    head: head?.ok && head.out ? head.out : null,
    commits: log?.ok ? log.out.split('\n').filter(Boolean) : [],
    uncommitted: status?.ok
      ? status.out
          .split('\n')
          .map((l) => /^[ MADRCUT?!]{1,2} (.+)$/.exec(l)?.[1] ?? '')
          .filter(Boolean)
      : [],
    flow: flow && isOpen(flow) ? `${flow.id}: ${stepName(currentStep(flow)?.kind ?? 'research', c.lang)} (${flow.status})` : null,
    quota: null,
    request: w.request,
  };
}

/** A compaction's summary kept as a handoff note, when the conversation was compacted (not only computed ahead). */
async function compactHandoff($: $, trigger: string, r: unknown): Promise<void> {
  try {
    const c = await ctxOf($);
    if (!c.config.memory.handoff.onCompact || (trigger !== 'manual' && trigger !== 'auto')) return;
    const messages = (r as { messages?: readonly { role: string; text: string }[] } | null)?.messages;
    if (!messages?.length) return;
    const summary = compactionSummary(messages);
    if (!summary) return;
    const path = await writeHandoff($, c, 'compact', { summary });
    if (path) await memorySync($, c, 'turn');
  } catch {
    /* the compaction stands; the note is a help */
  }
}

/** The morning line after a long gap: what waits for the person (a short version of `mode-code morning`). */
async function morningLineFor($: $, c: Ctx, from: number, now: number): Promise<string | null> {
  const flows: MorningFacts['flows'] = [];
  try {
    for (const e of (await $.fs.list(c.layout.flowsDir)).filter((x) => x.kind === 'dir').slice(-40)) {
      const dir = flowDir(c.layout, e.name);
      const f = dir ? parseFlow(await readFile($, joinPath(dir, 'flow.json'))) : null;
      if (f && f.status === 'waiting') flows.push({ id: f.id, title: f.task.split('\n')[0] ?? f.id });
    }
  } catch {
    /* no flows */
  }
  const s = c.config.memory.store;
  let memory: MorningFacts['memory'] = null;
  if (s) {
    const last = newestRecord(
      await Promise.all((['mod', 'hook', 'cli'] as const).map(async (w) => parseSyncRecord(await readFile($, memorySyncFile(c.layout, w))))),
    );
    const r = last && last.at >= from ? last.result : null;
    memory = { place: s.place, ahead: last?.result.ahead ?? null, conflicts: r?.conflicts ?? [], held: r?.held.map(heldText) ?? [], error: null };
  }
  return morningSummary(
    {
      since: from,
      now,
      flows,
      sessions: [],
      handoffs: [],
      belt: null,
      quota: null,
      memory,
      syncPending: c.syncPending.length,
      update: newerThan(APP_VERSION, parseUpdateState(await readFile($, c.layout.updateState))?.latest ?? null),
    },
    c.lang,
  );
}

/**
 * What the memory adds to a prompt of the person's: the morning line after a long gap (a notice), on the
 * session's first prompt the waiting handoff in one line, on "continue" the whole note.
 */
async function memoryPromptContext($: $, c: Ctx, kw: KeywordMatch | null, own: (notes: readonly string[]) => readonly string[] = (n) => n): Promise<string[]> {
  const out: string[] = [];
  const now = await $.clock.now();
  // The gap since the last prompt (any session): the morning line.
  if (c.config.memory.morning.enabled) {
    const before = parseActivity(await readFile($, c.layout.activity));
    const after = nextActivity(before, now, c.config.memory.morning.afterHours);
    try {
      await $.fs.write(c.layout.activity, JSON.stringify(after) + '\n');
    } catch {
      /* the gap is measured again next time */
    }
    if (after.away && after.away !== before.away) {
      const line = await morningLineFor($, c, after.away.from, now);
      if (line) $.ui.toast(line, { timeoutMs: 15_000 });
    }
  }
  if (c.memStart) {
    await c.memStart;
    c.memStart = null;
  }
  if (c.sharedStart) {
    await c.sharedStart;
    c.sharedStart = null;
  }
  // Settings from another computer that lower a protection: the person is told once each (they are not Claude's to take).
  const unsaid = c.syncPending.filter((p) => !c.syncSaid.has(`${p.key}@${p.at}`));
  if (unsaid.length) {
    for (const p of unsaid) c.syncSaid.add(`${p.key}@${p.at}`);
    $.ui.toast(tIn(c.lang, 'mod.sync.pending', { keys: unsaid.map((p) => p.key).join(', '), cmd: `${CLI_NAME} sync` }), { timeoutMs: 15_000 });
  }
  const store = c.config.memory.store;
  const pulled = c.memPulled && store ? pulledContext(c.memPulled, store.dir) : null;
  c.memPulled = null;
  if (pulled) out.push(...own([pulled]));
  const first = c.prompts === 1;
  if (c.closedStart) {
    await c.closedStart;
    c.closedStart = null;
  }
  if (kw?.kind === 'continue' || (first && c.config.memory.handoff.enabled)) {
    const found = await waitingHandoff($, c);
    // The note a reset started this conversation with is in its prompt already, whole.
    const h = found && found.path === c.carried?.note ? null : found;
    if (h && kw?.kind === 'continue') out.push(handoffFull(h.text, h.path));
    else if (h && first) out.push(...own([handoffLine(h.note, h.path)]));
  }
  return out;
}

// ── the session's controls: the strip above the prompt and the slash commands (docs/modes.md, "Controls") ──

/** What the strip, the menu and the confirmations show: the mode in effect, the way of working, the flow's place. */
function viewOf(c: Ctx): StripView {
  return {
    mode: modeNow(c),
    style: styleOf(c.state.interaction),
    flow: flowView(c),
    frozen: c.state.frozen ? (c.state.frozen.split('/').filter(Boolean).pop() ?? c.state.frozen) : null,
    agents: { shown: c.config.agents.enabled, state: c.state.agents, running: c.agentsRunning },
    cockpit: c.cockpit.open,
  };
}

/** The flow as the strip shows it: working, waiting for approval, paused for another mode, or armed. */
function flowView(c: Ctx): FlowView | null {
  if (c.flow && isOpen(c.flow)) {
    const p = progress(c.flow);
    const at = `${p.at}/${p.of}`;
    if (c.flow.status === 'paused') return { at, state: 'paused' };
    return { at, state: currentStep(c.flow)?.kind === 'approve' ? 'approval' : 'running' };
  }
  return c.armed?.kind === 'flow' ? { at: '', state: 'armed' } : null;
}

const COMMAND_HINT: Record<ControlAction['kind'], MessageKey | null> = {
  mode: 'ctl.hint.text',
  style: 'ctl.hint.text',
  flow: 'ctl.hint.flow',
  cockpit: null,
  continue: 'ctl.hint.continue',
  quota: 'ctl.hint.quota',
  close: null,
  freeze: 'ctl.hint.freeze',
  agents: 'ctl.hint.agents',
  why: 'ctl.hint.why',
};

/** A command's line in the `/` menu: its control's own words in the catalog. */
function commandDescription(a: ControlAction, lang: Lang): string {
  return controlText(controlOf(a), 'what', lang);
}

/**
 * The slash commands, in the person's language. The mode, the way of working, the menu and the budget act at
 * once, mid-turn too: the brake. So does closing, which asks first while Claude works.
 */
async function registerCommands($: $, c: Ctx): Promise<void> {
  // All asked at once, while the start's hook runs: a call made after it returned would not count.
  await Promise.all([
    ...COMMANDS.map((cmd) => {
      const hint = COMMAND_HINT[cmd.action.kind];
      const now = ['mode', 'style', 'cockpit', 'quota', 'close', 'freeze', 'agents'].includes(cmd.action.kind);
      return $.command
        .register({
          name: cmd.name,
          description: commandDescription(cmd.action, c.lang),
          ...(hint ? { argumentHint: tIn(c.lang, hint) } : {}),
          ...(now ? { immediate: true as const } : {}),
        })
        .catch(() => undefined); // a name Claude Code keeps for itself: the digits and the other words still work
    }),
    // The list of everything, and in Turkish the short commands of the person's skills (core/skills.ts).
    ...LIST_COMMANDS.map((name) =>
      $.command.register({ name, description: tIn(c.lang, 'ctl.desc.commands'), immediate: true as const }).catch(() => undefined),
    ),
    ...shortCommands(c.lang).map(({ name, skill }) =>
      $.command.register({ name, description: tIn(c.lang, `skill.short.${skill.id}` as MessageKey) }).catch(() => undefined),
    ),
  ]);
}

/**
 * `text` as the person's message, sent on their behalf ("/2 look into it", "/devam 3"): its keywords are applied
 * here, now, as if typed (the plugin's own prompt hook may not see a prompt it submitted), and the notes they
 * add are answered for the command's row; then the text goes as the person's own words. Claude Code refuses a
 * prompt submitted from the command's hook itself (it would wait on the turn the hook holds), so it goes from
 * a timer the moment the command is done; if the plugin's prompt hook does see it, it is not applied twice.
 */
async function sendAsPerson($: $, c: Ctx, text: string): Promise<string[]> {
  const notes: string[] = [];
  const said = await keywordTurn($, c, text);
  notes.push(...said.context);
  // "Continue" brings the project's handoff note in full, as it does when typed (memoryPromptContext).
  const kw = detectKeyword(text, projectRefs(c.config), keywordTables(c.config));
  if (kw?.kind === 'continue') {
    const h = await waitingHandoff($, c);
    if (h) notes.push(handoffFull(h.text, h.path));
  }
  await refreshStatus($, c);
  c.selfSent = text;
  $.clock.after(1, () => {
    $.prompt.submit({ text, asUser: true }).catch((err: unknown) => $.ui.toast(`${APP_NAME}: ${String((err as Error)?.message ?? err).slice(0, 300)}`));
  });
  return notes;
}

/**
 * A press on the strip or on a row of `/devam`'s list: the same control a slash command runs. Its line shows
 * as a toast and the strip changes at once; its notes for the model go into the conversation as rows the
 * person does not see as typed (read from the running turn's next request too: a press while Claude works is
 * the brake). A mode, a way of working or the flow pressed again within a moment counts as the last press:
 * Claude hears the end state once, not every step on the way.
 */
async function press($: $, name: string, args = '', surface?: string): Promise<void> {
  try {
    const r = await control($, name, args, 'strip', surface === undefined || surface === 'terminal' ? 'here' : 'remote');
    const kind = commandNamed(name)?.kind;
    if (r.context?.length) {
      if (kind === 'mode' || kind === 'style' || kind === 'flow') await holdPressNotes($, kind, r.context);
      else await appendNotes($, r.context);
    }
    // A toast is one line in a small box, cut after three (test/core/toasts.test.ts); none for a window opened.
    const line = r.toast ?? r.text.split('\n')[0]!;
    if (line) $.ui.toast(line, { timeoutMs: 8000 });
  } catch {
    /* a press that cannot act shows nothing; the slash command says why */
  }
}

/** The hover group of a control's card: the pointer on the control shows it under the strip (src/core/ux/say.ts). */
function cardScope(id: string): string {
  return `card-${id}`;
}

type Tag = Parameters<typeof h>[0];

/**
 * The line under the strip (docs/design.md, the four questions): what Claude does now, in words, and the count of
 * this session's activity at its end (what waits for you, in the colour of a question, when something does), a press
 * away from the cockpit. While the keyboard rests on a control, that control's card says
 * itself there instead. The card of every control, and Mo's words, lie in it unseen: the surface shows one while the
 * pointer rests on its control (a hover, no hook runs). Its height never changes, so nothing moves under the pointer;
 * narrower than 120 columns it is two rows tall, so a card is read whole.
 */
function sayLine(
  $: $,
  els: { Box: unknown; Text: unknown; Button: unknown },
  p: {
    columns: number;
    lang: Lang;
    cards: readonly { scope: string; text: string }[];
    mo: string | null;
    focus: string | null;
    now: string;
    activity: number;
    waiting: number;
    agentView: boolean;
  },
): ReturnType<typeof h> {
  const Box = els.Box as Tag;
  const Text = els.Text as Tag;
  const Button = els.Button as Tag;
  const height = p.columns >= 120 ? 1 : 2;
  const wrap = height === 1 ? 'truncate-end' : 'wrap';
  const reveal = (scope: string, text: string) =>
    h(Box, { display: 'none', flexShrink: 0, width: p.columns, hover: { display: 'flex', scope } }, h(Text, { wrap }, text));
  const said = p.agentView
    ? [
        h(Box, { key: 'say-text', flexGrow: 1, flexShrink: 1 }, h(Text, { wrap }, tIn(p.lang, 'ux.say.agentView'))),
        h(
          Box,
          { key: 'say-main', flexShrink: 0, marginLeft: 2 },
          h(Button, { key: 'strip-main', onPress: () => $.ui.view({}) }, tIn(p.lang, 'ux.say.mainView')),
        ),
      ]
    : [
        h(
          Box,
          { key: 'say-text', flexGrow: 1, flexShrink: 1 },
          p.focus ? h(Text, { wrap, color: COLORS.focus.claude }, `${mark('focus', false)} ${p.focus}`) : h(Text, { wrap, dimColor: true }, p.now),
        ),
        ...(p.activity > 0
          ? [
              h(
                Box,
                { key: 'say-activity', flexShrink: 0, marginLeft: 2 },
                p.waiting > 0
                  ? h(
                      Button,
                      { key: 'strip-activity', plain: true, onPress: (e?: { surface?: string }) => showCockpit($, e?.surface) },
                      h(Text, { color: COLORS.ask.claude }, `${mark('ask', false)} ${tIn(p.lang, 'ux.say.waiting', { n: p.waiting })}${mark('opener', false)}`),
                    )
                  : h(
                      Button,
                      { key: 'strip-activity', plain: true, dimColor: true, onPress: (e?: { surface?: string }) => showCockpit($, e?.surface) },
                      `${tIn(p.lang, 'ux.say.activity', { n: p.activity })}${mark('opener', false)}`,
                    ),
              ),
            ]
          : []),
      ];
  return h(
    Box,
    { key: 'strip-say', flexDirection: 'row', height, overflow: 'hidden', width: p.columns },
    ...p.cards.map((c) => reveal(c.scope, c.text)),
    ...(p.mo ? [reveal(cardScope('mo'), p.mo)] : []),
    h(Box, { key: 'say-now', flexDirection: 'row', flexShrink: 0, width: p.columns }, ...said),
  );
}

/**
 * The cockpit at a press on the strip's activity or on Mo (docs/design.md, The cockpit): opened, or brought forward
 * when it is open; where no pane can be drawn, the control center's activity; from the phone, where they open.
 */
async function showCockpit($: $, surface?: string): Promise<void> {
  try {
    const c = await ctxOf($);
    if (surface !== undefined && surface !== 'terminal') {
      $.ui.toast(tIn(c.lang, 'ctl.center.remote'), { timeoutMs: TOAST_MS.result });
      return;
    }
    if (!(await openCockpit($, c, true))) await openActivity($);
  } catch {
    /* the strip stays as it is */
  }
}

/** Opens the control center at Activity › Activity feed beside the session; from the phone, says where it opens. Never silent. */
async function openActivity($: $, surface?: string): Promise<void> {
  return openCenterAt($, ACTIVITY_PAGE, surface);
}

/** Opens the control center beside the session, at a page of its own or at home; from the phone, says where. Never silent. */
async function openCenterAt($: $, address: string | undefined, surface?: string): Promise<void> {
  try {
    const c = await ctxOf($);
    if (surface !== undefined && surface !== 'terminal') {
      $.ui.toast(tIn(c.lang, 'ctl.center.remote'), { timeoutMs: TOAST_MS.result });
      return;
    }
    const r = await openCenter($, c, address);
    $.ui.toast(r.ok ? tIn(c.lang, r.opens === 'tab' ? 'ctl.center.tab' : 'ctl.center.window') : r.text.split('\n')[0]!, { timeoutMs: TOAST_MS.result });
  } catch {
    /* what was on the screen stays as it is */
  }
}

/** The control center's page of what Mode_Code did in the background, and why (src/tui/tree.tsx). */
const ACTIVITY_PAGE = 'activity/feed';

/** How long the strip stays still before its presses are told to Claude. */
const PRESS_QUIET_MS = 2500;

async function appendNotes($: $, notes: readonly string[]): Promise<void> {
  if (notes.length) await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: notes.join('\n\n') }] } });
}

async function holdPressNotes($: $, kind: 'mode' | 'style' | 'flow', notes: string[]): Promise<void> {
  const c = await ctxOf($);
  const gen = c.heldPress.gen + 1;
  c.heldPress = { notes: { ...c.heldPress.notes, [kind]: notes }, gen };
  $.clock.after(PRESS_QUIET_MS, () => {
    if (c.heldPress.gen === gen) void appendNotes($, takePressNotes(c)).catch(() => undefined);
  });
}

/** The held notes, in the strip's order, and none held after: told now (a quiet moment, or with a prompt). */
function takePressNotes(c: Ctx): string[] {
  const n = c.heldPress.notes;
  c.heldPress = { notes: {}, gen: c.heldPress.gen + 1 };
  return [...(n.mode ?? []), ...(n.flow ?? []), ...(n.style ?? [])];
}

/** Asks the person to pick one of 2-4 options (or type under "Other"); null when they dismissed it or nobody can be asked. */
async function askOptions($: $, question: string, options: readonly string[]): Promise<string | null> {
  try {
    const answer = (await $.ui.ask(question, [...options])).trim();
    return answer || null;
  } catch {
    return null;
  }
}

function percentText(n: number | null, lang: Lang): string {
  return n === null ? '?' : percent(n, lang);
}

function budgetText(b: Budget, lang: Lang): string {
  return b.plus ? `+${b.n}` : percent(b.n, lang);
}

/** Every project and folder the person may want to continue (see continueChoices). */
async function continueChoicesOf($: $, c: Ctx): Promise<ContinueChoice[]> {
  const cwd = await $.session.cwd();
  const env = pathEnv(c, cwd);
  const cdir = claudeDirOf(c, cwd);
  const global = c.env.CLAUDE_CONFIG_DIR ? joinPath(cdir, '.claude.json') : joinPath(c.home, '.claude.json');
  let known: string[] = [];
  try {
    known = Object.keys((JSON.parse((await readFile($, global)) ?? '{}') as { projects?: Record<string, unknown> }).projects ?? {});
  } catch {
    known = [];
  }
  // When work last happened in each: Claude Code keeps one folder of transcripts per project, named after its path.
  let dirs: { name: string; mtimeMs: number }[] = [];
  try {
    dirs = await $.fs.list(joinPath(cdir, 'projects'));
  } catch {
    dirs = [];
  }
  const touched = new Map(dirs.map((d) => [d.name, d.mtimeMs]));
  const folders = known.map((p) => ({ path: resolvePath(p, env), at: touched.get(p.replace(/[^A-Za-z0-9]/g, '-')) ?? 0 }));
  // And the folders this tool's sessions worked in.
  for (const s of await sessionStates($, c)) if (s.cwd) folders.push({ path: s.cwd, at: s.aliveAt });
  return continueChoices({ projects: c.config.projects, folders, platform: c.platform });
}

/** The records of this computer's `limit` most recent sessions, newest first. */
async function sessionStates($: $, c: Ctx, limit = 200): Promise<ModSessionState[]> {
  let entries: { name: string; mtimeMs: number }[] = [];
  try {
    entries = (await $.fs.list(c.layout.sessionsDir)).filter((x) => x.name.endsWith('.mod.json')).sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
  const out: ModSessionState[] = [];
  for (const x of entries.slice(0, limit)) {
    const s = parseModState(await readFile($, joinPath(c.layout.sessionsDir, x.name)));
    if (s) out.push(s);
  }
  return out;
}

/** Continues `ch`: a registered project by its name, any other folder by its project key, both as the person's "devam". */
async function continueWith($: $, c: Ctx, ch: ContinueChoice, budget: Budget | null): Promise<{ text: string; context: string[] }> {
  const reg = ch.project ? c.config.projects.find((p) => p.id === ch.project) : undefined;
  let notes: string[] = [];
  if (reg) notes = await sendAsPerson($, c, continuePhrase(reg.names[0] ?? reg.id, budget, c.lang));
  else if (ch.folder) {
    const top = await gitIn($, ch.folder, ['rev-parse', '--show-toplevel'], 5000);
    const folder = top.ok && top.out ? resolvePath(top.out, pathEnv(c, ch.folder)) : ch.folder;
    const remote = top.ok ? await gitIn($, folder, ['config', '--get', 'remote.origin.url'], 5000) : null;
    c.pendingContinue = { key: projectKey({ id: null, remote: remote?.ok ? remote.out : null, folder }), folder, label: ch.label };
    notes = await sendAsPerson($, c, continuePhrase(null, budget, c.lang));
  }
  return { text: tIn(c.lang, 'ctl.continue.started', { label: ch.label }), context: notes };
}

/** The flow last started in this folder: `/6 <task>` starts the same kind again. */
async function lastFlowVariant($: $, c: Ctx): Promise<StartableVariant | null> {
  const cwd = await $.session.cwd();
  const here = pathKey(resolvePath(cwd, pathEnv(c, cwd)), c.platform);
  let dirs: { name: string }[] = [];
  try {
    dirs = await $.fs.list(c.layout.flowsDir);
  } catch {
    return null;
  }
  for (const d of [...dirs].sort((a, b) => b.name.localeCompare(a.name, 'en')).slice(0, 50)) {
    const f = parseFlow(await readFile($, joinPath(c.layout.flowsDir, d.name, 'flow.json')));
    if (f && pathKey(f.cwd, c.platform) === here) return f.variant;
  }
  return null;
}

/** A command this plugin ran itself ($.command.run) came from a press; anything else, from the person's slash command. */
function viaOf(e: In<'command.run'>): 'command' | 'strip' {
  const o = e.origin as { kind?: string; name?: string } | undefined;
  return o?.kind === 'plugin' && o.name === PLUGIN_NAME ? 'strip' : 'command';
}

/**
 * Whether the person is at the computer's terminal: their Enter there, or a run of a plugin's own. A message
 * through the bridge comes from a phone or the web, and a headless run has no one to see a new tab.
 */
function whereOf(e: In<'command.run'>): 'here' | 'remote' {
  const kind = (e.origin as { kind?: string } | undefined)?.kind;
  return kind === 'composer' || kind === 'plugin' ? 'here' : 'remote';
}

async function onCommand($: $, e: In<'command.run'>, next: Nx<'command.run'>): Out<'command.run'> {
  const short = SHORT_COMMANDS.get(e.command);
  if (short) return shortCommand($, short, String(e.args ?? ''));
  if ((LIST_COMMANDS as readonly string[]).includes(e.command)) return { text: await commandsList($) };
  if (!commandNamed(e.command)) return next(e);
  return control($, e.command, String(e.args ?? ''), viaOf(e), whereOf(e), (e.origin as { kind?: string } | undefined)?.kind);
}

/**
 * Why something is as it is (src/core/ux/why.ts), for `/neden` and the `why` tool: every part with no word, one part
 * or one rule of the belt with one, and "last" for the last call this session refused, with its rule's reasons.
 */
async function whyAnswer($: $, c: Ctx, word: string): Promise<string> {
  const facts: WhyFacts = { config: c.config, session: c.state, now: await $.clock.now() };
  const w = word.trim();
  if (!w) return whyAll(facts, c.lang).map(whyText).join('\n');
  if ((RULE_IDS as readonly string[]).includes(w)) return whyText(whyRule(w as RuleId, facts, c.lang));
  if (/^(?:last|son)$/i.test(w)) {
    for (let i = c.events.length - 1; i >= 0; i--) {
      let e: ActivityEvent;
      try {
        e = JSON.parse(c.events[i]!) as ActivityEvent;
      } catch {
        continue;
      }
      if (e.verdict !== 'deny' && !(e.kind === 'belt' && e.answer !== 'allow' && e.verdict === 'ask')) continue;
      const line = activityOf(e, c.lang);
      const rule =
        Array.isArray(e.rules) && typeof e.rules[0] === 'string' && (RULE_IDS as readonly string[]).includes(e.rules[0]) ? (e.rules[0] as RuleId) : null;
      return [activityText(line, facts.now, c.lang), ...(rule ? [whyText(whyRule(rule, facts, c.lang))] : [])].join('\n');
    }
    return tIn(c.lang, 'why.noBlock');
  }
  const subject = whySubjectNamed(w);
  return subject ? whyText(why(subject, facts, c.lang)) : tIn(c.lang, 'why.none', { subjects: [...WHY_SUBJECTS, 'last'].join(', ') });
}

/** What the terminal the session runs in says about itself (LAUNCH_ENV), each name spelled out for the plugin's validator. */
async function launchEnv($: $): Promise<Record<(typeof LAUNCH_ENV)[number], string | undefined>> {
  const [
    WT_SESSION,
    TMUX,
    TERM_PROGRAM,
    WEZTERM_PANE,
    KONSOLE_VERSION,
    GNOME_TERMINAL_SCREEN,
    GNOME_TERMINAL_SERVICE,
    DISPLAY,
    WAYLAND_DISPLAY,
    SSH_CONNECTION,
    SSH_CLIENT,
    SSH_TTY,
    WSL_DISTRO_NAME,
  ] = await Promise.all([
    $.env.get('WT_SESSION'),
    $.env.get('TMUX'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('WEZTERM_PANE'),
    $.env.get('KONSOLE_VERSION'),
    $.env.get('GNOME_TERMINAL_SCREEN'),
    $.env.get('GNOME_TERMINAL_SERVICE'),
    $.env.get('DISPLAY'),
    $.env.get('WAYLAND_DISPLAY'),
    $.env.get('SSH_CONNECTION'),
    $.env.get('SSH_CLIENT'),
    $.env.get('SSH_TTY'),
    $.env.get('WSL_DISTRO_NAME'),
  ]);
  return {
    WT_SESSION,
    TMUX,
    TERM_PROGRAM,
    WEZTERM_PANE,
    KONSOLE_VERSION,
    GNOME_TERMINAL_SCREEN,
    GNOME_TERMINAL_SERVICE,
    DISPLAY,
    WAYLAND_DISPLAY,
    SSH_CONNECTION,
    SSH_CLIENT,
    SSH_TTY,
    WSL_DISTRO_NAME,
  };
}

/**
 * Opens the control center beside the session (`/0`): the program the installation recorded, in a new tab of
 * this terminal or a window of its own (src/core/launch.ts). Says what went wrong, with the command to open
 * it by hand, when it cannot.
 */
async function openCenter($: $, c: Ctx, address?: string): Promise<{ ok: true; opens: 'tab' | 'window' } | { ok: false; text: string }> {
  const lang = c.lang;
  const recorded = centerProgram(await readFile($, c.layout.manifest));
  if (!recorded || !(await $.fs.exists(recorded[1]).catch(() => false))) return { ok: false, text: tIn(lang, 'ctl.center.unknown', { app: CLI_NAME }) };
  // At a page of its own (`open <address>`): what the strip's activity count and Mo lead to.
  const program = address ? [...recorded, 'open', address] : recorded;
  const cmd = commandLine(program, c.platform);
  const env = await launchEnv($);
  const cwd = c.state.cwd ?? (await $.session.cwd());
  // Windows Terminal by its alias's full path: Claude Code refuses to find it by name in a session opened in
  // the home folder. The folder is listed, not checked: a check follows the link, which Windows refuses.
  let wt: string | undefined;
  if (c.platform === 'win32' && env.WT_SESSION) {
    const apps = windowsAppsDir(c.env.LOCALAPPDATA);
    wt = windowsTerminalProgram(apps, apps === null ? [] : await $.fs.list(apps).catch(() => []));
  }
  const launch = terminalLaunch({ platform: c.platform, env, program, cwd, title: APP_NAME, wt });
  if (!launch) {
    await logEvent($, c, { kind: 'center', via: null, ok: false });
    return { ok: false, text: tIn(lang, 'ctl.center.noTerminal', { cmd }) };
  }
  let reason: string | null = null;
  try {
    const r = await $.process.run(launch.argv, { cwd, timeoutMs: 15_000 });
    if (r.exitCode !== 0) reason = `${launch.via}: ${r.stderr.trim().split('\n')[0]?.slice(0, 160) || `exit ${r.exitCode}`}`;
  } catch (err) {
    reason = `${launch.via}: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
  }
  await logEvent($, c, { kind: 'center', via: launch.via, ok: reason === null, ...(reason === null ? {} : { reason }) });
  return reason === null ? { ok: true, opens: OPENS[launch.via] } : { ok: false, text: tIn(lang, 'ctl.center.failed', { reason, cmd }) };
}

// ── parallel agents (core/agents.ts, docs/agents.md) ──

/** The window where the person sets the session's agents: its pane's id. */
const AGENTS_PANE = WINDOWS.agents.pane;
const agentsPaneAtom = atom(
  { plugin: 'mode-code', key: 'agentsPane' } as const,
  { lang: 'en', current: '', mode: 'off', n: '5', rows: [], editing: 0, writable: true, running: [], error: null } as ModeCodeAgentsPane,
);
/** The task typed for the row being edited, kept by the plugin while it is typed (a redraw per key would fight it). */
const agentsDraft = { task: '' };

function agentsCfg(c: Ctx): AgentsSettings {
  return { enabled: c.config.agents.enabled, helpers: c.config.agents.helpers };
}

type AgentRecord = Awaited<ReturnType<$['agent']['list']>>[number];

/** The session's agents as Claude Code lists them; none where it cannot say. */
async function agentList($: $): Promise<AgentRecord[]> {
  try {
    return await $.agent.list();
  } catch {
    return [];
  }
}

const AT_WORK = new Set(['pending', 'running', 'waiting']);

/** Ultracode is on: the person's last /effort, else the settings; or the word in their prompt, for that request. */
function ultracodeOn(c: Ctx): boolean {
  return (c.ultracode.command ?? c.ultracode.settings) || c.ultracode.prompt;
}

/** Ultracode's state into the session's: while on, the agent mode stands aside; when it ends, the setting is back. */
async function syncUltracode($: $, c: Ctx): Promise<void> {
  const on = ultracodeOn(c);
  if (on === c.state.agents.ultracode) return;
  c.state = { ...c.state, agents: { ...c.state.agents, ultracode: on } };
  await saveState($, c);
  await logEvent($, c, { kind: 'agents', action: on ? 'ultracodeOn' : 'ultracodeOff' });
  if (c.config.agents.enabled) $.ui.toast(tIn(c.lang, on ? 'agents.ultracode.on' : 'agents.ultracode.off'), { timeoutMs: 8000 });
  await refreshStatus($, c);
}

/** Whether the settings start Claude Code in ultracode (read where they can be; a failure leaves it as it was). */
async function readUltracodeSetting($: $, c: Ctx): Promise<void> {
  try {
    const s = await $.settings.read();
    c.ultracode.settings = s.ultracode === true || s.effortLevel === 'ultracode';
  } catch {
    /* unknown: the commands and the prompt still tell */
  }
}

/**
 * An agent about to start (`agent.spawn`): let through, refused with why, or fitted to an assigned row (the person's
 * task word for word, its kind, its model), as core/agents.ts decides. Workflows (ultracode) are never touched.
 */
async function onAgentSpawn($: $, e: In<'agent.spawn'>, next: Nx<'agent.spawn'>): Out<'agent.spawn'> {
  const c = await ctxOf($);
  const cfg = agentsCfg(c);
  if (!cfg.enabled) return next(e);
  const s = c.state.agents;
  const workflow = e.workflow !== undefined;
  const running = s.mode === 'free' && !s.ultracode && !workflow ? countRunning(await agentList($), cfg) : 0;
  const d = decideSpawn({ type: e.subagentType, prompt: e.prompt, description: e.description, toolUseId: e.tool_use_id, workflow, running }, s, cfg);
  if (d.kind === 'pass') {
    const r = await next(e);
    // The strip counts the agents at work under a free mode's N: one more now.
    if (s.mode === 'free' && !s.ultracode && !workflow) await refreshStatus($, c);
    return r;
  }
  if (d.kind === 'deny') {
    await logEvent($, c, { kind: 'agents', action: 'deny', why: d.why, type: e.subagentType, n: s.n });
    // Off with the helpers free: Claude is told they are still there, or it takes the refusal for all agents.
    const key = d.why === 'off' && cfg.helpers ? 'agents.deny.offHelpers' : (`agents.deny.${d.why}` as MessageKey);
    return { deny: tIn(c.lang, key, { n: s.n }) };
  }
  c.state = { ...c.state, agents: withStarted(s, d.row, e.tool_use_id) };
  await saveState($, c);
  await logEvent($, c, { kind: 'agents', action: 'assign', row: d.row + 1, of: s.n, type: d.type, model: d.model, task: !!s.rows[d.row]?.task.trim() });
  await refreshStatus($, c);
  return next({ ...e, prompt: d.prompt, subagentType: d.type, description: d.description, ...(d.model ? { model: d.model } : {}) });
}

/** An assigned batch whose agents are all done closes itself, and says so; else the strip's count is brought up to date. */
async function agentsCheck($: $, c: Ctx): Promise<void> {
  const s = c.state.agents;
  if (!c.config.agents.enabled || s.mode !== 'assigned' || !s.batch) return;
  const seen = await agentList($);
  if (!batchOver(s, seen)) return refreshStatus($, c);
  const started = s.batch.started.length;
  c.state = { ...c.state, agents: closeBatch(s) };
  await saveState($, c);
  await logEvent($, c, { kind: 'agents', action: 'batchDone', started, of: s.n });
  $.ui.toast(tIn(c.lang, 'agents.batchDone', { n: started, of: s.n }), { timeoutMs: 8000 });
  await refreshStatus($, c);
}

/** The person's prompt: an assigned mode takes it as its batch (a batch before it is sealed); Claude is told what was set. */
async function agentsOnPrompt($: $, c: Ctx, text: string): Promise<string[]> {
  if (!c.config.agents.enabled) return [];
  await readUltracodeSetting($, c);
  c.ultracode.prompt = /\bultracode\b/i.test(text);
  await syncUltracode($, c);
  c.state = { ...c.state, agents: onPersonPrompt(c.state.agents, await $.clock.now()) };
  await saveState($, c);
  // A batch this prompt sealed with nothing left at work closes now, and is said with this very prompt.
  await agentsCheck($, c);
  const s = c.state.agents;
  const note = s.untold && !s.ultracode ? modeNote(s, agentsCfg(c), s.untold) : null;
  if (note) {
    c.state = { ...c.state, agents: { ...s, untold: false } };
    await saveState($, c);
  }
  return note ? [note] : [];
}

/** Stops one agent with Claude Code's own TaskStop; false where it could not. */
async function stopAgent($: $, id: string): Promise<boolean> {
  try {
    const r = (await $.tool.call({ tool: 'TaskStop', task_id: id } as never)) as { deny?: unknown; isError?: unknown } | null;
    return !!r && r.deny === undefined && r.isError !== true;
  } catch {
    return false;
  }
}

/** Stops every agent at work (not the workflows'); an assigned batch takes no more. The line to show. */
async function stopAgents($: $, c: Ctx): Promise<string> {
  const working = (await agentList($)).filter((a) => AT_WORK.has(a.status));
  const s = c.state.agents;
  if (s.mode === 'assigned' && s.batch && !s.batch.sealed) {
    c.state = { ...c.state, agents: { ...s, batch: { ...s.batch, sealed: true } } };
    await saveState($, c);
  }
  if (!working.length) {
    await agentsCheck($, c);
    return tIn(c.lang, 'agents.none');
  }
  const stopped = await Promise.all(working.map((a) => stopAgent($, a.id)));
  const ok = stopped.filter(Boolean).length;
  await logEvent($, c, { kind: 'agents', action: 'stop', stopped: ok, failed: working.length - ok });
  await agentsCheck($, c);
  return [ok ? tIn(c.lang, 'agents.stopped', { n: ok }) : '', ok < working.length ? tIn(c.lang, 'agents.stopFailed', { n: working.length - ok }) : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * The person sets the session's agents (the window, /ajan): the line to show, and whether it was set.
 */
async function setAgents($: $, c: Ctx, mode: AgentMode, n: number, rows: readonly AgentRow[] = []): Promise<{ line: string; set: boolean }> {
  const lang = c.lang;
  const writable = !isRestricted(modeNow(c));
  c.state = { ...c.state, agents: setMode(c.state.agents, mode, n, mode === 'assigned' ? rowsFor(n, rows, writable) : []) };
  await saveState($, c);
  await logEvent($, c, { kind: 'agents', action: 'set', mode, n: mode === 'off' ? null : n });
  await refreshStatus($, c);
  return { line: mode === 'off' ? tIn(lang, 'agents.set.off') : tIn(lang, mode === 'free' ? 'agents.set.free' : 'agents.set.assigned', { n }), set: true };
}

/** How `/ajan` is used, in the person's words: a line of its own, never a toast's. */
function agentsUsage(lang: Lang): string {
  const word = (k: 'exact' | 'off' | 'stop') => tIn(lang, `agents.word.${k}`);
  return tIn(lang, 'agents.usage', { cmd: commandOf({ kind: 'agents' }, lang), exact: word('exact'), off: word('off'), stop: word('stop') });
}

/** `/ajan` with words: N, exact N, off, stop; a line, or null for none (the window, or how to use it). */
async function agentsCommand($: $, c: Ctx, args: string): Promise<string | null> {
  const lang = c.lang;
  const a = fold(args.trim());
  if (!a) return null;
  if (/^(?:kapat|off|0|kapali)$/.test(a)) return (await setAgents($, c, 'off', c.state.agents.n)).line;
  if (/^(?:dur|stop|durdur)$/.test(a)) return stopAgents($, c);
  const exact = /^(?:tam|exact|=)\s*(\S+)$/.exec(a);
  const n = agentCount(exact ? exact[1] : a);
  if (n === null) return `${tIn(lang, 'agents.bad')}\n${agentsUsage(lang)}`;
  const r = await setAgents($, c, exact ? 'assigned' : 'free', n);
  return r.set && n > MANY_AGENTS ? `${r.line}${tIn(lang, 'agents.many')}` : r.line;
}

/** The window's state from the session's: the mode, its count and rows, and the agents at work now. */
async function agentsPaneFrom($: $, c: Ctx): Promise<void> {
  const s = c.state.agents;
  const writable = !isRestricted(modeNow(c));
  const running = (await agentList($)).filter((a) => AT_WORK.has(a.status)).map((a) => ({ id: a.id, label: `${a.description || a.type} · ${a.type}` }));
  await update($, agentsPaneAtom, (x) => ({
    ...x,
    lang: c.lang,
    current: s.mode === 'off' ? tIn(c.lang, 'agents.mode.off') : tIn(c.lang, s.mode === 'free' ? 'ux.say.agents.free' : 'ux.say.agents.assigned', { n: s.n }),
    mode: s.mode,
    n: String(s.n),
    rows: s.mode === 'assigned' && s.rows.length ? s.rows : rowsFor(s.n, x.rows, writable),
    editing: 0,
    writable,
    running,
    error: null,
  }));
  const pane = await read($, agentsPaneAtom);
  agentsDraft.task = pane.rows[0]?.task ?? '';
}

/** Opens the window; false where no window can be shown (a phone: the command's words work there). */
async function openAgentsPane($: $, c: Ctx): Promise<boolean> {
  await agentsPaneFrom($, c);
  return openWindow($, 'agents', c.lang, 18);
}

/** The window's rows with the task being typed kept in the row it belongs to. */
function rowsWithDraft(pane: ModeCodeAgentsPane): AgentRow[] {
  return pane.rows.map((r, i) => (i === pane.editing ? { ...r, task: agentsDraft.task } : r));
}

/** The window's Apply: its mode, count and rows become the session's. */
async function applyAgentsPane($: $): Promise<void> {
  const c = await ctxOf($);
  const pane = await read($, agentsPaneAtom);
  const n = agentCount(pane.n);
  if (n === null && pane.mode !== 'off') {
    await update($, agentsPaneAtom, (x) => ({ ...x, error: tIn(c.lang, 'agents.bad') }));
    return;
  }
  const r = await setAgents($, c, pane.mode, n ?? c.state.agents.n, rowsWithDraft(pane));
  if (!r.set) {
    await update($, agentsPaneAtom, (x) => ({ ...x, error: r.line }));
    return;
  }
  await closeWindow($, AGENTS_PANE);
  // Above 20 the window said what decides: the toast keeps to what was set.
  $.ui.toast(r.line, { timeoutMs: 8000 });
}

/** The agents at work now, into the window (it draws from its own state alone). */
async function agentsPaneRunning($: $): Promise<void> {
  const running = (await agentList($)).filter((a) => AT_WORK.has(a.status)).map((a) => ({ id: a.id, label: `${a.description || a.type} · ${a.type}` }));
  await update($, agentsPaneAtom, (x) => ({ ...x, running }));
}

/** The window's Stop on one agent. */
async function stopOneFromPane($: $, id: string): Promise<void> {
  const c = await ctxOf($);
  const ok = await stopAgent($, id);
  await logEvent($, c, { kind: 'agents', action: 'stop', stopped: ok ? 1 : 0, failed: ok ? 0 : 1 });
  $.ui.toast(tIn(c.lang, ok ? 'agents.stopped' : 'agents.stopFailed', { n: 1 }), { timeoutMs: 6000 });
  await agentsPaneRunning($);
}

/** The window's Stop all. */
async function stopAllFromPane($: $): Promise<void> {
  const c = await ctxOf($);
  $.ui.toast(await stopAgents($, c), { timeoutMs: 6000 });
  await agentsPaneRunning($);
}

/** The window's rows after the count changed: kept where they were, made or cut to the new count. */
function rowsForCount(x: ModeCodeAgentsPane, text: string): Pick<ModeCodeAgentsPane, 'n' | 'rows' | 'editing'> {
  const n = agentCount(text);
  if (n === null) return { n: text, rows: x.rows, editing: x.editing };
  const rows = rowsFor(n, rowsWithDraft(x), x.writable);
  return { n: text, rows, editing: Math.min(x.editing, n - 1) };
}

// ── the windows (docs/design.md, Window; src/core/ux/catalog.ts, WINDOWS): one pattern, drawn with the kit ──

const QUOTA_PANE = WINDOWS.quota.pane;
const FLOW_PANE = WINDOWS.flow.pane;
const quotaPaneAtom = atom(
  { plugin: 'mode-code', key: 'quotaPane' } as const,
  { lang: 'en', week: null, target: null, limit: 99, pick: '+10', error: null } as ModeCodeQuotaPane,
);
/** A budget typed in its window: the plugin's own while it is typed (a redraw on every key would fight the typing). */
const quotaDraft = { text: '' };
const flowPaneAtom = atom({ plugin: 'mode-code', key: 'flowPane' } as const, { lang: 'en', pick: 'full', error: null } as ModeCodeFlowPane);
/** A flow's task typed in its window, kept while the window is open. */
const flowDraft = { task: '' };
/** The budgets a window offers to pick. */
const BUDGET_PICKS = ['+5', '+10', '+20'] as const;

/** The elements a window draws with: Claude Code's, as the surface resolves them. */
type Els = { Box: unknown; Text: unknown; Button: unknown; Input?: unknown };
type Node = ReturnType<typeof h>;

/** The cells across a window's body, as the surface measured it. */
function paneWidth(props: unknown): number {
  return Math.max(30, Number((props as { bodyColumns?: number }).bodyColumns ?? 60));
}

/**
 * Opens a window as a dialog: it takes the keys, Esc closes it, toasts wait behind it. False where none can be shown.
 *
 * The cockpit steps aside for it and comes back when it closes. Beside the cockpit the window would be a second tab
 * that is not shown: Claude Code raises a pane only while the prompt has the keys, and a press in the cockpit or the
 * strip holds them there, so the window opened and nothing seemed to happen (2.1.305, the person's report).
 */
async function openWindow($: $, id: keyof typeof WINDOWS, lang: Lang, rows: number): Promise<boolean> {
  const def = WINDOWS[id];
  const c = await ctxOf($).catch(() => null);
  const aside = c !== null && c.cockpit.open;
  if (aside) await cockpitAside($, c, def.pane);
  try {
    const opened = await $.ui.open({ id: def.pane, title: tIn(lang, def.title), focus: true, closeOnEscape: true, holdToasts: true, rows });
    if (opened.isPlaced) return true;
    await $.ui.close({ id: def.pane });
  } catch {
    /* no window here */
  }
  if (aside) await cockpitBack($, c, false);
  return false;
}

/** The cockpit closed for the window `pane`, and the strip told: what it showed is kept for its return. */
async function cockpitAside($: $, c: Ctx, pane: string): Promise<void> {
  c.cockpit.away = pane;
  c.cockpit.open = false;
  await $.ui.close({ id: COCKPIT_PANE }).catch(() => undefined);
  await refreshStatus($, c);
}

/** Closes one of the windows; the cockpit, if it stepped aside for it, comes back with the keys the press held. */
async function closeWindow($: $, pane: string): Promise<void> {
  await $.ui.close({ id: pane }).catch(() => undefined);
  const c = await ctxOf($).catch(() => null);
  if (c && c.cockpit.away === pane) await cockpitBack($, c, true);
}

/** The cockpit back after the window it stepped aside for: with the keys when the window closed at a press in it. */
async function cockpitBack($: $, c: Ctx, keys: boolean): Promise<void> {
  c.cockpit.away = null;
  if (!c.cockpit.open) await openCockpit($, c, keys);
}

/**
 * A window's frame (src/core/ux/kit.ts, windowFrame): the catalog's sentence on what it is for, how it is now, its
 * controls, what applying will do, Apply and Cancel. Cancel closes it and changes nothing.
 */
function windowTree(
  $: $,
  els: Els,
  def: WindowDef,
  p: {
    lang: Lang;
    width: number;
    now: string;
    controls: Node[];
    preview: string | null;
    apply: () => unknown;
    error: string | null;
    after?: Node[];
    labelWidth: number;
    cancelFirst?: boolean;
  },
): Node {
  return windowFrame(claudeHost(els), {
    what: tIn(p.lang, def.what),
    now: { label: tIn(p.lang, 'ux.win.now'), text: p.now },
    width: p.width,
    controls: p.controls,
    preview: p.preview ? { label: tIn(p.lang, 'ux.win.preview'), text: p.preview } : null,
    apply: { id: 'apply', label: tIn(p.lang, def.apply), onPress: () => void p.apply() },
    cancel: {
      id: 'cancel',
      label: tIn(p.lang, 'ux.win.cancel'),
      onPress: () => void closeWindow($, def.pane),
      ...(p.cancelFirst ? { autoFocus: true } : {}),
    },
    error: p.error,
    ...(p.after ? { after: p.after } : {}),
    labelWidth: p.labelWidth,
  });
}

/** The label column every row of a window shares, its own two labels counted in (docs/design.md, Grid). */
function windowLabels(lang: Lang, labels: readonly string[]): number {
  return labelColumn([...labels, tIn(lang, 'ux.win.now'), tIn(lang, 'ux.win.preview')], cells, 26);
}

/** The parallel agents window: the mode, its count, an assigned batch's rows one at a time, the agents at work. */
function agentsWindow($: $, els: Els, pane: ModeCodeAgentsPane, width: number): Node {
  const k = claudeHost(els);
  const Box = els.Box as Tag;
  const Text = els.Text as Tag;
  const Input = els.Input as Tag;
  const t = (key: MessageKey, params?: Record<string, string | number>) => tIn(pane.lang, key, params);
  const set = (patch: (x: ModeCodeAgentsPane) => Partial<ModeCodeAgentsPane>) => void update($, agentsPaneAtom, (x) => ({ ...x, ...patch(x), error: null }));
  const setRow = (patch: Partial<AgentRow>) => set((x) => ({ rows: x.rows.map((r, i) => (i === x.editing ? { ...r, task: agentsDraft.task, ...patch } : r)) }));
  const row = pane.rows[pane.editing];
  const n = agentCount(pane.n);
  const countLabel = t(pane.mode === 'free' ? 'agents.pane.nFree' : 'agents.pane.nAssigned');
  const taskLabel = `${t('agents.pane.task')} ${pane.editing + 1}`;
  const lw = windowLabels(pane.lang, [t('agents.pane.mode'), countLabel, t('agents.pane.row'), taskLabel, t('agents.pane.kind'), t('agents.pane.model')]);
  const line = (label: string, value: Node) => kitRow(k, { label, labelWidth: lw, value });
  const controls: Node[] = [
    line(
      t('agents.pane.mode'),
      choices(k, {
        column: true,
        options: AGENT_MODES.map((m) => ({
          id: `ag-mode-${m}`,
          label: t(`agents.mode.${m}` as MessageKey),
          chosen: pane.mode === m,
          onPress: () => set((x) => ({ mode: m, ...rowsForCount(x, x.n) })),
        })),
      }),
    ),
  ];
  if (pane.mode !== 'off') {
    controls.push(
      line(countLabel, h(Input, { key: 'ag-n', value: pane.n, onInput: (v: string) => set((x) => rowsForCount(x, v)), onSubmit: () => applyAgentsPane($) })),
    );
    if ((n ?? 0) > MANY_AGENTS) controls.push(h(Text, { key: 'ag-many', dimColor: true }, t('agents.many').trim()));
  }
  if (pane.mode === 'assigned' && row) {
    const go = (to: number) =>
      set((x) => {
        const rows = rowsWithDraft(x);
        agentsDraft.task = rows[to]?.task ?? '';
        return { rows, editing: to };
      });
    controls.push(
      line(
        t('agents.pane.row'),
        h(
          Box,
          { flexDirection: 'row' },
          ...(pane.editing > 0
            ? [action(k, { id: 'ag-prev', label: t('agents.pane.prev'), onPress: () => go(pane.editing - 1) }), h(Text, { key: 'ag-gap1' }, ' ')]
            : []),
          h(Text, { key: 'ag-row', bold: true }, t('agents.pane.rowOf', { i: pane.editing + 1, n: pane.rows.length })),
          ...(pane.editing < pane.rows.length - 1
            ? [h(Text, { key: 'ag-gap2' }, ' '), action(k, { id: 'ag-next', label: t('agents.pane.next'), onPress: () => go(pane.editing + 1) })]
            : []),
        ),
      ),
      line(
        taskLabel,
        h(Input, {
          key: `ag-task-${pane.editing}`,
          placeholder: t('agents.pane.taskHint'),
          value: agentsDraft.task,
          onInput: (v: string) => {
            agentsDraft.task = v;
          },
          onSubmit: (v: string) => {
            agentsDraft.task = v;
            return applyAgentsPane($);
          },
        }),
      ),
      line(
        t('agents.pane.kind'),
        choices(k, {
          options: AGENT_KINDS.filter((x) => pane.writable || x !== 'code').map((x) => ({
            id: `ag-kind-${x}`,
            label: t(`agents.kind.${x}` as MessageKey),
            chosen: row.kind === x,
            onPress: () => setRow({ kind: x as AgentKind }),
          })),
        }),
      ),
      line(
        t('agents.pane.model'),
        choices(k, {
          options: ['', ...AGENT_MODELS].map((m) => ({
            id: `ag-model-${m || 'session'}`,
            label: m || t('agents.model.session'),
            chosen: (row.model ?? '') === m,
            onPress: () => setRow({ model: m || null }),
          })),
        }),
      ),
    );
    if (!pane.writable) controls.push(h(Text, { key: 'ag-ro', dimColor: true }, t('agents.pane.readOnly')));
  }
  const preview = pane.mode === 'off' ? t('agents.set.off') : n === null ? null : t(pane.mode === 'free' ? 'agents.set.free' : 'agents.set.assigned', { n });
  const after: Node[] = pane.running.length
    ? [
        h(Box, { key: 'ag-running', marginTop: 1 }, h(Text, { bold: true }, `${t('agents.pane.running')} (${pane.running.length})`)),
        ...pane.running
          .slice(0, 8)
          .map((a) =>
            h(
              Box,
              { key: `ag-r-${a.id}`, flexDirection: 'row' },
              h(Box, { flexGrow: 1, flexShrink: 1 }, h(Text, { wrap: 'truncate-end' }, a.label)),
              h(
                Box,
                { flexShrink: 0, marginLeft: 1 },
                action(k, { id: `ag-view-${a.id}`, label: t('agents.pane.view'), onPress: () => void viewAgent($, a.id) }),
              ),
              h(
                Box,
                { flexShrink: 0, marginLeft: 1 },
                action(k, { id: `ag-stop-${a.id}`, label: t('agents.pane.stop'), onPress: () => void stopOneFromPane($, a.id) }),
              ),
            ),
          ),
        action(k, { id: 'ag-stop-all', label: t('agents.pane.stopAll'), onPress: () => void stopAllFromPane($) }),
      ]
    : [];
  return windowTree($, els, WINDOWS.agents, {
    lang: pane.lang,
    width,
    now: t('agents.pane.now', {
      mode: pane.current,
      running: pane.running.length ? t('agents.pane.atWork', { n: pane.running.length }) : t('agents.pane.noneRunning'),
    }),
    controls,
    preview,
    apply: () => applyAgentsPane($),
    error: pane.error,
    after,
    labelWidth: lw,
  });
}

/** An agent's conversation in the main view, as the person's own switch from the tasks list does; the window goes. */
async function viewAgent($: $, id: string): Promise<void> {
  await closeWindow($, AGENTS_PANE);
  const r = await $.ui.view({ agentId: id }).catch((err: unknown) => ({ deny: String((err as Error)?.message ?? err) }));
  if ('deny' in r && r.deny) $.ui.toast(String(r.deny).slice(0, 200), { timeoutMs: TOAST_MS.result });
}

/** The weekly budget window: three to pick, or one typed; what it will hold before it does. */
async function openQuotaPane($: $, c: Ctx, week: number | null): Promise<boolean> {
  quotaDraft.text = '';
  await update($, quotaPaneAtom, () => ({
    lang: c.lang,
    week,
    target: c.state.weeklyTarget,
    limit: c.config.quota.defaultWeeklyTarget,
    pick: '+10',
    error: null,
  }));
  return openWindow($, 'quota', c.lang, 12);
}

function quotaWindow($: $, els: Els, pane: ModeCodeQuotaPane, width: number): Node {
  const k = claudeHost(els);
  const Input = els.Input as Tag;
  const t = (key: MessageKey, params?: Record<string, string | number>) => tIn(pane.lang, key, params);
  const lw = windowLabels(pane.lang, [t('ctl.quotaPane.pick'), t('ctl.quotaPane.typed')]);
  const target = budgetTarget(pane.pick, pane.week);
  const problem = budgetProblem(parseBudget(pane.pick), pane.week);
  return windowTree($, els, WINDOWS.quota, {
    lang: pane.lang,
    width,
    now: t('ctl.quotaPane.now', {
      week: percentText(pane.week, pane.lang),
      budget:
        pane.target !== null
          ? t('ctl.quotaPane.budget', { target: percent(pane.target, pane.lang) })
          : t('ctl.quotaPane.noBudget', { limit: percent(pane.limit, pane.lang) }),
    }),
    controls: [
      kitRow(k, {
        label: t('ctl.quotaPane.pick'),
        labelWidth: lw,
        value: choices(k, {
          options: BUDGET_PICKS.map((v) => ({
            id: `quota-${v}`,
            label: budgetLabel(v, pane.week, pane.lang),
            chosen: v === pane.pick,
            onPress: () => void update($, quotaPaneAtom, (x) => ({ ...x, pick: v, error: null })),
          })),
        }),
      }),
      kitRow(k, {
        label: t('ctl.quotaPane.typed'),
        labelWidth: lw,
        value: h(Input, {
          key: 'quota-typed',
          placeholder: t('ctl.quotaPane.placeholder'),
          value: quotaDraft.text,
          onInput: (v: string) => {
            quotaDraft.text = v;
          },
          onSubmit: (v: string) => applyQuotaPane($, v),
        }),
      }),
    ],
    preview: problem ? t(problem.key, problem.params) : target !== null ? t('ctl.quotaPane.preview', { target: percent(target, pane.lang) }) : null,
    apply: () => applyQuotaPane($),
    error: pane.error,
    labelWidth: lw,
  });
}

/** The window's Apply: what was typed, else the budget picked; what cannot be set is said in the window. */
async function applyQuotaPane($: $, typed?: string): Promise<void> {
  const c = await ctxOf($);
  const pane = await read($, quotaPaneAtom);
  const value = (typed ?? quotaDraft.text).trim() || pane.pick;
  const problem = budgetProblem(parseBudget(value), pane.week);
  if (problem) {
    await update($, quotaPaneAtom, (x) => ({ ...x, error: tIn(c.lang, problem.key, problem.params) }));
    return;
  }
  quotaDraft.text = '';
  await closeWindow($, QUOTA_PANE);
  await press($, commandOfQuota(c.lang), value);
}

/** `/kota` or `/quota`, as the person's language names it. */
function commandOfQuota(lang: Lang): string {
  return lang === 'tr' ? 'kota' : 'quota';
}

/** The window that starts a flow: which one, and its task now or with the next message. */
async function openFlowPane($: $, c: Ctx): Promise<boolean> {
  flowDraft.task = '';
  const pick = (await lastFlowVariant($, c)) ?? 'full';
  await update($, flowPaneAtom, () => ({ lang: c.lang, pick, error: null }));
  return openWindow($, 'flow', c.lang, 14);
}

function flowWindow($: $, els: Els, pane: ModeCodeFlowPane, width: number): Node {
  const k = claudeHost(els);
  const Input = els.Input as Tag;
  const t = (key: MessageKey, params?: Record<string, string | number>) => tIn(pane.lang, key, params);
  const lw = windowLabels(pane.lang, [t('ctl.flowPane.pick'), t('ctl.flowPane.task')]);
  return windowTree($, els, WINDOWS.flow, {
    lang: pane.lang,
    width,
    now: t('ctl.flowPane.now'),
    controls: [
      kitRow(k, {
        label: t('ctl.flowPane.pick'),
        labelWidth: lw,
        value: choices(k, {
          column: true,
          options: FLOW_PRESETS.map((v) => ({
            id: `flow-${v}`,
            label: flowPresetLine(v, pane.lang),
            chosen: v === pane.pick,
            onPress: () => void update($, flowPaneAtom, (x) => ({ ...x, pick: v, error: null })),
          })),
        }),
      }),
      kitRow(k, {
        label: t('ctl.flowPane.task'),
        labelWidth: lw,
        value: h(Input, {
          key: 'flow-task',
          placeholder: t('ctl.flowPane.placeholder'),
          value: flowDraft.task,
          onInput: (v: string) => {
            flowDraft.task = v;
          },
          onSubmit: (v: string) => applyFlowPane($, v),
        }),
      }),
    ],
    preview: t('ctl.flowPane.preview', { steps: flowPresetLine(pane.pick, pane.lang) }),
    apply: () => applyFlowPane($),
    error: pane.error,
    labelWidth: lw,
  });
}

/** The window's Choose: with a task the flow starts now, as `/6 <task>` does; without one the next message is its task. */
async function applyFlowPane($: $, typed?: string): Promise<void> {
  const c = await ctxOf($);
  const pane = await read($, flowPaneAtom);
  const task = (typed ?? flowDraft.task).trim();
  flowDraft.task = '';
  await closeWindow($, FLOW_PANE);
  const steps = flowPresetLine(pane.pick, c.lang);
  if (task) {
    await appendNotes($, await sendAsPerson($, c, `${task}\n\n${flowPhrase(pane.pick, c.lang)}`));
    $.ui.toast(steps, { timeoutMs: TOAST_MS.result });
    return;
  }
  c.armed = { kind: 'flow', variant: pane.pick };
  await refreshStatus($, c);
  $.ui.toast(tIn(c.lang, 'ctl.flow.armed', { steps }), { timeoutMs: TOAST_MS.result });
}

// ── the cockpit (docs/design.md, The cockpit; src/core/ux/cockpit.ts): beside the conversation, opened by the person ──

/** What the cockpit shows, worked out by the hooks while it is open, and what the person opened or started in it. */
const cockpitAtom = atom({ plugin: 'mode-code', key: 'cockpit' } as const, { data: null } as ModeCodeCockpit);
const COCKPIT_UI: ModeCodeCockpitUi = { open: null, confirm: null, changed: null, undo: null, focus: null };
const cockpitUiAtom = atom({ plugin: 'mode-code', key: 'cockpitUi' } as const, COCKPIT_UI);

/** The permissions a press in the cockpit may turn on, each after its own warning: the first doors of its controls. */
const ALLOWABLE: ReadonlySet<string> = new Set(['agents.enabled']);

/** Where the mode in force comes from, in the order effectiveMode takes them. */
function modeFromOf(c: Ctx): ModeFrom {
  if (c.state.turnMode) return 'turn';
  if (flowRunning(c) && currentStep(c.flow!)) return 'flow';
  if (c.state.nativePlan?.on) return 'plan';
  return 'session';
}

/**
 * Works out what the cockpit shows (src/core/ux/cockpit.ts) and keeps it for the drawing: while it is open, on
 * every change the strip, Mo or the activity sees. The cockpit is a view: whatever fails here leaves it as it was.
 */
async function publishCockpit($: $, c: Ctx): Promise<void> {
  if (!c.cockpit.open) return;
  try {
    const now = await $.clock.now();
    const working = c.turnId !== null;
    const agents = (await agentList($)).filter((a) => AT_WORK.has(a.status)).map((a) => ({ id: a.id, label: `${a.description || a.type} · ${a.type}` }));
    const step = c.flow && isOpen(c.flow) ? currentStep(c.flow) : null;
    const fp = c.flow && isOpen(c.flow) ? progress(c.flow) : null;
    // The activity's newest lines are enough here: the whole of it is a press away, in the control center.
    const events: ActivityEvent[] = [];
    for (const l of c.events.slice(-400)) {
      try {
        const e = JSON.parse(l) as ActivityEvent;
        if (typeof e.kind === 'string') events.push(e);
      } catch {
        /* a torn line says nothing */
      }
    }
    const data = cockpitData(
      {
        config: c.config,
        session: c.state,
        mode: modeNow(c),
        modeFrom: modeFromOf(c),
        style: styleOf(c.state.interaction),
        now,
        quota: await quotaNow($, c),
        working,
        mo: moState(
          {
            working,
            tools: c.mo.tools,
            agents: c.mo.agents,
            asking: c.mo.asking,
            waiting: c.flow?.status === 'waiting',
            auto: c.state.interaction === 'full',
            low: c.announced !== 'ok',
            blockAt: c.mo.blockAt,
            errorAt: c.mo.errorAt,
            doneAt: c.mo.doneAt,
            stoppedAt: c.mo.stoppedAt,
          },
          now,
        ),
        calls: [...c.calls.values()],
        agents,
        flow:
          c.flow && fp && c.config.modules.modes
            ? {
                at: `${fp.at}/${fp.of}`,
                step: step ? stepName(step.kind, c.lang) : '',
                state: c.flow.status === 'paused' ? 'paused' : step?.kind === 'approve' ? 'approval' : 'running',
              }
            : null,
        events,
      },
      c.lang,
    );
    await update($, cockpitAtom, () => ({ data }));
  } catch {
    /* the cockpit shows what it showed */
  }
}

/** Whether the person keeps the cockpit open: the next session opens it in its place (state/cockpit.json). */
async function rememberCockpit($: $, c: Ctx, open: boolean): Promise<void> {
  try {
    await $.fs.write(c.layout.cockpit, JSON.stringify({ v: 1, open }) + '\n');
  } catch {
    /* the next session starts without it, as the person can open it again */
  }
}

/**
 * Opens the cockpit: asked (a press, `/0`), at any width, the keyboard in it; unasked (a session starting where the
 * person kept it open), only where the screen leaves room beside the conversation. False where it is not drawn.
 */
async function openCockpit($: $, c: Ctx, asked: boolean): Promise<boolean> {
  c.cockpit.open = true;
  await publishCockpit($, c);
  let placed = false;
  try {
    const opened = await $.ui.open({
      id: COCKPIT_PANE,
      title: tIn(c.lang, 'ck.title'),
      ...(asked ? { focus: true as const } : {}),
      rows: COCKPIT_ROWS,
      columns: COCKPIT_COLUMNS,
    });
    placed = opened.isPlaced;
    // A cockpit no one sees is not left waiting: the strip would say it is open.
    if (!placed) await $.ui.close({ id: COCKPIT_PANE });
  } catch {
    placed = false;
  }
  c.cockpit.open = placed;
  if (asked && placed) await rememberCockpit($, c, true);
  await refreshStatus($, c);
  return placed;
}

/** Closes the cockpit at the person's word; the next session starts without it. */
async function closeCockpit($: $, c: Ctx): Promise<void> {
  c.cockpit.open = false;
  await $.ui.close({ id: COCKPIT_PANE }).catch(() => undefined);
  await rememberCockpit($, c, false);
  await update($, cockpitUiAtom, () => COCKPIT_UI);
  await refreshStatus($, c);
}

/** A session starting where the person kept the cockpit open opens it again, beside the conversation. */
async function reopenCockpit($: $, c: Ctx): Promise<void> {
  try {
    const kept = JSON.parse((await readFile($, c.layout.cockpit)) ?? '{}') as { open?: unknown };
    if (kept.open === true && !c.cockpit.open) await openCockpit($, c, false);
  } catch {
    /* no record: the person opens it */
  }
}

/**
 * A setting the person changed inside Claude Code (the cockpit's press, never the model's): written to config.json as
 * the control center writes it, its row in the record of changes (src/core/ux/changes.ts), in effect at once. The
 * change made, or null when the setting already had that value.
 */
async function saveSetting(
  $: $,
  c: Ctx,
  path: SettingPath,
  value: string | number | boolean | null,
  who: ChangeWho,
): Promise<{ path: string; from: string | number | boolean | null; to: string | number | boolean | null } | null> {
  const before = parseConfig(await readFile($, c.layout.config)).config;
  const after = setConfigValue(before, path, value).config;
  const rows = changeRows(before, after, who, await $.clock.now());
  if (!rows.length) return null;
  await $.fs.write(c.layout.config, serializeConfig(after));
  try {
    await $.fs.write(c.layout.changes, appendChanges(await readFile($, c.layout.changes), rows));
  } catch {
    /* the setting is saved; only its row is lost */
  }
  await refreshConfig($, c);
  await refreshStatus($, c);
  return { path, from: valueIn(before, path) as string | number | boolean | null, to: valueIn(after, path) as string | number | boolean | null };
}

/** What a press in the cockpit does: a control of the strip, a page of the control center, or a permission's warning. */
async function cockpitAct($: $, a: CockpitAct): Promise<void> {
  if (a.kind === 'allow') {
    await update($, cockpitUiAtom, (x) => ({ ...x, confirm: a.path, open: null }));
    return;
  }
  if (a.kind === 'center') return openCenterAt($, a.address);
  await press($, a.name);
}

/** The warning confirmed: the permission is turned on, said with its undo. Only the three the cockpit offers. */
async function cockpitAllow($: $, path: string): Promise<void> {
  const c = await ctxOf($);
  if (!ALLOWABLE.has(path)) return;
  try {
    const r = await saveSetting($, c, path as SettingPath, true, 'cockpit');
    await update($, cockpitUiAtom, (x) => ({
      ...x,
      confirm: null,
      ...(r ? { changed: tIn(c.lang, 'ck.changed', { change: changeText(r as Parameters<typeof changeText>[0], c.lang) }), undo: r } : {}),
    }));
  } catch (err) {
    $.ui.toast(String((err as Error)?.message ?? err).slice(0, 200), { timeoutMs: TOAST_MS.attention });
  }
}

/** The cockpit's undo: the last change made there goes back, unless the setting changed again since. */
async function cockpitUndo($: $): Promise<void> {
  const c = await ctxOf($);
  const u = (await read($, cockpitUiAtom)).undo;
  if (!u) return;
  await refreshConfig($, c).catch(() => undefined);
  if (JSON.stringify(valueIn(c.local, u.path as SettingPath)) !== JSON.stringify(u.to)) {
    $.ui.toast(tIn(c.lang, 'changes.changedSince'), { timeoutMs: TOAST_MS.result });
    await update($, cockpitUiAtom, (x) => ({ ...x, changed: null, undo: null }));
    return;
  }
  const r = await saveSetting($, c, u.path as SettingPath, u.from, 'undo');
  await update($, cockpitUiAtom, (x) => ({ ...x, changed: null, undo: null }));
  if (r) $.ui.toast(tIn(c.lang, 'changes.undone', { change: changeText(r as Parameters<typeof changeText>[0], c.lang) }), { timeoutMs: TOAST_MS.result });
}

/** An agent's conversation in the main view; the cockpit stays beside it and says so. */
async function cockpitView($: $, id: string): Promise<void> {
  const r = await $.ui.view({ agentId: id }).catch((err: unknown) => ({ deny: String((err as Error)?.message ?? err) }));
  if ('deny' in r && r.deny) $.ui.toast(String(r.deny).slice(0, 200), { timeoutMs: TOAST_MS.result });
}

/** One agent stopped from the cockpit, as the agents window stops it. */
async function cockpitStop($: $, id: string): Promise<void> {
  const c = await ctxOf($);
  const ok = await stopAgent($, id);
  await logEvent($, c, { kind: 'agents', action: 'stop', stopped: ok ? 1 : 0, failed: ok ? 0 : 1 });
  $.ui.toast(tIn(c.lang, ok ? 'agents.stopped' : 'agents.stopFailed', { n: 1 }), { timeoutMs: TOAST_MS.result });
  await publishCockpit($, c);
}

/**
 * The cockpit (docs/design.md, The cockpit): the line it opens with, where the card of what the pointer or the keyboard
 * rests on says itself (every card lies in it unseen; the surface shows one under the pointer, no hook runs), then
 * the body the kit lays out. Its height never changes, so nothing moves under the pointer.
 */
function cockpitTree($: $, els: Els & { Client?: unknown }, d: CockpitData, ui: ModeCodeCockpitUi, props: unknown, still: boolean): Node {
  const Box = els.Box as Tag;
  const Text = els.Text as Tag;
  const Button = els.Button as Tag;
  const Client = els.Client as Tag | undefined;
  const p = props as { bodyColumns?: number; isFocused?: boolean; view?: { agentId?: string } };
  const width = Math.max(30, Number(p.bodyColumns ?? COCKPIT_COLUMNS));
  const acts: CockpitActs<Node> = {
    toggle: (id) => void update($, cockpitUiAtom, (x) => ({ ...x, open: x.open === id ? null : id, confirm: null })),
    act: (a) => void cockpitAct($, a),
    allow: (path) => void cockpitAllow($, path),
    cancel: () => void update($, cockpitUiAtom, (x) => ({ ...x, confirm: null })),
    undo: () => void cockpitUndo($),
    view: (id) => void cockpitView($, id),
    stop: (id) => void cockpitStop($, id),
    open: (address) => void openCenterAt($, address),
    activity: () => void openCenterAt($, ACTIVITY_PAGE),
    center: () => void openCenterAt($, undefined),
    // A call's running time, counted by the surface (src/mod/cockpit-clock.ts); a surface with no module shows none.
    ...(Client
      ? { elapsed: (since: number, at: number) => h(Client, { key: 'ck-clock', module: './cockpit-clock.js', props: { since, at, lang: d.lang, still } }) }
      : {}),
  };
  const { body, cards } = cockpitBody(
    claudeHost(els),
    d as CockpitData,
    { open: ui.open, confirm: ui.confirm as SettingPath | null, changed: ui.changed },
    acts,
    {
      width,
    },
  );
  const lines = (s: string) => wrapText(s, width, cells);
  // Beside the conversation the cockpit is narrow: a card takes up to five rows there; above the prompt, where rows
  // are few and the line is wide, two.
  const height = width < 80 ? Math.min(5, Math.max(2, ...Object.values(cards).map((s) => lines(s).length))) : 2;
  /** Text in at most `height` lines: a card longer than the line says its start, and the rest is a press away. */
  const shown = (s: string) => {
    const all = lines(s);
    return all.length <= height ? all : [...all.slice(0, height - 1), `${all[height - 1]!.replace(/.$/u, '')}…`];
  };
  // The keyboard's card while the cockpit holds the keyboard: Claude Code says nothing when Esc hands it back.
  const focus = ui.focus && p.isFocused ? cards[ui.focus] : undefined;
  const lead = focus
    ? shown(`${mark('focus', false)} ${focus}`).map((l, i) => h(Text, { key: `ck-f-${i}`, color: COLORS.focus.claude }, l))
    : shown(tIn(d.lang, p.isFocused ? 'ck.leadKeys' : 'ck.lead')).map((l, i) => h(Text, { key: `ck-l-${i}`, dimColor: true }, l));
  const say = h(
    Box,
    { key: 'ck-say', flexDirection: 'row', height, overflow: 'hidden', width },
    ...Object.entries(cards).map(([scope, text]) =>
      h(
        Box,
        { key: `ck-card-${scope}`, display: 'none', flexDirection: 'column', flexShrink: 0, width, height, hover: { display: 'flex', scope } },
        ...shown(text).map((l, i) => h(Text, { key: `ck-c-${scope}-${i}` }, l)),
      ),
    ),
    h(Box, { key: 'ck-now', flexDirection: 'column', flexShrink: 0, width, height }, ...lead),
  );
  const agent = p.view?.agentId
    ? h(
        Box,
        { key: 'ck-agent', flexDirection: 'row', width, marginBottom: 1 },
        h(Box, { flexGrow: 1, flexShrink: 1 }, h(Text, { wrap: 'truncate-end', color: COLORS.agents.claude }, tIn(d.lang, 'ck.agentView'))),
        h(Box, { flexShrink: 0, marginLeft: 1 }, h(Button, { key: 'ck-main', plain: true, onPress: () => void $.ui.view({}) }, tIn(d.lang, 'ux.say.mainView'))),
      )
    : null;
  return h(Box, { flexDirection: 'column', width }, ...(agent ? [agent] : []), say, body);
}

/**
 * A control, by its command's name: what `/3` and a press on the strip both do. Answers the line to show and
 * the notes for the model; a press shows its first line as a toast, or `toast` where that line alone says less.
 */
async function control(
  $: $,
  name: string,
  given: string,
  via: 'command' | 'strip',
  where: 'here' | 'remote' = 'here',
  origin?: string,
): Promise<{ text: string; context?: string[]; toast?: string }> {
  const action = commandNamed(name)!;
  const c = await ctxOf($);
  // A setting changed in the control center holds for a press as for a prompt: full autonomy allowed there, then
  // pressed on the strip with no prompt between, opens with the settings as they are now.
  await refreshConfig($, c).catch(() => undefined);
  // Full autonomy and the other person-only controls are the person's alone: a press, or their own Enter here or on the phone. A command
  // the engine stamps otherwise (a background notice, another session, an unclassified run) is refused.
  const person = via === 'strip' || origin === 'composer' || origin === 'bridge';
  if (CONTROLS[controlOf(action)].personOnly && !person) return { text: tIn(c.lang, 'ctl.personOnly', { cmd: `/${name}` }) };
  // Every other control is the person's too, or a script of theirs (sdk): never a prompt the model scheduled for
  // itself, another session's message, a background notice or another plugin, which could change the mode, raise the
  // budget or close the session the model works in. A command the engine stamps no origin on is the person's.
  if (!person && origin !== undefined && origin !== 'sdk') return { text: tIn(c.lang, 'ctl.personOnly', { cmd: `/${name}` }) };
  const args = given.trim();
  const lang = c.lang;
  // A toast of '' shows none: the start window opened, and says it all itself.
  const say = (text: string, context?: string[], toast?: string) => ({
    text,
    ...(context?.length ? { context } : {}),
    ...(toast !== undefined ? { toast } : {}),
  });
  if (!c.config.modules.modes && (action.kind === 'mode' || action.kind === 'style' || action.kind === 'flow')) return say(tIn(lang, 'ctl.modesOff'));
  switch (action.kind) {
    case 'why':
      return say(await whyAnswer($, c, args));
    case 'agents': {
      if (!c.config.agents.enabled) return say(tIn(lang, 'agents.notEnabled'));
      const line = await agentsCommand($, c, args);
      if (line !== null) return say(line);
      // At the computer: the window. Elsewhere (a phone): where it stands, and the words that set it.
      if (where === 'here' && (await openAgentsPane($, c))) return say(tIn(lang, 'agents.pane.title'), undefined, '');
      return say(`${controlsLine(viewOf(c), lang)}\n${agentsUsage(lang)}`);
    }
    case 'freeze': {
      const cwd = await $.session.cwd();
      const env = pathEnv(c, cwd);
      const off = /^(?:off|kapat|aç|ac|stop|dur)$/i.test(args) || (!args && !!c.state.frozen);
      if (off) {
        c.state = { ...c.state, frozen: null };
        await saveState($, c);
        await refreshStatus($, c);
        return say(tIn(lang, 'ctl.freeze.off'), [freezeNote(null)]);
      }
      const folder = resolvePath(args || cwd, env);
      const st = await $.fs.stat(folder).catch(() => null);
      if (!st || st.kind !== 'dir') return say(tIn(lang, 'ctl.freeze.notDir', { folder }));
      c.state = { ...c.state, frozen: folder };
      await saveState($, c);
      await refreshStatus($, c);
      return say(tIn(lang, 'ctl.freeze.on', { folder }), [freezeNote(folder)]);
    }
    case 'mode':
    case 'style': {
      const kw = actionKeyword(action, lang, via);
      const said = await applyKeywordTurn($, c, kw, kw.text);
      await refreshStatus($, c);
      const sent = args ? await sendAsPerson($, c, args) : [];
      return say(tIn(lang, 'ctl.done', { controls: controlsLine(viewOf(c), lang) }), [...said.context, ...sent]);
    }
    case 'cockpit': {
      // The cockpit, shown or not (src/core/ux/cockpit.ts). From the phone, where the session stands and every command.
      const quota = (await quotaTail($)) || '—';
      const newer = newerThan(APP_VERSION, parseUpdateState(await readFile($, c.layout.updateState))?.latest ?? null);
      const menu = menuText(viewOf(c), lang, quota, newer);
      if (where === 'remote') return say(`${menu}\n\n${tIn(lang, 'ctl.center.remote')}`);
      // A press: the cockpit appearing or going is what it says; typed, the row says it too.
      if (c.cockpit.open) {
        await closeCockpit($, c);
        return say(tIn(lang, 'ck.closed'), undefined, '');
      }
      if (await openCockpit($, c, true)) return say(`${tIn(lang, 'ck.opened')}${newer ? `\n${tIn(lang, 'ctl.menu.update', { newer })}` : ''}`, undefined, '');
      // No surface places a pane here (a session with no screen): the control center opens, as before the cockpit.
      const opened = await openCenter($, c);
      if (!opened.ok) return say(`${opened.text}\n\n${menu}`);
      const now = tIn(lang, 'ctl.menu.now', { controls: controlsLine(viewOf(c), lang), quota });
      return say(
        `${tIn(lang, opened.opens === 'tab' ? 'ctl.center.tab' : 'ctl.center.window')}\n${now}${newer ? `\n${tIn(lang, 'ctl.menu.update', { newer })}` : ''}`,
      );
    }
    case 'quota': {
      const q = await quotaNow($, c);
      const week = q.usable && q.week ? Math.round(q.week.used) : null;
      let budget = args ? parseBudget(args) : null;
      if (args && !budget) return say(tIn(lang, 'ctl.quota.bad'));
      // At the computer: the window, where the budget is picked or typed. Elsewhere (a phone): asked.
      if (!budget && where === 'here' && (await openQuotaPane($, c, week))) return say(tIn(lang, 'ctl.quotaPane.title'), undefined, '');
      if (!budget) {
        const answer = await askOptions($, tIn(lang, 'ctl.quota.ask', { week: percentText(week, lang) }), ['+5', '+10', '+20']);
        if (answer === null) return say(tIn(lang, 'ctl.cancelled'));
        budget = parseBudget(answer);
        if (!budget) return say(tIn(lang, 'ctl.quota.bad'));
      }
      const problem = budgetProblem(budget, week);
      if (problem) return say(tIn(lang, problem.key, problem.params));
      const kw: KeywordMatch = {
        kind: 'quota',
        lang,
        n: budget.n,
        plus: budget.plus,
        text: `/${name} ${budgetText(budget, lang)}`,
        standalone: true,
        via,
      };
      const said = await applyKeywordTurn($, c, kw, kw.text);
      await refreshStatus($, c);
      return say(tIn(lang, 'ctl.quota.set', { target: c.state.weeklyTarget ?? budget.n }), said.context);
    }
    case 'continue': {
      const { budget, rest } = splitBudget(args);
      const choices = await continueChoicesOf($, c);
      if (!choices.length) return say(tIn(lang, 'ctl.continue.empty'));
      const now = await $.clock.now();
      if (!rest)
        return say(
          choicesText(
            choices,
            lang,
            (p) => shortPath(p, c.home, 60),
            (at) => ago(at, now, lang),
          ),
        );
      const picked = pickChoice(choices, rest, (ch) => {
        const p = ch.project ? c.config.projects.find((x) => x.id === ch.project) : undefined;
        return p ? [...p.names, p.id] : [ch.label];
      });
      if (!picked.choice)
        return say(
          picked.matches.length
            ? tIn(lang, 'ctl.continue.ambiguous', { text: rest, list: picked.matches.map((m) => `${m.n} ${m.label}`).join(', ') })
            : tIn(lang, 'ctl.continue.none', { text: rest }),
        );
      const went = await continueWith($, c, picked.choice, budget);
      return say(went.text, went.context);
    }
    case 'flow': {
      // One button, three answers: an open flow closes (its record stays), a paused one goes on, none starts.
      if (c.flow && isOpen(c.flow) && c.flow.status !== 'paused') {
        const r = cancelFlow(c.flow, await $.clock.now());
        await saveFlow($, c, r.flow);
        await flowEvent($, c, r.flow, 'cancel');
        await refreshStatus($, c);
        return say(tIn(lang, 'ctl.flow.closed'), [flowNote('canceled', r.flow, lang, stepTexts(c, r.flow))]);
      }
      if (c.flow && c.flow.status === 'paused') {
        const cwd = await $.session.cwd();
        const ctx = await resumeFor($, c, c.state.project, cwd);
        await refreshStatus($, c);
        return say(tIn(lang, ctx ? 'ctl.done' : 'ctl.flow.notResumed', { controls: controlsLine(viewOf(c), lang) }), ctx ? [ctx] : []);
      }
      if (c.armed?.kind === 'flow') {
        c.armed = null;
        await refreshStatus($, c);
        return say(tIn(lang, 'ctl.flow.disarmed'));
      }
      if (args) {
        const variant = (await lastFlowVariant($, c)) ?? 'full';
        return say(flowPresetLine(variant, lang), await sendAsPerson($, c, `${args}\n\n${flowPhrase(variant, lang)}`));
      }
      // At the computer: the window, where the flow is picked and its task written now or sent next. Elsewhere: asked.
      if (where === 'here' && (await openFlowPane($, c))) return say(tIn(lang, 'ctl.flowPane.title'), undefined, '');
      const lines = FLOW_PRESETS.map((v) => flowPresetLine(v, lang));
      const answer = await askOptions($, tIn(lang, 'ctl.flow.ask'), lines);
      if (answer === null) return say(tIn(lang, 'ctl.cancelled'));
      const i = lines.findIndex((l) => fold(l) === fold(answer));
      // Typed under "Other": that is the task, for the whole flow.
      if (i < 0) {
        return say(lines[0]!, await sendAsPerson($, c, `${answer}\n\n${flowPhrase('full', lang)}`));
      }
      c.armed = { kind: 'flow', variant: FLOW_PRESETS[i]! };
      await refreshStatus($, c);
      return say(tIn(lang, 'ctl.flow.armed', { steps: lines[i]! }));
    }
    case 'close': {
      if (c.closing) return say(tIn(lang, 'ctl.close.already'));
      // While Claude works, closing stops its work: asked first. Idle, it closes at once.
      if (c.turnId !== null) {
        const yes = tIn(lang, 'ctl.close.yes');
        const answer = await askOptions($, tIn(lang, 'ctl.close.busy'), [yes, tIn(lang, 'ctl.close.no')]);
        if (answer === null || fold(answer) !== fold(yes)) return say(tIn(lang, 'ctl.cancelled'));
      }
      c.closing = true;
      // From a timer, the moment this row is shown: Claude Code refuses a command run from a command's own hook.
      $.clock.after(1, () => {
        void closeSession($, c, via);
      });
      return say(tIn(lang, c.platform === 'win32' ? 'ctl.close.going' : 'ctl.close.goingNoTab'));
    }
  }
}

/**
 * Closes the session as /exit does (`/00`): a running turn is stopped first; the steps the session's end runs
 * under Claude Code's short clock (the handoff note, the sync) run here, with none, so none is cut short; on
 * Windows the helper that closes the tab after Claude Code is started (src/core/close.ts); then Claude Code is
 * asked to exit. If it does not, the session goes on and says so.
 */
async function closeSession($: $, c: Ctx, via: 'command' | 'strip'): Promise<void> {
  const busy = c.turnId !== null;
  if (c.turnId !== null) await $.turn.abort({ turnId: c.turnId }).catch(() => undefined);
  try {
    await endHandoff($, c, 'end');
    await sharedSync($, c, 'end');
    c.closed = true;
  } catch {
    /* the end runs them again */
  }
  let tab: CloseTab | 'off' = 'off';
  let detail = '';
  if (c.platform === 'win32') {
    try {
      ({ tab, detail } = closeTabOutcome((await $.process.run(closeTabArgv(c.env.SYSTEMROOT), { timeoutMs: 20_000 })).stdout));
    } catch (err) {
      tab = 'failed';
      detail = String((err as Error)?.message ?? err).slice(0, 80);
    }
  }
  await logEvent($, c, { kind: 'close', via, busy, tab, ...(detail ? { detail } : {}) });
  try {
    await $.command.run({ command: 'exit' });
  } catch (err) {
    c.closing = false;
    c.closed = false;
    $.ui.toast(tIn(c.lang, 'ctl.close.failed', { reason: String((err as Error)?.message ?? err).slice(0, 160) }), { timeoutMs: 15_000 });
  }
}

/**
 * The conversation after a /clear. After a reset at a task boundary it takes up what the reset carried; after the
 * person's own /clear it is a new session as far as they are concerned, so it takes up the folder's last choice as a
 * new session's start does (docs/modes.md): the one just cleared, full autonomy as autonomous.
 */
async function afterClear($: $, c: Ctx, clear: { from: string; at: number }): Promise<Ctx> {
  // Loaded in the moment between the end and the new id: still the cleared session. The next prompt takes up (promptCtx).
  if (c.sessionId === clear.from) return c;
  cleared = null;
  const carry = pendingCarry;
  pendingCarry = null;
  try {
    const now = await $.clock.now();
    if (carry && c.fresh && c.state.cwd && carryFits(carry, { sessionId: c.sessionId, cwd: c.state.cwd, now, platform: c.platform }))
      await takeCarry($, c, carry);
    else if (c.fresh && c.config.modules.modes) await restoreLast($, c);
  } catch {
    /* the session starts as a new one does with nothing to take up */
  }
  return c;
}

/**
 * The conversation a reset cleared to takes up what it carried (src/core/reset.ts): the way of working and the rest of
 * the state, the record of where things came from (the safety-net hook reads it before the first call), the person's
 * last request, and the flow, which goes on here at its step; one the person had paused stays paused.
 */
async function takeCarry($: $, c: Ctx, carry: Carry): Promise<void> {
  const now = await $.clock.now();
  c.state = withCarried(c.state, carry.state);
  c.lastPrompt = carry.request;
  c.lastResetAt = carry.at;
  c.resets = carry.resets;
  c.carried = { prompt: carry.prompt, note: carry.note, read: { before: carry.tokens, first: null, calls: 0 } };
  await saveProv($, c, () => carry.prov);
  const dir = c.state.flowId ? flowDir(c.layout, c.state.flowId) : null;
  const flow = dir ? parseFlow(await readFile($, joinPath(dir, 'flow.json'))) : null;
  if (flow && isOpen(flow)) {
    const r = isRunning(flow) ? resumeFlow(flow, c.sessionId, now) : null;
    if (r?.ok) await saveFlow($, c, r.flow);
    else c.flow = flow;
  } else c.state = { ...c.state, flowId: null };
  await saveState($, c);
  if (c.state.resumeAt) await scheduleResume($, c);
  await logEvent($, c, { kind: 'reset', phase: 'carried', from: carry.from, tokens: carry.tokens, resets: carry.resets, note: carry.note });
  $.ui.toast(tIn(c.lang, 'reset.toast', { tokens: compact(carry.tokens, c.lang) }), { timeoutMs: TOAST_MS.result });
}

/** On a fresh session, the mode and way of working the person last used in this folder (see lastChoice). */
async function restoreLast($: $, c: Ctx): Promise<void> {
  if (!c.state.cwd) return;
  // The 40 newest records are plenty to find the last session in this folder, and keep the start quick.
  const last = lastChoice(await sessionStates($, c, 40), c.state.cwd, c.platform, c.sessionId);
  // Only a choice that differs from a fresh session's: a manual the person picked is theirs to keep too.
  if (!last || (last.mode === 'free' && last.interaction === 'default')) return;
  c.state = { ...c.state, mode: last.mode, interaction: last.interaction };
  c.restored = true;
  await saveState($, c);
  $.ui.toast(tIn(c.lang, 'ctl.restored', { controls: controlsLine(viewOf(c), c.lang) }), { timeoutMs: 8000 });
}

export function register(on: On): void {
  on('session.start', onSessionStart);
  on('tool.call', onToolCallWithMo).catch(refuseToolCall);
  on('prompt.submit', onPromptSubmit);
  // A paste into the prompt box (an edit no key made, long or across lines): not the person's own words.
  on('prompt.edit', async ($, e, next) => {
    const text = e.inputText;
    if (!e.key && text && (text.length >= 20 || text.includes('\n'))) (await ctxOf($)).pastes.push(text);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('session.measure', onMeasure);
  on('turn.complete', onTurnComplete);
  on('classic.StopFailure', onStopFailure);
  // Parallel agents (docs/agents.md): each agent's start is decided here; a hook that fails lets it start, as before.
  on('agent.spawn', onAgentSpawn).catch(($, e, next) => next(e));
  // /effort ultracode and back: Claude Code's workflows run the agents, and the mode stands aside meanwhile.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e);
    try {
      const c = await ctxOf($);
      const a = String(e.args ?? '')
        .trim()
        .toLowerCase();
      if (/^ultracode(?:\s+on)?$/.test(a)) c.ultracode.command = true;
      else if (/^ultracode\s+off$/.test(a) || /^(?:low|medium|high|xhigh|max|auto)$/.test(a)) c.ultracode.command = false;
      await syncUltracode($, c);
    } catch {
      /* the next prompt reads the settings again */
    }
    return r;
  });
  // The main loop's turn while it runs: Claude is working, and /00 asks before it stops that work.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const r = await next(e);
    try {
      (await ctxOf($)).turnId = e.turnId;
    } catch {
      /* /00 then closes without asking */
    }
    return r;
  });
  on('prompt.attachment', { type: 'silent_turn_reminder' }, async ($, e, next) => ((await quietWork($)) ? { text: null } : next(e)));
  on('prompt.attachment', { type: 'plan_mode' }, async ($, e, next) => {
    const r = await next(e);
    await planNote($, true, (e.detail as { planFilePath?: string } | undefined)?.planFilePath);
    return r;
  });
  on('prompt.attachment', { type: 'plan_mode_exit' }, async ($, e, next) => {
    const r = await next(e);
    await planNote($, false, (e.detail as { planFilePath?: string } | undefined)?.planFilePath);
    return r;
  });
  on('tool.call', { tool: `mcp__${PLUGIN_NAME}__${FLOW_TOOL.name}` }, onFlowStep);
  on('tool.call', { tool: `mcp__${PLUGIN_NAME}__${HANDOFF_TOOL_DEF.name}` }, onHandoffTool);
  on('tool.call', { tool: `mcp__${PLUGIN_NAME}__${REQUEST_TOOL_DEF.name}` }, onRequestTool);
  on('tool.call', { tool: `mcp__${PLUGIN_NAME}__${CATALOG_TOOL.name}` }, onCatalogTool);
  on('tool.call', { tool: `mcp__${PLUGIN_NAME}__${WHY_TOOL.name}` }, onWhyTool);
  on('skill.prompt', onSkillPrompt);
  // Claude Code's own permission questions, answered as the way of working says (in full autonomy nobody waits).
  // A failure leaves Claude Code's verdict as it was (a question nobody answers, never a call let through).
  on('tool.check', onToolCheck).catch(($, e, next) => next(e));
  // The session's state survives a compaction: the summarizer is asked to keep it, and it is restated after.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const text = await sessionStateText($);
    const r = text
      ? await next({ ...e, instructions: [e.instructions, `Keep this in the summary, word for word: ${text}`].filter(Boolean).join('\n') })
      : await next(e);
    if (text) await restateSession($, text);
    // The session's first note may be summarized away: it goes again with the next prompt.
    try {
      (await ctxOf($)).introDue = true;
    } catch {
      /* the next session gives it */
    }
    // The compaction's own summary is the handoff note (docs/memory.md): no extra model call.
    await compactHandoff($, e.trigger, r);
    return r;
  });
  // After /clear the conversation goes on under a new session id with a fresh state; a running flow pauses.
  on('session.end', onSessionEnd);
  // The slash commands of the controls: /0 to /8, /00, /devam, /kota, /akis, /tam-otonom, /kapat and their English names.
  on('command.run', onCommand);
  // Above the prompt: the strip with the mode and the way of working, always in view and pressable; under it the line
  // that says what Claude does now, where a control's card shows while the pointer or the keyboard rests on it; and
  // while a plan waits for approval, a line that says so and how to approve. A question of Claude Code's own goes first.
  // A press on the breathing control (src/mod/strip-pulse.ts) or on Mo (src/mod/mo-strip.ts) arrives as a message.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { press?: unknown } | null;
    if (e.module.endsWith('strip-pulse.js') && data && typeof data.press === 'string' && commandNamed(data.press)) {
      await press($, data.press, '', e.surface);
      return {};
    }
    if (e.module.endsWith('mo-strip.js') && data?.press === 'mo') {
      await showCockpit($, e.surface);
      return {};
    }
    return next(e);
  });
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await next(e);
    try {
      // Only the strip's own controls have a card; the focus anywhere else in the band (or not ours) has none.
      const key = e.plugin === PLUGIN_NAME && typeof e.element === 'string' ? e.element : '';
      const id = key.startsWith('strip-') && controlOfItem(key.slice('strip-'.length)) ? key.slice('strip-'.length) : null;
      const at = await $.clock.now();
      await update($, stripFocusAtom, () => ({ id, at }));
      if (id)
        $.clock.after(FOCUS_MS, () => {
          void update($, stripFocusAtom, (x) => (x.at === at ? { id: null, at } : x)).catch(() => undefined);
        });
    } catch {
      /* the card shows what it showed */
    }
    return r;
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const labels = await read($, labelsAtom);
    const strip = labels.strip;
    if (!strip && !labels.band) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const props = e.props as { bodyColumns?: number; view?: { agentId?: string } };
    const columns = Number(props.bodyColumns ?? e.viewport?.columns ?? 80);
    const onPress = (id: string) => (p?: { surface?: string }) => press($, id, '', p?.surface);
    const els = $.ui.resolve(e);
    const Client = 'Client' in els ? els.Client : undefined;
    const still = strip?.still === true;
    const working = (e.props as { isWorking?: boolean }).isWorking === true;
    // The keyboard on the strip: nothing breathes under it (a module takes no focus), and the line says the card.
    const focus = strip ? (await read($, stripFocusAtom)).id : null;
    const item = (it: StripItem) =>
      // The mode a running flow's step works in breathes on Claude Code's clock (src/mod/strip-pulse.ts) while
      // Claude works; between turns (the person may be typing: every frame blinks the terminal's cursor), with
      // less motion asked for, where no module is drawn (a phone), or while the keyboard is on the strip, it is
      // marked instead: bold, underlined. Either way the pointer on it shows its card under the strip.
      it.pulse && Client && !still && working && focus === null
        ? h(
            Box,
            { key: `pulse-${it.id}`, hover: { scope: cardScope(it.id) } },
            h(Client, { key: `strip-${it.id}`, module: './strip-pulse.js', width: cells(it.label), height: 1, props: { id: it.id, label: it.label } }),
          )
        : h(
            Button,
            {
              key: `strip-${it.id}`,
              plain: true,
              onPress: onPress(it.id),
              hover: { scope: cardScope(it.id) },
              ...(it.active ? { variant: 'primary' } : {}),
            },
            h(
              Text,
              {
                bold: it.active || !!it.pulse,
                underline: !!it.pulse,
                inverse: it.active,
              },
              it.label,
            ),
          );
    // Mo at the strip's left, where there is room and the surface draws a module (the terminal, the desktop app;
    // not a phone): a small Mo beside a strip of two rows, its face beside a strip of one (src/mod/mo-strip.ts).
    const mo = strip && Client ? await read($, moAtom) : null;
    const withMo = mo !== null && mo.show && columns >= MO_MIN_COLUMNS;
    const rows = strip ? stripRows(strip as StripView, strip.lang as Lang, withMo ? columns - MARK_W - 2 : columns) : [];
    const lines = rows.map((row, r) =>
      h(
        Box,
        { key: `strip-row-${r}`, flexDirection: 'row' },
        ...row.flatMap((seg, i) => [
          // The menu and closing stand apart, at the row's far end: the room before them grows.
          ...(i ? [seg.end ? h(Box, { key: `push-${r}-${i}`, flexGrow: 1, minWidth: 2 }) : h(Text, { key: `gap-${r}-${i}` }, '  ')] : []),
          ...(seg.title ? [h(Text, { key: `title-${r}-${i}`, dimColor: true }, `${seg.title} `)] : []),
          ...seg.items.flatMap((it, j) => [...(j ? [h(Text, { key: `sp-${it.id}` }, ' ')] : []), item(it)]),
        ]),
      ),
    );
    const tall = lines.length > 1 && !mo?.oneRow;
    const shown =
      withMo && Client && lines.length
        ? [
            h(
              Box,
              { key: 'strip', flexDirection: 'row' },
              h(
                Box,
                { key: 'mo-at', hover: { scope: cardScope('mo') } },
                h(Client, {
                  key: 'mo',
                  module: './mo-strip.js',
                  width: MARK_W,
                  height: tall ? 2 : 1,
                  props: { ...mo, working, rows: tall ? 2 : 1 },
                }),
              ),
              h(Text, { key: 'mo-gap' }, '  '),
              h(Box, { key: 'strip-rows', flexDirection: 'column', flexGrow: 1 }, ...lines),
            ),
          ]
        : lines;
    if (strip) {
      const view = strip as StripView;
      const lang = strip.lang as Lang;
      const moWords = withMo && mo ? moLine(moState({ ...mo, working }, await $.clock.now()), lang) : null;
      shown.push(
        sayLine(
          $,
          { Box, Text, Button },
          {
            columns,
            lang,
            cards: rows.flat().flatMap((s) => s.items.map((it) => ({ scope: cardScope(it.id), text: cardLine(it.id, view, lang) }))),
            mo: moWords,
            focus: focus ? cardLine(focus, view, lang) : null,
            now: stripNow(view, lang),
            activity: labels.activity ?? 0,
            waiting: labels.waiting ?? 0,
            agentView: !!props.view?.agentId,
          },
        ),
      );
    }
    if (labels.band)
      shown.push(
        labels.bandMeaning
          ? h(Box, { key: 'band' }, notice(claudeHost({ Box, Text, Button }), { meaning: labels.bandMeaning, text: labels.band, wrap: true }))
          : h(Text, { key: 'band' }, labels.band),
      );
    const tree = h(Box, { flexDirection: 'column' }, ...shown);
    return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
  });
  // The windows a control opens (docs/design.md, Window): one pattern for all, each a dialog (Esc closes it). A
  // surface that draws no field (a phone) never gets one: the command asks there instead.
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e, next) => {
    const els = $.ui.resolve(e);
    if (!('Input' in els)) return next(e);
    const tree = agentsWindow($, els, await read($, agentsPaneAtom), paneWidth(e.props));
    return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
  });
  on('ui.render', { component: 'Pane', requestId: QUOTA_PANE }, async ($, e, next) => {
    const els = $.ui.resolve(e);
    if (!('Input' in els)) return next(e);
    const tree = quotaWindow($, els, await read($, quotaPaneAtom), paneWidth(e.props));
    return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
  });
  on('ui.render', { component: 'Pane', requestId: FLOW_PANE }, async ($, e, next) => {
    const els = $.ui.resolve(e);
    if (!('Input' in els)) return next(e);
    const tree = flowWindow($, els, await read($, flowPaneAtom), paneWidth(e.props));
    return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
  });
  // The cockpit (docs/design.md, The cockpit): beside the conversation in fullscreen, above the prompt otherwise. Drawn
  // from what the hooks worked out; a drawing that fails gives the engine's own, never a broken pane.
  on('ui.render', { component: 'Pane', requestId: COCKPIT_PANE }, async ($, e, next) => {
    const data = (await read($, cockpitAtom)).data;
    if (!data) return next(e);
    const ui = await read($, cockpitUiAtom);
    const still = (await read($, moAtom)).still;
    const tree = cockpitTree($, $.ui.resolve(e), data as CockpitData, ui, e.props, still);
    return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
  });
  // The person closed it (its close mark, ctrl+x x): the strip says so, and the next session starts without it.
  on('ui.close', { id: COCKPIT_PANE }, async ($, e, next) => {
    const r = await next(e);
    try {
      if (e.origin.kind === 'person') {
        const c = await ctxOf($);
        c.cockpit.open = false;
        await rememberCockpit($, c, false);
        await update($, cockpitUiAtom, () => COCKPIT_UI);
        await refreshStatus($, c);
      }
    } catch {
      /* the next press opens it again */
    }
    return r;
  });
  // A window the cockpit stepped aside for, closed by the person (Esc, its close mark): the cockpit comes back, the keys
  // left with the prompt Esc gave them to. Closed by Apply or Cancel, closeWindow brings it back.
  for (const id of WINDOW_IDS)
    on('ui.close', { id: WINDOWS[id].pane }, async ($, e, next) => {
      const r = await next(e);
      try {
        const c = await ctxOf($);
        if (e.origin.kind !== 'plugin' && c.cockpit.away === WINDOWS[id].pane) await cockpitBack($, c, false);
      } catch {
        /* the next press opens it again */
      }
      return r;
    });
  // The keyboard in the cockpit: the element it rests on says itself in the line the cockpit opens with.
  on('ui.focus', { component: 'Pane', requestId: COCKPIT_PANE }, async ($, e, next) => {
    const r = await next(e);
    try {
      const key = e.plugin === PLUGIN_NAME && typeof e.element === 'string' ? e.element : null;
      await update($, cockpitUiAtom, (x) => ({ ...x, focus: key }));
    } catch {
      /* the line says what it said */
    }
    return r;
  });
  // The list `/devam` printed: each row pressable, as `/devam <n>` is.
  for (const command of ['devam', 'continue'])
    on('ui.render', { component: 'CommandOutput', props: { command } }, async ($, e, next) => {
      const text = String((e.props as { text?: unknown }).text ?? '');
      if (!text.split('\n').some((l) => CHOICE_LINE.test(l))) return next(e);
      const { Box, Text, Button } = $.ui.resolve(e);
      const rows = text.split('\n').map((l, i) => {
        const m = CHOICE_LINE.exec(l);
        if (!m) return h(Text, { key: `l-${i}`, dimColor: i > 0 }, l);
        const run = () => press($, command, m[1]!);
        return h(Button, { key: `choice-${m[1]}`, plain: true, onPress: run }, h(Text, null, l));
      });
      const tree = h(Box, { flexDirection: 'column' }, ...rows);
      return tree && typeof tree === 'object' ? (tree as Awaited<ReturnType<typeof next>>) : next(e);
    });
  // The footer lines, as part of the answer's drawing (every surface, the phone included).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const lines = await footerFor($, e.props.text, e.props.isSummary === true);
    return lines?.length ? next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n${lines.join('\n\n')}` } }) : next(e);
  });
  // The session's mode beside Claude Code's own mode labels, and the quota at the end of the hint line.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const mine = await modeLabels($);
    return mine.length ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...mine] } }) : next(e);
  });
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const tail = await quotaTail($);
    return tail ? next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · ${tail}` : tail } }) : next(e);
  });
}

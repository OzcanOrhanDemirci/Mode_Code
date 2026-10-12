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
import type { TerminalCodeFooters, TerminalCodeLabels } from './contract.js';
import { APP_NAME, APP_VERSION, DATA_DIR_NAME, PLUGIN_NAME } from '../core/app.js';
import { parseConfig, type Config } from '../core/config.js';
import { layout, sessionFile, eventsFile, flowDir, type Layout } from '../core/layout.js';
import { isUnder, joinPath, pathKey, resolvePath, type PathAlias, type Platform } from '../core/paths.js';
import { detectLanguage, tIn, setLanguage, type Lang, type MessageKey } from '../core/i18n/index.js';
import { evaluateToolCall, decisionText } from '../core/belt/evaluate.js';
import { isFileTool, shellOf } from '../core/belt/tools.js';
import type { BeltContext, BeltDecision, GitFacts } from '../core/belt/types.js';
import { checkGuards, type ModeGuard } from '../core/guard.js';
import { detectKeyword, isModeKeyword, messageWithoutKeyword, MODE_KEYWORDS, type KeywordMatch } from '../core/keywords.js';
import {
  conflictContext,
  flowNote,
  flowResumeContext,
  flowStartContext,
  flowTurnContext,
  keywordContext,
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
  LIVE_WINDOW_MS,
  newModState,
  parseHookState,
  parseModState,
  sameFolderSessions,
  type ModSessionState,
} from '../core/session.js';
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
import { maskSecrets } from '../core/secrets/scan.js';

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
  turn: { startedAt: number | null; uses: ToolUse[] };
  events: string[];
  eventsPath: string | null;
  resumeTimer: { cancel(): void } | null;
  /** Sessions in the same folder already announced, so each is said once. */
  conflictsSeen: Set<string>;
  /** Protected places that are links, measured at most once a minute (see BeltContext.aliases). */
  aliases: { at: number; list: PathAlias[] } | null;
  /** The flow this session works on (its record is the mod's to write). */
  flow: Flow | null;
}

let ctxPromise: Promise<Ctx> | null = null;

/** Session state the drawings read (kept by Claude Code across reloads of this module). */
const footersAtom = atom({ plugin: 'terminal-code', key: 'footers' } as const, {} as TerminalCodeFooters);
const labelsAtom = atom({ plugin: 'terminal-code', key: 'labels' } as const, { modes: [], tail: '', band: '' } as TerminalCodeLabels);

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
    TERMINAL_CODE_HOME,
    TERMINAL_CODE_LANG,
    LANG,
    LC_ALL,
    LC_MESSAGES,
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
    $.env.get('TERMINAL_CODE_HOME'),
    $.env.get('TERMINAL_CODE_LANG'),
    $.env.get('LANG'),
    $.env.get('LC_ALL'),
    $.env.get('LC_MESSAGES'),
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
    TERMINAL_CODE_HOME,
    TERMINAL_CODE_LANG,
    LANG,
    LC_ALL,
    LC_MESSAGES,
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
  const root = env.TERMINAL_CODE_HOME ? resolvePath(env.TERMINAL_CODE_HOME, { platform, home, cwd }) : joinPath(home, DATA_DIR_NAME);
  const l = layout(root);
  const { config } = parseConfig(await readFile($, l.config));
  const lang = detectLanguage({ configured: config.language === 'auto' ? null : config.language, env });
  setLanguage(lang);
  const sessionId = await $.session.id();
  const now = await $.clock.now();
  const path = sessionFile(l, sessionId, 'mod');
  const previous = path ? parseModState(await readFile($, path)) : null;
  const state: ModSessionState =
    previous && previous.sessionId === sessionId ? { ...previous, aliveAt: now, modVersion: APP_VERSION } : newModState(sessionId, APP_VERSION, now);
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
    turn: { startedAt: null, uses: [] },
    events: existing ? existing.split('\n').filter(Boolean) : [],
    eventsPath,
    resumeTimer: null,
    conflictsSeen: new Set(),
    aliases: null,
    flow: flow && isOpen(flow) ? flow : null,
  };
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
  if (!ctxPromise) ctxPromise = load($);
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
  const found = sameFolderSessions(c.state, others, now, c.platform === 'win32' || c.platform === 'darwin');
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
  const text = await readFile($, c.layout.config);
  const { config } = parseConfig(text);
  if (JSON.stringify(config) === JSON.stringify(c.config)) return;
  c.config = config;
  c.lang = detectLanguage({ configured: config.language === 'auto' ? null : config.language, env: c.env });
  setLanguage(c.lang);
  await refreshStatus($, c);
}

async function saveState($: $, c: Ctx): Promise<void> {
  const path = sessionFile(c.layout, c.sessionId, 'mod');
  if (path) await $.fs.write(path, JSON.stringify(c.state, null, 2) + '\n');
}

async function logEvent($: $, c: Ctx, rec: Record<string, unknown>): Promise<void> {
  if (!c.eventsPath) return;
  const now = await $.clock.now();
  c.events.push(JSON.stringify({ v: 1, at: now, source: 'mod', session: c.sessionId, app: APP_VERSION, ...rec }));
  if (c.events.length > 5000) c.events = c.events.slice(-5000);
  try {
    await $.fs.write(c.eventsPath, c.events.join('\n') + '\n');
  } catch {
    /* the log never changes a decision */
  }
}

async function runGit($: $, dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await $.process.run(['git', '-C', dir, '--no-pager', ...args], { timeoutMs: 5000 });
    return { ok: r.exitCode === 0, out: r.stdout.trim() };
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

async function beltContextFor($: $, c: Ctx): Promise<BeltContext> {
  const cwd = await $.session.cwd();
  const root = await $.session.root();
  const env = pathEnv(c, cwd);
  return {
    platform: c.platform,
    home: c.home,
    cwd: env.cwd,
    projectDir: resolvePath(c.env.CLAUDE_PROJECT_DIR ?? root, env),
    env: c.env,
    dataDir: c.layout.root,
    memoryDirs: memoryDirs(c, cwd),
    managedSettingsFiles: managedFiles(c.platform),
    lang: c.lang,
    config: beltConfigOf(c.config),
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

/** The flows' work folder: the setting, or terminal-code/flows in the temporary folder. */
function workRoot(c: Ctx, cwd: string): string {
  const env = pathEnv(c, cwd);
  if (c.config.modes.workDir) return resolvePath(c.config.modes.workDir, env);
  return joinPath(tempZones(c.env, env)[0] ?? joinPath(c.home, '.cache'), APP_NAME, 'flows');
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
  return !!other && other.flowId === f.id && (await $.clock.now()) - other.aliveAt < LIVE_WINDOW_MS;
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

/** Runs the approved plan's verification commands through Claude Code's own shell tool, in order. */
async function runVerification($: $, c: Ctx, f: Flow): Promise<{ ok: true; seconds: number } | { ok: false; text: string }> {
  const tools = new Set((await $.tool.list()).map((t) => t.name));
  const shell = tools.has('Bash') ? 'Bash' : tools.has('PowerShell') ? 'PowerShell' : null;
  const started = await $.clock.now();
  for (const command of f.verification) {
    if (!shell) return { ok: false, text: tIn(c.lang, 'flow.step.codeRefused', { command, reason: 'no shell tool' }) };
    let r: Awaited<ReturnType<typeof $.tool.call>>;
    try {
      r = await $.tool.call({
        tool: shell,
        command,
        description: `terminal-code: verification ${f.verification.indexOf(command) + 1}/${f.verification.length}`,
        timeout: 600_000,
      } as never);
    } catch (err) {
      return { ok: false, text: tIn(c.lang, 'flow.step.codeRefused', { command, reason: String((err as Error)?.message ?? err) }) };
    }
    if (r.deny !== undefined) return { ok: false, text: tIn(c.lang, 'flow.step.codeRefused', { command, reason: r.deny }) };
    if (r.isError) {
      const out = String(r.text ?? r.result ?? '');
      const code = /Exit code (\d+)/.exec(out)?.[1] ?? '?';
      const tail = out.split('\n').slice(-25).join('\n').slice(-2000);
      return { ok: false, text: tIn(c.lang, 'flow.step.codeFailed', { command, code, tail }) };
    }
  }
  return { ok: true, seconds: Math.round(((await $.clock.now()) - started) / 1000) };
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

/**
 * What the prompt footer shows: the session's mode as labels at the right of the footer (beside Claude
 * Code's own), and the quota dim at the end of the hint line. Drawn by render hooks, so no notice prefix.
 */
async function refreshStatus($: $, c: Ctx): Promise<void> {
  if (!c.config.modules.status) {
    await update($, labelsAtom, () => ({ modes: [], tail: '', band: '' }));
    return;
  }
  const q = await quotaNow($, c);
  const modes: string[] = [];
  let band = '';
  if (c.config.modules.modes) {
    const mode = modeNow(c);
    if (mode !== 'free') modes.push(tIn(c.lang, `status.${mode}` as MessageKey));
    if (c.flow) {
      const p = progress(c.flow);
      modes.push(c.flow.status === 'paused' ? tIn(c.lang, 'status.flowPaused') : tIn(c.lang, 'status.flow', { at: p.at, of: p.of }));
      if (c.flow.status === 'waiting') band = tIn(c.lang, 'flow.band.waiting', { path: planPathOf(c, c.flow), approve: tIn(c.lang, 'kw.kind.approve') });
    }
  }
  if (c.state.interaction === 'autonomous') modes.push(tIn(c.lang, 'status.autonomous'));
  else if (c.state.interaction === 'manual') modes.push(tIn(c.lang, 'status.manual'));
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
  await update($, labelsAtom, () => ({ modes, tail: quota.length ? `🛡 ${quota.join(' · ')}` : '🛡', band }));
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
  const s = c.state;
  const parts: string[] = [];
  const label = s.project ? (c.config.projects.find((p) => p.id === s.project)?.names[0] ?? s.project) : null;
  if (s.interaction === 'autonomous') parts.push(`the person asked for autonomous work${label ? ` on project "${label}"` : ''}`);
  else if (s.interaction === 'manual') parts.push(`the person asked to work step by step${label ? ` on project "${label}"` : ''}`);
  if (s.mode === 'chat') parts.push('chat mode is on: no project or memory writes and no commits until the person says continue');
  else if (s.mode !== 'free') parts.push(`${s.mode} mode is on (the safety layer enforces it)`);
  if (s.weeklyTarget !== null) parts.push(`the weekly quota budget is ${s.weeklyTarget}%`);
  if (s.wrapUp) parts.push('work is wrapping up: finish the current step, commit, report and stop');
  if (c.flow && c.config.modules.modes) {
    const step = currentStep(c.flow);
    parts.push(
      `a flow ${c.flow.status === 'paused' ? 'is paused' : 'runs'} (${c.flow.id}${c.flow.task ? `, task "${c.flow.task.slice(0, 200)}"` : ''}): ${stepsLine(c.flow, 'en')}; ` +
        (step?.kind === 'approve'
          ? "the plan waits for the person's approval"
          : `finish the ${step?.kind ?? ''} step and call mcp__terminal-code__flow_step with its name; drafts are in ${c.flow.workDir}`),
    );
  }
  return parts.length ? `[${APP_NAME}] Session state, kept across compaction: ${parts.join('; ')}.` : '';
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
  try {
    const answer = await $.ui.ask(tIn(c.lang, 'belt.ask.question', { tool, reasons }), {
      options: [allow, block],
      header: tIn(c.lang, 'belt.ask.header').slice(0, 12),
    });
    return answer === allow ? 'allow' : 'block';
  } catch {
    return 'none';
  }
}

async function onToolCall($: $, e: In<'tool.call'>, next: Nx<'tool.call'>): Out<'tool.call'> {
  const c = await ctxOf($);
  const tool = String(e.tool);
  const { tool: _t, tool_use_id, agentId: _a, consent: _c, requestMeta: _m, ...input } = e as unknown as Record<string, unknown>;
  void [_t, _a, _c, _m];
  const cwd = await $.session.cwd();

  const ctx = await beltContextFor($, c);
  const d = await evaluateToolCall(tool, input, ctx);
  const rules = d.findings.map((f) => f.rule);

  if (d.verdict === 'deny') {
    for (const r of new Set(d.findings.filter((f) => f.verdict === 'deny').map((f) => f.rule))) c.state.blocks[r] = (c.state.blocks[r] ?? 0) + 1;
    const repeat = Math.max(0, ...d.findings.filter((f) => f.verdict === 'deny').map((f) => c.state.blocks[f.rule] ?? 0));
    await saveState($, c);
    await logEvent($, c, { kind: 'belt', tool, verdict: 'deny', rules, reasons: d.findings.map((f) => maskSecrets(f.reason)), issues: d.issues });
    return { deny: decisionText(d, ctx, { repeatCount: repeat }) };
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
  }

  const guard = modeGuardFor(c, cwd);
  const refusal = checkGuards(tool, input, guard, c.config.modules.quota ? await quotaNow($, c) : null, classifyEnvFor(c, cwd), c.lang);
  if (refusal) {
    await logEvent($, c, { kind: refusal.kind, tool, verdict: 'deny', ...(refusal.mode ? { mode: refusal.mode, what: refusal.what } : {}) });
    return { deny: refusal.kind === 'mode' ? refusal.reason : `🛡 ${refusal.reason}` };
  }

  if (tool === 'ExitPlanMode' && c.config.modules.modes) return onExitPlanMode($, c, e, next);
  const result = await next(e);
  // The footer counts what ran: a refused call changed nothing, and neither did a file tool that failed.
  const ran = result.deny === undefined && !(result.isError === true && isFileTool(tool));
  if (ran && e.agentId === undefined) c.turn.uses.push({ name: tool, input });
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
  if (d.verdict === 'warn' && result && result.deny === undefined) {
    await logEvent($, c, { kind: 'belt', tool, verdict: 'warn', rules });
    return { ...result, context: [...(result.context ?? []), decisionText(d, ctx)] };
  }
  return result;
}

async function onPromptSubmit($: $, e: In<'prompt.submit'>, next: Nx<'prompt.submit'>): Out<'prompt.submit'> {
  const c = await ctxOf($);
  const kind = e.origin?.kind;
  // The person's own prompts, and this plugin's resume prompt (which ends with their continue keyword).
  const ours = kind === 'plugin' && (e.origin as { name?: string }).name === PLUGIN_NAME;
  const human = kind === 'composer' || kind === 'bridge' || kind === 'sdk' || ours;
  const extra: string[] = [];
  if (human) {
    c.turn = { startedAt: await $.clock.now(), uses: [] };
    await refreshConfig($, c);
    await syncPermissionMode($, c);
    // A mode given for one turn ends with it.
    if (c.state.turnMode) c.state = { ...c.state, turnMode: null };
    await heartbeat($, c);
    extra.push(...(await sameFolderNotes($, c)));
  }
  let flowSaid = false;
  if (human && c.config.modules.keywords) {
    const said = await keywordTurn($, c, String(e.text ?? ''));
    extra.push(...said.context);
    flowSaid = said.flow;
  }
  // While a flow runs, every prompt carries where it stands (short), unless a flow keyword just said more.
  const running = flowRunning(c);
  if (human && running && !flowSaid && c.config.modules.modes) extra.push(flowTurnContext(running, c.lang, stepTexts(c, running)));
  if (human) await refreshStatus($, c);
  extra.push(...(await quotaContext($, c)));
  return extra.length ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e);
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
async function keywordTurn($: $, c: Ctx, text: string): Promise<{ context: string[]; flow: boolean }> {
  const kw: KeywordMatch | null = detectKeyword(text, projectRefs(c.config), keywordTables(c.config));
  if (!kw) return { context: [], flow: false };
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
  c.state = applyKeyword(c.state, kw, target, { inFlow: !!running });
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

  const label = kw.project ? (c.config.projects.find((p) => p.id === kw.project)?.names[0] ?? kw.project) : null;
  const kindLabel = tIn(c.lang, `kw.kind.${kw.kind}` as MessageKey);
  if (running && isModeKeyword(kw.kind) && !kw.standalone)
    $.ui.toast(
      tIn(c.lang, 'flow.toast.turnMode', {
        mode: tIn(c.lang, `mode.name.${MODE_KEYWORDS[kw.kind]}` as MessageKey),
        step: stepName(currentStep(running)!.kind, c.lang),
      }),
    );
  else
    $.ui.toast(
      kw.project === null && kw.projectText
        ? tIn(c.lang, 'kw.toast.unknownProject', { kind: kindLabel, text: kw.projectText })
        : tIn(c.lang, 'kw.toast', { kind: kindLabel, project: label ? ` · ${label}` : '' }),
    );
  const cwd = await $.session.cwd();
  const context = keywordContext(kw, c.state, await quotaNow($, c), label, {
    workDir: workRoot(c, cwd),
    flow: running && isModeKeyword(kw.kind) ? { step: pausedFor ?? stepName(currentStep(running)!.kind, c.lang), paused: pausedFor !== null } : null,
  });
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
  if (q.level === 'stop' && q.resumeAt && c.state.interaction === 'autonomous' && c.config.quota.autoResume) {
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

async function onTurnComplete($: $, e: In<'turn.complete'>, next: Nx<'turn.complete'>): Out<'turn.complete'> {
  const result = await next(e);
  if (e.agentId !== undefined || e.reason !== 'answer') return result;
  const c = await ctxOf($);
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
    const next: TerminalCodeFooters = { ...m, [key]: footer.lines };
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete next[k];
    return next;
  });
  return result;
}

/** The tool the model finishes a flow's step with. In the prompt's tool list from the start (no search first). */
const FLOW_TOOL = {
  name: 'flow_step',
  description:
    'Finishes the current step of a terminal-code flow (research ▶ plan → approval → code): code checks the step and answers what is missing or what comes next. Call it only while a flow runs and the step is complete; "status" shows the flow.',
  inputSchema: {
    type: 'object',
    properties: { step: { type: 'string', enum: ['research', 'plan', 'code', 'status'], description: 'The step being finished, or status.' } },
    required: ['step'],
    additionalProperties: false,
  },
  isDeferred: false,
} as const;

async function onSessionStart($: $, e: In<'session.start'>, next: Nx<'session.start'>): Out<'session.start'> {
  ctxPromise = null;
  const c = await ctxOf($);
  await saveState($, c);
  if (c.state.resumeAt) await scheduleResume($, c);
  await refreshStatus($, c);
  const r = await next(e);
  if (c.config.modules.modes) {
    try {
      await $.tool.register(FLOW_TOOL);
    } catch {
      /* flows then answer through the keywords alone; the doctor's live test notices */
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
    if (c.flow && isRunning(c.flow) && c.config.modules.modes) {
      const p = pauseFlow(c.flow, `session ${String(e.reason ?? 'ended')}`, await $.clock.now());
      if (p.ok) await saveFlow($, c, p.flow);
    }
  } catch {
    /* the flow stays as it was; "continue" in the next session takes it over */
  }
  const r = await next(e);
  if (e.reason === 'clear') ctxPromise = null;
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

export function register(on: On): void {
  on('session.start', onSessionStart);
  on('tool.call', onToolCall).catch(refuseToolCall);
  on('prompt.submit', onPromptSubmit);
  on('session.measure', onMeasure);
  on('turn.complete', onTurnComplete);
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
  // The session's state survives a compaction: the summarizer is asked to keep it, and it is restated after.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const text = await sessionStateText($);
    if (!text) return next(e);
    const r = await next({ ...e, instructions: [e.instructions, `Keep this in the summary, word for word: ${text}`].filter(Boolean).join('\n') });
    await restateSession($, text);
    return r;
  });
  // After /clear the conversation goes on under a new session id with a fresh state; a running flow pauses.
  on('session.end', onSessionEnd);
  // While a plan waits for approval, one line above the prompt says so and how to approve.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = await bandText($);
    if (!band || e.props.hasSurvey) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const tree = h(Box, null, h(Text, null, band));
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

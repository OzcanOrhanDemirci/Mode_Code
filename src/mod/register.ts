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
import { APP_NAME, APP_VERSION, DATA_DIR_NAME } from '../core/app.js';
import { parseConfig, type Config } from '../core/config.js';
import { layout, sessionFile, eventsFile, type Layout } from '../core/layout.js';
import { joinPath, resolvePath, type Platform } from '../core/paths.js';
import { detectLanguage, tIn, setLanguage, type Lang } from '../core/i18n/index.js';
import { evaluateToolCall, decisionText } from '../core/belt/evaluate.js';
import type { BeltContext, BeltDecision, GitFacts } from '../core/belt/types.js';
import { checkGuards } from '../core/guard.js';
import { detectKeyword, type KeywordMatch } from '../core/keywords.js';
import { keywordContext, wrapUpContext, stopContext, resumePrompt } from '../core/guidance.js';
import { addApproval, applyKeyword, newModState, parseModState, type ModSessionState } from '../core/session.js';
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
}

let ctxPromise: Promise<Ctx> | null = null;

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
  const reading = parseReading(await readFile($, l.quota));
  const eventsPath = eventsFile(l, sessionId, 'mod', now);
  const existing = await readFile($, eventsPath);
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
  if (!ctxPromise) ctxPromise = load($);
  try {
    return await ctxPromise;
  } catch (err) {
    ctxPromise = null;
    throw err;
  }
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

async function refreshStatus($: $, c: Ctx): Promise<void> {
  if (!c.config.modules.status) {
    $.ui.status(undefined);
    return;
  }
  const q = await quotaNow($, c);
  const parts: string[] = [`🛡 ${APP_NAME}`];
  if (c.state.mode === 'chat') parts.push(tIn(c.lang, 'status.chat'));
  if (c.state.interaction === 'autonomous') parts.push(tIn(c.lang, 'status.autonomous'));
  else if (c.state.interaction === 'manual') parts.push(tIn(c.lang, 'status.manual'));
  if (c.state.wrapUp) parts.push(tIn(c.lang, 'status.wrapUp'));
  if (q.usable && q.five) parts.push(tIn(c.lang, 'status.five', { n: Math.round(q.five.used) }));
  if (q.usable && q.week)
    parts.push(
      c.state.weeklyTarget !== null
        ? tIn(c.lang, 'status.weekTarget', { n: Math.round(q.week.used), target: c.state.weeklyTarget })
        : tIn(c.lang, 'status.week', { n: Math.round(q.week.used) }),
    );
  if (c.state.resumeAt) {
    const d = new Date(c.state.resumeAt);
    parts.push(tIn(c.lang, 'status.resume', { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }));
  }
  $.ui.status(parts.join(' · '));
}

/** Asks the person about a belt "ask" verdict. Resolves true only on an explicit "allow". */
async function askPerson($: $, c: Ctx, tool: string, d: BeltDecision): Promise<'allow' | 'block' | 'none'> {
  const reasons = d.findings
    .filter((f) => f.verdict === 'ask')
    .map((f) => f.reason)
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
  if (e.agentId === undefined) c.turn.uses.push({ name: tool, input });

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
    if (answer !== 'allow') return { deny: `${decisionText(d, ctx)}\n${tIn(c.lang, answer === 'none' ? 'belt.ask.noOne' : 'belt.ask.declined')}` };
    if (typeof tool_use_id === 'string') {
      c.state = addApproval(c.state, { toolUseId: tool_use_id, at: await $.clock.now(), rules });
      await saveState($, c);
    }
  }

  const refusal = checkGuards(tool, input, c.state, c.config.modules.quota ? await quotaNow($, c) : null, classifyEnvFor(c, cwd), c.lang);
  if (refusal) {
    await logEvent($, c, { kind: refusal.kind, tool, verdict: 'deny' });
    return { deny: refusal.reason };
  }

  const result = await next(e);
  if (d.verdict === 'warn' && result && result.deny === undefined) {
    await logEvent($, c, { kind: 'belt', tool, verdict: 'warn', rules });
    return { ...result, context: [...(result.context ?? []), decisionText(d, ctx)] };
  }
  return result;
}

async function onPromptSubmit($: $, e: In<'prompt.submit'>, next: Nx<'prompt.submit'>): Out<'prompt.submit'> {
  const c = await ctxOf($);
  const kind = e.origin?.kind;
  const human = kind === 'composer' || kind === 'bridge' || kind === 'sdk';
  if (human) c.turn = { startedAt: await $.clock.now(), uses: [] };
  const extra: string[] = [];
  if (human && c.config.modules.keywords) extra.push(...(await keywordTurn($, c, String(e.text ?? ''))));
  extra.push(...(await quotaContext($, c)));
  return extra.length ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e);
}

/** Detects a keyword in the person's prompt, applies it to the session, and returns the context it adds. */
async function keywordTurn($: $, c: Ctx, text: string): Promise<string[]> {
  const kw: KeywordMatch | null = detectKeyword(text, projectRefs(c.config), keywordTables(c.config));
  if (!kw) return [];
  const now = await $.clock.now();
  const budget = kw.kind === 'quota' ? { n: kw.n ?? 0, plus: kw.plus ?? false } : kw.budget;
  const target = budget ? weeklyTargetFrom(budget, c.reading, now) : null;
  c.state = applyKeyword(c.state, kw, target);
  if (kw.kind === 'continue' || kw.kind === 'manual') c.state = { ...c.state, resumeAt: null };
  if (kw.kind === 'stop' || kw.kind === 'wrapUp') {
    c.resumeTimer?.cancel();
    c.resumeTimer = null;
  }
  if (kw.kind === 'continue' || kw.kind === 'quota') c.announced = 'ok';
  await saveState($, c);
  await logEvent($, c, { kind: 'keyword', keyword: kw.kind, project: kw.project ?? null, n: kw.n ?? null });

  const label = kw.project ? (c.config.projects.find((p) => p.id === kw.project)?.names[0] ?? kw.project) : null;
  const kindLabel = tIn(c.lang, `kw.kind.${kw.kind}` as 'kw.kind.continue');
  $.ui.toast(
    kw.project === null && kw.projectText
      ? tIn(c.lang, 'kw.toast.unknownProject', { kind: kindLabel, text: kw.projectText })
      : tIn(c.lang, 'kw.toast', { kind: kindLabel, project: label ? ` · ${label}` : '' }),
  );
  await refreshStatus($, c);
  return keywordContext(kw, c.state, await quotaNow($, c), label);
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
  await $.prompt.submit({ text: resumePrompt(label) });
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
  return { ...result, text: footer.lines.join('\n') };
}

async function onSessionStart($: $, e: In<'session.start'>, next: Nx<'session.start'>): Out<'session.start'> {
  ctxPromise = null;
  const c = await ctxOf($);
  await saveState($, c);
  if (c.state.resumeAt) await scheduleResume($, c);
  await refreshStatus($, c);
  return next(e);
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
}

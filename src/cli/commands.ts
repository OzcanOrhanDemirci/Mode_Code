// SPDX-License-Identifier: Apache-2.0
/**
 * The command line. Every command prints plain text for people and, with --json, one JSON document whose
 * shape is versioned in its "schema" field ("terminal-code.<command>/1"): fields are only ever added
 * within a version, so scripts keep working.
 */
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { APP_NAME, APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS, REPO_URL } from '../core/app.js';
import { cloneDefaults, serializeConfig, setConfigValue, type Config } from '../core/config.js';
import { evaluateToolCall } from '../core/belt/evaluate.js';
import { RULES, RULE_IDS } from '../core/belt/rules.js';
import { compact, percent, ago, until, dateTime, bar, shortPath, integer } from '../core/format.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import { maskSecrets } from '../core/secrets/scan.js';
import { beltContext } from '../node/context.js';
import { readText, writeAtomic } from '../node/fsx.js';
import { applyInstall, applyUninstall, distDir, hookGroups, planInstall, readManifest, stableNodePath, underAgent } from '../node/install.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cacheHitRate } from '../node/index-db.js';
import { readClaudeEnv, runClaudeInteractive } from '../node/claude-env.js';
import { appContext, type AppContext } from '../app/context.js';
import { loadEvents, loadQuota, openIndex, scanPaths } from '../app/data.js';
import { checkHealth, healthCounts, type FeatureHealth } from '../app/health.js';
import { buildReport, reportLines } from '../app/report.js';
import { replay } from '../app/replay.js';
import { findFlow, flowFiles, loadFlows } from '../app/flows.js';
import { progress } from '../core/flow.js';
import { evidenceText, flowTitle, statusText } from '../core/flow-view.js';
import { stepName, stepsLine } from '../core/guidance.js';
import { claudeDir as claudeDirOf } from '../node/env.js';
import { appliedTemplates, repoKey, TEMPLATES, templateById, withTemplates } from '../core/templates.js';
import { git } from '../node/git.js';
import { autonomyCheck, findRun, loadRuns, runFiles } from '../app/runs.js';
import { activeTime, nextStep as nextRunStep, progress as runProgress, type Run } from '../core/run.js';
import { durationText, rollbackCommands } from '../core/run-report.js';
import { flag, intValue, value, values, type Args } from './args.js';
import { bold, dim, green, red, yellow, gray, cyan, table } from './style.js';

type Out = (s?: string) => void;
const say: Out = (s = '') => process.stdout.write(s + '\n');

function json(schema: string, data: object): void {
  process.stdout.write(JSON.stringify({ schema: `terminal-code.${schema}/1`, version: APP_VERSION, ...data }, null, 2) + '\n');
}

function T(ctx: AppContext, key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(ctx.lang, key, params);
}

function stateMark(ctx: AppContext, s: FeatureHealth['state']): string {
  const word = T(ctx, `health.state.${s}` as MessageKey);
  if (s === 'ok') return green(`✓ ${word}`);
  if (s === 'red') return red(`✗ ${word}`);
  if (s === 'gray') return yellow(`◌ ${word}`);
  return gray(`· ${word}`);
}

async function confirm(question: string, word?: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim();
    if (word) return answer === word;
    return /^(?:y|yes|e|evet)$/i.test(answer);
  } finally {
    rl.close();
  }
}

/** Asks the person to pick one of a few options by number; Enter picks the first. */
async function choose(ctx: AppContext, question: string, options: string[]): Promise<number> {
  say(bold(question));
  options.forEach((o, i) => say(`  ${cyan(String(i + 1))}  ${o}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`${T(ctx, 'install.ask.pick', { n: options.length })} `)).trim();
      if (answer === '') return 0;
      const n = parseInt(answer, 10);
      if (n >= 1 && n <= options.length) return n - 1;
    }
  } finally {
    rl.close();
  }
}

async function askText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${bold(question)} `)).trim();
  } finally {
    rl.close();
  }
}

// ── status ──

export async function cmdStatus(a: Args): Promise<number> {
  const ctx = appContext();
  const h = checkHealth(ctx);
  const q = loadQuota(ctx);
  const now = Date.now();
  const events = loadEvents(ctx, 1, now).filter((e) => e.kind === 'belt' && e.verdict === 'deny');
  if (flag(a, 'json')) {
    json('status', {
      installed: h.installed,
      claudeCode: h.claude,
      dataDir: ctx.layout.root,
      features: h.features,
      modSeen: h.modSeen,
      quota: q.reading
        ? { measuredAt: q.reading.measuredAt, fiveHour: q.assessment.five, sevenDay: q.assessment.week, level: q.assessment.level, stale: q.assessment.stale }
        : null,
      blockedToday: events.length,
      configProblems: ctx.problems,
    });
    return 0;
  }
  const c = healthCounts(h);
  say(`${bold(APP_NAME)} ${APP_VERSION} · Claude Code ${h.claude ?? T(ctx, 'cli.notFound')}`);
  say(dim(shortPath(ctx.layout.root, homedir())));
  say();
  if (!h.installed) {
    say(yellow(T(ctx, 'cli.status.notInstalled')));
    say(T(ctx, 'cli.status.installHint', { cmd: cyan(`${APP_NAME} install`) }));
    return 0;
  }
  for (const f of h.features) {
    const reason = f.reason ? dim(' · ' + T(ctx, f.reason.key as MessageKey, f.reason.params)) : '';
    say(`  ${stateMark(ctx, f.state)}  ${T(ctx, `feature.${f.id}` as MessageKey)}${reason}`);
  }
  say();
  if (q.reading) {
    const five = q.assessment.five;
    const week = q.assessment.week;
    if (five)
      say(
        `  ${T(ctx, 'cli.quota.five').padEnd(14)} ${bar(five.used, 20)} ${percent(five.used, ctx.lang)} ${dim(T(ctx, 'cli.quota.resets', { when: until(five.resetsAt, now, ctx.lang) }))}`,
      );
    if (week)
      say(
        `  ${T(ctx, 'cli.quota.week').padEnd(14)} ${bar(week.used, 20)} ${percent(week.used, ctx.lang)} ${dim(T(ctx, 'cli.quota.resets', { when: until(week.resetsAt, now, ctx.lang) }))}`,
      );
    say(dim(`  ${T(ctx, 'cli.measured', { when: ago(q.reading.measuredAt, now, ctx.lang) })}`));
  }
  if (events.length) say(`  ${red('🛡')} ${T(ctx, 'cli.status.blockedToday', { n: events.length })}`);
  if (ctx.problems.length) say(yellow(`  ${T(ctx, 'cli.status.configProblems', { n: ctx.problems.length, file: shortPath(ctx.layout.config, homedir()) })}`));
  if (c.red) say(red(`\n${T(ctx, 'cli.status.redHint', { cmd: `${APP_NAME} doctor` })}`));
  return c.red ? 1 : 0;
}

// ── install / uninstall ──

export async function cmdInstall(a: Args): Promise<number> {
  const ctx = appContext();
  const plan = planInstall(ctx.layout);
  const dry = flag(a, 'dry-run');
  if (flag(a, 'json') && (dry || plan.blockers.length)) {
    json('install-plan', { plan });
    return plan.blockers.length ? 1 : 0;
  }
  // With --json the output is one JSON document and nothing else; with nobody to confirm, --yes is the confirmation.
  if (flag(a, 'json')) {
    if (!flag(a, 'yes', 'y')) {
      json('install', { ok: false, steps: [], manifest: null, error: 'needs --yes' });
      return 1;
    }
    const chosen: Partial<Config> = {};
    const lang = value(a, 'lang');
    if (lang === 'en' || lang === 'tr') chosen.language = lang;
    const view = value(a, 'view');
    if (view === 'simple' || view === 'recommended' || view === 'detailed') chosen.view = view;
    const mem = values(a, 'memory');
    if (mem.length) chosen.memory = { ...cloneDefaults().memory, dirs: mem };
    const r = applyInstall(ctx.layout, plan, { config: chosen });
    json('install', { ok: r.ok, steps: r.steps, manifest: r.manifest });
    return r.ok ? 0 : 1;
  }
  say(bold(T(ctx, 'install.title', { app: APP_NAME, version: APP_VERSION })));
  say();
  say(T(ctx, 'install.intro'));
  say();
  for (const s of plan.steps) {
    const mark = s.done ? gray('·') : cyan('+');
    say(`  ${mark} ${T(ctx, `install.step.${s.kind}` as MessageKey)}`);
    for (const t of s.targets) say(dim(`      ${shortPath(t, homedir(), 90)}`));
  }
  say();
  say(dim(T(ctx, 'install.hookCommand', { cmd: `${plan.hookCommand.command} ${plan.hookCommand.args.join(' ')}` })));
  for (const w of plan.warnings) say(yellow(`  ! ${T(ctx, w.key, w.params)}`));
  for (const b of plan.blockers) say(red(`  ✗ ${T(ctx, b.key, b.params)}`));
  if (plan.blockers.length) return 1;
  if (dry) {
    say();
    say(dim(T(ctx, 'install.dryRun')));
    return 0;
  }
  say();
  const chosen: Partial<Config> = {};
  const lang = value(a, 'lang');
  if (lang === 'en' || lang === 'tr') chosen.language = lang;
  const view = value(a, 'view');
  if (view === 'simple' || view === 'recommended' || view === 'detailed') chosen.view = view;
  const mem = values(a, 'memory');
  if (mem.length) chosen.memory = { ...cloneDefaults().memory, dirs: mem };
  // First installation in a terminal: a few choices, then one confirmation for everything.
  const firstTime = !plan.steps.find((s) => s.kind === 'config')?.done;
  if (firstTime && !flag(a, 'yes', 'y') && process.stdin.isTTY && !chosen.view) {
    const v = await choose(ctx, T(ctx, 'install.ask.view'), [T(ctx, 'install.ask.simple'), T(ctx, 'install.ask.recommended'), T(ctx, 'install.ask.detailed')]);
    chosen.view = (['simple', 'recommended', 'detailed'] as const)[v];
    if (chosen.view !== 'simple') {
      if (!chosen.memory) {
        const suggestion = readClaudeEnv(ctx.cwd).memoryDir;
        const m = await askText(T(ctx, 'install.ask.memory', { suggestion: shortPath(suggestion, homedir(), 70) }));
        const dir = m === '' ? suggestion : m === '-' ? null : m;
        if (dir) chosen.memory = { ...cloneDefaults().memory, dirs: [dir] };
      }
      const f = await choose(ctx, T(ctx, 'install.ask.footer'), [T(ctx, 'footer.mode.draw'), T(ctx, 'footer.mode.check'), T(ctx, 'footer.mode.off')]);
      chosen.footer = { ...cloneDefaults().footer, mode: (['draw', 'check', 'off'] as const)[f]! };
    }
    say();
    say(bold(T(ctx, 'install.summary')));
    say(`  ${T(ctx, 'set.view')}: ${T(ctx, `view.${chosen.view ?? 'recommended'}` as MessageKey)}`);
    if (chosen.memory) say(`  ${T(ctx, 'page.memory')}: ${chosen.memory.dirs.map((d) => shortPath(d, homedir(), 70)).join(', ')}`);
    if (chosen.footer) say(`  ${T(ctx, 'set.footerMode')}: ${T(ctx, `footer.mode.${chosen.footer.mode}` as MessageKey)}`);
    say();
  }
  if (!flag(a, 'yes', 'y') && !(await confirm(T(ctx, 'install.confirm')))) {
    say(T(ctx, 'cli.cancelled'));
    return 1;
  }
  const r = applyInstall(ctx.layout, plan, { config: chosen });
  for (const s of r.steps) say(`  ${s.ok ? green('✓') : red('✗')} ${T(ctx, `install.step.${s.kind}` as MessageKey)}${s.detail ? dim(' · ' + s.detail) : ''}`);
  say();
  if (!r.ok) {
    say(red(T(ctx, 'install.failed')));
    say(T(ctx, 'install.failedHint', { cmd: `${APP_NAME} uninstall`, repo: `${REPO_URL}/issues` }));
    return 1;
  }
  say(green(bold(T(ctx, 'install.done'))));
  say(T(ctx, 'install.next', { cmd: cyan(APP_NAME) }));
  return 0;
}

/**
 * Starts one Claude Code session with the plugin and the safety-net hooks loaded from the built files,
 * without installing anything: the hooks come from a settings file passed with --settings, the plugin from
 * --plugin-dir. When the session ends, nothing is left in Claude Code's configuration.
 */
export async function cmdTry(a: Args): Promise<number> {
  const ctx = appContext();
  if (underAgent()) {
    say(red(T(ctx, 'try.agent')));
    return 1;
  }
  const dist = distDir();
  const hook = join(dist, 'hook.mjs').replace(/\\/g, '/');
  const plugin = join(dist, 'plugin');
  if (!existsSync(hook) || !existsSync(join(plugin, '.claude-plugin', 'plugin.json'))) {
    say(red(T(ctx, 'install.block.noBuild', { dir: dist })));
    return 1;
  }
  const settingsPath = join(ctx.layout.stateDir, 'try-settings.json');
  writeAtomic(settingsPath, JSON.stringify({ hooks: hookGroups(stableNodePath().replace(/\\/g, '/'), hook) }, null, 2) + '\n');
  const args = ['--plugin-dir', plugin, '--settings', settingsPath, ...a.positionals];
  say(T(ctx, 'try.intro'));
  say(dim(`claude ${args.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`));
  if (flag(a, 'print')) return 0; // show the command, start nothing
  say();
  const status = runClaudeInteractive(args);
  if (status === null) {
    say(red(T(ctx, 'install.block.noClaude')));
    return 1;
  }
  return status;
}

export async function cmdUninstall(a: Args): Promise<number> {
  const ctx = appContext();
  const m = readManifest(ctx.layout);
  const purge = flag(a, 'purge');
  if (underAgent()) {
    if (flag(a, 'json')) json('uninstall', { ok: false, steps: [], error: 'refused inside a Claude Code session' });
    else say(red(T(ctx, 'cli.agentRefused')));
    return 1;
  }
  // With --json the output is one JSON document. --yes confirms; deleting the data folder (--purge) needs the
  // person to type the name, so it is not available there.
  if (flag(a, 'json')) {
    if (!flag(a, 'yes', 'y') || purge) {
      json('uninstall', { ok: false, steps: [], error: purge ? '--purge needs a terminal' : 'needs --yes' });
      return 1;
    }
    if (flag(a, 'dry-run')) {
      json('uninstall', { ok: true, steps: [], dryRun: true });
      return 0;
    }
    const r = applyUninstall(ctx.layout);
    json('uninstall', r as unknown as object);
    return r.ok ? 0 : 1;
  }
  say(bold(T(ctx, 'uninstall.title')));
  say();
  say(T(ctx, m ? 'uninstall.intro' : 'uninstall.noManifest'));
  say(`  - ${T(ctx, 'uninstall.plugin')}`);
  say(`  - ${T(ctx, 'uninstall.hooks', { file: shortPath(m?.settingsFile ?? '~/.claude/settings.json', homedir()) })}`);
  say(`  - ${T(ctx, 'uninstall.files')}`);
  say(
    purge
      ? red(`  - ${T(ctx, 'uninstall.purge', { dir: shortPath(ctx.layout.root, homedir()) })}`)
      : dim(`  ${T(ctx, 'uninstall.keep', { dir: shortPath(ctx.layout.root, homedir()) })}`),
  );
  if (flag(a, 'dry-run')) return 0;
  say();
  const word = purge ? APP_NAME : undefined;
  if (!flag(a, 'yes', 'y') || purge) {
    const ok = await confirm(purge ? T(ctx, 'uninstall.typeName', { name: APP_NAME }) : T(ctx, 'uninstall.confirm'), word);
    if (!ok) {
      say(T(ctx, 'cli.cancelled'));
      return 1;
    }
  }
  const r = applyUninstall(ctx.layout, { purge });
  for (const s of r.steps)
    say(`  ${s.ok ? green('✓') : red('✗')} ${T(ctx, `uninstall.step.${s.what}` as MessageKey)}${s.detail && !s.ok ? dim(' · ' + s.detail) : ''}`);
  say();
  say(r.ok ? green(T(ctx, 'uninstall.done')) : red(T(ctx, 'uninstall.partial')));
  return r.ok ? 0 : 1;
}

// ── quota ──

export async function cmdQuota(a: Args): Promise<number> {
  const ctx = appContext();
  const q = loadQuota(ctx);
  const now = Date.now();
  if (flag(a, 'json')) {
    json('quota', { reading: q.reading, assessment: q.assessment, target: q.target });
    return 0;
  }
  if (!q.reading) {
    say(yellow(T(ctx, 'cli.quota.none')));
    return 1;
  }
  const rows = [
    [T(ctx, 'cli.quota.window'), T(ctx, 'cli.quota.used'), '', T(ctx, 'cli.quota.resetsAt')],
    ...q.reading.windows.map((w) => [
      w.kind === 'five_hour' ? T(ctx, 'cli.quota.five') : w.kind === 'seven_day' ? T(ctx, 'cli.quota.week') : w.kind,
      percent(w.used, ctx.lang),
      bar(w.used, 24),
      w.resetsAt ? `${dateTime(w.resetsAt, ctx.lang)} (${until(w.resetsAt, now, ctx.lang)})` : '?',
    ]),
  ];
  say(table(rows, [1]));
  say();
  const t = q.assessment.target;
  say(T(ctx, t.explicit ? 'cli.quota.targetExplicit' : 'cli.quota.targetDefault', { n: percent(t.value, ctx.lang) }));
  if (q.assessment.level !== 'ok') say(red(T(ctx, q.assessment.level === 'stop' ? 'cli.quota.levelStop' : 'cli.quota.levelWrapUp')));
  say(dim(T(ctx, 'cli.measured', { when: ago(q.reading.measuredAt, now, ctx.lang) }) + (q.assessment.stale ? ' · ' + T(ctx, 'cli.quota.stale') : '')));
  return 0;
}

// ── tokens / sessions ──

export async function cmdTokens(a: Args): Promise<number> {
  const ctx = appContext();
  const days = intValue(a, 'days', 7, 1, 3650);
  const by = (value(a, 'by') ?? 'day') as 'day' | 'model' | 'cwd';
  const since = Date.now() - days * 86400_000;
  const idx = openIndex(ctx);
  try {
    const total = idx.totals(since);
    const rows = idx.breakdown(by === 'model' || by === 'cwd' ? by : 'day', since);
    if (flag(a, 'json')) {
      json('tokens', { days, by, total, cacheHitRate: cacheHitRate(total), rows });
      return 0;
    }
    say(bold(T(ctx, 'cli.tokens.title', { n: days })));
    say();
    const hit = cacheHitRate(total);
    say(
      table(
        [
          [T(ctx, 'tokens.kind'), T(ctx, 'tokens.count')],
          [T(ctx, 'tokens.input'), compact(total.input, ctx.lang)],
          [T(ctx, 'tokens.cacheWrite'), compact(total.cacheWrite, ctx.lang)],
          [T(ctx, 'tokens.cacheRead'), compact(total.cacheRead, ctx.lang)],
          [T(ctx, 'tokens.output'), compact(total.output, ctx.lang)],
          [T(ctx, 'tokens.thinking'), compact(total.thinking, ctx.lang)],
          [T(ctx, 'tokens.agents'), compact(total.agentTokens, ctx.lang)],
          [T(ctx, 'tokens.messages'), integer(total.messages, ctx.lang)],
          [T(ctx, 'tokens.cacheHit'), hit === null ? '?' : percent(hit * 100, ctx.lang, 1)],
        ],
        [1],
      ),
    );
    say();
    const head = by === 'model' ? T(ctx, 'tokens.model') : by === 'cwd' ? T(ctx, 'tokens.folder') : T(ctx, 'tokens.day');
    say(
      table(
        [
          [head, T(ctx, 'tokens.output'), T(ctx, 'tokens.cacheRead'), T(ctx, 'tokens.messages')],
          ...rows
            .slice(0, 30)
            .map((r) => [
              by === 'cwd' ? shortPath(r.key, homedir(), 50) : r.key,
              compact(r.output, ctx.lang),
              compact(r.cacheRead, ctx.lang),
              integer(r.messages, ctx.lang),
            ]),
        ],
        [1, 2, 3],
      ),
    );
    say();
    say(dim(T(ctx, 'tokens.note')));
    return 0;
  } finally {
    idx.close();
  }
}

/** Rule templates for the current folder: list, apply (preview and confirm), remove. */
export async function cmdTemplate(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'list';
  const mdPath = join(process.cwd(), 'CLAUDE.md');
  const md = readText(mdPath);
  const applied = appliedTemplates(md);
  if (sub === 'list') {
    if (flag(a, 'json')) {
      json('templates', {
        folder: process.cwd(),
        applied,
        templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name[ctx.lang], description: t.description[ctx.lang], rules: t.rules[ctx.lang] })),
      });
      return 0;
    }
    for (const t of TEMPLATES) {
      say(`${applied.includes(t.id) ? green('✓') : ' '} ${bold(t.id.padEnd(15))} ${t.name[ctx.lang]}`);
      say(dim(`                  ${t.description[ctx.lang]}`));
    }
    say();
    say(dim(T(ctx, 'template.hint')));
    return 0;
  }
  if (sub !== 'apply' && sub !== 'remove') {
    say(red(T(ctx, 'cli.unknownSub', { sub, cmd: 'template' })));
    return 2;
  }
  const t = templateById(a.positionals[1] ?? '');
  if (!t) {
    say(red(T(ctx, 'template.unknown', { id: a.positionals[1] ?? '' })));
    return 2;
  }
  if (sub === 'remove' && underAgent()) {
    say(red(T(ctx, 'cli.agentRefused')));
    return 1;
  }
  const remoteRun = git(process.cwd(), ['remote', 'get-url', 'origin']);
  const remote = remoteRun.ok && remoteRun.out ? repoKey(remoteRun.out) : null;
  if (sub === 'apply' && t.needsRemote && !remote) {
    say(red(T(ctx, 'template.noRemote')));
    return 1;
  }
  const changes = sub === 'apply' ? (t.changes?.(remote) ?? []) : [];
  const ids = sub === 'apply' ? [...new Set([...applied, t.id])] : applied.filter((x) => x !== t.id);
  say(bold(t.name[ctx.lang]) + dim(`  (${t.id})`));
  say(T(ctx, sub === 'apply' ? 'template.willWrite' : 'template.willRemove', { file: shortPath(mdPath, homedir(), 80) }));
  for (const r of t.rules[ctx.lang]) say(`  - ${r}`);
  for (const ch of changes) say(`  ${cyan('+')} ${ch.text[ctx.lang]}`);
  if (sub === 'remove' && t.changes) say(dim(T(ctx, 'template.settingsStay')));
  if (flag(a, 'dry-run')) return 0;
  if (!flag(a, 'yes', 'y') && !(await confirm(T(ctx, 'template.confirm')))) {
    say(T(ctx, 'cli.cancelled'));
    return 1;
  }
  let cfg = ctx.config;
  for (const ch of changes) cfg = setConfigValue(cfg, ch.path, ch.apply(cfg)).config;
  if (changes.length) writeAtomic(ctx.layout.config, serializeConfig(cfg));
  writeAtomic(mdPath, withTemplates(md, ids, ctx.lang));
  say(green(T(ctx, sub === 'apply' ? 'template.applied' : 'template.removed')));
  return 0;
}

export async function cmdReport(a: Args): Promise<number> {
  const ctx = appContext();
  const days = flag(a, 'week') ? 7 : intValue(a, 'days', 1, 1, 365);
  const to = Date.now();
  const from = to - days * 86400_000;
  const idx = openIndex(ctx);
  try {
    const r = buildReport(idx, loadEvents(ctx, days + 1), from, to);
    if (flag(a, 'json')) {
      json('report', { days, report: { ...r, sessions: r.sessions.map((s) => s.id) } });
      return 0;
    }
    say(bold(days === 1 ? T(ctx, 'report.titleDay') : T(ctx, 'report.title', { n: days })) + dim(`  ${dateTime(from, ctx.lang)} → ${dateTime(to, ctx.lang)}`));
    say();
    const lines = reportLines(r, ctx.lang, homedir());
    const w = Math.max(...lines.map((l) => l.label.length)) + 2;
    for (const l of lines) say(`  ${bold(l.label.padEnd(w))}${l.text}`);
    return 0;
  } finally {
    idx.close();
  }
}

export async function cmdSessions(a: Args): Promise<number> {
  const ctx = appContext();
  const idx = openIndex(ctx);
  try {
    const search = value(a, 'search') ?? (a.positionals.length ? a.positionals.join(' ') : undefined);
    const list = idx.sessions({ limit: intValue(a, 'limit', 20, 1, 1000), ...(search ? { search } : {}) });
    if (flag(a, 'json')) {
      json('sessions', { sessions: list });
      return 0;
    }
    if (!list.length) {
      say(T(ctx, 'cli.sessions.none'));
      return 0;
    }
    const now = Date.now();
    say(
      table(
        [
          [T(ctx, 'sessions.when'), T(ctx, 'sessions.title'), T(ctx, 'sessions.folder'), T(ctx, 'sessions.prompts'), T(ctx, 'sessions.tokens'), 'id'],
          ...list.map((s) => [
            ago(s.lastTs, now, ctx.lang),
            (s.title ?? s.firstPrompt ?? '').slice(0, 40),
            shortPath(s.cwd, homedir(), 28),
            String(s.prompts),
            compact(s.tokens, ctx.lang),
            dim(s.id.slice(0, 8)),
          ]),
        ],
        [3, 4],
      ),
    );
    return 0;
  } finally {
    idx.close();
  }
}

// ── flows ──

export async function cmdFlow(a: Args): Promise<number> {
  const ctx = appContext();
  const flows = loadFlows(ctx);
  const sub = a.positionals[0] ?? 'list';
  if (sub === 'show') {
    const f = a.positionals[1] ? findFlow(flows, a.positionals[1]) : flows[0];
    if (!f) {
      process.stderr.write(T(ctx, 'cli.flow.notFound', { id: a.positionals[1] ?? '' }) + '\n');
      return 1;
    }
    const files = flowFiles(ctx, f);
    if (flag(a, 'json')) {
      json('flow', { flow: f, files });
      return 0;
    }
    const now = Date.now();
    say(bold(flowTitle(f, 100)) + dim(`  ${f.id}`));
    say(`  ${T(ctx, 'flow.card.status').padEnd(16)}${statusText(f.status, ctx.lang)} · ${stepsLine(f, ctx.lang)}`);
    say(`  ${T(ctx, 'flow.card.folder').padEnd(16)}${shortPath(f.cwd, homedir(), 70)}`);
    say(`  ${T(ctx, 'flow.card.updated').padEnd(16)}${ago(f.updatedAt, now, ctx.lang)}`);
    say();
    for (const s of f.steps) {
      const mark = s.status === 'done' ? green('✓') : s.status === 'active' ? yellow('▶') : gray('·');
      say(
        `  ${mark} ${stepName(s.kind, ctx.lang).padEnd(16)}${s.evidence ? evidenceText(s.evidence, ctx.lang) : dim(T(ctx, `flow.step.status.${s.status}` as MessageKey))}`,
      );
    }
    if (f.verification.length) {
      say();
      say(`  ${T(ctx, 'flow.card.verification')}`);
      for (const v of f.verification) say(`    ${cyan(v)}`);
    }
    say();
    const fileRows: [MessageKey, string | null][] = [
      ['flow.card.report', files.report],
      ['flow.card.plan', files.plan],
      ['flow.card.checkedReport', files.checkedReport],
      ['flow.card.approvedPlan', files.approvedPlan],
    ];
    for (const [k, p] of fileRows) if (p) say(`  ${T(ctx, k).padEnd(16)}${p}`);
    return 0;
  }
  if (sub !== 'list') {
    process.stderr.write(T(ctx, 'cli.unknownCommand', { cmd: `flow ${sub}` }) + '\n');
    return 2;
  }
  const open = flag(a, 'all')
    ? flows
    : flows
        .filter((f) => f.status !== 'done' && f.status !== 'canceled')
        .concat(flows.filter((f) => f.status === 'done' || f.status === 'canceled').slice(0, 5));
  if (flag(a, 'json')) {
    json('flows', { flows: open });
    return 0;
  }
  if (!open.length) {
    say(T(ctx, 'cli.flow.none'));
    return 0;
  }
  const now = Date.now();
  say(
    table(
      [
        [T(ctx, 'sessions.when'), T(ctx, 'flow.card.status'), T(ctx, 'flow.card.step'), T(ctx, 'flow.card.task'), 'id'],
        ...open.map((f) => {
          const p = progress(f);
          const step = f.steps[f.current];
          return [
            ago(f.updatedAt, now, ctx.lang),
            f.status === 'waiting' ? yellow(statusText(f.status, ctx.lang)) : statusText(f.status, ctx.lang),
            step ? `${p.at}/${p.of} ${stepName(step.kind, ctx.lang)}` : `${p.of}/${p.of}`,
            flowTitle(f, 40),
            dim(f.id),
          ];
        }),
      ],
      [],
    ),
  );
  return 0;
}

// ── belt ──

export async function cmdBelt(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'rules';
  if (sub === 'rules') {
    const rows = RULE_IDS.map((id) => {
      const info = RULES[id];
      const disabled = !info.locked && ctx.config.belt.disabled?.includes(id);
      const v = ctx.config.belt.verdicts?.[id] ?? info.verdict;
      return {
        id,
        category: info.category,
        verdict: disabled ? 'off' : v,
        locked: info.locked,
        pack: info.pack ?? null,
        description: T(ctx, `rule.${id}` as MessageKey),
      };
    });
    if (flag(a, 'json')) {
      json('belt-rules', { rules: rows });
      return 0;
    }
    say(
      table([
        [T(ctx, 'belt.col.rule'), T(ctx, 'belt.col.verdict'), T(ctx, 'belt.col.what')],
        ...rows.map((r) => [r.id + (r.locked ? ' 🔒' : ''), T(ctx, `verdict.${r.verdict}` as MessageKey), r.description]),
      ]),
    );
    say();
    say(dim(T(ctx, 'belt.lockedNote')));
    return 0;
  }
  if (sub === 'test') {
    const tool = value(a, 'tool') ?? (value(a, 'path') ? 'Write' : 'Bash');
    const input: Record<string, unknown> = {};
    if (value(a, 'command') !== undefined) input.command = value(a, 'command');
    if (value(a, 'path') !== undefined) input.file_path = value(a, 'path');
    if (value(a, 'content') !== undefined) input.content = value(a, 'content');
    if (tool === 'Write' && input.content === undefined) input.content = '';
    const d = await evaluateToolCall(tool, input, beltContext({ cwd: process.cwd(), config: ctx.config, layout: ctx.layout, lang: ctx.lang }));
    if (flag(a, 'json')) {
      json('belt-test', { tool, input, decision: d });
      return 0;
    }
    say(`${bold(T(ctx, `verdict.${d.verdict}` as MessageKey))}  ${dim(T(ctx, 'belt.testNote'))}`);
    for (const f of d.findings)
      say(`  ${f.verdict === 'deny' ? red('✗') : f.verdict === 'ask' ? yellow('?') : gray('i')} ${f.reason} ${dim('[' + f.rule + ']')}`);
    for (const i of d.issues) say(dim(`  · ${i}`));
    return 0;
  }
  if (sub === 'replay') {
    const days = intValue(a, 'days', 30, 1, 365);
    const tty = process.stderr.isTTY && !flag(a, 'json');
    const r = await replay({
      claudeDir: claudeDirOf(),
      config: ctx.config,
      layout: ctx.layout,
      lang: ctx.lang,
      days,
      ...(tty ? { onProgress: (done: number, total: number) => process.stderr.write(`\r${T(ctx, 'belt.replay.progress', { done, total })}   `) } : {}),
    });
    if (tty) process.stderr.write(`\r${' '.repeat(60)}\r`);
    if (flag(a, 'json')) {
      json('belt-replay', r);
      return 0;
    }
    say(bold(T(ctx, 'belt.replay.title', { n: days })));
    say(
      T(ctx, 'belt.replay.summary', {
        files: r.files,
        calls: integer(r.calls, ctx.lang),
        asked: r.asked,
        perDay: r.askedPerDay,
        blocked: r.blocked,
        noted: r.noted,
      }),
    );
    if (r.byRule.length) {
      say();
      say(
        table(
          [
            [T(ctx, 'belt.col.verdict'), T(ctx, 'belt.col.rule'), T(ctx, 'belt.replay.count')],
            ...r.byRule.map((x) => [T(ctx, `verdict.${x.verdict}` as MessageKey), x.rule, String(x.count)]),
          ],
          [2],
        ),
      );
    }
    if (r.modes.shell) {
      const pc = (n: number) => percent((100 * n) / r.modes.shell, ctx.lang);
      say();
      say(
        T(ctx, 'belt.replay.modes', {
          n: integer(r.modes.shell, ctx.lang),
          read: pc(r.modes.read),
          write: pc(r.modes.write),
          local: pc(r.modes.local),
          outside: pc(r.modes.outside),
          unknown: pc(r.modes.unknown + r.modes.unreadable),
        }),
      );
    }
    say();
    say(dim(T(ctx, 'belt.replay.note')));
    return 0;
  }
  if (sub === 'events') {
    const days = intValue(a, 'days', 7, 1, 3650);
    const ev = loadEvents(ctx, days).filter((e) => e.kind === 'belt' || e.kind === 'chat' || e.kind === 'quota');
    if (flag(a, 'json')) {
      json('belt-events', { days, events: ev });
      return 0;
    }
    if (!ev.length) {
      say(T(ctx, 'belt.noEvents', { n: days }));
      return 0;
    }
    const now = Date.now();
    say(
      table([
        [T(ctx, 'sessions.when'), T(ctx, 'belt.col.verdict'), T(ctx, 'belt.col.tool'), T(ctx, 'belt.col.why')],
        ...ev
          .slice(0, 50)
          .map((e) => [
            ago(e.at, now, ctx.lang),
            T(ctx, `verdict.${e.verdict ?? 'deny'}` as MessageKey),
            e.tool ?? e.kind,
            (e.reasons?.[0] ?? (e.rules ?? []).join(', ')).slice(0, 90),
          ]),
      ]),
    );
    return 0;
  }
  say(red(T(ctx, 'cli.unknownSub', { sub, cmd: 'belt' })));
  return 2;
}

// ── secrets ──

export async function cmdSecrets(a: Args): Promise<number> {
  const ctx = appContext();
  const paths = a.positionals.slice(a.positionals[0] === 'scan' ? 1 : 0);
  const targets = paths.length ? paths : ctx.config.memory.dirs;
  if (!targets.length) {
    say(T(ctx, 'secrets.noTargets'));
    return 2;
  }
  const r = scanPaths(targets);
  if (flag(a, 'json')) {
    json('secrets', { targets, files: r.files, skipped: r.skipped, findings: r.findings });
    return r.findings.length ? 1 : 0;
  }
  if (!r.findings.length) {
    say(green(T(ctx, 'secrets.clean', { n: r.files })));
    return 0;
  }
  say(red(T(ctx, 'secrets.found', { n: r.findings.length, files: r.files })));
  for (const f of r.findings.slice(0, 100)) say(`  ${shortPath(f.path, homedir(), 70)}:${f.line}  ${f.kind}  ${dim(f.masked)}`);
  say();
  say(dim(T(ctx, 'secrets.note')));
  return 1;
}

// ── full autonomy ──

function runTitle(r: Run, width: number): string {
  const first = (r.task || r.id).split('\n')[0]!;
  return first.length > width ? `${first.slice(0, Math.max(1, width - 1))}…` : first;
}

function runStatusText(ctx: AppContext, r: Run): string {
  if (r.status === 'paused' && r.pause) return T(ctx, 'auto.report.statusPaused', { reason: T(ctx, `auto.pause.${r.pause.reason}` as MessageKey) });
  return T(ctx, `auto.status.${r.status}` as MessageKey);
}

function runWhere(ctx: AppContext, r: Run): string {
  const p = runProgress(r);
  if (r.phase === 'plan' || !r.plan) return T(ctx, 'auto.phase.plan');
  return nextRunStep(r) ? `${p.done}/${p.of} ${T(ctx, 'auto.phase.work')}` : T(ctx, 'auto.phase.finish');
}

/** The warning the person reads before turning full autonomy on. */
function autonomyWarning(ctx: AppContext): string[] {
  return [
    bold(T(ctx, 'auto.cli.warnTitle')),
    '',
    ...T(ctx, 'auto.cli.warnBody')
      .split('\n')
      .map((l) => `  ${l}`),
    '',
  ];
}

export async function cmdAutonomy(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'list';
  const runs = loadRuns(ctx);
  const pick = (): Run | null => (a.positionals[1] ? findRun(runs, a.positionals[1]) : (runs[0] ?? null));
  if (sub === 'enable' || sub === 'disable') {
    const on = sub === 'enable';
    // Turning it on lowers no protection but changes what a session may do unasked: the person's call only.
    if (on && underAgent()) {
      say(red(T(ctx, 'cli.agentRefused')));
      return 1;
    }
    if (on && !flag(a, 'yes', 'y')) {
      for (const l of autonomyWarning(ctx)) say(l);
      if (!process.stdin.isTTY) {
        say(red(T(ctx, 'auto.cli.needsYes')));
        return 2;
      }
      if (!(await confirm(T(ctx, 'auto.cli.confirm')))) {
        say(T(ctx, 'auto.cli.unchanged'));
        return 1;
      }
    }
    const r = setConfigValue(ctx.config, 'autonomy.enabled', on);
    writeAtomic(ctx.layout.config, serializeConfig(r.config));
    say(green(T(ctx, on ? 'auto.cli.enabled' : 'auto.cli.disabled')));
    return 0;
  }
  if (sub === 'check') {
    const g = autonomyCheck(ctx, process.cwd());
    if (flag(a, 'json')) {
      json('autonomy.check', { ok: g.ok, checks: g.checks.map((c) => ({ id: c.id, ok: c.ok, text: T(ctx, c.key, c.params) })) });
      return g.ok ? 0 : 1;
    }
    for (const c of g.checks) {
      const mark = c.ok === true ? green('✓') : c.ok === false ? red('✗') : gray('·');
      say(`  ${mark} ${T(ctx, `auto.gate.name.${c.id}` as MessageKey).padEnd(20)}${c.ok === null ? dim(T(ctx, c.key, c.params)) : T(ctx, c.key, c.params)}`);
    }
    say();
    say(g.ok ? green(T(ctx, 'auto.cli.checkOk')) : red(T(ctx, 'auto.cli.checkFailed', { n: g.checks.filter((c) => c.ok === false).length })));
    return g.ok ? 0 : 1;
  }
  if (sub === 'show' || sub === 'report' || sub === 'rollback') {
    const r = pick();
    if (!r) {
      process.stderr.write(T(ctx, 'auto.cli.notFound', { id: a.positionals[1] ?? '' }) + '\n');
      return 1;
    }
    const files = runFiles(ctx, r);
    if (sub === 'rollback') {
      const n = Number(a.positionals[2] ?? 0);
      const back = Number.isInteger(n) ? rollbackCommands(r, n) : null;
      if (!back) {
        process.stderr.write(T(ctx, 'auto.cli.noPoint', { n: a.positionals[2] ?? '' }) + '\n');
        return 1;
      }
      if (flag(a, 'json')) {
        json('autonomy.rollback', { run: r.id, point: n, ...back });
        return 0;
      }
      say(T(ctx, 'auto.cli.rollbackKeep'));
      say(`  ${cyan(back.keep)}`);
      say(T(ctx, 'auto.cli.rollbackMove'));
      say(`  ${cyan(back.move)}`);
      return 0;
    }
    if (sub === 'report') {
      const text = files.report ? readText(files.report) : null;
      if (flag(a, 'json')) {
        json('autonomy.report', { run: r.id, path: files.report, report: text });
        return text === null ? 1 : 0;
      }
      if (text === null) {
        say(T(ctx, 'auto.cli.noReport'));
        return 1;
      }
      say(text.trimEnd());
      return 0;
    }
    if (flag(a, 'json')) {
      json('autonomy.run', { run: r, files });
      return 0;
    }
    const now = Date.now();
    say(bold(runTitle(r, 100)) + dim(`  ${r.id}`));
    say(`  ${T(ctx, 'auto.report.status').padEnd(18)}${runStatusText(ctx, r)} · ${runWhere(ctx, r)}`);
    say(`  ${T(ctx, 'auto.report.folder').padEnd(18)}${shortPath(r.cwd, homedir(), 70)}`);
    say(`  ${T(ctx, 'auto.report.time').padEnd(18)}${durationText(activeTime(r, now), ctx.lang)} · ${ago(r.updatedAt, now, ctx.lang)}`);
    say(`  ${T(ctx, 'auto.cli.budget').padEnd(18)}${r.budget.weeklyTarget}% (${r.budget.source})`);
    if (r.plan) {
      say();
      for (const s of r.plan.steps) {
        const m = r.milestones.find((x) => x.n === s.n);
        const mark = m ? green('✓') : nextRunStep(r)?.n === s.n ? yellow('▶') : gray('·');
        say(
          `  ${mark} ${String(s.n).padStart(2)}. ${s.title}${m ? dim(`  ${m.commit.slice(0, 12)} · ${T(ctx, `auto.verdict.${m.review.verdict}` as MessageKey)}`) : ''}`,
        );
      }
    }
    if (r.deferred.length) {
      say();
      say(`  ${T(ctx, 'auto.report.deferred')}`);
      for (const d of r.deferred) say(`    ${yellow(T(ctx, `auto.defer.${d.kind}` as MessageKey))} ${cyan(d.what)}${d.count > 1 ? dim(` ×${d.count}`) : ''}`);
    }
    if (r.blockers.length) {
      say();
      say(`  ${T(ctx, 'auto.report.blockers')}`);
      for (const b of r.blockers) say(`    ${T(ctx, `auto.blocker.${b.kind}` as MessageKey)}: ${b.text}`);
    }
    say();
    const rows: [MessageKey, string | null][] = [
      ['auto.cli.fileReport', files.report],
      ['auto.cli.filePlan', files.plan],
      ['auto.cli.fileDrafts', files.drafts],
      ['auto.cli.fileNotes', files.notes],
    ];
    for (const [k, p] of rows) if (p) say(`  ${T(ctx, k).padEnd(18)}${p}`);
    return 0;
  }
  if (sub !== 'list') {
    process.stderr.write(T(ctx, 'cli.unknownCommand', { cmd: `autonomy ${sub}` }) + '\n');
    return 2;
  }
  const shown = flag(a, 'all')
    ? runs
    : runs.filter((r) => r.status === 'active' || r.status === 'paused').concat(runs.filter((r) => r.status !== 'active' && r.status !== 'paused').slice(0, 5));
  if (flag(a, 'json')) {
    json('autonomy', { enabled: ctx.config.autonomy.enabled, runs: shown });
    return 0;
  }
  say(T(ctx, ctx.config.autonomy.enabled ? 'auto.cli.isOn' : 'auto.cli.isOff'));
  if (!shown.length) {
    say(T(ctx, 'auto.cli.none'));
    return 0;
  }
  const now = Date.now();
  say(
    table(
      [
        [T(ctx, 'sessions.when'), T(ctx, 'auto.report.status'), T(ctx, 'auto.cli.where'), T(ctx, 'auto.report.deferred'), T(ctx, 'auto.report.task'), 'id'],
        ...shown.map((r) => [
          ago(r.updatedAt, now, ctx.lang),
          r.status === 'paused' || r.status === 'stuck' ? yellow(runStatusText(ctx, r)) : runStatusText(ctx, r),
          runWhere(ctx, r),
          r.deferred.length ? yellow(String(r.deferred.length)) : '0',
          runTitle(r, 40),
          dim(r.id),
        ]),
      ],
      [],
    ),
  );
  return 0;
}

// ── config ──

/** Settings an agent's shell may not change: they lower a protection or widen what a session does unasked. */
const PROTECTIVE = /^(?:belt|memory|modules\.(?:quota|secrets)|autonomy|projects)(?:\.|$)/;

export async function cmdConfig(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'get';
  if (sub === 'path') {
    say(ctx.layout.config);
    return 0;
  }
  if (sub === 'get') {
    const key = a.positionals[1];
    let v: unknown = ctx.config;
    if (key) for (const k of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    if (flag(a, 'json') || typeof v === 'object') say(JSON.stringify(v, null, 2));
    else say(String(v));
    return v === undefined ? 1 : 0;
  }
  if (sub === 'set') {
    const key = a.positionals[1];
    const raw = a.positionals[2];
    if (!key || raw === undefined) {
      say(red(T(ctx, 'config.usage')));
      return 2;
    }
    if (PROTECTIVE.test(key) && underAgent()) {
      say(red(T(ctx, 'cli.agentRefused')));
      return 1;
    }
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const r = setConfigValue(ctx.config, key, parsed);
    const mine = r.problems.filter((p) => p.path === key || p.path.startsWith(key + '.') || key.startsWith(p.path + '.'));
    if (mine.length) {
      for (const p of mine) say(red(T(ctx, 'cli.doctor.configProblem', { path: p.path, detail: p.detail })));
      return 1;
    }
    writeAtomic(ctx.layout.config, serializeConfig(r.config));
    say(green(T(ctx, 'config.saved', { key })));
    return 0;
  }
  say(red(T(ctx, 'cli.unknownSub', { sub, cmd: 'config' })));
  return 2;
}

/** A transcript export with secrets masked, for sharing a session. */
export function maskedLine(s: string): string {
  return maskSecrets(s);
}

export function helpText(lang: Lang): string {
  const c = (s: string) => cyan(s);
  const L = (k: MessageKey) => tIn(lang, k);
  return [
    `${bold(APP_NAME)} ${APP_VERSION}  ${dim(L('help.tagline'))}`,
    '',
    `${bold(L('help.usage'))}  ${APP_NAME} ${dim('[' + L('help.command') + ']')}`,
    '',
    `  ${c(APP_NAME.padEnd(28))}${L('help.open')}`,
    `  ${c('open <address>'.padEnd(28))}${L('help.openAt')}`,
    `  ${c('status'.padEnd(28))}${L('help.status')}`,
    `  ${c('doctor'.padEnd(28))}${L('help.doctor')}`,
    `  ${c('install [--dry-run]'.padEnd(28))}${L('help.install')}`,
    `  ${c('uninstall [--purge]'.padEnd(28))}${L('help.uninstall')}`,
    `  ${c('try'.padEnd(28))}${L('help.try')}`,
    `  ${c('quota'.padEnd(28))}${L('help.quota')}`,
    `  ${c('tokens [--days N] [--by …]'.padEnd(28))}${L('help.tokens')}`,
    `  ${c('sessions [search]'.padEnd(28))}${L('help.sessions')}`,
    `  ${c('report [--week]'.padEnd(28))}${L('help.report')}`,
    `  ${c('flow [show <id>] [--all]'.padEnd(28))}${L('help.flow')}`,
    `  ${c('autonomy [check|show|…]'.padEnd(28))}${L('help.autonomy')}`,
    `  ${c('template list|apply|remove'.padEnd(28))}${L('help.template')}`,
    `  ${c('belt rules|events|test|replay'.padEnd(28))}${L('help.belt')}`,
    `  ${c('secrets [path…]'.padEnd(28))}${L('help.secrets')}`,
    `  ${c('config get|set|path'.padEnd(28))}${L('help.config')}`,
    '',
    dim(L('help.json')),
    dim(L('help.privacy')),
    dim(`${REPO_URL}`),
  ].join('\n');
}

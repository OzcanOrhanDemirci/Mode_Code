// SPDX-License-Identifier: Apache-2.0
/**
 * `terminal-code doctor`: the maintenance check. Measures, checks, offers the safe repairs (or makes them
 * with --fix), measures again. --self-check tests the doctor itself in a sandbox; --report prints a
 * problem report to paste into an issue; --json prints everything for scripts.
 */
import { createInterface } from 'node:readline/promises';
import { homedir, userInfo } from 'node:os';
import { APP_NAME, APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS } from '../core/app.js';
import { tIn } from '../core/i18n/index.js';
import { appContext } from '../app/context.js';
import { checkHealth } from '../app/health.js';
import { agentRunning, doctorEnvFor, examine, planRepairs, repair, saveSummary } from '../app/doctor/doctor.js';
import { renderChecks, renderPlan, renderRepairs, renderReport, renderSelfCheck, renderSummary, type Style } from '../app/doctor/render.js';
import { selfCheck } from '../app/doctor/selfcheck.js';
import { toolPath } from '../node/env.js';
import { flag, type Args } from './args.js';
import { bold, dim, green, red, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');
const STYLE: Style = { ok: green, warn: yellow, fail: red, dim, bold };

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(?:y|yes|e|evet)$/i.test((await rl.question(`${question} `)).trim());
  } finally {
    rl.close();
  }
}

function json(schema: string, data: object): void {
  process.stdout.write(JSON.stringify({ schema: `terminal-code.${schema}/1`, version: APP_VERSION, ...data }, null, 2) + '\n');
}

export async function cmdDoctor(a: Args): Promise<number> {
  const ctx = appContext();
  const home = toolPath(homedir());

  if (flag(a, 'self-check')) {
    const r = await selfCheck(ctx.lang);
    if (flag(a, 'json')) json('doctor-self-check', r);
    else for (const l of renderSelfCheck(r, ctx.lang, STYLE)) say(l);
    return r.ok ? 0 : 1;
  }

  const d = doctorEnvFor(ctx, { quick: flag(a, 'quick') });
  const before = await examine(d);
  saveSummary(d, before);
  const agent = agentRunning(d);
  const plans = planRepairs(before.results, { agent });

  if (flag(a, 'report')) {
    let user = '';
    try {
      user = userInfo().username;
    } catch {
      user = '';
    }
    say(renderReport(before, { home, user }));
    return 0;
  }

  const fix = flag(a, 'fix');
  if (flag(a, 'json')) {
    const rep = fix && plans.some((p) => !p.refused) ? await repair(d, before, plans) : null;
    const final = rep?.after ?? before;
    if (rep) saveSummary(d, rep.after);
    // The fields of earlier versions stay, so scripts keep working.
    const h = checkHealth(ctx);
    json('doctor', {
      installed: h.installed,
      claudeCode: final.facts.claude.version,
      minimumClaudeCode: MIN_CLAUDE_CODE_FOR_HOOKS,
      node: process.version,
      features: h.features,
      modSeen: final.facts.modSeen,
      hooks: final.facts.hooks.filter((x) => x.ours),
      hooksDisabledBy: final.facts.settings.filter((s) => s.disableAllHooks).map((s) => s.scope),
      plugins: final.facts.plugins,
      configProblems: final.facts.config.problems,
      checks: final.results,
      tally: final.tally,
      ms: before.ms,
      repairsPlanned: plans,
      repairs: rep?.outcomes ?? [],
      selfTests: final.facts.selftest,
    });
    return final.tally.fail ? 1 : 0;
  }

  say(`${bold(`${APP_NAME} ${APP_VERSION}`)} · ${tIn(ctx.lang, 'doc.title')}`);
  say();
  for (const l of renderChecks(before.results, { lang: ctx.lang, home, all: flag(a, 'all'), style: STYLE })) say(l);
  say();
  for (const l of renderSummary(before.tally, before.results.length, before.ms, ctx.lang, STYLE)) say(l);
  if (d.quick) say(dim(tIn(ctx.lang, 'doc.quick')));

  if (!plans.length) return before.tally.fail ? 1 : 0;
  say();
  say(bold(tIn(ctx.lang, 'doc.repairs.title')));
  for (const l of renderPlan(plans, ctx.lang, STYLE)) say(l);
  if (!plans.some((p) => !p.refused)) return before.tally.fail ? 1 : 0;
  if (!fix && !(process.stdin.isTTY && (await confirm(tIn(ctx.lang, 'doc.repairs.ask'))))) {
    if (!process.stdin.isTTY) say(dim(tIn(ctx.lang, 'doc.repairs.hint')));
    return before.tally.fail ? 1 : 0;
  }
  const rep = await repair(d, before, plans);
  saveSummary(d, rep.after);
  say();
  for (const l of renderRepairs(rep, ctx.lang, home, STYLE)) say(l);
  const still = rep.after.results.filter((r) => r.status === 'fail');
  if (still.length) {
    say();
    for (const l of renderChecks(still, { lang: ctx.lang, home, style: STYLE })) say(l);
  }
  return rep.after.tally.fail ? 1 : 0;
}

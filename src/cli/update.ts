// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code update` (docs/cli.md): whether a newer release is out, and the update to it with the release's own
 * installer (node/update.ts). `--check` only asks: the one call to the release this command makes without the daily
 * check turned on, because the person typed it. The update itself is the person's: refused inside a Claude Code
 * session, and left to its own way for a copy the installer did not put here (a clone, npm).
 */
import { spawnSync } from 'node:child_process';
import { APP_ID, APP_VERSION, CLI_NAME } from '../core/app.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { newerThan, releasePage } from '../core/update.js';
import { appContext, type AppContext } from '../app/context.js';
import { distDir, underAgent } from '../node/install.js';
import { programReceipt } from '../node/program.js';
import { checkUpdate, runInstaller } from '../node/update.js';
import { flag, type Args } from './args.js';
import { terminalIO } from './memory.js';
import { bold, dim, green, red, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');

export async function cmdUpdate(a: Args): Promise<number> {
  return runUpdate(appContext(), { yes: flag(a, 'yes', 'y'), check: flag(a, 'check'), json: flag(a, 'json') });
}

/** The update in this terminal, from the command or from the control center (which then closes: it is the old program). */
export async function runUpdate(ctx: AppContext, opts: { yes: boolean; check: boolean; json: boolean }): Promise<number> {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  const asJson = opts.json;
  const onlyCheck = opts.check;
  if (!onlyCheck && underAgent()) {
    if (asJson) say(JSON.stringify({ schema: `${APP_ID}.update/1`, version: APP_VERSION, ok: false, reason: 'agent' }));
    else say(red(T('cli.agentRefused')));
    return 1;
  }
  const base = process.env.MODE_CODE_RELEASE_URL || null;
  const state = await checkUpdate(ctx.layout, { base });
  const newer = newerThan(APP_VERSION, state.latest);
  if (asJson) {
    say(JSON.stringify({ schema: `${APP_ID}.update/1`, version: APP_VERSION, latest: state.latest, newer, error: state.error }, null, 2));
    if (onlyCheck || !newer) return state.error && !state.latest ? 1 : 0;
  }
  if (!state.latest) {
    say(red(T('update.cantCheck', { detail: state.error ?? '' })));
    return 1;
  }
  if (!newer) {
    say(green(T('update.newest', { version: APP_VERSION })));
    return 0;
  }
  say(bold(T('update.available', { from: APP_VERSION, to: newer })));
  say(dim(T('update.notes', { url: releasePage(newer) })));
  if (onlyCheck) {
    say(dim(T('update.how', { cmd: `${CLI_NAME} update` })));
    return 0;
  }
  const receipt = programReceipt(distDir());
  if (!receipt) {
    say(yellow(T('update.notInstaller')));
    return 1;
  }
  if (!opts.yes && !(process.stdin.isTTY && (await terminalIO(ctx).confirm(T('update.confirm', { to: newer }), true)))) {
    say(T('cli.cancelled'));
    return 1;
  }
  say();
  const r = await runInstaller(newer, { base });
  if (!r.ok) {
    say(red(T(`update.failed.${r.error ?? 'failed'}` as MessageKey, { detail: r.detail ?? '' })));
    return 1;
  }
  // The new program checks the installation it now is.
  const doc = spawnSync(receipt.node, [receipt.program, 'doctor', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  let tally: { fail: number; warn: number } | null = null;
  try {
    tally = (JSON.parse(doc.stdout ?? '') as { tally: { fail: number; warn: number } }).tally;
  } catch {
    tally = null;
  }
  say();
  say(green(T('update.done', { to: newer })));
  // The update is done whatever the doctor finds: what it finds is said, with the command that shows it.
  if (!tally) say(yellow(T('update.doctorUnread', { cmd: `${CLI_NAME} doctor` })));
  else if (tally.fail) say(yellow(T('update.doctorProblems', { fail: tally.fail, warn: tally.warn, cmd: `${CLI_NAME} doctor` })));
  else say(T('update.doctor', { fail: tally.fail, warn: tally.warn }));
  say(dim(T('update.next')));
  return 0;
}

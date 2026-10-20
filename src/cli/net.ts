// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code net` (docs/safety-belt.md, "Safety net"): the safety nets laid before calls the belt let through on
 * their strength, one net with what it kept and the steps back, and putting it back without overwriting anything.
 */
import { homedir } from 'node:os';
import { APP_ID, APP_VERSION, CLI_NAME } from '../core/app.js';
import { ago, shortPath } from '../core/format.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import type { NetRecord, RestoreStep } from '../core/net.js';
import { appContext, type AppContext } from '../app/context.js';
import { listNets, netSteps, restoreNet } from '../node/net.js';
import { flag, type Args } from './args.js';
import { bold, cyan, dim, green, red, yellow } from './style.js';
import { say } from './ask.js';

function json(schema: string, data: object): void {
  process.stdout.write(JSON.stringify({ schema: `${APP_ID}.${schema}/1`, version: APP_VERSION, ...data }, null, 2) + '\n');
}

function T(ctx: AppContext, key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(ctx.lang, key, params);
}

/** What a net kept, in a few words: the branches, the changes not committed, the stash, a remote's tip, files. */
function keptText(ctx: AppContext, r: NetRecord): string {
  const parts: string[] = [];
  const branches = r.refs.filter((x) => x.name.startsWith('refs/heads/')).length;
  if (branches) parts.push(T(ctx, 'net.kept.branches', { n: branches }));
  if (r.work) parts.push(T(ctx, 'net.kept.work'));
  if (r.stashes.length) parts.push(T(ctx, 'net.kept.stashes', { n: r.stashes.length }));
  if (r.remote) parts.push(T(ctx, 'net.kept.remote', { branch: `${r.remote.remote}/${r.remote.branch}` }));
  if (r.files.length) parts.push(T(ctx, 'net.kept.files', { n: r.files.length }));
  return parts.join(' · ');
}

function stepText(ctx: AppContext, s: RestoreStep): string {
  if (s.kind === 'copy') return T(ctx, 'net.step.copy', { path: shortPath(s.to, homedir(), 90) });
  if (s.kind === 'person') return T(ctx, 'net.step.person', { what: s.what, command: s.command });
  return T(ctx, s.args[0] === 'stash' ? 'net.step.stash' : s.args[0] === 'tag' ? 'net.step.tag' : 'net.step.branch', { what: s.what });
}

function find(nets: readonly NetRecord[], id: string | undefined): NetRecord | null {
  if (!id) return nets[0] ?? null;
  const exact = nets.find((r) => r.id === id);
  if (exact) return exact;
  const starts = nets.filter((r) => r.id.startsWith(id));
  return starts.length === 1 ? starts[0]! : null;
}

export async function cmdNet(a: Args): Promise<number> {
  const ctx = appContext();
  const nets = listNets(ctx.layout);
  const sub = a.positionals[0] ?? 'list';
  const now = Date.now();

  if (sub === 'list') {
    if (flag(a, 'json')) {
      json('net', { nets });
      return 0;
    }
    if (!nets.length) {
      say(T(ctx, 'net.none'));
      return 0;
    }
    say(bold(T(ctx, 'net.title', { n: nets.length })));
    for (const r of nets) say(`  ${cyan(r.id)}  ${dim(ago(r.at, now, ctx.lang))}  ${r.command}${dim(`  ${keptText(ctx, r)}`)}`);
    say(dim(T(ctx, 'net.hint', { cmd: `${CLI_NAME} net restore <id>` })));
    return 0;
  }

  if (sub === 'show' || sub === 'restore') {
    const r = find(nets, a.positionals[1]);
    if (!r) {
      process.stderr.write(T(ctx, 'net.notFound', { id: a.positionals[1] ?? '' }) + '\n');
      return 1;
    }
    if (sub === 'show') {
      const steps = netSteps(ctx.layout, r);
      if (flag(a, 'json')) {
        json('net.show', { net: r, steps });
        return 0;
      }
      say(bold(r.command) + dim(`  ${r.id}`));
      say(`  ${T(ctx, 'net.card.when').padEnd(14)}${ago(r.at, now, ctx.lang)}`);
      say(`  ${T(ctx, 'net.card.kept').padEnd(14)}${keptText(ctx, r) || dim(T(ctx, 'net.card.nothing'))}`);
      if (r.plan.kind !== 'paths') say(`  ${T(ctx, 'net.card.repo').padEnd(14)}${shortPath(r.plan.repo, homedir(), 80)}`);
      say();
      if (!steps.length) say(green(`✓ ${T(ctx, 'net.card.whole')}`));
      for (const s of steps) say(`  ${s.kind === 'person' ? yellow('!') : '•'} ${stepText(ctx, s)}`);
      return 0;
    }
    const out = restoreNet(ctx.layout, r);
    if (flag(a, 'json')) {
      json('net.restore', { id: r.id, done: out.done, failed: out.failed, person: out.person });
      return out.failed.length ? 1 : 0;
    }
    if (!out.done.length && !out.failed.length && !out.person.length) say(green(`✓ ${T(ctx, 'net.card.whole')}`));
    for (const s of out.done) say(`${green('✓')} ${stepText(ctx, s)}`);
    for (const s of out.failed) say(`${red('✗')} ${stepText(ctx, s)}`);
    for (const s of out.person) say(`${yellow('!')} ${stepText(ctx, s)}`);
    return out.failed.length ? 1 : 0;
  }

  process.stderr.write(T(ctx, 'cli.unknownSub', { sub, cmd: 'net' }) + '\n');
  return 2;
}

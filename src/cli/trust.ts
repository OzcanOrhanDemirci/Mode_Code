// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code trust` (docs/safety-belt.md): what runs inside Claude Code besides the model, and what changed since the
 * person last looked (core/trust.ts). Run by the person, the look is kept; run inside a Claude Code session it only
 * shows, so a session cannot make something new look old.
 */
import { APP_ID, APP_VERSION } from '../core/app.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { parseTrustSnapshot, trustChanges, trustKey, type TrustItem, type TrustKind } from '../core/trust.js';
import { appContext } from '../app/context.js';
import { readClaudeEnv } from '../node/claude-env.js';
import { readText, writeJsonAtomic } from '../node/fsx.js';
import { underAgent } from '../node/install.js';
import { flag, type Args } from './args.js';
import { bold, dim, green, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');
const KINDS: readonly TrustKind[] = ['plugin', 'hook', 'mcp', 'skill', 'agent', 'command'];

export async function cmdTrust(a: Args): Promise<number> {
  const ctx = appContext();
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  const env = readClaudeEnv(ctx.cwd, { withPlugins: true });
  const items: TrustItem[] = [
    ...(env.plugins ?? []).map((p) => ({ kind: 'plugin' as const, name: p.id, scope: 'user', detail: p.enabled === false ? 'off' : 'on' })),
    ...env.hooks.map((h) => ({
      kind: 'hook' as const,
      name: `${h.event}${h.matcher ? ` (${h.matcher})` : ''}`,
      scope: h.scope,
      detail: [h.command, ...h.args].join(' ').slice(0, 200),
    })),
    ...env.mcp.map((m) => ({ kind: 'mcp' as const, name: m.name, scope: m.scope, detail: `${m.transport} ${m.target}`.slice(0, 200) })),
    ...env.skills.map((s) => ({ kind: 'skill' as const, name: s.name, scope: s.scope, detail: '' })),
    ...env.agents.map((s) => ({ kind: 'agent' as const, name: s.name, scope: s.scope, detail: '' })),
    ...env.commands.map((s) => ({ kind: 'command' as const, name: s.name, scope: s.scope, detail: '' })),
  ];
  const file = `${ctx.layout.stateDir}/trust.json`;
  const before = parseTrustSnapshot(readText(file));
  const changes = trustChanges(items, before);
  const keep = !underAgent();
  if (keep) writeJsonAtomic(file, { at: Date.now(), items: items.map(trustKey) });
  if (flag(a, 'json')) {
    say(JSON.stringify({ schema: `${APP_ID}.trust/1`, version: APP_VERSION, items, added: changes.added, gone: changes.gone, kept: keep }, null, 2));
    return 0;
  }
  say(bold(T('trust.title')));
  const isNew = new Set(changes.added.map(trustKey));
  for (const kind of KINDS) {
    const list = items.filter((i) => i.kind === kind);
    say();
    say(bold(T(`trust.kind.${kind}` as MessageKey, { n: list.length })));
    if (!list.length) say(dim(`  ${T('trust.none')}`));
    for (const i of list) {
      // Said in the person's words (its scope, on or off); the record keeps Claude Code's own (trustKey).
      const scope = ['managed', 'user', 'project', 'local'].includes(i.scope) ? T(`scope.${i.scope}` as MessageKey) : i.scope;
      const detail = i.kind === 'plugin' ? T(i.detail === 'off' ? 'set.off' : 'set.on') : i.detail;
      const line = `  ${i.name} ${dim(`· ${scope}${detail ? ` · ${detail}` : ''}`)}`;
      say(isNew.has(trustKey(i)) ? `${line} ${yellow(T('trust.new'))}` : line);
    }
  }
  say();
  if (before === null) say(dim(T('trust.first')));
  else if (!changes.added.length && !changes.gone.length) say(green(T('trust.unchanged')));
  else {
    if (changes.added.length) say(yellow(T('trust.added', { n: changes.added.length })));
    if (changes.gone.length) say(dim(T('trust.gone', { n: changes.gone.length })));
  }
  say(dim(T('trust.note')));
  if (!keep) say(dim(T('trust.notKept')));
  return 0;
}

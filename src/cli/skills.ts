// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code skills` (docs/skills.md): Mode_Code's own skills and the skills of others it carries, and turning one of
 * the others on (for the person alone, or for Claude too) or off. Turning one on or off is the person's: refused
 * inside a Claude Code session. `skills sync` puts the plugin's folder in line with the settings, as a session starts.
 */
import { APP_ID, APP_VERSION, PLUGIN_NAME } from '../core/app.js';
import { serializeConfig, setConfigValue } from '../core/config.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { CORE_SKILLS, SKILL_STATES, type SkillState } from '../core/skills.js';
import { EXTERNAL_SKILLS } from '../core/skills-external.js';
import { appContext } from '../app/context.js';
import { writeAtomic } from '../node/fsx.js';
import { underAgent } from '../node/install.js';
import { memorySetUp, syncKeptSkills } from '../node/skills.js';
import { flag, type Args } from './args.js';
import { bold, dim, green, red, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');

export async function cmdSkills(a: Args): Promise<number> {
  const ctx = appContext();
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  const sub = a.positionals[0] ?? 'list';
  const json = flag(a, 'json');
  const out = (o: Record<string, unknown>) => say(JSON.stringify({ schema: `${APP_ID}.skills/1`, version: APP_VERSION, ...o }, null, 2));
  if (sub === 'sync') {
    const r = syncKeptSkills(ctx.layout, ctx.config);
    if (json) out(r);
    else if (r.added.length || r.removed.length) say(T('skills.cli.synced', { added: r.added.join(', ') || '-', removed: r.removed.join(', ') || '-' }));
    return 0;
  }
  if (sub === 'list') {
    const own = CORE_SKILLS.map((s) => ({ id: s.id, command: s.kind === 'skill' ? `/${PLUGIN_NAME}:${s.id}` : null, tr: s.tr, who: s.who, kind: s.kind }));
    const others = Object.entries(EXTERNAL_SKILLS).map(([id, s]) => ({
      id,
      state: ctx.config.skills.items[id] ?? 'off',
      suggested: s.suggested,
      source: s.repo,
      license: s.license,
    }));
    if (json) {
      out({ own, others, memory: memorySetUp(ctx.config) });
      return 0;
    }
    say(bold(T('skills.cli.own')));
    for (const s of CORE_SKILLS) {
      const how = s.kind === 'skill' ? `/${PLUGIN_NAME}:${s.id}` : s.kind === 'keyword' ? T('skills.cli.keyword') : T('skills.cli.command');
      const short = ctx.lang === 'tr' && s.who === 'person' ? ` · /${s.tr}` : '';
      say(`  ${s.id.padEnd(20)} ${dim(`${how}${short}`)}${s.who === 'model' ? yellow(` · ${T('skills.cli.claudeToo')}`) : ''}`);
    }
    say();
    say(bold(T('skills.cli.others')));
    for (const o of others) {
      const state = o.state === 'off' ? dim(T('skills.state.off')) : green(T(`skills.state.${o.state}` as MessageKey));
      say(`  ${o.id.padEnd(32)} ${state} ${dim(`· ${o.source} (${o.license})`)}`);
    }
    say();
    say(dim(T('skills.cli.hint')));
    return 0;
  }
  if (underAgent()) {
    if (json) out({ ok: false, reason: 'agent' });
    else say(red(T('cli.agentRefused')));
    return 1;
  }
  const state = (sub === 'on' ? 'on' : sub === 'me' ? 'me' : sub === 'off' ? 'off' : null) as SkillState | null;
  const id = a.positionals[1] ?? '';
  if (!state || !SKILL_STATES.includes(state)) {
    say(red(T('skills.cli.usage')));
    return 2;
  }
  if (!Object.hasOwn(EXTERNAL_SKILLS, id)) {
    say(red(T('skills.cli.unknown', { skill: id })));
    return 2;
  }
  const r = setConfigValue(ctx.config, `skills.items.${id}`, state);
  writeAtomic(ctx.layout.config, serializeConfig(r.config));
  syncKeptSkills(ctx.layout, r.config);
  say(green(T('skills.cli.set', { skill: id, state: T(`skills.state.${state}` as MessageKey) })));
  if (state !== 'off') say(dim(T('skills.cli.reload')));
  return 0;
}

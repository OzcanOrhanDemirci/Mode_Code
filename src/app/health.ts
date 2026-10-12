// SPDX-License-Identifier: Apache-2.0
/**
 * Every feature checks its own health. A broken feature turns gray and says why in one line; a broken
 * protection never turns gray: it turns red, because a protection that quietly stops is worse than none.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS, MIN_CLAUDE_CODE_FOR_MODS } from '../core/app.js';
import { compareVersions } from '../core/version.js';
import { resolvePath } from '../core/paths.js';
import { HOOK_EVENTS, hookProgram, isOurHook, readManifest, selfTest, type Manifest } from '../node/install.js';
import { readClaudeEnv, type ClaudeEnv } from '../node/claude-env.js';
import { repoStatus } from '../node/git.js';
import { home, platform } from '../node/env.js';
import { recentModStates, loadQuota } from './data.js';
import type { AppContext } from './context.js';

export type HealthState = 'ok' | 'off' | 'gray' | 'red' | 'absent';

export type FeatureId = 'belt' | 'selfProtection' | 'mod' | 'keywords' | 'quota' | 'footer' | 'quietWork' | 'modes' | 'memory' | 'index' | 'secrets';

export interface FeatureHealth {
  id: FeatureId;
  protection: boolean;
  state: HealthState;
  /** Message key of the reason, with parameters; absent when ok. */
  reason?: { key: string; params?: Record<string, string | number> };
  /** Address of the screen where it is fixed, when there is one. */
  fix?: string;
}

export interface Health {
  installed: boolean;
  manifest: Manifest | null;
  claude: string | null;
  features: FeatureHealth[];
  /** The most recent time the in-process mod confirmed it was running, and its version. */
  modSeen: { at: number; version: string } | null;
  env: ClaudeEnv;
}

export function checkHealth(ctx: AppContext, opts: { selfTest?: boolean; withPlugins?: boolean } = {}): Health {
  const manifest = readManifest(ctx.layout);
  const env = readClaudeEnv(ctx.cwd, { withPlugins: opts.withPlugins ?? false, ourMarker: ctx.layout.root.replace(/\\/g, '/') + '/bin/hook.mjs' });
  const claude = env.version;
  const installed = manifest !== null;
  const f: FeatureHealth[] = [];
  const hookFile = hookProgram(ctx.layout);
  const ours = env.hooks.filter((h) => h.scope === 'user' && isOurHook({ command: h.command, args: h.args }, ctx.layout.root));
  const missingEvents = HOOK_EVENTS.filter((ev) => !ours.some((h) => h.event === ev));
  const states = recentModStates(ctx, 20);
  const newest = states.sort((a, b) => b.aliveAt - a.aliveAt)[0];
  const modSeen = newest ? { at: newest.aliveAt, version: newest.modVersion } : null;

  // ── protections ──
  let belt: FeatureHealth;
  if (!installed) belt = { id: 'belt', protection: true, state: 'absent', reason: { key: 'health.notInstalled' }, fix: 'settings/maintenance' };
  else if (env.hooksDisabledBy.length)
    belt = {
      id: 'belt',
      protection: true,
      state: 'red',
      reason: { key: 'health.belt.disabledAll', params: { scope: env.hooksDisabledBy.join(', ') } },
      fix: 'claude-code/settings',
    };
  else if (!existsSync(hookFile))
    belt = { id: 'belt', protection: true, state: 'red', reason: { key: 'health.belt.noProgram', params: { path: hookFile } }, fix: 'settings/maintenance' };
  else if (missingEvents.includes('PreToolUse'))
    belt = { id: 'belt', protection: true, state: 'red', reason: { key: 'health.belt.noHook' }, fix: 'settings/maintenance' };
  else if (ours.some((h) => h.command && !existsSync(h.command)))
    // A hook that cannot start blocks every checked call (onFailure: block): say so before it surprises anyone.
    belt = {
      id: 'belt',
      protection: true,
      state: 'red',
      reason: { key: 'health.belt.noNode', params: { path: ours.find((h) => h.command && !existsSync(h.command))!.command } },
      fix: 'settings/maintenance',
    };
  else if (claude && compareVersions(claude, MIN_CLAUDE_CODE_FOR_HOOKS) < 0)
    belt = { id: 'belt', protection: true, state: 'red', reason: { key: 'health.claudeOld', params: { have: claude, need: MIN_CLAUDE_CODE_FOR_HOOKS } } };
  else {
    const t = opts.selfTest ? selfTest(manifest?.node ?? process.execPath, hookFile, ctx.layout) : { ok: true, detail: '' };
    belt = t.ok
      ? { id: 'belt', protection: true, state: 'ok' }
      : { id: 'belt', protection: true, state: 'red', reason: { key: 'health.belt.selfTest', params: { detail: t.detail } }, fix: 'settings/maintenance' };
  }
  f.push(belt);
  f.push({ ...belt, id: 'selfProtection' });

  // ── the in-process layer ──
  let mod: FeatureHealth;
  if (!installed) mod = { id: 'mod', protection: false, state: 'absent', reason: { key: 'health.notInstalled' } };
  else if (claude && compareVersions(claude, MIN_CLAUDE_CODE_FOR_MODS) < 0)
    mod = { id: 'mod', protection: false, state: 'gray', reason: { key: 'health.claudeOld', params: { have: claude, need: MIN_CLAUDE_CODE_FOR_MODS } } };
  else if (!manifest?.plugin.installed)
    mod = { id: 'mod', protection: false, state: 'gray', reason: { key: 'health.mod.notInstalled' }, fix: 'settings/maintenance' };
  else if (!modSeen) mod = { id: 'mod', protection: false, state: 'gray', reason: { key: 'health.mod.neverSeen' } };
  else if (modSeen.version !== APP_VERSION)
    mod = { id: 'mod', protection: false, state: 'gray', reason: { key: 'health.mod.otherVersion', params: { have: modSeen.version, now: APP_VERSION } } };
  else mod = { id: 'mod', protection: false, state: 'ok' };
  f.push(mod);

  const modOk = mod.state === 'ok';
  const hookOk = belt.state === 'ok';
  const feature = (id: FeatureId, enabled: boolean, needsMod: boolean, hookFallback: boolean): FeatureHealth => {
    if (!installed) return { id, protection: false, state: 'absent', reason: { key: 'health.notInstalled' } };
    if (!enabled) return { id, protection: false, state: 'off', fix: 'settings/modules' };
    if (modOk || (!needsMod && hookOk)) return { id, protection: false, state: 'ok' };
    if (hookFallback && hookOk) return { id, protection: false, state: 'ok', reason: { key: 'health.fallback' } };
    return { id, protection: false, state: 'gray', reason: { key: 'health.needsMod' } };
  };
  f.push(feature('keywords', ctx.config.modules.keywords, true, true));
  const q = loadQuota(ctx);
  const quota = feature('quota', ctx.config.modules.quota, true, false);
  if (quota.state === 'ok' && !q.reading) Object.assign(quota, { state: 'gray', reason: { key: 'health.quota.noReading' } });
  f.push(quota);
  const footerOn = ctx.config.modules.footer && ctx.config.footer.mode !== 'off';
  f.push(feature('footer', footerOn, ctx.config.footer.mode === 'draw', ctx.config.footer.mode === 'check'));
  f.push(feature('quietWork', ctx.config.modules.quietWork, true, false));
  f.push(feature('modes', ctx.config.modules.modes, true, false));

  // ── data ──
  const dirs = ctx.config.memory.dirs.map((d) => resolvePath(d, { platform, home: home(), cwd: ctx.cwd }));
  if (!dirs.length) f.push({ id: 'memory', protection: false, state: 'off', reason: { key: 'health.memory.none' }, fix: 'settings/memory' });
  else {
    const missing = dirs.filter((d) => !existsSync(d));
    const notRepo = dirs.filter((d) => existsSync(d) && !repoStatus(d).isRepo);
    if (missing.length)
      f.push({
        id: 'memory',
        protection: false,
        state: 'gray',
        reason: { key: 'health.memory.missing', params: { path: missing[0]! } },
        fix: 'settings/memory',
      });
    else if (notRepo.length === dirs.length) f.push({ id: 'memory', protection: false, state: 'ok', reason: { key: 'health.memory.noGit' } });
    else f.push({ id: 'memory', protection: false, state: 'ok' });
  }
  f.push({
    id: 'index',
    protection: false,
    state: existsSync(join(env.dir, 'projects')) ? 'ok' : 'gray',
    ...(existsSync(join(env.dir, 'projects')) ? {} : { reason: { key: 'health.index.noTranscripts' } }),
  });
  f.push({ id: 'secrets', protection: false, state: ctx.config.modules.secrets ? 'ok' : 'off' });
  return { installed, manifest, claude, features: f, modSeen, env };
}

export function healthCounts(h: Health): { red: number; gray: number; ok: number } {
  return {
    red: h.features.filter((x) => x.state === 'red').length,
    gray: h.features.filter((x) => x.state === 'gray').length,
    ok: h.features.filter((x) => x.state === 'ok').length,
  };
}

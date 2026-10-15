// SPDX-License-Identifier: Apache-2.0
/**
 * Repairs the maintenance check can make. Each one changes only the tool's own files or puts back what the
 * installer put there, backs up a file before changing it, and says what it did. Whether it worked is not
 * taken from the repair's word: the doctor measures again and runs the checks (see doctor.ts).
 *
 * A repair never weakens a protection. Repairs that change the person's own settings, install software,
 * or put program code or a program into the protection (the hook program and the plugin files come from
 * whatever build runs the doctor, Node.js from whatever runs it) are refused when an agent runs the doctor:
 * an agent could otherwise build a weaker hook and have the doctor install it. The person runs those.
 */
import { chmodSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ID } from '../../core/app.js';
import { serializeConfig } from '../../core/config.js';
import type { Config } from '../../core/config.js';
import type { Layout } from '../../core/layout.js';
import type { ClaudeRunner } from '../../node/claude-env.js';
import { ensureDir, readText, writeAtomic, writeJsonAtomic } from '../../node/fsx.js';
import {
  cliProgram,
  fileHash,
  hookGroups,
  hookProgram,
  pluginInstallArgs,
  pluginUpdateArgs,
  readManifest,
  withOurHooks,
  writeMarketplace,
  type Manifest,
} from '../../node/install.js';
import type { Facts, RepairId } from './types.js';

export interface RepairEnv {
  layout: Layout;
  claudeDir: string;
  distDir: string;
  /** The Node.js the hooks should run when the recorded one no longer works. */
  node: string;
  runner: ClaudeRunner;
  /** The settings as parsed, valid parts only (for rewriting a settings file with problems). */
  config: Config;
  now: number;
  /** An agent runs the doctor: no new code or program goes into the protection. */
  agent?: boolean;
}

export interface RepairOutcome {
  id: RepairId;
  ok: boolean;
  /** What was done, or why it could not be. */
  detail: string;
  /** The copy taken before a file was changed. */
  backup?: string;
}

export interface RepairInfo {
  /** Changes the person's own settings or installs software: refused when an agent runs the doctor. */
  personOnly: boolean;
  run(e: RepairEnv, f: Facts): RepairOutcome;
}

function backupOf(e: RepairEnv, name: string, text: string): string {
  const path = join(e.layout.backupsDir, `${name}.doctor.${e.now}`);
  writeAtomic(path, text);
  return path.replace(/\\/g, '/');
}

/** Puts the safety-net hooks back into Claude Code's current settings file, with a working Node.js. */
function restoreHooks(e: RepairEnv, f: Facts, id: RepairId, forceNode: boolean): RepairOutcome {
  const settingsFile = join(e.claudeDir, 'settings.json');
  const text = readText(settingsFile);
  let settings: Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { id, ok: false, detail: 'settings.json is not a JSON object' };
      settings = v as Record<string, unknown>;
    } catch (err) {
      // Never overwrite a file Claude Code cannot read either: the person's own settings are in it.
      return { id, ok: false, detail: `settings.json is not valid JSON (${(err as Error).message}); fix it first` };
    }
  }
  const recorded = f.hookNode?.exists && f.hookNode.version ? f.hookNode.path : null;
  // Under an agent the hooks are only put back with the Node.js the person installed them with.
  if (e.agent && (forceNode || !recorded)) return { id, ok: false, detail: 'refused: an agent runs the doctor, and the hooks would get another Node.js' };
  const node = (forceNode || !recorded ? e.node : recorded).replace(/\\/g, '/');
  const hook = hookProgram(e.layout).replace(/\\/g, '/');
  const groups = hookGroups(node, hook);
  const backup = text !== null ? backupOf(e, 'settings.json', text) : undefined;
  writeAtomic(settingsFile, JSON.stringify(withOurHooks(settings, groups, e.layout.root), null, 2) + '\n');
  const m = readManifest(e.layout);
  if (m) writeJsonAtomic(e.layout.manifest, { ...m, node, settingsFile: settingsFile.replace(/\\/g, '/'), hooks: groups } satisfies Manifest);
  return { id, ok: true, detail: `hooks written to ${settingsFile.replace(/\\/g, '/')} (node ${node})`, ...(backup ? { backup } : {}) };
}

function removeFiles(id: RepairId, root: string, files: readonly string[]): RepairOutcome {
  let n = 0;
  for (const f of files) {
    const p = join(root, f);
    // Only inside the data folder, only what the facts listed.
    if (!p.replace(/\\/g, '/').startsWith(root.replace(/\\/g, '/') + '/')) continue;
    rmSync(p, { force: true });
    n++;
  }
  return { id, ok: true, detail: `${n} removed` };
}

export const REPAIRS: Record<RepairId, RepairInfo> = {
  'restore-hooks': { personOnly: false, run: (e, f) => restoreHooks(e, f, 'restore-hooks', false) },
  'remove-duplicate-hooks': { personOnly: false, run: (e, f) => restoreHooks(e, f, 'remove-duplicate-hooks', false) },
  'repoint-node': { personOnly: true, run: (e, f) => restoreHooks(e, f, 'repoint-node', true) },
  'restore-hook-program': {
    personOnly: true,
    run: (e) => {
      const from = join(e.distDir, 'hook.mjs');
      if (!existsSync(from)) return { id: 'restore-hook-program', ok: false, detail: `this build has no hook program (${from})` };
      ensureDir(join(e.layout.root, 'bin'));
      cpSync(from, hookProgram(e.layout));
      // The manifest records the program now installed, so a later check tells it from a change.
      const m = readManifest(e.layout);
      const hookHash = fileHash(hookProgram(e.layout));
      if (m && hookHash) writeJsonAtomic(e.layout.manifest, { ...m, hookHash } satisfies Manifest);
      return { id: 'restore-hook-program', ok: true, detail: `copied from ${from.replace(/\\/g, '/')}` };
    },
  },
  'restore-plugin-files': {
    personOnly: true,
    run: (e) => {
      if (!existsSync(join(e.distDir, 'plugin'))) return { id: 'restore-plugin-files', ok: false, detail: 'this build has no plugin files' };
      writeMarketplace(e.layout, e.distDir);
      return { id: 'restore-plugin-files', ok: true, detail: `plugin files copied to ${e.layout.pluginDir}; new sessions load them` };
    },
  },
  // Another version in Claude Code: this version's files, then Claude Code's record of them (an install over an
  // older one leaves the record behind, and a plugin not read in place loads from Claude Code's own copy).
  'update-plugin': {
    personOnly: true,
    run: (e) => {
      if (!existsSync(join(e.distDir, 'plugin'))) return { id: 'update-plugin', ok: false, detail: 'this build has no plugin files' };
      writeMarketplace(e.layout, e.distDir);
      const r = e.runner.run(pluginUpdateArgs(), 120_000);
      const out = `${r.stdout}${r.stderr}`.trim().split('\n').pop() ?? '';
      return { id: 'update-plugin', ok: r.status === 0, detail: out || `exit ${r.status}` };
    },
  },
  'reinstall-plugin': {
    personOnly: true,
    run: (e) => {
      writeMarketplace(e.layout, e.distDir);
      const r = e.runner.run(pluginInstallArgs(e.layout), 120_000);
      const out = `${r.stdout}${r.stderr}`.trim().split('\n').pop() ?? '';
      return { id: 'reinstall-plugin', ok: r.status === 0, detail: out || `exit ${r.status}` };
    },
  },
  'record-cli': {
    // Which program `/0` starts: the person's to point, as the hook program is.
    personOnly: true,
    run: (e) => {
      const cli = cliProgram(e.distDir);
      const m = readManifest(e.layout);
      if (!cli) return { id: 'record-cli', ok: false, detail: `this build has no command-line program (${e.distDir.replace(/\\/g, '/')})` };
      if (!m) return { id: 'record-cli', ok: false, detail: 'not installed' };
      writeJsonAtomic(e.layout.manifest, { ...m, cli } satisfies Manifest);
      return { id: 'record-cli', ok: true, detail: `/0 opens ${cli}` };
    },
  },
  'enable-plugin': {
    personOnly: true,
    run: (e) => {
      const r = e.runner.run(['plugin', 'enable', PLUGIN_ID, '--scope', 'user'], 60_000);
      const out = `${r.stdout}${r.stderr}`.trim().split('\n').pop() ?? '';
      return { id: 'enable-plugin', ok: r.status === 0, detail: out || `exit ${r.status}` };
    },
  },
  'create-data-folders': {
    personOnly: false,
    run: (e) => {
      const l = e.layout;
      for (const d of [l.root, l.stateDir, l.sessionsDir, l.eventsDir, l.installDir, l.backupsDir, join(l.root, 'bin')]) ensureDir(d);
      return { id: 'create-data-folders', ok: true, detail: l.root };
    },
  },
  'rebuild-index': {
    personOnly: false,
    run: (e) => {
      // The index is a cache of the transcripts: removed, it is built again the next time it is opened.
      for (const suffix of ['', '-wal', '-shm']) rmSync(e.layout.index + suffix, { force: true });
      return { id: 'rebuild-index', ok: true, detail: 'removed; it is built again when the control center or a report opens it' };
    },
  },
  'remove-stale-temp': { personOnly: false, run: (e, f) => removeFiles('remove-stale-temp', e.layout.root, f.data.staleTemp) },
  'prune-session-state': {
    personOnly: false,
    run: (e) => {
      let names: string[] = [];
      try {
        names = readdirSync(e.layout.sessionsDir).filter((n) => /\.(?:mod|hook)\.json$/.test(n));
      } catch {
        return { id: 'prune-session-state', ok: true, detail: '0 removed' };
      }
      const old = names.filter((n) => {
        try {
          return e.now - statSync(join(e.layout.sessionsDir, n)).mtimeMs > 30 * 86400_000;
        } catch {
          return false;
        }
      });
      return removeFiles(
        'prune-session-state',
        e.layout.root,
        old.map((n) => `state/sessions/${n}`),
      );
    },
  },
  'remove-bad-quota': {
    personOnly: false,
    run: (e) => {
      rmSync(e.layout.quota, { force: true });
      return { id: 'remove-bad-quota', ok: true, detail: 'removed; the next answer in a session writes a new reading' };
    },
  },
  'rewrite-config': {
    personOnly: true,
    run: (e) => {
      const text = readText(e.layout.config);
      const backup = text !== null ? backupOf(e, 'config.json', text) : undefined;
      writeAtomic(e.layout.config, serializeConfig(e.config));
      return { id: 'rewrite-config', ok: true, detail: 'rewritten with the valid settings kept', ...(backup ? { backup } : {}) };
    },
  },
  'tighten-permissions': {
    personOnly: false,
    run: (e) => {
      const l = e.layout;
      for (const d of [l.root, l.stateDir]) if (existsSync(d)) chmodSync(d, 0o700);
      if (existsSync(l.config)) chmodSync(l.config, 0o600);
      return { id: 'tighten-permissions', ok: true, detail: 'data folder 700, settings file 600' };
    },
  },
};

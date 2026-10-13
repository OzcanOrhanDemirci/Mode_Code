// SPDX-License-Identifier: Apache-2.0
/**
 * An installation made under an earlier name of the tool (PREVIOUS_NAMES), as the installer takes it over:
 * where it is, what of it is copied, which paths inside the copy follow it. The installer (install.ts)
 * decides the order: copy, swap the hooks in one write, remove the rest once the new installation works.
 */
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIOUS_NAMES } from '../core/app.js';
import type { Layout } from '../core/layout.js';
import { joinPath } from '../core/paths.js';
import { readJson, writeJsonAtomic } from './fsx.js';
import type { Manifest } from './install.js';

/** An installation, or only the data, of an earlier name of the tool, in the folder beside this one. */
export interface PreviousInstall {
  id: string;
  name: string;
  /** Its data folder: `.<id>` in the folder that holds this data folder. */
  root: string;
  /** Its manifest, when it was installed (hooks, plugin) and not removed since. */
  manifest: Manifest | null;
  /** This data folder does not exist yet: the earlier one's settings and history are copied here. */
  copy: boolean;
}

/** The newest earlier name whose data folder is beside this one, or null. */
export function findPrevious(l: Layout, names: readonly { id: string; name: string }[] = PREVIOUS_NAMES): PreviousInstall | null {
  const parent = l.root.replace(/\/[^/]+\/?$/, '') || '/';
  for (const p of names) {
    const root = joinPath(parent, `.${p.id}`);
    if (root.toLowerCase() === l.root.toLowerCase() || !existsSync(root)) continue;
    const m = readJson<Manifest>(join(root, 'install', 'manifest.json'));
    return { id: p.id, name: p.name, root, manifest: m && m.v === 1 && m.app === p.id ? m : null, copy: !existsSync(l.root) };
  }
  return null;
}

/** The plugin an earlier installation put into Claude Code, and its marketplace. */
export function previousPlugin(prev: PreviousInstall): { id: string; marketplace: string } {
  return { id: prev.manifest?.plugin.id ?? `${prev.id}@${prev.id}-local`, marketplace: `${prev.id}-local` };
}

/** `p` moved from inside `from` to the same place inside `to`; unchanged when it is not inside `from`. Pure. */
export function rebase(p: string, from: string, to: string): string {
  const a = p.replace(/\\/g, '/');
  const f = from.replace(/\\/g, '/').replace(/\/+$/, '');
  if (a.toLowerCase() === f.toLowerCase()) return to;
  if (a.toLowerCase().startsWith(`${f.toLowerCase()}/`)) return to.replace(/\/+$/, '') + a.slice(f.length);
  return p;
}

/** Every string in a JSON value rebased (see rebase), and how many changed. Pure. */
export function rebaseJson(v: unknown, from: string, to: string): { value: unknown; changed: number } {
  let changed = 0;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const y = rebase(x, from, to);
      if (y !== x) changed++;
      return y;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return { value: walk(v), changed };
}

/**
 * Claude Code's settings with its memory folder moved along, when that folder lay inside the earlier data
 * folder (a memory kept on GitHub only) and the data is copied here. Pure.
 */
export function movedMemorySetting(settings: Record<string, unknown>, prev: PreviousInstall, root: string): Record<string, unknown> {
  const mem = settings.autoMemoryDirectory;
  if (!prev.copy || typeof mem !== 'string') return settings;
  const moved = rebase(mem, prev.root, root);
  return moved === mem ? settings : { ...settings, autoMemoryDirectory: moved };
}

/** The folders of a data folder whose JSON files hold paths into it: the tool's settings and records. */
const REBASED = ['config.json', 'state', 'flows', 'runs'];

/**
 * Copies an earlier installation's data folder here, without its programs (bin/, marketplace/) or its
 * manifest, and points every path in the copied settings and records that led into the old folder at this
 * one. Memory and sync working copies are copied as they are.
 */
export function copyPrevious(prev: PreviousInstall, l: Layout): { files: number; paths: number } {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const skip = [joinPath(prev.root, 'bin'), joinPath(prev.root, 'marketplace'), joinPath(prev.root, 'install', 'manifest.json')].map(norm);
  let files = 0;
  cpSync(prev.root, l.root, {
    recursive: true,
    filter: (src) => {
      const n = norm(src);
      if (skip.includes(n)) return false; // a folder left out is not entered
      if (statSync(src).isFile()) files++;
      return true;
    },
  });
  let paths = 0;
  const visit = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p)) visit(join(p, e));
      return;
    }
    if (!p.endsWith('.json')) return;
    const before = readJson<unknown>(p);
    if (before === null) return;
    const r = rebaseJson(before, prev.root, l.root);
    if (r.changed) {
      writeJsonAtomic(p, r.value);
      paths += r.changed;
    }
  };
  for (const f of REBASED) visit(join(l.root, f));
  return { files, paths };
}

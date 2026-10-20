// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers as the command line and the control center see it (docs/sync.md): where it lives,
 * the computers in it and when each was last seen, the last sync, the settings from other computers in
 * effect here and those waiting for the person, projects without a folder on this computer, and what the
 * other computers did, for the morning report.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncSetting } from '../core/config.js';
import { machinePaths, parseFlowSummary, type Pending } from '../core/sync.js';
import type { SharedRecord } from '../core/sync-export.js';
import { readText } from '../node/fsx.js';
import { lastShared, mergedConfig } from '../node/sync.js';
import type { AppContext } from './context.js';
import { loadEventsFrom } from './data.js';
import { machinesIn } from './sync-setup.js';

export interface SyncMachine {
  id: string;
  name: string;
  platform: string;
  self: boolean;
  /** When it last did something it sent (its newest event), or this computer's last sync; null: nothing yet. */
  lastSeen: number | null;
}

export interface SyncView {
  setting: SyncSetting | null;
  /** The shared place is there on this computer. */
  exists: boolean;
  machines: SyncMachine[];
  last: SharedRecord | null;
  pending: Pending[];
  applied: { key: string; machine: string; at: number }[];
  /** Projects in effect here without a folder on this computer (they came from other computers). */
  homeless: string[];
  handoffs: 'shared' | 'memory' | 'local';
}

/** The newest event a computer sent, from the newest month folder of its copy. */
export function lastEventAt(eventsDir: string): number | null {
  let months: string[] = [];
  try {
    months = readdirSync(eventsDir)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const m of months) {
    let best: number | null = null;
    let files: string[] = [];
    try {
      files = readdirSync(join(eventsDir, m)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const lines = (readText(join(eventsDir, m, f)) ?? '').trimEnd().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const at = (JSON.parse(lines[i]!) as { at?: unknown }).at;
          if (typeof at === 'number') {
            best = best === null ? at : Math.max(best, at);
            break;
          }
        } catch {
          /* a torn line: the one before */
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

export function syncView(ctx: AppContext): SyncView {
  const local = ctx.local ?? ctx.config;
  const s = local.sync;
  const store = ctx.config.memory.store;
  const handoffs = store?.handoffs ? 'memory' : s?.handoffs ? 'shared' : 'local';
  if (!s) return { setting: null, exists: false, machines: [], last: null, pending: [], applied: [], homeless: [], handoffs };
  const merged = mergedConfig(local, ctx.layout);
  const last = lastShared(ctx.layout);
  const known = machinesIn(s.dir);
  if (!known.some((m) => m.id === s.machine.id)) known.unshift({ id: s.machine.id, name: s.machine.name, platform: process.platform });
  const machines = known.map((m) => {
    const self = m.id === s.machine.id;
    return { ...m, name: self ? s.machine.name : m.name, self, lastSeen: self ? (last?.at ?? null) : lastEventAt(machinePaths(s.dir, m.id).events) };
  });
  machines.sort((a, b) => (a.self === b.self ? (a.name < b.name ? -1 : 1) : a.self ? -1 : 1));
  return {
    setting: s,
    exists: existsSync(s.dir),
    machines,
    last,
    pending: merged.pending,
    applied: merged.applied,
    homeless: merged.config.projects.filter((p) => !p.path).map((p) => p.id),
    handoffs,
  };
}

/** What another computer did in a window: its flows waiting, its sessions, what the belt stopped. */
export interface Elsewhere {
  machine: string;
  flows: number;
  sessions: number;
  blocked: number;
}

/** The other computers' news for the morning report: only those with something to say. */
export function elsewhereFacts(ctx: AppContext, since: number, until: number): Elsewhere[] {
  const s = (ctx.local ?? ctx.config).sync;
  if (!s) return [];
  const out: Elsewhere[] = [];
  for (const m of machinesIn(s.dir)) {
    if (m.id === s.machine.id) continue;
    const p = machinePaths(s.dir, m.id);
    let flows = 0;
    for (const f of list(p.flows)) if (parseFlowSummary(readText(join(p.flows, f)))?.status === 'waiting') flows++;
    const events = loadEventsFrom(p.events, Math.max(1, Math.ceil((until - since) / 86_400_000) + 1), until).filter((e) => e.at >= since && e.at <= until);
    const sessions = new Set(events.map((e) => e.session)).size;
    const blocked = events.filter((e) => e.kind === 'belt' && e.verdict === 'deny').length;
    if (flows || sessions || blocked) out.push({ machine: m.name, flows, sessions, blocked });
  }
  return out;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

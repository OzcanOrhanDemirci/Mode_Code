// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store on this machine (docs/memory.md): running its sync with child processes, and what the
 * command line and the hook need around it. The steps themselves are core/memory-sync.ts.
 */
import { spawn } from 'node:child_process';
import type { Config } from '../core/config.js';
import type { Lang } from '../core/i18n/index.js';
import { memorySeenFile, memorySyncFile, type Layout } from '../core/layout.js';
import { commitMessage } from '../core/memory.js';
import {
  lastSeen,
  outgoingSecrets,
  parseAllowed,
  parseSeen,
  syncMemory,
  syncPlan,
  type Runner,
  type SyncResult,
  type SyncTrigger,
} from '../core/memory-sync.js';
import { scanSecrets } from '../core/secrets/scan.js';
import { dataLayout } from './env.js';
import { readText, writeJsonAtomic } from './fsx.js';
import { git } from './git.js';

/** Runs a program without a shell or a window; output is collected, a time limit kills it. */
export const nodeRunner: Runner = {
  run(argv, opts) {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(argv[0]!, argv.slice(1), {
          cwd: opts.cwd,
          env: { ...process.env, ...(opts.env ?? {}) },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`timed out after ${opts.timeoutMs ?? 30_000} ms: ${argv.join(' ')}`));
      }, opts.timeoutMs ?? 30_000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  },
};

export type { SyncTrigger };

/** Which steps a trigger takes in a store kept fully in sync: a session's start and a manual sync do all three, a turn's end commits and sends. */
export function stepsFor(trigger: SyncTrigger): { commit: boolean; pull: boolean; push: boolean } {
  return syncPlan('auto', trigger).steps;
}

const WRITERS = ['mod', 'hook', 'cli'] as const;

/** The commit this computer last saw the store at, the newest of the writers'. */
export function seenSince(l: Layout): string | null {
  return lastSeen(WRITERS.map((w) => parseSeen(readText(memorySeenFile(l, w)))));
}

/** Records a sync (and where it left the store) as this writer's. Never throws. */
export function recordSync(l: Layout, writer: 'hook' | 'cli', trigger: SyncTrigger | 'setup', session: string | null, r: SyncResult): void {
  try {
    writeJsonAtomic(memorySyncFile(l, writer), { at: Date.now(), trigger, session, result: r });
    if (r.head) writeJsonAtomic(memorySeenFile(l, writer), { head: r.head, at: Date.now() });
  } catch {
    /* the records are for the person's eyes and the next sync's report; the sync itself happened */
  }
}

/**
 * A look without a sync (a turn's end in a store its owner commits): where the store stands now becomes
 * where this writer last saw it, so the next session reports only what arrives after.
 */
export function lookStore(l: Layout, dir: string, writer: 'hook' | 'cli'): void {
  const head = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head.ok || !/^[0-9a-f]{7,64}$/.test(head.out)) return;
  const seen = parseSeen(readText(memorySeenFile(l, writer)));
  if (seen?.head === head.out) return;
  try {
    writeJsonAtomic(memorySeenFile(l, writer), { head: head.out, at: Date.now() });
  } catch {
    /* looked at again after the next turn */
  }
}

/**
 * One sync of the configured store from this process, by its mode (core/memory-sync.ts syncPlan); null when
 * there is no store or it has no history. What arrived since this computer last saw it is in the result.
 */
export async function syncStore(
  config: Config,
  opts: { trigger: SyncTrigger; session: string | null; lang: Lang; runner?: Runner; since?: string | null },
): Promise<SyncResult | null> {
  const s = config.memory.store;
  if (!s || !s.git) return null;
  const plan = syncPlan(s.sync, opts.trigger);
  return syncMemory(opts.runner ?? nodeRunner, {
    dir: s.dir,
    remote: s.place !== 'local',
    steps: plan.steps,
    pullMode: plan.pullMode,
    since: opts.since ?? null,
    message: (counts) => commitMessage(counts, opts.session, opts.lang),
    readFile: async (p) => readText(p),
    secrets: (text) => scanSecrets(text).length,
    outgoing: outgoingSecrets(parseAllowed(readText(dataLayout().secretsAllow))),
  });
}

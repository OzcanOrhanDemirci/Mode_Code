// SPDX-License-Identifier: Apache-2.0
/**
 * The memory store on this machine (docs/memory.md): running its sync with child processes, and what the
 * command line and the hook need around it. The steps themselves are core/memory-sync.ts.
 */
import { spawn } from 'node:child_process';
import type { Config } from '../core/config.js';
import type { Lang } from '../core/i18n/index.js';
import { commitMessage } from '../core/memory.js';
import { syncMemory, type Runner, type SyncResult } from '../core/memory-sync.js';
import { scanSecrets } from '../core/secrets/scan.js';
import { readText } from './fsx.js';

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

export type SyncTrigger = 'start' | 'turn' | 'manual';

/** Which steps a trigger takes: a session's start and a manual sync do all three, a turn's end commits and sends. */
export function stepsFor(trigger: SyncTrigger): { commit: boolean; pull: boolean; push: boolean } {
  return { commit: true, pull: trigger !== 'turn', push: true };
}

/** One sync of the configured store from this process; null when there is no store or it has no history. */
export async function syncStore(
  config: Config,
  opts: { trigger: SyncTrigger; session: string | null; lang: Lang; runner?: Runner },
): Promise<SyncResult | null> {
  const s = config.memory.store;
  if (!s || !s.git) return null;
  return syncMemory(opts.runner ?? nodeRunner, {
    dir: s.dir,
    remote: s.place !== 'local',
    steps: stepsFor(opts.trigger),
    message: (counts) => commitMessage(counts, opts.session, opts.lang),
    readFile: async (p) => readText(p),
    secrets: (text) => scanSecrets(text).length,
  });
}

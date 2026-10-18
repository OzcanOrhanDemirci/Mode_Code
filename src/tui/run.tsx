// SPDX-License-Identifier: Apache-2.0
/** Starts the control center: brings the session index up to date (with progress on the first run), then draws. */
import { render } from 'ink';
import { join } from 'node:path';
import { tIn } from '../core/i18n/index.js';
import { appContext } from '../app/context.js';
import { SessionIndex } from '../node/index-db.js';
import { claudeDir } from '../node/env.js';
import { LiveData } from './store.js';
import { App } from './app.js';
import type { LeaveAction } from './ui.js';
import { runMemorySetup } from '../cli/memory.js';
import { runSyncSetup } from '../cli/sync.js';
import { runUpdate } from '../cli/update.js';

export async function runControlCenter(opts: { address: string | null; plain: boolean }): Promise<number> {
  const ctx = appContext();
  // The first index of a large history takes a few seconds: say so, instead of a blank screen.
  try {
    const idx = new SessionIndex(ctx.layout.index);
    const first = idx.lastUpdate() === null;
    let lastShown = 0;
    idx.update(join(claudeDir(), 'projects'), (p) => {
      if (!first || !process.stderr.isTTY) return;
      const nowMs = Date.now();
      if (nowMs - lastShown < 120 && p.done < p.files) return;
      lastShown = nowMs;
      process.stderr.write(`\r${tIn(ctx.lang, 'tui.indexing', { done: p.done, total: p.files, mb: Math.round(p.bytes / 1048576) })}   `);
    });
    if (first && process.stderr.isTTY) process.stderr.write('\r\u001B[2K');
    idx.close();
  } catch (err) {
    process.stderr.write(`${tIn(ctx.lang, 'tui.indexFailed', { error: (err as Error).message })}\n`);
  }
  // The control center can leave for something that talks in the terminal (the memory setup) and come back.
  let address = opts.address;
  for (;;) {
    let leave: { action: LeaveAction; back: string } | null = null;
    const data = new LiveData(appContext());
    const instance = render(<App data={data} address={address} plain={opts.plain} onLeave={(action, back) => (leave = { action, back })} />, {
      alternateScreen: true,
      exitOnCtrlC: true,
      patchConsole: true,
      // Only the lines that changed are written again: Mo moves without the whole screen being redrawn.
      incrementalRendering: true,
    });
    try {
      await instance.waitUntilExit();
    } finally {
      data.close();
    }
    const left = leave as { action: LeaveAction; back: string } | null;
    if (!left) return 0;
    if (left.action === 'memory-setup') await runMemorySetup(appContext());
    if (left.action === 'sync-setup') await runSyncSetup(appContext());
    // Updated, this process is the old program: the person opens the new one.
    if (left.action === 'update' && (await runUpdate(appContext(), { yes: false, check: false, json: false })) === 0) return 0;
    process.stdout.write(`\n${tIn(ctx.lang, 'tui.backSoon')}\n`);
    await new Promise((r) => setTimeout(r, 1200));
    address = left.back;
  }
}

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
import { mouseReporting, PointerHub, pointerInput } from './pointer.js';
import { progressSequence, terminalCaps } from './terminal.js';

export async function runControlCenter(opts: { address: string | null; plain: boolean; noColor: boolean; mouse: boolean }): Promise<number> {
  const ctx = appContext();
  // What the terminal takes beyond drawing (src/tui/terminal.ts): the title, the progress on its tab, links.
  const caps = terminalCaps(process.env, !!process.stdout.isTTY);
  const terminal = { caps, write: (s: string) => void process.stdout.write(s) };
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
      if (caps.progress && p.files) process.stderr.write(progressSequence((p.done / p.files) * 100));
    });
    if (first && process.stderr.isTTY) process.stderr.write('\r\u001B[2K');
    if (first && caps.progress) process.stderr.write(progressSequence(null));
    idx.close();
  } catch (err) {
    process.stderr.write(`${tIn(ctx.lang, 'tui.indexFailed', { error: (err as Error).message })}\n`);
  }
  // The mouse (src/tui/pointer.ts): reported while the control center is drawn, off as it ends and on every way out.
  const mouse = opts.mouse && process.stdin.isTTY && process.stdout.isTTY ? mouseReporting((x) => process.stdout.write(x), process) : null;
  // The control center can leave for something that talks in the terminal (the memory setup) and come back.
  let address = opts.address;
  for (;;) {
    let leave: { action: LeaveAction; back: string } | null = null;
    const data = new LiveData(appContext());
    const hub = new PointerHub();
    const instance = render(
      <App
        data={data}
        address={address}
        plain={opts.plain}
        {...(opts.noColor ? { noColor: true } : {})}
        pointer={hub}
        terminal={terminal}
        onLeave={(action, back) => (leave = { action, back })}
        {...(mouse ? { onQuit: mouse.off } : {})}
      />,
      {
        stdin: mouse ? pointerInput(process.stdin, hub) : process.stdin,
        alternateScreen: true,
        exitOnCtrlC: false,
        patchConsole: true,
        // Only the lines that changed are written again: Mo moves without the whole screen being redrawn.
        incrementalRendering: true,
      },
    );
    mouse?.on();
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

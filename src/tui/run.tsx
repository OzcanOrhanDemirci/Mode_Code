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
  const data = new LiveData(ctx);
  const instance = render(<App data={data} address={opts.address} plain={opts.plain} />, { alternateScreen: true, exitOnCtrlC: true, patchConsole: true });
  try {
    await instance.waitUntilExit();
  } finally {
    data.close();
  }
  return 0;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The daily update check inside Claude Code's engine (core/update.ts): as a session starts, the installed program
 * asks the release, only when the person said yes and the last check is a day old; a newer release the last check
 * found is said in the /0 menu. The world beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, PROJECT } from './world.ts';

const NODE = '/usr/bin/node';
const CLI = '/home/ada/.local/share/mode-code/app/dist/cli.mjs';
const installed = (w: any) => {
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, app: 'mode-code', node: NODE, cli: CLI }));
  w.write(CLI, '// the program');
};
const start = async ($: any, on: any) => {
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  // The check runs beside the start, which never waits for it.
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const asked = (w: any) => w.ran.filter((argv: string[]) => argv.join(' ') === `${NODE} ${CLI} update --check --json`).length;

test('the daily check asks the release as a session starts, when the person said yes and none ran today', async ($, on) => {
  const w = world(on, { config: { update: { check: true } } });
  installed(w);
  await start($, on);
  expect(asked(w)).toBe(1);
});

test('no check while the setting is off', async ($, on) => {
  const off = world(on, { config: {} });
  installed(off);
  await start($, on);
  expect(asked(off)).toBe(0);
});

test('a check that ran within the day is not run again', async ($, on) => {
  const w = world(on, { config: { update: { check: true } } });
  installed(w);
  w.write(`${DATA}/state/update.json`, JSON.stringify({ checkedAt: Date.parse('2026-10-12T09:00:00Z'), latest: '1.0.0', error: null }));
  await start($, on);
  expect(asked(w)).toBe(0);
});

test('a newer release the last check found is said in the /0 menu', async ($, on) => {
  const w = world(on, { config: {} });
  w.write(`${DATA}/state/update.json`, JSON.stringify({ checkedAt: Date.parse('2026-10-12T09:00:00Z'), latest: '99.0.0', error: null }));
  await start($, on);
  const r = (await $.command.run({ command: '0', args: '', origin: { kind: 'bridge' } } as any)) as any;
  expect(r.text).toMatch(/Mode_Code 99\.0\.0 is out: run mode-code update in your own terminal\./);
});

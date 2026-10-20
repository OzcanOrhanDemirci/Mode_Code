// SPDX-License-Identifier: Apache-2.0
/**
 * The plugin's own git calls inside Claude Code's engine (src/core/git-safe.ts), seen through a handoff note,
 * which reads the project's log and status: every call with the safe settings; where the work tree is read,
 * the repository's filter drivers switched off and the person's left alone; no converter or outside diff
 * program; no look inside submodules. A driver whose name the command line cannot say stops the call.
 */
import { test, expect } from 'claude-code/testing';
import { PROJECT, world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const TOOL = 'mcp__mode-code__handoff';
const PARTS = { summary: 'The store is in.', open: 'The wizard.', decisions: 'One memory for all.', next: 'Write the setup.' };

const repoGit = (args: string[]) => {
  const a = args.join(' ');
  if (a === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${PROJECT}\n` };
  if (a === 'rev-parse --is-inside-work-tree') return { exitCode: 0, stdout: 'true\n' };
  if (a === 'rev-parse HEAD') return { exitCode: 0, stdout: `${'c'.repeat(40)}\n` };
  if (args[0] === 'log') return { exitCode: 0, stdout: 'ccccccc feat: the store\n' };
  if (args[0] === 'status') return { exitCode: 0, stdout: ' M src/a.ts\n' };
  return undefined;
};

/** Where the call itself starts in git's arguments: past -C, --no-pager and the settings. */
const call = (argv: string[]) => {
  let i = 3;
  while (argv[i] === '-c') i += 2;
  return argv.slice(i);
};

test("a handoff reads the project with the safe settings, the repository's filters off", async ($, on) => {
  const w = world(on, { config: {}, git: repoGit, filterDrivers: 'global\tfilter.lfs.clean\nlocal\tfilter.x.process\nlocal\tfilter.a.b.clean\n' });
  await $.prompt.submit(typed('devir'));
  const done: any = await $.tool.call({ tool: TOOL, ...PARTS } as any);
  expect(String(done.result)).toMatch(/The handoff note is written/);
  expect(w.gitRan.length).toBeGreaterThan(3);
  for (const argv of w.gitRan) expect(argv.slice(2, 7)).toEqual(['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false']);
  expect(w.gitRan.filter((r) => r.includes('--show-scope')).map((r) => r[1])).toEqual([PROJECT]);
  const status = w.gitRan.find((r) => call(r)[0] === 'status')!;
  expect(call(status)).toEqual(['status', '--ignore-submodules=dirty', '--porcelain=v1']);
  const off = (d: string) => [`filter.${d}.clean=`, `filter.${d}.smudge=`, `filter.${d}.process=`, `filter.${d}.required=false`];
  expect(status.filter((_, i) => status[i - 1] === '-c').slice(2)).toEqual([...off('x'), ...off('a.b')]);
  const log = w.gitRan.find((r) => call(r)[0] === 'log')!;
  expect(call(log).slice(0, 3)).toEqual(['log', '--no-ext-diff', '--no-textconv']);
  expect(log.some((x) => x.startsWith('filter.'))).toBe(false);
});

test('a filter driver whose name cannot be switched off: the status call is not made, the rest goes on', async ($, on) => {
  const w = world(on, { config: {}, git: repoGit, filterDrivers: 'local\tfilter.a=b.clean\n' });
  await $.prompt.submit(typed('devir'));
  const done: any = await $.tool.call({ tool: TOOL, ...PARTS } as any);
  expect(String(done.result)).toMatch(/The handoff note is written/);
  expect(w.gitRan.filter((r) => r.includes('--show-scope')).length).toBe(1);
  expect(w.gitRan.some((r) => call(r)[0] === 'status')).toBe(false);
  expect(w.gitRan.some((r) => call(r)[0] === 'log')).toBe(true);
});

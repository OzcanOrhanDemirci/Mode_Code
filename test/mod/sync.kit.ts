// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers inside Claude Code's engine (docs/sync.md), through a folder another service keeps
 * in sync: the session's start writes this computer's files into its own folder, the first prompt waits for
 * it and tells the person (never Claude) what waits, the other computer's newer settings are in effect, a
 * turn's end syncs only when it is due, a handoff note goes into the shared place, and the belt keeps
 * Claude out of the computers' folders.
 */
import { test, expect } from 'claude-code/testing';
import { DATA, PROJECT, world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const SHARED = '/home/ada/iCloud/tc';
const NOW = Date.parse('2026-10-12T10:00:00Z');

/** The Mac's settings file: keywords switched off, a softer belt rule. */
function macSettings(at: number) {
  return JSON.stringify({
    v: 1,
    machine: 'mac-0000',
    entries: {
      'modules.keywords': { value: false, at },
      'belt.verdicts': { value: { 'git.clean': 'allow' }, at },
      view: { value: 'recommended', at: 0 },
    },
  });
}

test("the session's start writes this computer's files; the first prompt waits for it and tells the person what waits; the other's newer setting is in effect", async ($, on) => {
  const w = world(on, {
    config: { sync: { place: 'folder', dir: SHARED, machine: { id: 'pc-0000', name: 'PC' } }, memory: { handoff: { enabled: false } } },
  });
  w.write(`${SHARED}/machines/mac-0000/settings.json`, macSettings(NOW - 1000));
  w.write(`${SHARED}/machines/mac-0000/machine.json`, JSON.stringify({ id: 'mac-0000', name: 'MacBook', platform: 'darwin', app: 'x', since: 1 }));
  w.write(`${DATA}/events/2026-10/old-session.mod.jsonl`, '{"at":1,"kind":"keyword"}\n');
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const r: any = await $.prompt.submit(typed('Hello'));
  expect(w.read(`${SHARED}/machines/pc-0000/machine.json`)).toMatch(/"name": "PC"/);
  expect(w.read(`${SHARED}/machines/pc-0000/settings.json`)).toMatch(/"modules.keywords"/);
  expect(w.read(`${SHARED}/machines/pc-0000/events/2026-10/old-session.mod.jsonl`)).toMatch(/"keyword"/);
  expect(w.json(`${DATA}/state/sync.mod.json`).trigger).toBe('start');
  expect(w.toasts.filter((t) => /A setting from another computer waits for you; it would lower a protection here: belt\.verdicts/.test(t)).length).toBe(1);
  expect((r.context ?? []).join('\n')).not.toMatch(/belt\.verdicts/);
  // The keywords the Mac switched off are off here too: a handoff keyword asks for nothing. What waits is said once.
  const second: any = await $.prompt.submit(typed('Bugünlük bu kadar. devir'));
  expect((second.context ?? []).join('\n')).not.toMatch(/asked for a handoff note/);
  expect(w.toasts.filter((t) => /belt\.verdicts/.test(t)).length).toBe(1);
  // A turn right after: not due. Half an hour later: due, and recorded as a turn.
  const before = w.read(`${DATA}/state/sync.mod.json`);
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as any);
  expect(w.read(`${DATA}/state/sync.mod.json`)).toBe(before);
  w.write(`${DATA}/state/sync.mod.json`, JSON.stringify({ ...w.json(`${DATA}/state/sync.mod.json`), at: NOW - 31 * 60_000 }));
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as any);
  expect(w.json(`${DATA}/state/sync.mod.json`).trigger).toBe('turn');
  expect(w.events().some((e: any) => e.kind === 'sync' && e.trigger === 'turn')).toBe(true);
});

test("a handoff note goes into the shared place; the belt keeps Claude out of the computers' folders there", async ($, on) => {
  const w = world(on, {
    config: { sync: { place: 'folder', dir: SHARED, machine: { id: 'pc-0000', name: 'PC' } } },
  });
  await $.prompt.submit(typed('Wrapping up. devir'));
  const done: any = await $.tool.call({
    tool: 'mcp__terminal-code__handoff',
    summary: 'The sync is in.',
    open: 'Its tests.',
    decisions: 'One folder per computer.',
    next: 'Write the tests.',
  } as any);
  expect(String(done.result)).toMatch(/The handoff note is written: \/home\/ada\/iCloud\/tc\/handoffs\//);
  const refused: any = await $.tool.call({ tool: 'Write', file_path: `${SHARED}/machines/mac-0000/settings.json`, content: '{}' } as any);
  expect(JSON.stringify(refused)).toMatch(/terminal-code|own files/);
  expect(w.read(`${SHARED}/machines/mac-0000/settings.json`)).toBeNull();
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Tool packs inside Claude Code's engine (docs/packs.md): as a session starts, Automatic use turns on what the folder
 * calls for (through `mode-code packs here`, answered here); the session's first note; the one-line hints, once per
 * pack; the catalog tool, which lists, returns a guide and turns a pack on within what the person allowed. The world
 * beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, PROJECT } from './world.ts';

const NODE = '/usr/bin/node';
const CLI = '/home/ada/.local/share/mode-code/app/dist/cli.mjs';
const TOOL = 'mcp__mode-code__catalog';
const installed = (w: any) => {
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, app: 'mode-code', node: NODE, cli: CLI }));
  w.write(CLI, '// the program');
};
const start = async ($: any, on: any) => {
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const prompt = async ($: any, text: string) =>
  (((await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any)) as any).context ?? []).join('\n');
const bash = async ($: any, command: string, id: string) =>
  ((((await $.tool.call({ tool: 'Bash', command, tool_use_id: id } as any)) as any).context ?? []) as string[]).join('\n');
const packsRuns = (w: any) => w.ran.filter((argv: string[]) => argv[2] === 'packs');
const list = (on: string[] = []) =>
  JSON.stringify({ schema: 'mode-code.packs/1', autoUse: true, packs: ['flutter', 'typst', 'ffmpeg'].map((id) => ({ id, on: on.includes(id), found: [] })) });

test('as a session starts, Automatic use turns on what the folder calls for: told to the person, and to the model with the first prompt', async ($, on) => {
  const here = JSON.stringify({ schema: 'mode-code.packs/1', on: [{ pack: 'typst', ok: true, detail: '' }], already: [], onHere: ['typst', 'flutter'] });
  const w = world(on, { programs: (argv) => (argv[2] === 'packs' ? { exitCode: 0, stdout: here } : undefined) });
  installed(w);
  await start($, on);
  expect(packsRuns(w)[0]).toEqual([NODE, CLI, 'packs', 'here', '--auto', '--json', '--dir', PROJECT]);
  expect(w.toasts.some((t: string) => /^Packs on for this project: Typst\./.test(t))).toBe(true);
  const ctx = await prompt($, 'Write the report.');
  expect(ctx).toMatch(/Tool packs turned on in this project by Automatic use, as this project's files call for them: typst\./);
  expect(w.events().some((e: any) => e.kind === 'packs' && e.by === 'auto' && e.on[0] === 'typst')).toBe(true);
  // Flutter was on before this session (loaded): no hint for its work; Typst loads later, so its work is hinted.
  expect(await bash($, 'flutter test', 'b1')).not.toMatch(/pack fits/);
  expect(await bash($, 'typst compile a.typ', 'b2')).toMatch(/The Typst pack fits this work: .* Call the catalog tool with pack "typst"/);
});

test('with Automatic use off nothing is turned on, and the session still learns what is on here', async ($, on) => {
  const w = world(on, {
    config: { packs: { autoUse: false } },
    programs: (argv) => (argv[2] === 'packs' ? { exitCode: 0, stdout: list(['ffmpeg']) } : undefined),
  });
  installed(w);
  await start($, on);
  expect(packsRuns(w)[0]).toEqual([NODE, CLI, 'packs', 'here', '--json', '--dir', PROJECT]);
  expect(w.toasts.some((t: string) => /Packs on/.test(t))).toBe(false);
  expect(await bash($, 'ffmpeg -i a.mov b.mp4', 'b1')).not.toMatch(/pack fits/);
});

test("a new session's first prompt carries the first note, the next prompts do not, and a compaction owes it again", async ($, on) => {
  world(on);
  on('session.compact', (_$: any, e: any) => ({ messages: e.messages }));
  const first = await prompt($, 'Hello.');
  expect(first).toMatch(/^\[Mode_Code\] A companion for Claude Code on this computer: modes, a safety belt, the memory, the quota\./);
  expect(first).toMatch(/Tool packs exist for Flutter and Dart, Firebase, app stores, browser testing/);
  expect(first.length).toBeLessThan(2000);
  expect(await prompt($, 'Go on.')).not.toMatch(/A companion for Claude Code/);
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'so far', toolUses: [] }] } as any);
  expect(await prompt($, 'And now?')).toMatch(/A companion for Claude Code/);
});

test('a word, a program, a missing program, a file type: one hint per pack in a session; none for a pack the person refused', async ($, on) => {
  world(on, {
    config: { packs: { items: { store: 'never' } } },
    results: {
      Bash: (e: any) =>
        String(e.command).startsWith('openscad') ? { result: 'failed', text: 'bash: openscad: command not found', isError: true } : { result: 'ran' },
    },
  });
  expect(await prompt($, 'Make the PDF with typst please.')).toMatch(/The Typst pack fits this work/);
  expect(await prompt($, 'Upload it to TestFlight.')).not.toMatch(/App stores pack/);
  expect(await bash($, 'ffmpeg -i a.mov b.mp4', 'h1')).toMatch(/The ffmpeg pack fits this work/);
  expect(await bash($, 'ffmpeg -i b.mov c.mp4', 'h2')).not.toMatch(/pack fits/);
  expect(await bash($, 'openscad -o part.stl part.scad', 'h3')).toMatch(
    /openscad is not installed here; the OpenSCAD pack uses it\. The person installs it \(openscad >=2021\.01: winget/,
  );
  const file: any = await $.tool.call({ tool: 'Write', file_path: `${PROJECT}/firestore.rules`, content: 'x', tool_use_id: 'h4' } as any);
  expect((file.context ?? []).join('\n')).toMatch(/The Firebase pack fits this work/);
});

test('the catalog: the packs for a need, a guide with what to install, and a pack turned on when the person allows it', async ($, on) => {
  let tainted = false;
  const w = world(on, {
    programs: (argv) => {
      if (argv[2] !== 'packs') return undefined;
      if (argv[3] === 'list') return { exitCode: 0, stdout: list() };
      if (argv[3] === 'here' && argv[4] === '--pack')
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, reason: null, changes: [{ pack: argv[5], ok: true, detail: '' }], onHere: [argv[5]] }) };
      return { exitCode: 0, stdout: JSON.stringify({ on: [], already: [], onHere: [] }) };
    },
    results: { WebFetch: () => ({ result: 'read', text: tainted ? 'a page' : '' }) },
  });
  installed(w);
  w.write(`${DATA}/marketplace/packs/guides/typst.md`, 'Typst documents: compile with typst compile.\n');
  await start($, on);
  expect(w.registered.find((t: any) => t.name === 'catalog')?.isDeferred).toBe(true);
  const found: any = await $.tool.call({ tool: TOOL, need: 'a PDF document', tool_use_id: 'c1' } as any);
  expect(String(found.result)).toMatch(/- typst \(documents\): Typst documents.* \[off here\]/);
  const guide: any = await $.tool.call({ tool: TOOL, pack: 'typst', tool_use_id: 'c2' } as any);
  expect(String(guide.result)).toMatch(
    /^# Typst pack \(off in this project\)\n\nTypst documents: compile with typst compile\.\n\nNot found on this computer; the person installs: typst >=0\.15\.1: winget install --id Typst\.Typst --exact/,
  );
  const turned: any = await $.tool.call({ tool: TOOL, pack: 'typst', turn_on: true, tool_use_id: 'c3' } as any);
  expect(String(turned.result)).toMatch(/^\[Mode_Code\] Tool packs turned on in this project as you asked: typst\./);
  expect(w.toasts.some((t: string) => /Claude turned on the Typst pack here \(Automatic use\)/.test(t))).toBe(true);
  expect(packsRuns(w).some((a: string[]) => a.join(' ') === `${NODE} ${CLI} packs here --pack typst --json --dir ${PROJECT}`)).toBe(true);
  // After outside content, a new pack waits for the person.
  tainted = true;
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'read', tool_use_id: 'c4' } as any);
  const refused: any = await $.tool.call({ tool: TOOL, pack: 'ffmpeg', turn_on: true, tool_use_id: 'c5' } as any);
  expect(String(refused.result)).toMatch(
    /^Not turned on: this session read outside content, so a new pack waits for the person; the person turns it on \(mode-code packs on ffmpeg/,
  );
});

test('Automatic use off, or a pack the person keeps for themselves: the catalog says who turns it on', async ($, on) => {
  const w = world(on, {
    config: { packs: { autoUse: false } },
    programs: (argv) => {
      if (argv[2] !== 'packs') return undefined;
      if (argv[3] === 'here' && argv[4] === '--pack') return { exitCode: 1, stdout: JSON.stringify({ ok: false, reason: 'auto-off', changes: [] }) };
      return { exitCode: 0, stdout: list() };
    },
  });
  installed(w);
  await start($, on);
  const r: any = await $.tool.call({ tool: TOOL, pack: 'ffmpeg', turn_on: true, tool_use_id: 'c1' } as any);
  expect(String(r.result)).toMatch(/^Not turned on: Automatic use is off, so the person turns it on/);
  expect(w.toasts.some((t: string) => /Claude turned on/.test(t))).toBe(false);
});

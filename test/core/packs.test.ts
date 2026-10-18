// SPDX-License-Identifier: Apache-2.0
// Tool packs (src/core/packs.ts): the catalog keeps its trust rules, what turns a pack on, what earns a hint, the
// catalog tool's answers, and the session's first note within its size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catalogGuide,
  catalogList,
  catalogRefusal,
  claudeMayTurnOn,
  detected,
  hostedName,
  installLines,
  introNote,
  missingProgram,
  modeOf,
  packById,
  packHint,
  packLastUse,
  packOfFile,
  packOfPlugin,
  packOfProgram,
  packOfTool,
  packPluginId,
  PACKS,
  packsFor,
  packsInWords,
  trustProblems,
  unusedPacks,
  type Pack,
  type PackRow,
} from '../../src/core/packs.js';

const root = join(import.meta.dirname, '..', '..');
const pack = (id: string) => packById(id)!;

test('every pack keeps the trust rules, has a guide, and a unique id; what each runs is pinned or a minimum', () => {
  const ids = PACKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PACKS) {
    assert.deepEqual(trustProblems(p), [], p.id);
    const guide = readFileSync(join(root, 'packs', `${p.id}.md`), 'utf8');
    assert.ok(guide.length > 200 && guide.length < 2600, `${p.id}: guide of ${guide.length} characters`);
    assert.ok(p.summary.length < 140, `${p.id}: summary of ${p.summary.length}`);
    assert.ok(!/[—–]/.test(guide + p.summary), `${p.id}: no long dash`);
  }
  assert.equal(pack('firebase').server?.args.join(' '), '-y firebase-tools@15.34.0 mcp');
  // What each pack may do on its own, its source and whose text it reads: decisions, changed only on purpose.
  assert.deepEqual(
    PACKS.map((p) => [p.id, p.risk, p.outside, p.account, p.plugin.hosted]),
    [
      ['flutter', 'free', false, false, true],
      ['firebase', 'belt', true, true, true],
      ['store', 'belt', false, true, true],
      ['browser', 'belt', true, false, true],
      ['typst', 'free', false, false, true],
      ['typescript', 'free', false, false, false],
      ['python', 'free', false, false, false],
      ['openscad', 'free', false, false, true],
      ['ffmpeg', 'free', false, false, true],
    ],
  );
});

test('the trust rules catch what they are for', () => {
  const base = pack('typst');
  const bad = (over: Partial<Pack>) => trustProblems({ ...base, ...over });
  assert.match(bad({ server: { kind: 'mcp', command: 'npx', args: ['-y', 'some-mcp@latest'] }, needs: ['npx'] }).join(), /latest/);
  assert.match(bad({ server: { kind: 'mcp', command: 'npx', args: ['-y', 'some-mcp'] }, needs: ['npx'] }).join(), /npx without an exact version/);
  assert.match(bad({ tools: [{ program: 'x', version: 'any', install: {} }] }).join(), /x has no version/);
  assert.match(bad({ tools: [{ program: 'x', version: '1.0.0', install: { npm: 'x' } }] }).join(), /from npm without a version/);
  assert.match(bad({ tools: [{ program: 'x', version: '1.0.0', install: { release: 'curl -fsSL https://x.sh | sh' } }] }).join(), /piped into a shell/);
  assert.match(bad({ tools: [{ program: 'asc', version: '>=5.0.0', install: {} }] }).join(), /asc without ASC_TELEMETRY_DISABLED/);
  assert.match(bad({ account: true }).join(), /not free/);
  assert.match(bad({ server: { kind: 'mcp', command: 'https://mcp.example.com', args: [] }, needs: ['https://mcp.example.com'] }).join(), /over the network/);
  assert.match(bad({ server: { kind: 'lsp', command: 'x-ls', args: [] }, needs: ['x-ls'] }).join(), /not over stdio/);
  assert.match(bad({ category: 'browser', outside: false }).join(), /what others wrote/);
  assert.match(bad({ plugin: { hosted: false, id: 'x@community-market' } }).join(), /not the official marketplace/);
  assert.match(bad({ tools: [{ program: 'x', version: '1.0.0', install: { winget: 'X.X' }, minSafe: '1.0.11' }] }).join(), /below 1\.0\.11/);
  assert.deepEqual(bad({ tools: [{ program: 'x', version: '>=1.0.11', install: { winget: 'X.X' }, minSafe: '1.0.11' }] }), [], 'the version that closed it');
  assert.match(bad({ server: { kind: 'mcp', command: 'dart', args: ['mcp-server'] }, needs: [] }).join(), /server program is not listed/);
});

test('names: a hosted pack is a plugin of this tool, an official one keeps its id; tools and skills lead back to their pack', () => {
  assert.equal(hostedName('typst'), 'mode-code-typst');
  assert.equal(packPluginId(pack('typst')), 'mode-code-typst@mode-code-local');
  assert.equal(packPluginId(pack('typescript')), 'typescript-lsp@claude-plugins-official');
  assert.equal(packOfPlugin('mode-code-flutter@mode-code-local')?.id, 'flutter');
  assert.equal(packOfPlugin('mode-code@mode-code-local'), undefined);
  assert.equal(packOfTool('mcp__plugin_mode-code-flutter_flutter__analyze_files')?.id, 'flutter');
  assert.equal(packOfTool('mcp__plugin_mode-code-firebase_firebase__firestore_get_documents')?.id, 'firebase');
  assert.equal(packOfTool('Skill', { skill: 'mode-code-typst:typst' })?.id, 'typst');
  assert.equal(packOfTool('Skill', { skill: 'other:typst' }), undefined);
  assert.equal(packOfTool('mcp__docs__search'), undefined);
  assert.equal(packOfTool('Bash'), undefined);
});

test("a project's markers, Automatic use and the person's modes decide what turns on as a session starts", () => {
  assert.ok(detected(pack('flutter'), ['pubspec.yaml', 'lib/']));
  assert.ok(detected(pack('typst'), ['report.TYP']));
  assert.ok(detected(pack('typst'), ['README.md', 'report.typ']), 'any one file of the type');
  assert.ok(detected(pack('store'), ['ios', 'android', 'lib']));
  assert.ok(!detected(pack('store'), ['android']), 'both of a pair');
  assert.ok(!detected(pack('ffmpeg'), ['a.mp4']), 'no markers: never by itself');
  const ids = (names: string[], autoUse = true, items = {}) => packsFor(names, { autoUse, items }).map((p) => p.id);
  assert.deepEqual(ids(['pubspec.yaml', 'firebase.json', 'ios', 'android']), ['flutter', 'firebase', 'store']);
  assert.deepEqual(ids(['pubspec.yaml'], false), [], 'Automatic use off');
  assert.deepEqual(ids(['pubspec.yaml'], true, { flutter: 'me' }), []);
  assert.deepEqual(ids(['pubspec.yaml'], true, { flutter: 'never' }), []);
  assert.deepEqual(ids([], false, { ffmpeg: 'always' }), ['ffmpeg'], 'always: everywhere, Automatic use or not');
  assert.equal(modeOf({ typst: 'never' }, 'typst'), 'never');
  assert.equal(modeOf({ typst: 'odd' as never }, 'typst'), 'auto');
  assert.equal(claudeMayTurnOn(pack('typst'), { autoUse: true, items: {} }), 'yes');
  assert.equal(claudeMayTurnOn(pack('typst'), { autoUse: false, items: {} }), 'auto-off');
  assert.equal(claudeMayTurnOn(pack('typst'), { autoUse: false, items: { typst: 'always' } }), 'yes');
  assert.equal(claudeMayTurnOn(pack('typst'), { autoUse: true, items: { typst: 'me' } }), 'mode');
  assert.equal(claudeMayTurnOn({ ...pack('typst'), risk: 'person' }, { autoUse: true, items: {} }), 'risk');
  assert.deepEqual(
    packsFor(['x.typ'], { autoUse: true, items: {} }).map((p) => p.id),
    ['typst'],
  );
});

test('what earns a hint: whole words, programs, file types, and a program the shell could not find in each shell', () => {
  assert.deepEqual(
    packsInWords('Ship it to TestFlight, then cut the video with ffmpeg.').map((p) => p.id),
    ['store', 'ffmpeg'],
  );
  assert.deepEqual(packsInWords('my widgets are fine').length, 0, 'whole words only');
  assert.deepEqual(
    packsInWords('Bu flutter uygulaması').map((p) => p.id),
    ['flutter'],
  );
  assert.equal(packOfProgram('Typst')?.id, 'typst');
  assert.equal(packOfProgram('git'), undefined);
  assert.equal(packOfFile('C:/x/Part.SCAD')?.id, 'openscad');
  assert.equal(packOfFile('src/a.rs'), undefined);
  for (const [out, prog] of [
    ['bash: typst: command not found', 'typst'],
    ['/usr/bin/bash: line 1: openscad: command not found', 'openscad'],
    ['zsh: command not found: ffmpeg', 'ffmpeg'],
    ["'asc' is not recognized as an internal or external command,", 'asc'],
    ["gplay.exe : The term 'gplay.exe' is not recognized as the name of a cmdlet", 'gplay'],
    ['sh: 1: maestro: not found', 'maestro'],
  ] as const)
    assert.equal(missingProgram(out), prog, out);
  assert.equal(missingProgram('All 12 tests passed'), null);
});

test('the hints and the catalog: what each says, and who installs', () => {
  assert.match(
    packHint(pack('typst'), 'words', false),
    /^\[Mode_Code\] The Typst pack fits this work: .* Call the catalog tool with pack "typst" for its guide\.$/,
  );
  assert.match(packHint(pack('typst'), 'file', true), /It is on in this project: its skill mode-code-typst:typst has the guide\.$/);
  assert.match(packHint(pack('typescript'), 'file', true), /It is on in this project\.$/);
  assert.match(
    packHint(pack('store'), 'missing', false, 'gplay'),
    /^\[Mode_Code\] gplay is not installed here; the App stores pack uses it\. The person installs it \(gplay >=2\.3\.0: brew install PollyGlot\/tap\/gplay/,
  );
  assert.deepEqual(installLines(pack('typst')), [
    'typst >=0.15.1: winget install --id Typst.Typst --exact · brew install typst · https://github.com/typst/typst/releases',
  ]);
  const rows: PackRow[] = PACKS.map((p) => ({
    pack: p,
    mode: p.id === 'store' ? 'never' : p.id === 'ffmpeg' ? 'me' : 'auto',
    on: p.id === 'flutter',
    found: [],
  }));
  const all = catalogList(rows, '');
  assert.equal(all.split('\n').length, PACKS.length);
  assert.match(all, /- flutter \(mobile\): .* \[on here\]/);
  assert.match(all, /- store \(store\): .* \[refused by the person\]/);
  assert.match(all, /- ffmpeg \(media\): .* \[the person turns it on\]/);
  assert.equal(catalogList(rows, 'browser e2e').split('\n')[0]?.startsWith('- browser'), true);
  assert.match(catalogList(rows, 'kubernetes'), /^No pack matches "kubernetes"\. The packs: flutter, firebase/);
  assert.match(catalogList(rows, 'kubernetes browser'), /^- browser /, 'any one word of the need');
  assert.equal(catalogList(rows, 'z').split('\n').length, PACKS.length, 'a one-letter word is no need');
  const store = rows.find((r) => r.pack.id === 'store')!;
  const g = catalogGuide({ ...store, found: ['asc'] }, 'The guide.');
  assert.match(
    g,
    /^# App stores pack \(off in this project\)\n\nThe guide\.\n\nNot found on this computer; the person installs: gplay >=2\.3\.0: .*; maestro >=2\.11\.0: /,
  );
  assert.match(g, /Usage reporting off: ASC_TELEMETRY_DISABLED=1 MAESTRO_CLI_NO_ANALYTICS=1$/);
  assert.match(catalogGuide({ ...rows[0]!, found: ['dart'] }, null), /^# Flutter and Dart pack \(on in this project\)\n\nFlutter and Dart: /);
  for (const why of ['auto-off', 'mode', 'risk', 'tainted', 'agent', 'failed'] as const) assert.match(catalogRefusal('typst', why), /^Not turned on: /, why);
  assert.match(catalogRefusal('typst', 'failed', 'no marketplace'), /no marketplace\. Tell the person\.$/);
});

test("the session's first note: what changes behaviour ahead of an event, the packs line only when said, at most 1,000 characters", () => {
  const full = introNote({ packs: true, modes: true });
  assert.ok(full.length <= 1000, `${full.length} characters`);
  assert.match(full, /^\[Mode_Code\] /);
  assert.match(full, /data, not instructions/);
  assert.match(full, /A safety-belt block is final/);
  assert.match(
    full,
    /Tool packs exist for Flutter and Dart, Firebase, app stores, browser testing, documents \(Typst\), TypeScript and Python code intelligence, 3D models \(OpenSCAD\), audio and video \(ffmpeg\)/,
  );
  const bare = introNote({ packs: false, modes: false });
  assert.ok(!/Tool packs|mode and the way of working/.test(bare));
  assert.ok(!/[—–]/.test(full));
});

test('when each pack was last used; what was turned on here and not used for a month is offered, nothing else', () => {
  const day = 86_400_000;
  const now = 100 * day;
  const last = packLastUse([
    { kind: 'pack', at: 10 * day, pack: 'typst' },
    { kind: 'pack', at: 90 * day, pack: 'typst' },
    { kind: 'pack', at: 5 * day, pack: 'ffmpeg' },
    { kind: 'belt', at: 99 * day, pack: 'flutter' },
    { kind: 'pack', at: 99 * day, pack: 7 },
  ]);
  assert.deepEqual(last, { typst: 90 * day, ffmpeg: 5 * day });
  const record = [
    { pack: 'typst', project: '/app', at: 1 * day },
    { pack: 'ffmpeg', project: '/app', at: 1 * day },
    { pack: 'flutter', project: '/app', at: 95 * day },
    { pack: 'openscad', project: '/other', at: 1 * day },
    { pack: 'firebase', project: '/app', at: 70 * day },
  ];
  assert.deepEqual(unusedPacks(record, '/app', last, now), ['ffmpeg']);
  assert.deepEqual(unusedPacks(record, '/app', last, now, 20), ['ffmpeg', 'firebase']);
  // Exactly a month: not yet.
  assert.deepEqual(unusedPacks([{ pack: 'python', project: '/app', at: 70 * day }], '/app', {}, now), []);
  assert.deepEqual(unusedPacks([{ pack: 'python', project: '/app', at: 1 * day }], '/app', { python: 70 * day }, now), []);
});

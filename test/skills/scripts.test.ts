// SPDX-License-Identifier: Apache-2.0
// The scripts two skills carry (skills/store-check/check.mjs, skills/turkish-text/check.mjs): each check on a made-up
// project, a package and a text, and the command line's exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
// @ts-expect-error: a plain JavaScript script the skill runs
import { checkProject, loadAligns, pngAlpha, zipEntries } from '../../skills/store-check/check.mjs';
// @ts-expect-error: a plain JavaScript script the skill runs
import { lineFindings, particleFor, textFindings } from '../../skills/turkish-text/check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
type Result = { level: string; title: string; detail: string };

function project(files: Record<string, string | Buffer>): { root: string; done(): void } {
  const root = mkdtempSync(join(tmpdir(), 'tc-store-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A PNG's signature and IHDR with the given color type, then a chunk named `next`. */
function png(colorType: number, next = 'IDAT'): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(1024, 8);
  ihdr.writeUInt32BE(1024, 12);
  ihdr[16] = 8;
  ihdr[17] = colorType;
  const chunk = Buffer.alloc(12);
  chunk.writeUInt32BE(0, 0);
  chunk.write(next, 4, 'latin1');
  return Buffer.concat([head, ihdr, chunk]);
}

/** A 64-bit little-endian ELF with one loadable segment of the given alignment. */
function elf(align: number): Buffer {
  const b = Buffer.alloc(64 + 56);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2;
  b[5] = 1;
  b.writeBigUInt64LE(64n, 0x20);
  b.writeUInt16LE(56, 0x36);
  b.writeUInt16LE(1, 0x38);
  b.writeUInt32LE(1, 64);
  b.writeBigUInt64LE(BigInt(align), 64 + 0x30);
  return b;
}

/** A ZIP of the given files, deflated, as an APK is. */
function zip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const body = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const titles = (r: Result[], level: string) => r.filter((x) => x.level === level).map((x) => x.title);

test('store readiness: a project not ready is blocked on each store condition, with the files named', () => {
  const p = project({
    'android/app/build.gradle.kts':
      'android { defaultConfig { applicationId = "com.example.app" } buildTypes { release { signingConfig = signingConfigs.getByName("debug") } } }',
    'android/app/src/main/AndroidManifest.xml': '<application android:label="my_app"></application>',
    'ios/Runner/Info.plist': '<plist></plist>',
    'ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png': png(6),
    'lib/main.dart': 'await FirebaseAuth.instance.createUserWithEmailAndPassword(email: e, password: p);',
    'pubspec.yaml': 'name: app\nversion: 1.2.0+3\n',
    'lib/app_version.dart': "const version = '1.1.0'; const buildNumber = 3;",
  });
  try {
    const r: Result[] = checkProject(p.root);
    assert.deepEqual(titles(r, 'BLOCK'), [
      'The application id is still com.example',
      'The release is signed with the debug key',
      'PrivacyInfo.xcprivacy is missing',
      'The iOS 1024 icon has an alpha channel',
      'The app holds no privacy policy text',
      'Accounts are made but cannot be deleted in the app',
    ]);
    assert.deepEqual(titles(r, 'WARN'), [
      'The main manifest has no INTERNET permission',
      "The app's name looks like snake_case",
      'Info.plist has no ITSAppUsesNonExemptEncryption',
      'ios/Podfile is missing',
      'app_version.dart and pubspec.yaml disagree',
    ]);
    assert.match(r[0]!.detail, /android\/app\/build\.gradle\.kts/);
  } finally {
    p.done();
  }
});

test('store readiness: a ready project passes, and a package with libraries for 16 KB pages too; one for 4 KB is blocked', () => {
  const p = project({
    'android/app/build.gradle': 'android { signingConfigs { release { storeFile file(keystoreProperties["storeFile"]) } } } // key.properties',
    'android/key.properties': 'storeFile=x',
    'android/app/src/main/AndroidManifest.xml': '<uses-permission android:name="android.permission.INTERNET"/><application android:label="@string/app_name">',
    'ios/Runner/Info.plist': '<key>ITSAppUsesNonExemptEncryption</key><false/>',
    'ios/Runner/PrivacyInfo.xcprivacy': '<plist></plist>',
    'ios/Runner.xcodeproj/project.pbxproj': 'PrivacyInfo.xcprivacy in Resources',
    'ios/Podfile': "platform :ios, '13.0'",
    'ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png': png(2),
    'lib/legal.dart': "const privacyText = 'Gizlilik Politikası';",
    'pubspec.yaml': 'version: 1.0.0+1\n',
    'good.apk': zip({ 'lib/arm64-v8a/libapp.so': elf(16384), 'AndroidManifest.xml': Buffer.from('x') }),
    'old.apk': zip({ 'lib/arm64-v8a/libapp.so': elf(4096) }),
    'nolibs.apk': zip({ 'classes.dex': Buffer.from('x') }),
    'not.apk': 'not a zip',
  });
  try {
    const r: Result[] = checkProject(p.root, join(p.root, 'good.apk'));
    assert.deepEqual(titles(r, 'BLOCK'), []);
    assert.deepEqual(titles(r, 'WARN'), []);
    assert.ok(titles(r, 'OK').includes('16 KB pages: all 1 native libraries are aligned'));
    assert.ok(titles(r, 'OK').includes('No accounts are made: in-app deletion does not apply'));
    const old: Result[] = checkProject(p.root, join(p.root, 'old.apk'));
    assert.deepEqual(titles(old, 'BLOCK'), ['Native libraries are not aligned for 16 KB pages']);
    assert.match(old.find((x) => x.level === 'BLOCK')!.detail, /libapp\.so \(p_align 4096\)/);
    assert.ok(titles(checkProject(p.root, join(p.root, 'nolibs.apk')), 'WARN').includes('The package holds no native libraries (.so)'));
    assert.ok(titles(checkProject(p.root, join(p.root, 'not.apk')), 'WARN').some((t: string) => t.startsWith('Not a ZIP package')));
    assert.ok(titles(checkProject(p.root, join(p.root, 'gone.apk')), 'WARN').some((t: string) => t.startsWith('The package was not found')));
    // The command line: 0 when nothing blocks, 1 when something does, 2 for no folder.
    const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'skills', 'store-check', 'check.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(run(p.root).status, 0);
    assert.equal(run(p.root, '--package', join(p.root, 'old.apk')).status, 1);
    assert.equal(JSON.parse(run(p.root, '--json').stdout).blocks, 0);
    assert.equal(run(join(p.root, 'missing')).status, 2);
  } finally {
    p.done();
  }
});

test('the pieces: PNG transparency by color type or a tRNS chunk; ELF alignments; ZIP entries', () => {
  assert.equal(pngAlpha(png(6)), true);
  assert.equal(pngAlpha(png(4)), true);
  assert.equal(pngAlpha(png(3, 'tRNS')), true);
  assert.equal(pngAlpha(png(3)), false);
  assert.equal(pngAlpha(png(2)), false);
  assert.equal(pngAlpha(Buffer.from('GIF89a and more bytes than thirty-three')), null);
  assert.deepEqual(loadAligns(elf(16384)), [16384]);
  assert.equal(loadAligns(Buffer.from('not an elf at all, not at all, not at all, not at all')), null);
  const z = zipEntries(zip({ 'a.txt': Buffer.from('hello') }));
  assert.deepEqual(
    z.map((e: { name: string; data(): Buffer }) => [e.name, e.data().toString()]),
    [['a.txt', 'hello']],
  );
  assert.equal(zipEntries(Buffer.from('nothing here')), null);
});

test('Turkish text: long dashes, and the question particle against the word before it, endings included', () => {
  assert.equal(particleFor('geldi'), 'mi');
  assert.equal(particleFor('kitap'), 'mı');
  assert.equal(particleFor('oldu'), 'mu');
  assert.equal(particleFor('gördün'), 'mü');
  assert.equal(particleFor('İSTANBUL'), 'mu');
  assert.equal(particleFor('rkt'), null);
  const kinds = (s: string) => lineFindings(s).map((f: { kind: string; want?: string }) => `${f.kind}${f.want ? `:${f.want}` : ''}`);
  assert.deepEqual(kinds('Geldi mı?'), ['harmony:Geldi mi']);
  assert.deepEqual(kinds('test mısın'), ['harmony:test mi']);
  assert.deepEqual(kinds('Kitap mi, kalem mi?'), ['harmony:Kitap mı']);
  assert.deepEqual(kinds('Bu iş bitti mi? Oldu mu, olmadı mı? Gördün mü?'), []);
  assert.deepEqual(kinds('Sorun mu var — evet – hayır'), ['dash']);
  assert.deepEqual(kinds('anlamı? durumu? gelecekmisin?'), [], 'joined forms are left to reading');
  // Markdown: fenced and inline code left out.
  const md = ['Bitti mı?', '```', 'kod mı', '```', 'Bu `test mı` doğru mu?'].join('\n');
  assert.deepEqual(
    textFindings(md, true).map((f: { line: number }) => f.line),
    [1],
  );
  assert.equal(textFindings(md, false).length, 3);
  const p = project({ 'docs/a.md': 'Hazır mi?\n', 'docs/b.txt': 'Hazır mı?\n', 'node_modules/x.md': 'Hazır mi?\n' });
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'skills', 'turkish-text', 'check.mjs'), ...args], { encoding: 'utf8' });
    const r = run(p.root, '--json');
    assert.equal(r.status, 1);
    assert.deepEqual(
      JSON.parse(r.stdout).found.map((f: { file: string; line: number }) => [f.file.replace(/\\/g, '/').split('/').slice(-2).join('/'), f.line]),
      [['docs/a.md', 1]],
    );
    assert.equal(run(join(p.root, 'docs', 'b.txt')).status, 0);
    assert.equal(run(join(p.root, 'missing')).status, 2);
  } finally {
    p.done();
  }
});

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Store readiness, measured (the store-check skill): each check reads one concrete condition of an Android or iOS
 * app project (Flutter's layout first) and says why it matters. Nothing is changed. Node.js only, no packages.
 *
 * Usage: node check.mjs [project folder, default .] [--package <app.apk|app.aab>] [--json]
 * Exit code 0: nothing blocks a store; 1: at least one BLOCK; 2: the folder could not be read.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const BLOCK = 'BLOCK';
export const WARN = 'WARN';
export const OK = 'OK';

/** Every check on a project folder, in order; `pkg` is a built APK or AAB to look inside. */
export function checkProject(root, pkg = null) {
  const out = [];
  const add = (level, title, detail = '') => out.push({ level, title, detail });
  const read = (...p) => {
    try {
      return readFileSync(join(root, ...p), 'utf8');
    } catch {
      return null;
    }
  };
  const has = (...p) => existsSync(join(root, ...p));
  const dart = dartFiles(join(root, 'lib'));

  // The application id: com.example is refused by both stores.
  const idFiles = ['android/app/build.gradle.kts', 'android/app/build.gradle', 'ios/Runner.xcodeproj/project.pbxproj', 'android/app/google-services.json'];
  const example = idFiles.filter((f) => (read(f) ?? '').includes('com.example'));
  if (example.length) add(BLOCK, 'The application id is still com.example', `Both stores refuse it. In: ${example.join(', ')}`);
  else add(OK, 'The application id is not com.example');

  // Release signing.
  const gradle = read('android/app/build.gradle.kts') ?? read('android/app/build.gradle');
  if (gradle === null) add(WARN, 'android/app/build.gradle(.kts) not found');
  else if (/signingConfigs\.getByName\("debug"\)|signingConfig\s*=?\s*signingConfigs\.debug/.test(gradle) && !gradle.includes('key.properties'))
    add(BLOCK, 'The release is signed with the debug key', 'Google Play refuses a package signed with the debug certificate.');
  else if (gradle.includes('key.properties'))
    add(
      has('android', 'key.properties') ? OK : WARN,
      has('android', 'key.properties')
        ? 'Release signing is set up and key.properties is there'
        : 'Release signing is set up but android/key.properties is missing',
      has('android', 'key.properties') ? '' : 'The build falls back to the debug key on this computer.',
    );
  else add(WARN, 'How the release is signed could not be read');

  // The Android manifest.
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  if (manifest === null) add(WARN, 'The main AndroidManifest.xml was not found');
  else {
    if (manifest.includes('android.permission.INTERNET')) add(OK, 'The INTERNET permission is in the main manifest');
    else add(WARN, 'The main manifest has no INTERNET permission', "An app that uses the network then depends on its plugins' manifests being merged.");
    if (/android:label="[a-z0-9]+(?:_[a-z0-9]+)+"/.test(manifest))
      add(WARN, "The app's name looks like snake_case", 'It shows on the home screen as the project name; use @string/app_name.');
  }

  // iOS.
  const plist = read('ios/Runner/Info.plist');
  if (plist === null) add(WARN, 'ios/Runner/Info.plist not found');
  else {
    if (plist.includes('ITSAppUsesNonExemptEncryption')) add(OK, 'The export encryption answer is in Info.plist');
    else add(WARN, 'Info.plist has no ITSAppUsesNonExemptEncryption', 'Every upload asks the export compliance question again.');
    if (!has('ios/Runner/PrivacyInfo.xcprivacy'))
      add(BLOCK, 'PrivacyInfo.xcprivacy is missing', "Apple's privacy manifest; without it uploads get ITMS-91053.");
    else if (!(read('ios/Runner.xcodeproj/project.pbxproj') ?? '').includes('PrivacyInfo.xcprivacy'))
      add(
        BLOCK,
        'PrivacyInfo.xcprivacy is not in the Xcode target',
        'It sits in the source tree and never reaches the package: add it to the Resources phase.',
      );
    else add(OK, 'PrivacyInfo.xcprivacy is there and in the Runner target');
    if (!has('ios/Podfile')) add(WARN, 'ios/Podfile is missing', 'The deployment target is then resolved differently on each computer.');
  }

  // Icons.
  const hdpi = join(root, 'android/app/src/main/res/mipmap-hdpi/ic_launcher.png');
  if (existsSync(hdpi) && statSync(hdpi).size < 800)
    add(WARN, "The Android icon may still be Flutter's default", `mipmap-hdpi/ic_launcher.png is ${statSync(hdpi).size} bytes (the template's is about 544).`);
  const icon = join(root, 'ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png');
  if (existsSync(icon)) {
    const alpha = pngAlpha(readFileSync(icon));
    if (alpha === null) add(WARN, 'The iOS 1024 icon is not a PNG that could be read');
    else if (alpha) add(BLOCK, 'The iOS 1024 icon has an alpha channel', 'App Store Connect refuses an icon with alpha.');
    else add(OK, 'The iOS 1024 icon has no alpha channel');
  } else if (plist !== null) add(WARN, 'The iOS 1024x1024 icon was not found');

  // A privacy policy inside the app.
  const hints = ['privacytext', 'privacy_text', 'privacysections', 'privacy policy', 'gizlilik politikas', 'aydinlatma metni', 'aydınlatma metni'];
  if (!dart.length) add(WARN, 'No Dart code under lib/: the in-app checks were skipped');
  else if (dart.some((d) => hints.some((h) => d.toLowerCase().includes(h)))) add(OK, 'A privacy text was found in the app');
  else add(BLOCK, 'The app holds no privacy policy text', 'Both stores ask for a privacy policy.');

  // Account deletion, where accounts are made.
  if (dart.length) {
    const makes = dart.some((d) => /createUserWithEmailAndPassword|signInWithApple|GoogleSignIn/.test(d));
    const deletes = dart.some((d) => /deleteAccount|deleteCurrentUser/.test(d) || (d.includes('.delete()') && d.includes('currentUser')));
    if (makes && !deletes) add(BLOCK, 'Accounts are made but cannot be deleted in the app', "Google Play's policy and Apple's guideline 5.1.1(v) require it.");
    else if (makes) add(OK, 'Accounts are made and can be deleted in the app');
    else add(OK, 'No accounts are made: in-app deletion does not apply');
  }

  // The version.
  const pub = read('pubspec.yaml');
  if (pub !== null) {
    const m = /^version:\s*([0-9.]+)\+([0-9]+)\s*$/m.exec(pub);
    if (!m) add(WARN, "pubspec.yaml has no 'version: x.y.z+n' line");
    else {
      const av = read('lib/app_version.dart');
      const v = av && /version\s*=\s*'([0-9.]+)'/.exec(av);
      const b = av && /buildNumber\s*=\s*([0-9]+)/.exec(av);
      if (v && b && (v[1] !== m[1] || b[1] !== m[2]))
        add(WARN, 'app_version.dart and pubspec.yaml disagree', `pubspec ${m[1]}+${m[2]}, app_version ${v[1]}+${b[1]}`);
      else add(OK, `Version ${m[1]}+${m[2]}`);
    }
  }

  if (pkg) checkPackage(pkg, add);
  return out;
}

/** The text of every .dart file under a folder. */
function dartFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/** Whether a PNG carries transparency: an alpha color type, or a palette with a tRNS chunk. Null: not a PNG. */
export function pngAlpha(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const type = buf[25];
  if (type === 4 || type === 6) return true;
  for (let at = 8; at + 8 <= buf.length;) {
    const len = buf.readUInt32BE(at);
    const name = buf.toString('latin1', at + 4, at + 8);
    if (name === 'tRNS') return true;
    if (name === 'IDAT' || name === 'IEND') break;
    at += 12 + len;
  }
  return false;
}

/** The files of a ZIP (an APK or AAB), read from its central directory: name, then its bytes on request. */
export function zipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let n = 0; n < count && buf.readUInt32LE(at) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    out.push({
      name,
      data: () => {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + size);
        return method === 8 ? inflateRawSync(raw) : raw;
      },
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The alignments of an ELF file's loadable segments, or null when it is not ELF. */
export function loadAligns(data) {
  if (data.length < 52 || data.readUInt32BE(0) !== 0x7f454c46) return null;
  const wide = data[4] === 2;
  const le = data[5] === 1;
  const u16 = (o) => (le ? data.readUInt16LE(o) : data.readUInt16BE(o));
  const u32 = (o) => (le ? data.readUInt32LE(o) : data.readUInt32BE(o));
  const u64 = (o) => Number(le ? data.readBigUInt64LE(o) : data.readBigUInt64BE(o));
  const phoff = wide ? u64(0x20) : u32(0x1c);
  const size = u16(wide ? 0x36 : 0x2a);
  const count = u16(wide ? 0x38 : 0x2c);
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = phoff + i * size;
    if (u32(base) === 1) out.push(wide ? u64(base + 0x30) : u32(base + 0x1c));
  }
  return out;
}

/** A built package: every native library aligned for 16 KB pages, as Google Play requires. */
function checkPackage(path, add) {
  if (!existsSync(path)) {
    add(WARN, `The package was not found: ${path}`);
    return;
  }
  const entries = zipEntries(readFileSync(path));
  if (!entries) {
    add(WARN, `Not a ZIP package: ${path}`);
    return;
  }
  const libs = entries.filter((e) => e.name.endsWith('.so'));
  const bad = [];
  for (const e of libs) {
    const aligns = loadAligns(e.data());
    if (!aligns || !aligns.length || Math.min(...aligns) < 16384) bad.push(`${e.name} (${aligns?.length ? `p_align ${Math.min(...aligns)}` : 'not ELF'})`);
  }
  if (!libs.length) add(WARN, 'The package holds no native libraries (.so)');
  else if (bad.length) add(BLOCK, 'Native libraries are not aligned for 16 KB pages', bad.join('; '));
  else add(OK, `16 KB pages: all ${libs.length} native libraries are aligned`);
}

function main(argv) {
  const i = argv.indexOf('--package');
  const pkg = i >= 0 ? argv[i + 1] : null;
  const rest = argv.filter((a, n) => !a.startsWith('--') && !(i >= 0 && n === i + 1));
  const root = resolve(rest[0] ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`store-check: not a folder: ${root}`);
    return 2;
  }
  const results = checkProject(root, pkg ? resolve(pkg) : null);
  const blocks = results.filter((r) => r.level === BLOCK).length;
  if (argv.includes('--json')) console.log(JSON.stringify({ root, results, blocks }, null, 2));
  else {
    console.log(`Store readiness: ${root}`);
    for (const r of results) console.log(`[${r.level.padEnd(5)}] ${r.title}${r.detail ? `\n        ${r.detail}` : ''}`);
    const warns = results.filter((r) => r.level === WARN).length;
    console.log(`BLOCK ${blocks} · WARN ${warns} · OK ${results.length - blocks - warns}`);
  }
  return blocks ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));

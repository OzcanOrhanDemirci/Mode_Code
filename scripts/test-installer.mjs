// SPDX-License-Identifier: Apache-2.0
/**
 * The one-line installer (install.sh, install.ps1), run as a person runs it, in a home of its own: the
 * package npm would publish, a stand-in `claude`, and a Node.js mirror on disk that holds this very Node.js,
 * so nothing is downloaded. Each case checks what the installer left: the program folder and its record,
 * the `mode-code` command (run through it), the PATH entry (a startup file, or on Windows a registry key of
 * its own under HKCU\Software, never the real one), the Claude Code side through `mode-code install`, and
 * then `mode-code uninstall`, run through the command, taking all of it away again.
 *
 * Usage: node scripts/test-installer.mjs [--package <tgz>] [--shell <name>]...
 *   Shells: sh, bash (macOS, Linux), powershell (Windows PowerShell 5.1), pwsh. Default: every one installed.
 *   Needs a build (npm run build) unless --package names a tarball.
 * Exit: 0 passed · 1 failed.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const wantedShells = args.flatMap((a, i) => (args[i - 1] === '--shell' ? [a] : []));
const FAKE_CLAUDE = join(root, 'test', 'helpers', 'fake-claude.mjs');
// The mirror's build is this Node.js, so its file name carries this version, as nodejs.org's names carry theirs.
const NODE_VERSION = process.versions.node;

class Failure extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Failure(msg);
};

const tmp = mkdtempSync(join(tmpdir(), 'tc-installer-'));
// A path as one place on disk: macOS's temporary folder is under /var, a link to /private/var, and the program
// records where it really is, as it does for a home folder reached through a link.
const placeKey = (p) => {
  let real = p;
  try {
    real = realpathSync(p);
  } catch {
    /* compared as written */
  }
  return real.replace(/\\/g, '/').toLowerCase();
};
const results = [];

/** Every variable of the session this may run in that would change what the installer does. */
function baseEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k === 'NODE_OPTIONS' || k === 'FORCE_COLOR') continue;
    if (k.startsWith('MODE_CODE_') || k === 'PSModulePath' || k === 'XDG_DATA_HOME' || k === 'ZDOTDIR') continue;
    env[k] = v;
  }
  return env;
}

const pathKey = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

/** PATH without the folders holding a `claude`, or a `node` too. */
function pathWithout(path, names) {
  return path
    .split(delimiter)
    .filter((d) => {
      try {
        return !readdirSync(d).some((f) => names.some((n) => new RegExp(`^${n}(?:\\.exe|\\.cmd|\\.bat)?$`, 'i').test(f)));
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', windowsHide: true, timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}

// Windows' own tar: the one Git for Windows puts on PATH reads "C:" as a remote host.
const WINDOWS = process.env.SystemRoot ?? 'C:\\Windows';
const TAR = isWin ? join(WINDOWS, 'System32', 'tar.exe') : 'tar';
const isUnixShell = (shell) => shell === 'sh' || shell === 'bash';
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ── what is installed: the package, and a Node.js mirror on disk ──

function makePackage() {
  const given = opt('--package');
  if (given) return resolve(given);
  check(existsSync(join(root, 'dist', 'cli.mjs')), 'no build (run npm run build first)');
  const packed = run(isWin ? 'npm.cmd' : 'npm', ['pack', '--json', '--pack-destination', tmp], { cwd: root, shell: isWin });
  check(packed.code === 0, `npm pack failed: ${packed.out.slice(0, 2000)}`);
  const info = JSON.parse(packed.out.slice(packed.out.indexOf('['), packed.out.lastIndexOf(']') + 1))[0];
  return join(tmp, info.filename);
}

/** latest-v24.x/ with SHASUMS256.txt and one build for this system, holding this Node.js. */
function makeMirror() {
  const mirror = join(tmp, 'mirror');
  const latest = join(mirror, 'latest-v24.x');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const os = isWin ? 'win' : process.platform;
  const folder = `node-v${NODE_VERSION}-${os}-${arch}`;
  const src = join(tmp, 'nodebuild', folder);
  mkdirSync(latest, { recursive: true });
  let file;
  if (isWin) {
    mkdirSync(src, { recursive: true });
    copyFileSync(process.execPath, join(src, 'node.exe'));
    writeFileSync(join(src, 'LICENSE'), 'Node.js license (test copy)\n');
    file = `${folder}.zip`;
    const r = run(TAR, ['-a', '-cf', join(latest, file), '-C', join(tmp, 'nodebuild'), folder]);
    check(r.code === 0, `zip failed: ${r.out}`);
  } else {
    mkdirSync(join(src, 'bin'), { recursive: true });
    copyFileSync(process.execPath, join(src, 'bin', 'node'));
    chmodSync(join(src, 'bin', 'node'), 0o755);
    writeFileSync(join(src, 'LICENSE'), 'Node.js license (test copy)\n');
    file = `${folder}.tar.gz`;
    const r = run('tar', ['-czf', join(latest, file), '-C', join(tmp, 'nodebuild'), folder]);
    check(r.code === 0, `tar failed: ${r.out}`);
  }
  // A build for another system first, as nodejs.org lists many: the installer must pick its own.
  writeFileSync(join(latest, 'SHASUMS256.txt'), `${'0'.repeat(64)}  node-v${NODE_VERSION}-aix-ppc64.tar.gz\n${sha256(join(latest, file))}  ${file}\n`);
  return mirror;
}

// ── a home of its own for each case ──

function world(name, opts) {
  const dir = join(tmp, name);
  const home = join(dir, 'home');
  const fakeBin = join(dir, 'fake-bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(dir, 'claude'), { recursive: true });
  const env = baseEnv();
  const pk = pathKey(env);
  let path = pathWithout(env[pk] ?? '', opts.node === false ? ['claude', 'node'] : ['claude']);
  if (opts.claude !== false) {
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(dir, 'fake-claude.json'), JSON.stringify({ version: '2.1.299', pluginVersion: 'dev', plugins: [], calls: [] }));
    if (isWin) writeFileSync(join(fakeBin, 'claude.cmd'), `@"${process.execPath}" "${FAKE_CLAUDE}" %*\r\n`);
    else {
      writeFileSync(join(fakeBin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`);
      chmodSync(join(fakeBin, 'claude'), 0o755);
    }
    path = fakeBin + delimiter + path;
  }
  // The stand-in claude runs on this Node.js by its full path, so a PATH without node still runs it.
  env[pk] = path;
  Object.assign(env, {
    CI: '1',
    NO_COLOR: '1',
    MODE_CODE_LANG: opts.lang ?? 'en',
    MODE_CODE_PACKAGE: opts.pkg,
    MODE_CODE_NODE_MIRROR: opts.mirror,
    MODE_CODE_HOME: join(dir, 'data'),
    CLAUDE_CONFIG_DIR: join(dir, 'claude'),
    FAKE_CLAUDE_STATE: join(dir, 'fake-claude.json'),
  });
  if (isWin) {
    env.USERPROFILE = home;
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.MODE_CODE_TEST_ENV_KEY = `Software\\ModeCodeTest\\${name}-${process.pid}\\Environment`;
  } else {
    env.HOME = home;
    env.SHELL = '/bin/zsh';
  }
  const programHome = isWin ? join(env.LOCALAPPDATA, 'mode-code') : join(home, '.local', 'share', 'mode-code');
  const bin = join(home, '.local', 'bin');
  const command = join(bin, isWin ? 'mode-code.cmd' : 'mode-code');
  return {
    dir,
    home,
    env,
    programHome,
    bin,
    command,
    rc: join(home, '.zshrc'),
    receipt: () => JSON.parse(readFileSync(join(programHome, 'install.json'), 'utf8')),
    claudeCalls: () => JSON.parse(readFileSync(join(dir, 'fake-claude.json'), 'utf8')).calls.map((c) => c.join(' ')),
    manifest: () => {
      try {
        return JSON.parse(readFileSync(join(dir, 'data', 'install', 'manifest.json'), 'utf8'));
      } catch {
        return null;
      }
    },
    /** The user PATH the installer wrote, in its own registry key (Windows). */
    userPath: () => {
      const r = run('reg', ['query', `HKCU\\${env.MODE_CODE_TEST_ENV_KEY}`, '/v', 'Path']);
      return r.code === 0 ? r.out : '';
    },
    cleanup: () => {
      if (isWin) run('reg', ['delete', `HKCU\\Software\\ModeCodeTest\\${name}-${process.pid}`, '/f']);
    },
  };
}

// PowerShell writes to a pipe in the console's code page; the cases read UTF-8.
const UTF8 = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ';

/** Runs the installer in one shell: as a file, or (PowerShell) pasted the way `irm | iex` runs it. */
function install(shell, w, flags = [], { pasted = false } = {}) {
  if (shell === 'sh' || shell === 'bash') return run(shell, [join(root, 'install.sh'), ...flags], { env: w.env, cwd: w.home });
  const exe = shell === 'powershell' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';
  const file = join(root, 'install.ps1').replace(/'/g, "''");
  const script = pasted
    ? // What `irm <address> | iex` does: the text, evaluated in the session; no options can be passed.
      `${UTF8}$t = [IO.File]::ReadAllText('${file}'); Invoke-Expression $t; exit $LASTEXITCODE`
    : `${UTF8}& ([scriptblock]::Create([IO.File]::ReadAllText('${file}'))) ${flags.join(' ')}; exit $LASTEXITCODE`;
  return run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { env: w.env, cwd: w.home });
}

/** Runs the `mode-code` command the installer wrote, as a shell would find it. */
function command(w, argv) {
  if (isWin)
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${w.command}" ${argv.join(' ')}`], {
      env: w.env,
      cwd: w.home,
      windowsVerbatimArguments: true,
    });
  return run('sh', [w.command, ...argv], { env: w.env, cwd: w.home });
}

/** Waits for a path to disappear (Windows removes a running program's folder after the program ends). */
function gone(path, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!existsSync(path)) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
  }
  return !existsSync(path);
}

// ── the cases ──

function caseFull(shell, pkg, mirror, version) {
  const w = world(`${shell}-full`, { pkg, mirror });
  try {
    const r = install(shell, w, isUnixShell(shell) ? ['--yes'] : ['-Yes']);
    check(r.code === 0, `the installer failed (exit ${r.code}):\n${r.out}`);
    const rec = w.receipt();
    check(rec.version === version && rec.privateNode === false, `the record says ${JSON.stringify({ version: rec.version, privateNode: rec.privateNode })}`);
    check(existsSync(w.command), `no command at ${w.command}`);
    const v = command(w, ['--version']);
    check(v.code === 0 && v.out.trim() === version, `the command printed ${JSON.stringify(v.out.trim())} (exit ${v.code})`);
    if (isWin) check(w.userPath().toLowerCase().includes(w.bin.toLowerCase()), `the user PATH does not hold ${w.bin}: ${w.userPath()}`);
    else check(readFileSync(w.rc, 'utf8').includes('# Added by the Mode_Code installer'), `${w.rc} has no PATH line`);
    const m = w.manifest();
    check(m && m.cli && placeKey(m.cli) === placeKey(rec.program), `the installation record names ${m?.cli}, not ${rec.program}`);
    check(
      w.claudeCalls().some((c) => c.startsWith('plugin install mode-code')),
      `the plugin was not installed: ${w.claudeCalls().join(' | ')}`,
    );

    // Again: an update. The PATH line is not added twice.
    const again = install(shell, w, isUnixShell(shell) ? ['--yes'] : ['-Yes']);
    check(again.code === 0, `the second run failed (exit ${again.code}):\n${again.out}`);
    if (!isWin) check(readFileSync(w.rc, 'utf8').split('# Added by the Mode_Code installer').length === 2, 'the PATH line was added twice');
    else check(w.userPath().toLowerCase().split(w.bin.toLowerCase()).length === 2, 'the PATH entry was added twice');

    // Removal, through the command: Claude Code's side, then the program, its command and its PATH entry.
    const u = command(w, ['uninstall', '--yes']);
    check(u.code === 0, `uninstall failed (exit ${u.code}):\n${u.out}`);
    check(
      gone(w.programHome),
      `the program folder is still there: ${w.programHome}
${u.out}`,
    );
    check(
      gone(w.command),
      `the command is still there: ${w.command}
${u.out}`,
    );
    if (isWin)
      check(
        !w.userPath().toLowerCase().includes(w.bin.toLowerCase()),
        `the user PATH still holds ${w.bin}
${u.out}`,
      );
    else check(!readFileSync(w.rc, 'utf8').includes('Mode_Code'), `${w.rc} still has the PATH line`);
    check(
      w.claudeCalls().some((c) => c.startsWith('plugin uninstall mode-code')),
      'the plugin was not removed',
    );
    check(existsSync(join(w.dir, 'data', 'config.json')), 'the settings were removed without --purge');
    return 'system Node.js, install, update, run, uninstall';
  } finally {
    w.cleanup();
  }
}

function casePrivateNode(shell, pkg, mirror) {
  // In Turkish: its messages carry paths, and a Windows path must come through them as it is.
  const w = world(`${shell}-node`, { pkg, mirror, node: false, lang: 'tr' });
  try {
    const r = install(shell, w, isUnixShell(shell) ? ['--yes'] : ['-Yes']);
    check(r.code === 0, `the installer failed (exit ${r.code}):\n${r.out}`);
    const rec = w.receipt();
    check(rec.privateNode === true, 'the record does not say Node.js was downloaded');
    check(r.out.includes(`Node.js ${NODE_VERSION}, sağlama toplamı doğrulandı, ${join(w.programHome, 'node')}`), `no checksum line:\n${r.out}`);
    const v = command(w, ['--version']);
    check(v.code === 0, `the command failed with the downloaded Node.js (exit ${v.code}): ${v.out}`);
    // The hooks run on that Node.js too.
    const m = w.manifest();
    check(m && placeKey(m.node).startsWith(placeKey(w.programHome)), `the hooks run on ${m?.node}`);
    // A second run keeps the Node.js it has when it is the newest.
    const again = install(shell, w, isUnixShell(shell) ? ['--yes'] : ['-Yes']);
    check(again.code === 0 && again.out.includes(`Node.js ${NODE_VERSION} (Mode_Code için tutulan)`), `the second run did not keep Node.js:\n${again.out}`);
    // Uninstall runs on the downloaded Node.js, which Windows can delete only after it ends.
    const u = command(w, ['uninstall', '--yes']);
    check(u.code === 0, `uninstall failed (exit ${u.code}):\n${u.out}`);
    check(
      gone(w.programHome),
      `the program folder is still there: ${w.programHome}: ${existsSync(w.programHome) ? readdirSync(w.programHome).join(', ') : ''}
${u.out}`,
    );
    return 'Node.js downloaded, checksum verified, kept on update, removed';
  } finally {
    w.cleanup();
  }
}

function caseRelease(shell, pkg, mirror, version) {
  // A release's files as GitHub serves them (scripts/release.mjs pack): the package under both names, SHA256SUMS.
  const rel = join(tmp, `${shell}-release-files`);
  mkdirSync(rel, { recursive: true });
  copyFileSync(pkg, join(rel, `mode-code-${version}.tgz`));
  copyFileSync(pkg, join(rel, 'mode-code.tgz'));
  const sums = () => `${sha256(join(rel, 'mode-code.tgz'))}  mode-code.tgz
${sha256(join(rel, `mode-code-${version}.tgz`))}  mode-code-${version}.tgz
`;
  writeFileSync(join(rel, 'SHA256SUMS'), sums());
  const w = world(`${shell}-release`, { pkg: '', mirror });
  delete w.env.MODE_CODE_PACKAGE;
  w.env.MODE_CODE_RELEASE_URL = rel;
  try {
    const flags = isUnixShell(shell) ? ['--no-setup'] : ['-NoSetup'];
    const r = install(shell, w, flags);
    check(
      r.code === 0 && r.out.includes(`Mode_Code ${version}, checksum verified`),
      `the newest release: exit ${r.code}:
${r.out}`,
    );
    check(w.receipt().sha256 === sha256(pkg), `the record holds ${w.receipt().sha256}`);
    const pinned = install(shell, w, isUnixShell(shell) ? ['--no-setup', '--version', version] : ['-NoSetup', '-Version', version]);
    check(
      pinned.code === 0 && w.receipt().source.endsWith(`mode-code-${version}.tgz`),
      `a pinned version: exit ${pinned.code}:
${pinned.out}`,
    );
    // A download that does not match its checksum is never installed, and the installed one stays.
    writeFileSync(
      join(rel, 'SHA256SUMS'),
      `${'0'.repeat(64)}  mode-code.tgz
`,
    );
    const before = w.receipt().installedAt;
    const tampered = install(shell, w, flags);
    check(
      tampered.code === 1 && tampered.out.includes('does not match the release checksum'),
      `a checksum that does not match: exit ${tampered.code}:
${tampered.out}`,
    );
    check(w.receipt().installedAt === before, 'a download that failed its checksum replaced the installation');
    // A release that lists no checksum for the file is refused too.
    writeFileSync(
      join(rel, 'SHA256SUMS'),
      `${'0'.repeat(64)}  other.tgz
`,
    );
    const unlisted = install(shell, w, flags);
    check(
      unlisted.code === 1 && unlisted.out.includes('lists no checksum'),
      `no checksum listed: exit ${unlisted.code}:
${unlisted.out}`,
    );
    return 'from a release: checksum verified, a pinned version, a wrong or missing checksum refused';
  } finally {
    w.cleanup();
  }
}

function caseNoClaude(shell, pkg, mirror) {
  const w = world(`${shell}-noclaude`, { pkg, mirror, claude: false });
  try {
    // Nobody to answer and no --yes: Claude Code is not installed for the person, the program is.
    const r = isUnixShell(shell) ? install(shell, w, []) : install(shell, w, [], { pasted: true });
    check(r.code === 1, `exit ${r.code}, not 1:\n${r.out}`);
    check(r.out.includes('which was not found on this computer'), `no word about Claude Code:\n${r.out}`);
    check(existsSync(w.command), 'the program was not installed');
    check(w.manifest() === null, 'Claude Code was changed without Claude Code');
    return `no Claude Code: program only, says so, exit 1${isUnixShell(shell) ? '' : ' (pasted)'}`;
  } finally {
    w.cleanup();
  }
}

function caseNoSetupAndRefusals(shell, pkg, mirror) {
  const w = world(`${shell}-nosetup`, { pkg, mirror });
  try {
    const flags = isUnixShell(shell) ? ['--no-setup', '--no-modify-path'] : ['-NoSetup', '-NoModifyPath'];
    const r = install(shell, w, flags);
    check(r.code === 0 && r.out.includes('Next: mode-code install'), `--no-setup: exit ${r.code}:\n${r.out}`);
    check(w.manifest() === null, '--no-setup changed Claude Code');
    if (isWin)
      check(
        w.userPath() === '',
        `-NoModifyPath changed the PATH: ${w.userPath()}
${r.out}`,
      );
    else check(!existsSync(w.rc), '--no-modify-path wrote a startup file');
    check(w.receipt().path === null, 'the record names a PATH entry that was not made');

    // A command file the installer did not write is never replaced.
    writeFileSync(w.command, isWin ? '@echo someone else\r\n' : '#!/bin/sh\necho someone else\n');
    const foreign = install(shell, w, flags);
    check(foreign.code === 1 && foreign.out.includes('was not written by this installer'), `a foreign command: exit ${foreign.code}:\n${foreign.out}`);
    check(readFileSync(w.command, 'utf8').includes('someone else'), 'the foreign command was replaced');

    // Inside a Claude Code session it refuses before anything happens.
    const inside = { ...w, env: { ...w.env, CLAUDECODE: '1' } };
    rmSync(w.programHome, { recursive: true, force: true });
    const refused = install(shell, inside, flags);
    check(refused.code === 1 && refused.out.includes('not inside a Claude Code session'), `inside a session: exit ${refused.code}:\n${refused.out}`);
    check(!existsSync(w.programHome), 'it installed inside a Claude Code session');

    // A package that is not this program's is refused.
    const bogus = join(w.dir, 'bogus.tgz');
    mkdirSync(join(w.dir, 'bogus', 'package'), { recursive: true });
    writeFileSync(join(w.dir, 'bogus', 'package', 'package.json'), '{"name":"other","version":"1.0.0"}');
    run(TAR, ['-czf', bogus, '-C', join(w.dir, 'bogus'), 'package'], { cwd: w.dir });
    const wrong = install(shell, { ...w, env: { ...w.env, MODE_CODE_PACKAGE: bogus } }, flags);
    check(wrong.code === 1 && wrong.out.includes('not a Mode_Code package'), `another package: exit ${wrong.code}:\n${wrong.out}`);
    return '--no-setup, --no-modify-path, a foreign command kept, refused in a session, another package refused';
  } finally {
    w.cleanup();
  }
}

// ── run ──

function available(shell) {
  if (isWin && (shell === 'sh' || shell === 'bash')) return false;
  if (!isWin && (shell === 'powershell' || shell === 'pwsh')) return false;
  const probe = shell === 'powershell' || shell === 'pwsh' ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'];
  const exe = shell === 'powershell' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : shell;
  return run(exe, probe, { env: baseEnv() }).code === 0;
}

let code = 0;
try {
  const pkg = makePackage();
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const mirror = makeMirror();
  const shells = (wantedShells.length ? wantedShells : isWin ? ['powershell', 'pwsh'] : ['sh', 'bash']).filter(available);
  check(shells.length > 0, 'no shell to run the installer in');
  for (const shell of shells) {
    for (const [name, fn] of [
      ['full', () => caseFull(shell, pkg, mirror, version)],
      ['node', () => casePrivateNode(shell, pkg, mirror)],
      ['no claude', () => caseNoClaude(shell, pkg, mirror)],
      ['options', () => caseNoSetupAndRefusals(shell, pkg, mirror)],
      ['release', () => caseRelease(shell, pkg, mirror, version)],
    ]) {
      const started = Date.now();
      try {
        const what = fn();
        results.push(`  ✓ ${shell} · ${what} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      } catch (err) {
        if (!(err instanceof Failure)) throw err;
        code = 1;
        results.push(`  ✗ ${shell} · ${name}: ${err.message}`);
      }
    }
  }
} catch (err) {
  if (!(err instanceof Failure)) throw err;
  results.push(`  ✗ ${err.message}`);
  code = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  // The registry key the cases' keys lived under, once no run is using it.
  if (isWin) {
    const left = run('reg', ['query', 'HKCU\\Software\\ModeCodeTest']);
    if (left.code === 0 && !/ModeCodeTest\\./i.test(left.out)) run('reg', ['delete', 'HKCU\\Software\\ModeCodeTest', '/f']);
  }
}
console.log(`test-installer: ${results.filter((r) => r.includes('✓')).length} passed, ${results.filter((r) => r.includes('✗')).length} failed`);
console.log(results.join('\n'));
process.exit(code);

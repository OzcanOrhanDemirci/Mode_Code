// SPDX-License-Identifier: Apache-2.0
/**
 * Opening the control center beside a session: which terminal is asked, with exactly which arguments, and
 * where nothing is opened because the person would not see it. The quoting is checked against the real
 * decoders where they exist (Node's own base64, a POSIX shell).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  asQuote,
  centerProgram,
  commandLine,
  encodedCommand,
  LAUNCH_ENV,
  OPENS,
  psQuote,
  shQuote,
  terminalLaunch,
  windowsAppsDir,
  windowsTerminalProgram,
  type LaunchInput,
} from '../../src/core/launch.js';

const NODE_W = 'C:/Program Files/nodejs/node.exe';
const CLI_W = 'C:/dev/mode-code/dist/cli.mjs';
const NODE_P = '/usr/local/bin/node';
const CLI_P = '/home/ada/dev/mode-code/dist/cli.mjs';

const win = (env: LaunchInput['env'] = {}, over: Partial<LaunchInput> = {}): LaunchInput => ({
  platform: 'win32',
  env,
  program: [NODE_W, CLI_W],
  cwd: 'C:/Users/ada',
  title: 'mode-code',
  ...over,
});
const posix = (platform: 'linux' | 'darwin', env: LaunchInput['env'] = {}, over: Partial<LaunchInput> = {}): LaunchInput => ({
  platform,
  env,
  program: [NODE_P, CLI_P],
  cwd: '/home/ada/dev/app',
  title: 'mode-code',
  ...over,
});
const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');

test('Windows Terminal: a new tab in the window the session runs in, the folder and the program as they are', () => {
  assert.deepEqual(terminalLaunch(win({ WT_SESSION: 'f7502808-2eec' })), {
    via: 'windows-terminal',
    argv: ['wt.exe', '-w', '0', 'new-tab', '--title', 'mode-code', '-d', 'C:/Users/ada', NODE_W, CLI_W],
  });
  // A ";" would start Windows Terminal's next command: it goes escaped, in every argument it reads.
  const odd = terminalLaunch(win({ WT_SESSION: 'x' }, { cwd: 'C:/a;b', title: 't;1', program: ['C:/n;ode.exe', 'C:/c;li.mjs'] }))!;
  assert.deepEqual(odd.argv.slice(4), ['--title', 't\\;1', '-d', 'C:/a\\;b', 'C:/n\\;ode.exe', 'C:/c\\;li.mjs']);
  // Backslashes stay as they are: Windows Terminal drops only the one right before a ";".
  const slashed = terminalLaunch(win({ WT_SESSION: 'x' }, { cwd: 'C:\\x\\;y' }))!;
  assert.deepEqual(slashed.argv.slice(6, 8), ['-d', 'C:\\x\\\\;y']);
  assert.equal(OPENS['windows-terminal'], 'tab');
  // The program the plugin found goes first, as it is.
  const alias = 'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
  assert.deepEqual(terminalLaunch(win({ WT_SESSION: 'x' }, { wt: alias }))!.argv.slice(0, 4), [alias, '-w', '0', 'new-tab']);
  // Outside Windows Terminal it is not asked for.
  assert.equal(terminalLaunch(win({}, { wt: alias }))!.argv[0], 'powershell.exe');
});

test("Windows Terminal's program: its alias by the full path when the alias folder holds it as a link, wt.exe otherwise", () => {
  const dir = windowsAppsDir('C:\\Users\\ada\\AppData\\Local');
  assert.equal(dir, 'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps');
  const entries = [
    { name: 'winget.exe', isLink: true },
    { name: 'wt.exe', isLink: true },
  ];
  assert.equal(windowsTerminalProgram(dir, entries), 'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe');
  // Windows names are case-blind.
  assert.equal(windowsTerminalProgram(dir, [{ name: 'WT.EXE', isLink: true }]), `${dir}\\wt.exe`);
  // A program copied there is not an alias; no alias, no folder, no list: the name, for Claude Code to look up.
  assert.equal(windowsTerminalProgram(dir, [{ name: 'wt.exe', isLink: false }]), 'wt.exe');
  assert.equal(windowsTerminalProgram(dir, [{ name: 'winget.exe', isLink: true }]), 'wt.exe');
  assert.equal(windowsTerminalProgram(dir, [{ name: 'wt.exe.lnk', isLink: true }]), 'wt.exe');
  assert.equal(windowsTerminalProgram(dir, []), 'wt.exe');
  assert.equal(windowsTerminalProgram(null, entries), 'wt.exe');
});

test('the alias folder: under the variable, in the separators it is written in, never with a doubled one', () => {
  assert.equal(windowsAppsDir('C:\\Users\\ada\\AppData\\Local\\'), 'C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps');
  assert.equal(windowsAppsDir('C:/Users/ada/AppData/Local'), 'C:/Users/ada/AppData/Local/Microsoft/WindowsApps');
  assert.equal(windowsAppsDir('C:/Users/ada/AppData/Local//'), 'C:/Users/ada/AppData/Local/Microsoft/WindowsApps');
  assert.equal(windowsAppsDir('D:\\Profiles/ada\\Local'), 'D:\\Profiles/ada\\Local\\Microsoft\\WindowsApps');
  assert.equal(windowsAppsDir('L'), 'L\\Microsoft\\WindowsApps');
  assert.equal(windowsAppsDir(''), null);
  assert.equal(windowsAppsDir(undefined), null);
  assert.equal(windowsTerminalProgram('C:/A/Microsoft/WindowsApps', [{ name: 'wt.exe', isLink: true }]), 'C:/A/Microsoft/WindowsApps/wt.exe');
  assert.equal(windowsTerminalProgram('W', [{ name: 'wt.exe', isLink: true }]), 'W\\wt.exe');
});

test('any other Windows console: PowerShell starts the program in a window of its own, from an encoded command', () => {
  const l = terminalLaunch(win())!;
  assert.equal(l.via, 'windows-console');
  assert.deepEqual(l.argv.slice(0, 5), ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(l.argv.length, 6);
  assert.equal(
    decode(l.argv[5]!),
    `Start-Process -FilePath 'C:/Program Files/nodejs/node.exe' -ArgumentList '"C:/dev/mode-code/dist/cli.mjs"' -WorkingDirectory 'C:/Users/ada'`,
  );
  // A quote in a path is doubled inside PowerShell's single quotes; a program alone has no argument list.
  const q = terminalLaunch(win({}, { program: ["C:/O'Neil/node.exe"], cwd: "C:/it's here" }))!;
  assert.equal(decode(q.argv[5]!), `Start-Process -FilePath 'C:/O''Neil/node.exe' -WorkingDirectory 'C:/it''s here'`);
  const two = terminalLaunch(win({}, { program: [NODE_W, CLI_W, 'tokens'] }))!;
  assert.match(decode(two.argv[5]!), / -ArgumentList '"C:\/dev\/mode-code\/dist\/cli\.mjs"','"tokens"' /);
  assert.equal(OPENS['windows-console'], 'window');
  // tmux variables mean nothing to a Windows program.
  assert.equal(terminalLaunch(win({ TMUX: '/tmp/tmux-1000/default,1,0' }))!.via, 'windows-console');
});

test('the encoded command is exactly the base64 of UTF-16LE, at every padding length and outside the BMP', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'Start-Process', 'ğüşİıöç', 'C:/Kullanıcılar/Özcan', '😀 x', '\u0000\uffff']) {
    assert.equal(encodedCommand(s), Buffer.from(s, 'utf16le').toString('base64'), JSON.stringify(s));
    assert.equal(decode(encodedCommand(s)), s);
  }
});

test('tmux: a new window of the same tmux on macOS and Linux, over SSH too; the line goes to the folder and becomes the program', () => {
  const env = { TMUX: '/tmp/tmux-1000/default,4242,0', SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' };
  for (const platform of ['linux', 'darwin'] as const)
    assert.deepEqual(terminalLaunch(posix(platform, env)), {
      via: 'tmux',
      argv: ['tmux', 'new-window', '-n', 'mode-code', '-c', '/home/ada/dev/app', `cd '/home/ada/dev/app' && exec '${NODE_P}' '${CLI_P}'`],
    });
  assert.equal(OPENS.tmux, 'tab');
});

test('over SSH, inside WSL and with no display nothing opens; an empty program never does', () => {
  for (const v of ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'] as const) {
    assert.equal(terminalLaunch(posix('darwin', { [v]: 'x', TERM_PROGRAM: 'iTerm.app' })), null, v);
    assert.equal(terminalLaunch(posix('linux', { [v]: 'x', DISPLAY: ':0', GNOME_TERMINAL_SCREEN: 'x' })), null, v);
  }
  assert.equal(terminalLaunch(posix('linux', { WSL_DISTRO_NAME: 'Ubuntu', WT_SESSION: 'x', DISPLAY: ':0', GNOME_TERMINAL_SCREEN: 'x' })), null);
  assert.equal(terminalLaunch(posix('linux', { KONSOLE_VERSION: '230800' })), null);
  assert.equal(terminalLaunch(posix('linux', { DISPLAY: ':0' })), null);
  assert.equal(terminalLaunch(posix('linux', { DISPLAY: '', KONSOLE_VERSION: '1' })), null);
  assert.equal(terminalLaunch(win({ WT_SESSION: 'x' }, { program: [] })), null);
  assert.equal(terminalLaunch(posix('linux', { TMUX: 'x' }, { program: [] })), null);
});

test('macOS: iTerm2 gets a tab of its current window (a window when it has none), any other terminal a Terminal window', () => {
  // The typed line is cleared from the screen before the program starts: the shell would show it twice.
  const line = `"clear && cd '/home/ada/dev/app' && exec '${NODE_P}' '${CLI_P}'"`;
  const iterm = terminalLaunch(posix('darwin', { TERM_PROGRAM: 'iTerm.app' }))!;
  assert.equal(iterm.via, 'iterm');
  assert.equal(iterm.argv[0], 'osascript');
  const script = iterm.argv.filter((_, i) => i % 2 === 0 && i > 0);
  assert.deepEqual(
    iterm.argv.filter((_, i) => i % 2 === 1),
    Array(script.length).fill('-e'),
  );
  assert.deepEqual(script, [
    'tell application "iTerm"',
    'activate',
    'if (count of windows) = 0 then',
    'create window with default profile',
    'else',
    'tell current window to create tab with default profile',
    'end if',
    `tell current session of current window to write text ${line}`,
    'end tell',
  ]);
  for (const env of [{ TERM_PROGRAM: 'Apple_Terminal' }, { TERM_PROGRAM: 'ghostty' }, {}])
    assert.deepEqual(terminalLaunch(posix('darwin', env)), {
      via: 'mac-terminal',
      argv: ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${line}`, '-e', 'end tell'],
    });
  assert.equal(OPENS.iterm, 'tab');
  assert.equal(OPENS['mac-terminal'], 'window');
});

test('Linux: WezTerm, Konsole and GNOME Terminal each open a tab their own way', () => {
  assert.deepEqual(terminalLaunch(posix('linux', { WEZTERM_PANE: '3' })), {
    via: 'wezterm',
    argv: ['wezterm', 'cli', 'spawn', '--cwd', '/home/ada/dev/app', '--', NODE_P, CLI_P],
  });
  assert.deepEqual(terminalLaunch(posix('linux', { WAYLAND_DISPLAY: 'wayland-0', KONSOLE_VERSION: '230800' })), {
    via: 'konsole',
    argv: ['konsole', '--new-tab', '--workdir', '/home/ada/dev/app', '-e', NODE_P, CLI_P],
  });
  for (const env of [
    { DISPLAY: ':0', GNOME_TERMINAL_SCREEN: '/org/gnome/Terminal/screen/1' },
    { DISPLAY: ':1', GNOME_TERMINAL_SERVICE: ':1.99' },
  ])
    assert.deepEqual(terminalLaunch(posix('linux', env)), {
      via: 'gnome-terminal',
      argv: ['gnome-terminal', '--tab', '--working-directory=/home/ada/dev/app', '--', NODE_P, CLI_P],
    });
  for (const via of ['wezterm', 'konsole', 'gnome-terminal'] as const) assert.equal(OPENS[via], 'tab');
});

test('every variable the choice reads is in the list the plugin asks the session for', () => {
  const read = ['WT_SESSION', 'TMUX', 'TERM_PROGRAM', 'WEZTERM_PANE', 'KONSOLE_VERSION', 'GNOME_TERMINAL_SCREEN', 'GNOME_TERMINAL_SERVICE'];
  for (const v of [...read, 'DISPLAY', 'WAYLAND_DISPLAY', 'SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY', 'WSL_DISTRO_NAME'])
    assert.ok((LAUNCH_ENV as readonly string[]).includes(v), v);
  assert.equal(new Set(LAUNCH_ENV).size, LAUNCH_ENV.length);
});

test('the quoting: POSIX single quotes, AppleScript strings, PowerShell literals', () => {
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.equal(shQuote(''), `''`);
  assert.equal(asQuote('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  assert.equal(psQuote("a'b''c"), `'a''b''''c'`);
});

const sh = spawnSync('sh', ['-c', 'exit 0']).status === 0;
test('a POSIX shell reads every quoted word back exactly', { skip: !sh && 'no POSIX shell here' }, () => {
  const words = ["it's", 'two  spaces', '$HOME', '`id`', '"q"', 'back\\slash', 'ü 😀', '*', ''];
  const r = spawnSync('sh', ['-c', `printf '%s\\n' ${words.map(shQuote).join(' ')}`], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.split('\n').slice(0, -1), words);
});

test('the program the installation recorded, and the line to type it by hand', () => {
  assert.deepEqual(centerProgram(JSON.stringify({ node: NODE_W, cli: CLI_W, v: 1 })), [NODE_W, CLI_W]);
  for (const text of [
    null,
    '',
    'not json',
    'null',
    '[]',
    JSON.stringify({ node: NODE_W }),
    JSON.stringify({ node: NODE_W, cli: '' }),
    JSON.stringify({ node: 1, cli: CLI_W }),
  ])
    assert.equal(centerProgram(text), null, String(text));
  assert.equal(commandLine([NODE_W, CLI_W], 'win32'), `& "${NODE_W}" "${CLI_W}"`);
  assert.equal(commandLine([NODE_P, "/home/o'neil/cli.mjs"], 'linux'), `'${NODE_P}' '/home/o'\\''neil/cli.mjs'`);
});

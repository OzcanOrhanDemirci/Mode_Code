// SPDX-License-Identifier: Apache-2.0
/**
 * Closing a session from its controls (`/00`, `00` on the strip): the difference between a shut-down and the
 * power button. The plugin (src/mod/register.ts) first runs the steps the session's end would run under
 * Claude Code's short clock (the handoff note, the sync), then has Claude Code exit as `/exit` does, so its
 * own end hooks run too and nothing is cut halfway.
 *
 * On Windows the terminal tab goes with it. The shell Claude Code was started from is left once Claude Code
 * has ended, and it holds the tab open; killing it would leave the tab on "[process exited with code 1]". So
 * a helper, started before the exit, waits for Claude Code to end and then types `exit` into that shell: the
 * shell ends as if the person had typed it, and the terminal closes the tab as it does for any shell that
 * ends normally (Windows Terminal's `closeOnExit`, "graceful" for what it starts itself). Measured by hand
 * with Claude Code 2.1.299 on Windows 11: the helper, started by `Start-Process`, is outside the job object
 * Claude Code puts its own children in, so it outlives Claude Code.
 *
 * Pure: the scripts and the program to run them by. The helper types only into a shell it recognises, that
 * is Claude Code's own parent and shares its console; a Claude Code started straight by the terminal, by a
 * program, or in a console of its own is left alone, and so is any shell when Claude Code does not end.
 */
import { encodedCommand } from './launch.js';

/** The shells the helper types `exit` into: Claude Code's parent must be one of them. */
export const CLOSE_SHELLS = ['pwsh.exe', 'powershell.exe', 'cmd.exe', 'bash.exe', 'sh.exe', 'zsh.exe', 'fish.exe', 'nu.exe'] as const;

/** How long the helper waits for Claude Code to end before it gives up and touches nothing, in seconds. */
export const CLOSE_WAIT_S = 60;

/** Windows PowerShell by its full path: always there, and found without a lookup by name. */
const POWERSHELL = '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/**
 * The helper, as it runs on its own once started: `__CLAUDE__` and `__SHELL__` stand for the two processes.
 * The typing is compiled before the wait, so the shell gets its `exit` the moment Claude Code is gone, and the
 * helper leaves the console at once after it, as a process still attached would keep the tab open.
 */
export function helperScript(): string {
  return [
    `Add-Type -TypeDefinition @'`,
    'using System; using System.Runtime.InteropServices;',
    'public static class TcType {',
    '  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]',
    '  public struct Rec { [FieldOffset(0)] public short Type; [FieldOffset(4)] public int Down; [FieldOffset(8)] public short Repeat;',
    '    [FieldOffset(10)] public short Vk; [FieldOffset(12)] public short Scan; [FieldOffset(14)] public char Ch; [FieldOffset(16)] public int State; }',
    '  [DllImport("kernel32.dll")] static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);',
    '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr p, uint d, uint f, IntPtr t);',
    '  [DllImport("kernel32.dll")] static extern bool WriteConsoleInputW(IntPtr h, Rec[] b, uint n, out uint w);',
    '  [DllImport("user32.dll")] static extern short VkKeyScanW(char c);',
    '  [DllImport("user32.dll")] static extern uint MapVirtualKeyW(uint c, uint t);',
    '  public static bool Type(uint pid, string text) {',
    '    FreeConsole();',
    '    if (!AttachConsole(pid)) return false;',
    '    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);',
    '    bool ok = false;',
    '    if (h != new IntPtr(-1)) {',
    '      string keys = text + "\\r"; Rec[] recs = new Rec[keys.Length * 2];',
    '      for (int i = 0; i < keys.Length; i++) {',
    "        char ch = keys[i]; short vk = ch == '\\r' ? (short)0x0D : (short)(VkKeyScanW(ch) & 0xFF);",
    '        for (int d = 0; d < 2; d++) { Rec r = new Rec(); r.Type = 1; r.Down = 1 - d; r.Repeat = 1; r.Vk = vk;',
    '          r.Scan = (short)MapVirtualKeyW((uint)vk, 0); r.Ch = ch; recs[i * 2 + d] = r; } }',
    '      uint w; ok = WriteConsoleInputW(h, recs, (uint)recs.Length, out w);',
    '    }',
    '    FreeConsole();',
    '    return ok;',
    '  }',
    '}',
    `'@`,
    '$claude = __CLAUDE__; $shell = __SHELL__',
    `$until = [DateTime]::UtcNow.AddSeconds(${CLOSE_WAIT_S})`,
    'while ((Get-Process -Id $claude -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 200 }',
    'if (Get-Process -Id $claude -ErrorAction SilentlyContinue) { exit }',
    'if (-not (Get-Process -Id $shell -ErrorAction SilentlyContinue)) { exit }',
    "[void][TcType]::Type([uint32]$shell, 'exit')",
  ].join('\n');
}

/**
 * The starter, run by the plugin as a child of Claude Code: it finds Claude Code (its parent) and the shell
 * (Claude Code's parent), checks the shell, then starts the helper hidden and says one line: `armed <shell>`,
 * `none <why>` (the shell's name, `console` when Claude Code has a console of its own, `gone`), or `failed`.
 */
export function starterScript(): string {
  const shells = CLOSE_SHELLS.map((s) => `'${s}'`).join(',');
  return [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    '  $me = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"',
    '  $claude = Get-CimInstance Win32_Process -Filter "ProcessId=$($me.ParentProcessId)"',
    '  $shell = Get-CimInstance Win32_Process -Filter "ProcessId=$($claude.ParentProcessId)"',
    `  if (-not $claude -or -not $shell) { 'none gone'; exit 0 }`,
    '  $name = $shell.Name.ToLowerInvariant()',
    `  if (@(${shells}) -notcontains $name) { "none $name"; exit 0 }`,
    `  Add-Type -TypeDefinition @'`,
    'using System; using System.Runtime.InteropServices;',
    'public static class TcConsole {',
    '  [DllImport("kernel32.dll")] static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);',
    '  [DllImport("kernel32.dll")] static extern uint GetConsoleProcessList(uint[] list, uint count);',
    '  public static bool Shares(uint a, uint b) {',
    '    FreeConsole();',
    '    if (!AttachConsole(a)) return false;',
    '    uint[] list = new uint[64]; uint n = GetConsoleProcessList(list, 64);',
    '    FreeConsole();',
    '    for (uint i = 0; i < n && i < 64; i++) if (list[i] == b) return true;',
    '    return false;',
    '  }',
    '}',
    `'@`,
    `  if (-not [TcConsole]::Shares([uint32]$claude.ProcessId, [uint32]$shell.ProcessId)) { 'none console'; exit 0 }`,
    `  $helper = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedCommand(helperScript())}'))`,
    `  $helper = $helper.Replace('__CLAUDE__', [string]$claude.ProcessId).Replace('__SHELL__', [string]$shell.ProcessId)`,
    `  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))`,
    `  Start-Process -WindowStyle Hidden -FilePath "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded`,
    '  "armed $name"',
    `} catch { 'failed' }`,
  ].join('\n');
}

/** The program that starts the helper, run without a shell: Windows PowerShell with the starter, encoded. */
export function closeTabArgv(systemRoot: string | undefined): string[] {
  const program = systemRoot ? POWERSHELL.replace('%SystemRoot%', systemRoot.replace(/[\\/]+$/, '')) : 'powershell.exe';
  return [program, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(starterScript())];
}

export type CloseTab = 'armed' | 'none' | 'failed';

/** What the starter said: its last line's first word; anything else is a failure. */
export function closeTabOutcome(stdout: string): { tab: CloseTab; detail: string } {
  const line = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
  const m = /^(armed|none|failed)(?:\s+(\S.*))?$/.exec(line);
  return m ? { tab: m[1] as CloseTab, detail: m[2] ?? '' } : { tab: 'failed', detail: line.slice(0, 80) };
}

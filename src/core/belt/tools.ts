// SPDX-License-Identifier: Apache-2.0
/**
 * The Claude Code tools the belt reads, by what they do: the one list the mod, the hook program, its
 * matcher, the doctor, replay and the footer all take theirs from. A tool that runs commands or writes
 * files and is missing here goes unchecked; the doctor reports any such tool it finds in the transcripts.
 */

/** Tools that run a shell command, and the shell that reads it. Monitor runs its script in the Bash tool's shell. */
const SHELL_TOOLS: Readonly<Record<string, 'bash' | 'powershell'>> = { Bash: 'bash', PowerShell: 'powershell', Monitor: 'bash' };

/** Tools that write a file at a path. */
export const FILE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/** Every tool the belt checks. */
export const BELT_TOOLS: readonly string[] = [...Object.keys(SHELL_TOOLS), ...FILE_TOOLS];

/** The settings hook matcher for the belt: exactly the tools it checks. */
export const BELT_MATCHER = BELT_TOOLS.join('|');

/** The shell a tool's `command` is written for, or null for a tool that runs no command. */
export function shellOf(tool: string): 'bash' | 'powershell' | null {
  return Object.hasOwn(SHELL_TOOLS, tool) ? SHELL_TOOLS[tool]! : null;
}

export function isFileTool(tool: string): boolean {
  return FILE_TOOLS.includes(tool);
}

export function isBeltTool(tool: string): boolean {
  return BELT_TOOLS.includes(tool);
}

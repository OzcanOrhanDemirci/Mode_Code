// SPDX-License-Identifier: Apache-2.0
/**
 * The Claude Code tools the belt reads, by what they do: the one list the mod, the hook program, its
 * matcher, the doctor, replay and the footer all take theirs from. A tool that runs commands or writes
 * files and is missing here goes unchecked; the doctor reports any such tool it finds in the transcripts.
 */

import { PLUGIN_NAME } from '../app.js';

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

/**
 * The tools this plugin registers itself (`$.tool.register`, src/mod/register.ts), each by its name under the plugin's
 * server (`mcp__<plugin>__<name>`). Exactly these are Mode_Code's own, and only these are left alone as such (not judged
 * as a connected service's, not a source of outside content, not refused in a restricted mode). A tool added there
 * is added here: test/core/own-tools.test.ts reads the source and fails on any difference.
 */
export const OWN_TOOLS: readonly string[] = ['flow_step', 'catalog', 'why', 'handoff', 'request'];

/**
 * Whether a tool is one of this plugin's own, by its exact name. The server's name alone is no proof: any MCP server
 * can be named like this plugin, and the tools it carries are a connected service's like any other.
 */
export function isOwnTool(tool: string): boolean {
  return OWN_TOOLS.some((name) => tool === `mcp__${PLUGIN_NAME}__${name}`);
}

/**
 * Tools of connected services (MCP servers: mail, calendars, drives …), not this tool's own. The plugin
 * checks what they send, share and delete; the safety-net hook stays on commands and file writes, so a
 * service call does not start a program each time.
 */
export function isOutwardTool(tool: string): boolean {
  return tool.startsWith('mcp__') && !isOwnTool(tool);
}

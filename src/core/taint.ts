// SPDX-License-Identifier: Apache-2.0
/**
 * Outside content in a session (A3-2 of 1.2.0: prompt injection's "lethal trifecta"). Once the model has read
 * what someone else wrote (a web page, a search, an issue, a connected service's data, a dependency's files,
 * another session's message), that text may carry instructions. What would let it act on them is then asked:
 * sending data out of the machine, writing what starts by itself or changes Claude Code's configuration, and
 * writing to the memory. Pure: the plugin keeps the session's state and asks (src/mod/register.ts).
 */
import { analyzeCommand } from './shell/analyze.js';
import { OUTWARD_MCP } from './footer.js';
import { APP_ID, PLUGIN_NAME } from './app.js';
import { packOfTool } from './packs.js';
import { isFileTool, shellOf } from './belt/tools.js';
import { isUnder, pathKey, resolvePath, type PathEnv } from './paths.js';

/** Programs whose output is what a remote server sent. */
const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'http', 'https', 'xh']);
/** gh subcommands that print what other people wrote: issues, pull requests, discussions, releases, the API. */
const GH_READS = /^(?:issue|pr|discussion|release|gist|api|search|run)$/;
/** Folders that hold other people's code: a package's files can say anything. */
const DEPENDENCY = /\/(?:node_modules|vendor|site-packages|\.pub-cache|Pods|\.venv|bower_components)\//i;

/**
 * The outside source a call reads, when it reads one: what taints the session from now on. Null for the
 * session's own work (its files, its commands' output).
 */
export function taintSource(tool: string, input: Readonly<Record<string, unknown>>): string | null {
  if (tool === 'WebFetch' || tool === 'WebSearch') return tool;
  // A pack's server that works on the project itself (the Dart SDK's) reads no one else's text (core/packs.ts).
  if (tool.startsWith('mcp__') && !tool.startsWith(`mcp__${PLUGIN_NAME}__`)) return packOfTool(tool)?.outside === false ? null : tool;
  if (tool === 'Read' && DEPENDENCY.test(String(input.file_path ?? '').replace(/\\/g, '/'))) return 'Read (a dependency)';
  const dialect = shellOf(tool);
  if (!dialect) return null;
  for (const inv of analyzeCommand(String(input.command ?? ''), dialect).invocations) {
    if (FETCHERS.has(inv.program)) return inv.program;
    if (inv.program === 'gh' && GH_READS.test(inv.args[0] ?? '')) return `gh ${inv.args[0]}`;
  }
  return null;
}

/**
 * Characters a reader does not see and a model reads: Unicode tags (U+E0000 to U+E007F, which spell ASCII invisibly),
 * bidirectional overrides, and zero-width spaces and joiners other than the one emoji are built with (U+200D).
 */
const INVISIBLE = /[\u200B\u200C\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFEFF\u180E]|[\u{E0000}-\u{E007F}]/gu;

/** Outside content without its invisible characters, and how many there were. */
export function withoutInvisible(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(INVISIBLE, () => {
    removed++;
    return '';
  });
  return { text: out, removed };
}

/** What a call would do that outside content must not steer without the person: send, persist, or write the memory. */
export type TaintedAct = 'send' | 'persist' | 'memory';

const SEND_FLAGS = /^(?:-d|--data(?:-\w+)?|-F|--form(?:-string)?|-T|--upload-file|--json|--post-data|--post-file|--body-data|--body-file|-body|-infile)$/i;
const SEND_METHOD = /^(?:post|put|patch|delete)$/i;
/** A method as a flag and its value (`-X POST`), or joined to it (`-XPOST`, `--request=PUT`, `-Method:Post`). */
const METHOD_FLAG = /^(?:-X|--request|-method)$/i;
const METHOD_JOINED = /^(?:-X|--request=|-method:)(\w+)$/i;
/** httpie and xh: the method is a word of its own (`http POST url`), and `name=value`, `name:=json`, `name@file` are a body. */
const HTTPIE = new Set(['http', 'https', 'xh']);
const HTTPIE_ITEM = /^\w[\w.-]*(?::=|=(?!=)|@)/;
const SENDERS = new Set(['nc', 'ncat', 'netcat', 'socat', 'telnet', 'ftp', 'sftp', 'scp', 'rsync']);
const PERSIST_FILE =
  /(?:^|\/)(?:\.claude\/(?:settings(?:\.local)?\.json|hooks\/)|\.mcp\.json$|crontab$|\.bashrc$|\.zshrc$|\.profile$|\.bash_profile$|Microsoft\.PowerShell_profile\.ps1$|\.git\/hooks\/)/i;

/** `host:path` or `user@host:path`: a place on another machine (a drive letter is not a host). */
function remote(arg: string): boolean {
  const c = arg.indexOf(':');
  if (c === -1 || arg.startsWith('-')) return false;
  const host = arg.slice(0, c);
  return host.length > 1 && !/[/\\]/.test(host);
}

function sends(program: string, args: readonly string[]): boolean {
  if (SENDERS.has(program)) return program === 'rsync' || program === 'scp' ? args.some(remote) : true;
  if (FETCHERS.has(program)) {
    if (args.some((a) => SEND_FLAGS.test(a.split('=')[0]!))) return true;
    if (HTTPIE.has(program) && args.some((a) => SEND_METHOD.test(a) || HTTPIE_ITEM.test(a))) return true;
    return args.some((a, i) => SEND_METHOD.test(METHOD_FLAG.test(a) ? (args[i + 1] ?? '') : (METHOD_JOINED.exec(a)?.[1] ?? '')));
  }
  if (program === 'gh') {
    const [sub, verb] = args;
    if (sub === 'api') return args.some((a) => /^(?:-f|-F|--field|--raw-field|--input)$/.test(a) || /^(?:-X|--method)$/.test(a));
    return /^(?:issue|pr|discussion|gist|release)$/.test(sub ?? '') && /^(?:create|comment|edit|review|upload)$/.test(verb ?? '');
  }
  return false;
}

/**
 * What a call does that a tainted session asks about, or null. Shell commands that send data (a request body, an
 * upload, a raw socket, a copy to another host, a comment through gh), outward tools of connected services, files
 * that start by themselves or configure Claude Code, and the memory.
 */
export function taintedAct(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  env: PathEnv & { memoryDirs: readonly string[] },
): { act: TaintedAct; what: string } | null {
  const inMemory = (p: string) => env.memoryDirs.some((m) => isUnder(p, m, env.platform) || pathKey(p, env.platform) === pathKey(m, env.platform));
  if (isFileTool(tool)) {
    const raw = String(input.file_path ?? input.notebook_path ?? '');
    if (!raw) return null;
    const path = resolvePath(raw, env);
    if (inMemory(path)) return { act: 'memory', what: raw };
    if (PERSIST_FILE.test(path)) return { act: 'persist', what: raw };
    return null;
  }
  if (tool.startsWith('mcp__') && !tool.startsWith(`mcp__${PLUGIN_NAME}__`)) return OUTWARD_MCP.test(tool) ? { act: 'send', what: tool } : null;
  const dialect = shellOf(tool);
  if (!dialect) return null;
  const command = String(input.command ?? '');
  for (const inv of analyzeCommand(command, dialect).invocations) {
    if (sends(inv.program, inv.args)) return { act: 'send', what: command };
    for (const w of inv.writes) {
      const path = resolvePath(w, env);
      if (inMemory(path)) return { act: 'memory', what: command };
      if (PERSIST_FILE.test(path)) return { act: 'persist', what: command };
    }
    if (inv.program === 'crontab' || inv.program === 'schtasks' || inv.program === 'register-scheduledtask') return { act: 'persist', what: command };
    // What runs inside Claude Code from now on: a plugin, an MCP server, a tool pack.
    if (inv.program === 'claude' && /^(?:plugin|plugins|mcp)$/.test(inv.args[0] ?? '') && /^(?:install|i|enable|add|add-json|update)$/.test(inv.args[1] ?? ''))
      return { act: 'persist', what: command };
    if (inv.program === APP_ID && inv.args[0] === 'packs') {
      const sub = inv.args[1] ?? '';
      if (/^(?:on|set|auto)$/.test(sub) || (sub === 'here' && inv.args.some((x) => x === '--auto' || x.startsWith('--pack'))))
        return { act: 'persist', what: command };
    }
  }
  return null;
}

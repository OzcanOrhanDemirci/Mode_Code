// SPDX-License-Identifier: Apache-2.0
/**
 * Outside content in a session (A3-2 of 1.2.0: prompt injection's "lethal trifecta"). Once the model has read
 * what someone else wrote (a web page, a search, an issue, a connected service's data, a dependency's files,
 * another session's message), that text may carry instructions. What would let it act on them is then asked:
 * sending data out of the machine, writing what starts by itself or changes Claude Code's configuration, and
 * writing to the memory. Pure: the plugin keeps the session's state and asks (src/mod/register.ts).
 */
import { analyzeCommand } from './shell/analyze.js';
import { bodyNamed, methodsNamed } from './shell/requests.js';
import { OUTWARD_MCP } from './footer.js';
import { APP_ID } from './app.js';
import { packOfTool } from './packs.js';
import { isFileTool, isOwnTool, shellOf } from './belt/tools.js';
import { isUnder, pathKey, resolvePath, type PathEnv } from './paths.js';
import { carriesOutside, type Provenance } from './provenance.js';

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
  if (tool.startsWith('mcp__') && !isOwnTool(tool)) return packOfTool(tool)?.outside === false ? null : tool;
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

/**
 * The methods that send nothing: a read. Any other method a call names sends, whatever it is called: the four that change
 * what is there (POST, PUT, PATCH, DELETE), the extensions (WebDAV's MKCOL, PROPPATCH, MOVE, LOCK …), TRACE (it echoes the
 * request's headers back) and CONNECT (it opens a tunnel, a raw socket), and one only known when it runs (`-X "$M"`).
 * The restricted modes read the same three (src/core/shell/effects.ts).
 */
const READ_METHOD = /^(?:get|head|options)$/i;
/** Whether a method a call names is no read. A dangling option names none: the call would not run. */
const sendingMethod = (method: string): boolean => method !== '' && !READ_METHOD.test(method);
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

/**
 * Whether a call sends data off the computer: a request body or a method that is no read, an upload, a raw socket, a copy
 * to a host, a comment through gh. A body and a method are read by their spelling in the program (curl's `-d`, `-X` and
 * `--request`, wget's `--post-data` and `--method`, PowerShell's `-Body` and `-Method`, httpie's items and first word,
 * gh's fields and `-X`), not by which are known to send.
 */
export function sends(program: string, args: readonly string[]): boolean {
  if (SENDERS.has(program)) return program === 'rsync' || program === 'scp' ? args.some(remote) : true;
  if (FETCHERS.has(program)) return bodyNamed(program, args) || methodsNamed(program, args).some(sendingMethod);
  if (program === 'gh') {
    const [sub, verb] = args;
    if (sub === 'api') {
      // The method said decides (`-X GET` reads, any other sends, and so does one only known when it runs: `-X "$M"`);
      // without one, fields make it a POST, a GraphQL query still a read.
      const methods = methodsNamed(program, args);
      if (methods.length) return methods.some(sendingMethod);
      if (!bodyNamed(program, args)) return false;
      return !args.includes('graphql') || args.some((a) => /^query=(?:@|\s*mutation\b)/.test(a) || a === '--input');
    }
    return /^(?:issue|pr|discussion|gist|release)$/.test(sub ?? '') && /^(?:create|comment|edit|review|upload)$/.test(verb ?? '');
  }
  return false;
}

/** A host on this computer: what is sent there does not leave it. */
export function isLocalHost(host: string): boolean {
  return /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|::1|0\.0\.0\.0|host\.docker\.internal)$/i.test(host);
}

/**
 * The hosts a sending call reaches: a URL's host, the host of a copy to another machine (`host:path`), a socket's
 * host, GitHub for gh. Empty when none can be told (a variable, a name only known when it runs).
 */
export function sendHosts(program: string, args: readonly string[], dynamic: readonly boolean[] = []): string[] {
  if (program === 'gh') return ['github.com'];
  const hosts: string[] = [];
  args.forEach((a, i) => {
    if (dynamic[i]) return;
    const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(a);
    if (url) hosts.push(url[1]!.replace(/^\[|\]$/g, '').toLowerCase());
    else if ((program === 'scp' || program === 'rsync' || program === 'sftp') && remote(a))
      hosts.push(a.slice(0, a.indexOf(':')).replace(/^.*@/, '').toLowerCase());
  });
  if (!hosts.length && (SENDERS.has(program) || FETCHERS.has(program))) {
    // A bare host: `nc host 9000`, `curl -d x example.com/api`.
    const bare = args.find((a, i) => !dynamic[i] && !a.startsWith('-') && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[:/].*)?$|^localhost(?:[:/].*)?$/i.test(a));
    if (bare) hosts.push(bare.split(/[:/]/)[0]!.toLowerCase());
  }
  return [...new Set(hosts)];
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
  if (tool.startsWith('mcp__') && !isOwnTool(tool)) return OUTWARD_MCP.test(tool) ? { act: 'send', what: tool } : null;
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
    // Turning on a skill of others: instructions Claude reads from then on.
    if (inv.program === APP_ID && inv.args[0] === 'skills' && /^(?:on|me)$/.test(inv.args[1] ?? '')) return { act: 'persist', what: command };
    if (inv.program === APP_ID && inv.args[0] === 'packs') {
      const sub = inv.args[1] ?? '';
      if (/^(?:on|set|auto)$/.test(sub) || (sub === 'here' && inv.args.some((x) => x === '--auto' || x.startsWith('--pack'))))
        return { act: 'persist', what: command };
    }
  }
  return null;
}

/**
 * Whether what a tainted session's call does still needs the person here. Sending data out and what starts by
 * itself are the belt's own rules now, for every session (`outbound.network`, `persist.*`), each by where its
 * target came from (src/core/provenance.ts). What stays is the memory: written with what was read from outside.
 */
export function taintMatters(t: { act: TaintedAct; what: string }, written: string, prov: Provenance): boolean {
  return t.act === 'memory' && carriesOutside(written || t.what, prov);
}

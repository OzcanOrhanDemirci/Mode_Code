// SPDX-License-Identifier: Apache-2.0
/**
 * What the doctor reads in Claude Code's setup beyond this tool's own (A6 of 1.2.0): hooks that cannot work or that
 * start a model each time, project settings that widen what runs unasked, MCP servers not pinned to a version. Pure:
 * facts.ts looks at the disk, these say what a line means.
 */

/** A hook's command line as one string. */
export const hookLine = (h: { command: string; args: readonly string[] }) => [h.command, ...h.args].join(' ');

/**
 * The files a hook's command line names by an absolute path (or one under the home folder or the project), which
 * must exist for it to run. Relative names, programs found on the PATH and, on Windows, POSIX paths other than a
 * drive (/c/...) are left out: the doctor cannot place them, and a guess would cry wolf.
 */
export function hookFiles(h: { command: string; args: readonly string[] }, o: { home: string; project: string; platform: string }): string[] {
  const out: string[] = [];
  for (const raw of [h.command, ...h.args]) {
    // A shell word may join quoted and bare parts: "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh is one word.
    for (const word of raw.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) ?? []) {
      let t = word
        .replace(/["']/g, '')
        .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?(?=[\\/]|$)/, o.project)
        .replace(/^(?:~|\$\{?HOME\}?)(?=[\\/])/, o.home);
      // A plugin's own root (${CLAUDE_PLUGIN_ROOT}), a flag or a URL never reads as an absolute path below.
      if (!/\.(?:m?js|cjs|ts|py|sh|ps1|rb|exe|cmd|bat)$/i.test(t)) continue;
      if (o.platform === 'win32' && /^\/[A-Za-z]\//.test(t)) t = `${t[1]!.toUpperCase()}:${t.slice(2)}`;
      if (/^[A-Za-z]:[\\/]/.test(t) || (o.platform !== 'win32' && t.startsWith('/'))) out.push(t);
    }
  }
  return [...new Set(out)];
}

/** A hook that starts a model of its own on each event it names: `claude -p`, `claude --print`. */
export const startsModel = (line: string) => /(?:^|[\s/\\])claude(?:\.exe|\.cmd)?\s(?:.*\s)?(?:-p|--print)(?:\s|$)/.test(line);

/** A hook that needs jq. */
export const usesJq = (line: string) => /(?:^|[\s|;&(`])jq(?:\.exe)?(?:\s|$)/.test(line);

/**
 * An allow rule that lets every command run unasked, or every use of a program that deletes, sends, or runs whatever
 * it is given (`Bash(rm:*)`, `Bash(curl *)`). A rule for one exact command is narrow, whatever the program.
 */
export function broadRule(rule: string): boolean {
  if (rule === 'Bash' || rule === 'PowerShell' || /^(?:Bash|PowerShell)\(\s*\*?\s*\)$/.test(rule)) return true;
  const m = /^(?:Bash|PowerShell)\((.*)\)$/.exec(rule);
  if (!m) return false;
  return /^(?:rm|sudo|curl|wget|git push|git reset|git clean|chmod|chown|del|remove-item|invoke-expression|iex|npx|bash|sh|python3?|node)(?:\s[^*]*)?(?::\*|\s?\*)$/i.test(
    m[1]!.trim(),
  );
}

/**
 * The environment variables that turn Claude Code's tool search off, as its own code decides it (2.1.x): every MCP
 * tool's description is then in every request. ENABLE_TOOL_SEARCH false, 0, no, off or auto:100 and above; the
 * experimental betas off; an ANTHROPIC_BASE_URL that is no Anthropic host while ENABLE_TOOL_SEARCH is unset.
 * ENABLE_TOOL_SEARCH=force turns it on whatever else says.
 */
export function toolSearchOff(env: Readonly<Record<string, string | undefined>>): string[] {
  const yes = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
  const ts = (env.ENABLE_TOOL_SEARCH ?? '').trim();
  if (ts === 'force') return [];
  const out: string[] = [];
  if (yes(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)) out.push('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS');
  if (['0', 'false', 'no', 'off'].includes(ts.toLowerCase()) || (ts.startsWith('auto:') && Number(ts.slice(5)) >= 100)) out.push('ENABLE_TOOL_SEARCH');
  const otherProvider = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some((k) => yes(env[k]));
  const base = (env.ANTHROPIC_BASE_URL ?? '').trim();
  if (!ts && !otherProvider && base && !anthropicHost(base)) out.push('ANTHROPIC_BASE_URL');
  return out;
}

/** A URL on anthropic.com or under it; one that cannot be read counts as Anthropic's (nothing to say about it). */
function anthropicHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return true;
  }
}

/**
 * An MCP server started at no pinned version: `npx -y pkg` without a version, anything at `@latest`. A launcher
 * whose package comes after another flag (`uvx --from pkg==1 cmd`) is left alone: it cannot be read surely.
 */
export function unpinnedServer(target: string): boolean {
  if (/@latest\b/.test(target)) return true;
  const m = /(?:^|\s)(?:npx|pnpm\s+dlx|bunx|uvx)(?:\s+(?:-y|--yes|-q))*\s+(\S+)/.exec(target);
  if (!m || m[1]!.startsWith('-')) return false;
  return !/^(?:@[\w.-]+\/)?[\w.-]+@\d/.test(m[1]!);
}

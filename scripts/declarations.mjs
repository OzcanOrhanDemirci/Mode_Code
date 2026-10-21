// SPDX-License-Identifier: Apache-2.0
/**
 * Where the Claude Code installed here keeps its declarations for mods (`claude-code.d.ts`). They are not published
 * as a package: Claude Code writes them itself, under the system temporary folder and for exactly its version, the
 * first time a session loads its plugin-authoring guide. A release just installed has none until a session has.
 * Read by scripts/typecheck-mod.mjs, scripts/claude-compat.mjs and the live tests (scripts/test-live.mjs, --only-types).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The version of the Claude Code on PATH, as `claude --version` says it; null where there is none. */
export function installedClaude() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
  let v = spawnSync('claude', ['--version'], { encoding: 'utf8', env, windowsHide: true });
  if (v.error && process.platform === 'win32') v = spawnSync('claude --version', { encoding: 'utf8', env, shell: true, windowsHide: true });
  return /(\d+\.\d+\.\d+)/.exec(v.stdout ?? '')?.[1] ?? null;
}

/** The newest declaration file Claude Code `version` laid under `temp`; null where it laid none. */
export function declarationsFor(version, temp = tmpdir()) {
  const base = join(temp, 'claude', 'bundled-skills', version);
  if (!existsSync(base)) return null;
  const found = readdirSync(base)
    .map((h) => join(base, h, 'plugin-authoring', 'types', 'claude-code.d.ts'))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

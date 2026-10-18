// SPDX-License-Identifier: Apache-2.0
/**
 * Updates on this computer (core/update.ts): the check, which reads the newest release's SHA256SUMS and writes what
 * it found to state/update.json, and the update itself, which runs the release's own installer, checked against
 * that SHA256SUMS first, the way the first installation ran: it fetches and checks the package, puts it in place
 * and registers it with Claude Code again (`mode-code install --yes`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, APP_VERSION } from '../core/app.js';
import type { Layout } from '../core/layout.js';
import { parseUpdateState, releaseBase, sumOf, versionInSums, type UpdateState } from '../core/update.js';
import { readText, writeJsonAtomic } from './fsx.js';

const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** A file of a release: over HTTPS from GitHub or a mirror, or from a folder on disk (a rehearsal, a test). */
export async function fetchFile(url: string, timeoutMs = 30_000): Promise<Buffer> {
  if (!isUrl(url)) return readFileSync(url.startsWith('file:') ? fileURLToPath(url) : url);
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': `${APP_ID}/${APP_VERSION}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

export function readUpdateState(l: Pick<Layout, 'updateState'>): UpdateState | null {
  return parseUpdateState(readText(l.updateState));
}

/**
 * Asks the release which version is the newest and keeps the answer. Never throws: what went wrong is the
 * state's `error`, with the newest version found before kept.
 */
export async function checkUpdate(l: Pick<Layout, 'updateState'>, opts: { now?: number; base?: string | null } = {}): Promise<UpdateState> {
  const now = opts.now ?? Date.now();
  const before = readUpdateState(l);
  let state: UpdateState;
  try {
    const sums = (await fetchFile(`${releaseBase(null, opts.base)}/SHA256SUMS`, 15_000)).toString('utf8');
    const latest = versionInSums(sums);
    state = { checkedAt: now, latest: latest ?? before?.latest ?? null, error: latest ? null : 'SHA256SUMS names no versioned package' };
  } catch (err) {
    state = {
      checkedAt: now,
      latest: before?.latest ?? null,
      error: String((err as Error)?.message ?? err)
        .split('\n')[0]!
        .slice(0, 300),
    };
  }
  try {
    writeJsonAtomic(l.updateState, state);
  } catch {
    /* the answer is still given */
  }
  return state;
}

export interface InstallerRun {
  ok: boolean;
  /** Why it did not run, or the installer's exit code when it ran and failed. */
  error?: 'download' | 'checksum' | 'failed';
  detail?: string;
}

/**
 * Updates to `version` with the release's own installer: install.sh, or install.ps1 on Windows, downloaded with the
 * release's SHA256SUMS and run only when its SHA-256 matches; with --yes and --version, so it installs exactly that
 * release and asks nothing more. Its output goes to this terminal.
 */
export async function runInstaller(version: string, opts: { base?: string | null; platform?: NodeJS.Platform } = {}): Promise<InstallerRun> {
  const platform = opts.platform ?? process.platform;
  const base = releaseBase(version, opts.base);
  const name = platform === 'win32' ? 'install.ps1' : 'install.sh';
  let script: Buffer;
  let want: string | null;
  try {
    want = sumOf((await fetchFile(`${base}/SHA256SUMS`, 15_000)).toString('utf8'), name);
    script = await fetchFile(`${base}/${name}`);
  } catch (err) {
    return {
      ok: false,
      error: 'download',
      detail: String((err as Error)?.message ?? err)
        .split('\n')[0]!
        .slice(0, 300),
    };
  }
  if (!want || createHash('sha256').update(script).digest('hex') !== want) return { ok: false, error: 'checksum', detail: name };
  const dir = mkdtempSync(join(tmpdir(), `${APP_ID}-update-`));
  try {
    const file = join(dir, name);
    writeFileSync(file, script);
    // The installer takes the package from the same place it came from: a mirror or a folder named for this run.
    const env = { ...process.env, ...(opts.base ? { MODE_CODE_RELEASE_URL: opts.base } : {}) };
    const r =
      platform === 'win32'
        ? spawnSync(
            'powershell.exe',
            // As the README runs it: a script block from the text, so no execution policy stands between. Run that
            // way it leaves its result in LASTEXITCODE and does not exit, so the exit is said here. -Command, not
            // -EncodedCommand: with that, PowerShell copies what it writes to a stderr that is not a console as XML.
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$ProgressPreference = 'SilentlyContinue'; & ([scriptblock]::Create((Get-Content -Raw -LiteralPath '${file.replace(/'/g, "''")}'))) -Yes -Version '${version}'; exit $LASTEXITCODE`,
            ],
            { stdio: 'inherit', env, windowsHide: false },
          )
        : spawnSync('sh', [file, '--yes', '--version', version], { stdio: 'inherit', env });
    if (r.status !== 0) return { ok: false, error: 'failed', detail: r.error?.message ?? `exit ${r.status}` };
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

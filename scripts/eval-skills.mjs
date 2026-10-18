// SPDX-License-Identifier: Apache-2.0
/**
 * Mode_Code's skills and packs measured with Claude Code's own evals (`claude plugin eval`, docs/skills.md): each case in
 * evals/ is run with the built plugin and without it, and scored. Once per release, as the 1.2.0 plan says: it spends
 * a little of the quota. The plugin is copied with the cases into a folder of its own, so the cases never ship.
 *
 * Usage: node scripts/eval-skills.mjs --yes [--runs N] [--max-cost-usd X]   (after npm run build)
 * Exit: claude plugin eval's (0 every case passed, 1 a case below the threshold, 2 stopped at the cost ceiling).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
if (!args.includes('--yes')) {
  console.log('eval-skills: runs real sessions and spends a little of the quota; add --yes to run it');
  process.exit(0);
}
if (!existsSync(join(root, 'dist', 'plugin', '.claude-plugin', 'plugin.json'))) {
  console.error('eval-skills: build first (npm run build)');
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'mc-eval-'));
const plugin = join(work, 'mode-code');
const out = join(work, 'result.json');
try {
  cpSync(join(root, 'dist', 'plugin'), plugin, { recursive: true });
  cpSync(join(root, 'evals'), join(plugin, 'evals'), { recursive: true });
  const evalArgs = [
    'plugin',
    'eval',
    plugin,
    '--runs',
    opt('--runs', '2'),
    '--model',
    'haiku',
    '--judge-model',
    'haiku',
    '--max-cost-usd',
    opt('--max-cost-usd', '1'),
    '--allow-tools',
    'ToolSearch',
    'mcp__mode-code__catalog',
    '--trust-plugin',
    '--no-publish',
    '--json',
    out,
  ];
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
  let r = spawnSync('claude', evalArgs, { cwd: work, env, encoding: 'utf8', timeout: 3_600_000, windowsHide: true });
  if (r.error && process.platform === 'win32')
    r = spawnSync(['claude', ...evalArgs.map((a) => (/^[\w@./:=,-]+$/.test(a) ? a : `"${a}"`))].join(' '), {
      cwd: work,
      env,
      encoding: 'utf8',
      timeout: 3_600_000,
      windowsHide: true,
      shell: true,
    });
  if (!existsSync(out)) {
    console.error(`eval-skills: no result (${r.status}): ${(r.stderr || r.stdout || '').slice(-800)}`);
    process.exit(r.status ?? 1);
  }
  const result = JSON.parse(readFileSync(out, 'utf8'));
  const cases = result.cases ?? [];
  for (const c of cases) {
    const score = (arm) => {
      const runs = c.arms?.[arm] ?? [];
      return runs.length ? (runs.reduce((n, x) => n + (x.score ?? 0), 0) / runs.length).toFixed(2) : '-';
    };
    const fired = (c.arms?.with ?? []).map((x) => (x.graders ?? []).map((g) => `${g.name}:${g.passed ? 'pass' : 'fail'}`).join(' ')).join(' | ');
    console.log(`${String(c.name).padEnd(20)} with ${score('with')} · without ${score('without')} · ${fired}`);
  }
  const cost = result.cost_usd ?? result.totals?.cost_usd ?? result.summary?.cost_usd;
  console.log(`eval-skills: ${cases.length} cases${typeof cost === 'number' ? ` · about US$${cost.toFixed(3)} at list price` : ''}`);
  process.exitCode = r.status ?? 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Mode_Code against a Claude Code release, in one run: which version is installed here and which is the newest
 * published, then the checks that depend on it, in order: `npm run check`, the mod's type check and engine test kit
 * (`npm run test:mod`, which also reviews every built-in tool that takes a command or a path:
 * test/claude-code-tools.json), and with --live the real sessions (`npm run test:live -- --yes`, a few US cents).
 * The result is added to the table in docs/testing.md ("Claude Code versions checked"), one row per version.
 *
 * It never installs Claude Code: when a newer one is out it says so and stops, unless --installed says to check the
 * installed one anyway. Update with `claude update`, then run this again.
 *
 * Usage: node scripts/claude-compat.mjs [--live] [--installed] [--no-write]
 * Exit: 0 every step passed · 1 a step failed · 2 a newer Claude Code is out (nothing was run).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADING = '## Claude Code versions checked';

/** The table's row for a run: the date, the version, each step's result. */
export function compatRow(date, version, steps) {
  const cell = (name) => {
    const s = steps.find((x) => x.name === name);
    return s ? (s.ok ? 'pass' : 'FAIL') : 'not run';
  };
  return `| ${date} | ${version} | ${cell('check')} | ${cell('mod')} | ${cell('live')} |`;
}

/** docs/testing.md with the row added: under the heading, after the table's last row; a new table at the end when there is none. A row for the same date and version is replaced. */
export function withRow(doc, row) {
  const key = row.split('|').slice(1, 3).join('|');
  const lines = doc.trimEnd().split('\n');
  const at = lines.indexOf(HEADING);
  if (at === -1)
    return `${lines.join('\n')}\n\n${HEADING}\n\nEach Claude Code release Mode_Code was checked against with \`node scripts/claude-compat.mjs\`.\n\n| Date | Claude Code | check | mod (types, kit) | live |\n| --- | --- | --- | --- | --- |\n${row}\n`;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  const section = lines.slice(at, end).filter((l) => !(l.startsWith('|') && l.split('|').slice(1, 3).join('|') === key));
  let last = section.length - 1;
  while (last > 0 && !section[last].startsWith('|')) last--;
  section.splice(last + 1, 0, row);
  return [...lines.slice(0, at), ...section, ...lines.slice(end)].join('\n') + '\n';
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  return r.status === 0;
}

function capture(cmd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, shell: process.platform === 'win32', windowsHide: true });
  return /(\d+\.\d+\.\d+)/.exec(r.stdout ?? '')?.[1] ?? null;
}

function main(argv) {
  const installed = capture('claude', ['--version']);
  if (!installed) {
    console.error('claude-compat: Claude Code is not installed here.');
    return 1;
  }
  const newest = capture('npm', ['view', '@anthropic-ai/claude-code', 'version']);
  console.log(`claude-compat: installed ${installed}, newest published ${newest ?? 'unknown (npm did not answer)'}`);
  if (newest && newest !== installed && !argv.includes('--installed')) {
    console.log(`claude-compat: Claude Code ${newest} is out. Run "claude update", then this again (or --installed to check ${installed}).`);
    return 2;
  }
  const steps = [];
  steps.push({ name: 'check', ok: run('npm', ['run', 'check']) });
  if (steps.every((s) => s.ok)) steps.push({ name: 'mod', ok: run('npm', ['run', 'test:mod']) });
  if (steps.every((s) => s.ok) && argv.includes('--live')) steps.push({ name: 'live', ok: run('npm', ['run', 'test:live', '--', '--yes']) });
  const row = compatRow(new Date().toISOString().slice(0, 10), installed, steps);
  console.log(`claude-compat: ${row}`);
  if (!argv.includes('--no-write')) {
    const file = join(root, 'docs', 'testing.md');
    writeFileSync(file, withRow(readFileSync(file, 'utf8'), row));
    console.log('claude-compat: docs/testing.md updated');
  }
  return steps.every((s) => s.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));

// SPDX-License-Identifier: Apache-2.0
/**
 * Quota per task, on this computer: every Claude Code session of the last days cut at its commits and
 * pushes, each piece priced and weighed (quota.mjs), with what a weekly point took by Mode_Code's readings.
 * It reads the transcripts and the event log and writes nothing.
 *
 * Usage: node scripts/measure/tasks.mjs [--days 7] [--project <part of the folder>] [--json]
 *
 * The folders: CLAUDE_CONFIG_DIR (else ~/.claude) and MODE_CODE_HOME (else ~/.mode-code).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundariesOf, callsOf, jsonLines, readingsOf, tasksOf, unitsPerPoint } from './quota.mjs';

/** The .jsonl files under a folder changed since `since`, at any depth (subagents keep their own). */
function jsonlFiles(dir, since) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p, since));
    else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since) out.push(p);
  }
  return out;
}

function option(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const stamp = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');

export function main(argv, env = process.env) {
  const days = Number(option(argv, '--days', '7'));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('tasks: --days takes a positive number');
    return 1;
  }
  const project = option(argv, '--project', null)?.toLowerCase() ?? null;
  const since = Date.now() - days * 86_400_000;
  const claude = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const data = env.MODE_CODE_HOME || join(homedir(), '.mode-code');

  const calls = [];
  const boundaries = [];
  for (const f of jsonlFiles(join(claude, 'projects'), since)) {
    const lines = jsonLines(readFileSync(f, 'utf8'));
    calls.push(...callsOf(lines));
    boundaries.push(...boundariesOf(lines));
  }
  // A call can be in two files (a resumed session copies its history): counted once, by its key.
  const unique = [...new Map(calls.filter((c) => c.at >= since).map((c) => [c.key, c])).values()];
  const readings = readingsOf(jsonlFiles(join(data, 'events'), since).flatMap((f) => jsonLines(readFileSync(f, 'utf8'))));
  const point = unitsPerPoint(readings, unique);
  const tasks = tasksOf(unique, boundaries).filter((t) => !project || t.cwd.toLowerCase().includes(project));

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ days, calls: unique.length, readings: readings.length, point, tasks }, null, 2));
    return 0;
  }
  console.log(`tasks: ${tasks.length} in ${days} day(s), ${unique.length} calls, ${readings.length} quota readings`);
  console.log('start        session   folder                 ended   calls  context  units   points');
  for (const t of tasks) {
    const points = point ? (t.units / point.perPoint).toFixed(2) : '-';
    console.log(
      [
        stamp(t.from),
        t.session.slice(0, 8).padEnd(9),
        basename(t.cwd || '-')
          .slice(0, 22)
          .padEnd(22),
        t.endedBy.padEnd(7),
        String(t.calls).padStart(5),
        `${Math.round(t.context / 1000)}k`.padStart(8),
        t.units.toFixed(2).padStart(6),
        points.padStart(8),
      ].join(' '),
    );
  }
  const units = tasks.reduce((n, t) => n + t.units, 0);
  const unpriced = tasks.reduce((n, t) => n + t.unpriced, 0);
  console.log(`units in all: ${units.toFixed(2)}${unpriced ? ` (${unpriced} calls of a model with no price, left out)` : ''}`);
  console.log(
    point
      ? `a weekly point took ${point.perPoint.toFixed(2)} units (${point.points} points over ${point.units.toFixed(2)} units; calls made elsewhere count in the readings too)`
      : 'a weekly point: not enough readings in these days',
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));

// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code measure` (docs/testing.md, "What a task costs"): the quota each task took on this computer, with how the
 * work went, from the transcripts and the event log. Reads only.
 */
import { basename } from 'node:path';
import { APP_ID, APP_VERSION } from '../core/app.js';
import { compact, dateTime, decimal, percent } from '../core/format.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import type { Task } from '../core/measure.js';
import { appContext } from '../app/context.js';
import { readClaudeEnv } from '../node/claude-env.js';
import { claudeDir } from '../node/env.js';
import { measure } from '../node/measure.js';
import { flag, intValue, value, type Args } from './args.js';
import { bold, dim, table } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');

export async function cmdMeasure(a: Args): Promise<number> {
  const ctx = appContext();
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  const days = intValue(a, 'days', 7, 1, 90);
  const servers = readClaudeEnv(ctx.cwd, { version: null }).mcp.map((s) => s.name);
  const r = measure({ claudeDir: claudeDir(), dataDir: ctx.layout.root, days, project: value(a, 'project') ?? null, servers });
  if (flag(a, 'json')) {
    say(JSON.stringify({ schema: `${APP_ID}.measure/1`, version: APP_VERSION, ...r }, null, 2));
    return 0;
  }
  say(bold(T('measure.title', { n: days })));
  if (!r.tasks.length) {
    say(T('measure.none'));
    return 0;
  }
  const units = (n: number) => decimal(n, ctx.lang);
  const traces = (t: Task) =>
    [
      t.traces.tested ? T('measure.trace.tested') : null,
      t.traces.rereads ? T('measure.trace.rereads', { n: t.traces.rereads }) : null,
      t.traces.refused ? T('measure.trace.refused', { n: t.traces.refused }) : null,
      t.traces.cacheRebuilds ? T('measure.trace.cache', { n: t.traces.cacheRebuilds }) : null,
      t.traces.large ? T('measure.trace.large', { n: t.traces.large }) : null,
      t.traces.touchedAgain.length ? T('measure.trace.again', { n: t.traces.touchedAgain.length }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  say();
  say(
    table(
      [
        [
          'measure.col.start',
          'measure.col.folder',
          'measure.col.ended',
          'measure.col.calls',
          'measure.col.context',
          'measure.col.units',
          'measure.col.points',
          'measure.col.traces',
        ].map((k) => T(k as MessageKey)),
        ...r.tasks.map((t) => [
          dateTime(t.from, ctx.lang),
          basename(t.cwd || '-').slice(0, 24),
          T(`measure.ended.${t.endedBy}` as MessageKey),
          String(t.calls),
          compact(t.context, ctx.lang),
          units(t.units),
          r.point ? units(t.units / r.point.perPoint) : '-',
          traces(t),
        ]),
      ],
      [3, 4, 5, 6],
    ),
  );
  say();
  const all = r.tasks.reduce((n, t) => n + t.units, 0);
  const unpriced = r.tasks.reduce((n, t) => n + t.unpriced, 0);
  say(T('measure.total', { units: units(all), tasks: r.tasks.length, calls: r.calls }));
  if (unpriced) say(dim(T('measure.unpriced', { n: unpriced })));
  say(r.point ? T('measure.point', { perPoint: units(r.point.perPoint), points: r.point.points, units: units(r.point.units) }) : dim(T('measure.noPoint')));
  const share = (n: number) => percent(all > 0 ? (n / all) * 100 : 0, ctx.lang);
  if (r.models.length)
    say(
      T('measure.models', {
        list: r.models
          .map((m) => T('measure.modelItem', { model: m.model.replace(/^claude-/, ''), share: share(m.units), sub: share(m.subagents) }))
          .join(', '),
      }),
    );
  const out = r.output.reduce((n, o) => n + o.chars, 0);
  if (out > 0)
    say(
      T('measure.output', {
        list: r.output
          .slice(0, 5)
          .map((o) => `${o.tool} ${percent((o.chars / out) * 100, ctx.lang)}`)
          .join(', '),
      }),
    );
  if (r.unusedServers.length) say(T('measure.unused', { list: r.unusedServers.join(', ') }));
  return 0;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Sync's settings, as properties over many generated cases (core/sync.ts, docs/sync.md): whatever times the
 * computers changed their settings at, every computer comes to the same value for each one; and a setting
 * from another computer never lowers a protection here without the person.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, type Config } from '../../src/core/config.js';
import { lowersProtection, mergeSettings, nextExport, sharedValues, type MachineSettings } from '../../src/core/sync.js';

/** A small deterministic generator, so a failure repeats. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CHOICES: Record<string, unknown[]> = {
  'footer.mode': ['draw', 'check', 'off'],
  view: ['simple', 'recommended', 'detailed'],
  language: ['auto', 'en', 'tr'],
  'footer.showFiveFrom': [50, 70, 90],
  'memory.handoff.keep': [5, 20, 40],
  'belt.verdicts': [{}, { 'git.clean': 'warn' }, { 'git.clean': 'deny' }, { 'fs.delete-outside-project': 'allow' }],
  'quota.fiveHourStop': [95, 97, 99],
};

function configWith(values: Record<string, unknown>): Config {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const parts = k.split('.');
    let cur = raw;
    for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
    cur[parts[parts.length - 1]!] = v;
  }
  return normalizeConfig(raw).config;
}

test('every computer comes to the same value for each setting, whatever the times (equal ones included)', () => {
  const ids = ['a-0000', 'b-0000', 'c-0000'];
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const machines = ids.map((id) => {
      const values: Record<string, unknown> = {};
      const times: Record<string, number> = {};
      for (const [k, opts] of Object.entries(CHOICES)) {
        values[k] = opts[Math.floor(r() * opts.length)];
        // A few distinct times, so equal times between computers happen often.
        times[k] = Math.floor(r() * 4) * 100;
      }
      const config = configWith(values);
      const file = nextExport(null, sharedValues(config), id, 0, (k) => times[k] ?? 0);
      return { id, config, file };
    });
    const results = machines.map((m) => {
      const others: MachineSettings[] = machines.filter((o) => o.id !== m.id).map((o) => o.file);
      // Every computer approves what waits for it: what is compared is the value each would come to.
      const merged = mergeSettings(m.config, m.file, others);
      const approved = Object.fromEntries(merged.pending.map((p) => [p.key, p.incoming]));
      return { ...sharedValues(merged.config), ...approved };
    });
    for (const k of Object.keys(CHOICES)) {
      const all = machines.map((m) => m.file.entries[k]!);
      const top = Math.max(...all.map((e) => e.at));
      if (top === 0) continue; // nobody changed it: each keeps its own
      const seen = new Set(results.map((v) => JSON.stringify(v[k])));
      assert.equal(seen.size, 1, `seed ${seed}, ${k}: ${[...seen].join(' / ')}`);
      const winner = machines.filter((m) => m.file.entries[k]!.at === top).sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
      assert.equal([...seen][0], JSON.stringify(winner.file.entries[k]!.value), `seed ${seed}, ${k}`);
    }
  }
});

test('a setting from another computer never lowers a protection here by itself', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7);
    const pick = () => {
      const values: Record<string, unknown> = {};
      for (const [k, opts] of Object.entries(CHOICES)) values[k] = opts[Math.floor(r() * opts.length)];
      return configWith(values);
    };
    const here = pick();
    const other = pick();
    const mine = nextExport(null, sharedValues(here), 'a-0000', 0);
    const theirs = nextExport(null, sharedValues(other), 'b-0000', 0, () => 500);
    const m = mergeSettings(here, mine, [theirs]);
    const before = sharedValues(here);
    const after = sharedValues(m.config);
    for (const k of Object.keys(after))
      if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) assert.ok(!lowersProtection(k, before[k], after[k]), `seed ${seed}, ${k}`);
    for (const p of m.pending) assert.ok(lowersProtection(p.key, p.current, p.incoming));
  }
});

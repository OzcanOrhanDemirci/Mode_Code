// SPDX-License-Identifier: Apache-2.0
/**
 * The command line's words for people (not --json), in both languages: what each command says in the
 * common states. Checked on the source; the shipped bundle runs the same code (see ../dist).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { built, cli, world } from '../helpers/proc.js';

test('before installing: status and doctor point to install; install --dry-run lists every change', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ lang: 'en' });
  try {
    const s = cli(w, ['status']);
    assert.equal(s.code, 0);
    assert.match(s.out, /Not installed/i);
    assert.match(s.out, /mode-code install/);
    const d = cli(w, ['doctor', '--quick']);
    assert.match(d.out, /Maintenance check/);
    assert.match(d.out, /Node\.js/);
    assert.match(d.out, /Not installed yet/);
    assert.match(d.out, /\d+ checks in [\d.]+ s/);
    const i = cli(w, ['install', '--dry-run']);
    assert.equal(i.code, 0, i.err);
    for (const step of ['data folder', 'hook program', 'marketplace', 'plugin', 'hooks', 'settings file', 'safety belt'])
      assert.match(i.out, new RegExp(step, 'i'));
    assert.match(i.out, /Nothing is changed until you confirm|dry run/i);
  } finally {
    w.done();
  }
});

test('Turkish throughout: help, status, doctor, belt rules', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ lang: 'tr' });
  try {
    assert.match(cli(w, ['help']).out, /Kullanım|kullanım/);
    assert.match(cli(w, ['status']).out, /Henüz kurulmadı/);
    const d = cli(w, ['doctor', '--quick']).out;
    assert.match(d, /Bakım denetimi/);
    assert.match(d, /denetim: \d+ tamam/);
    assert.match(cli(w, ['belt', 'rules']).out, /engelle|sor/);
  } finally {
    w.done();
  }
});

test('installed: status lists every feature; doctor offers the repairs it can make', { timeout: 180_000 }, (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ lang: 'en' });
  try {
    assert.equal(cli(w, ['install', '--yes', '--json', '--lang', 'en']).code, 0);
    const s = cli(w, ['status']);
    assert.match(s.out, /Safety belt/);
    assert.match(s.out, /✓/);
    // The hooks removed by accident: doctor says so and, with nobody at a terminal, how to repair.
    writeFileSync(join(w.claudeDir, 'settings.json'), '{}');
    const d = cli(w, ['doctor']);
    assert.equal(d.code, 1);
    assert.match(d.out, /Safety-net hooks are missing/);
    assert.match(d.out, /Put the safety-net hooks back/);
    assert.match(d.out, /mode-code doctor --fix/);
    const f = cli(w, ['doctor', '--fix']);
    assert.match(f.out, /repaired and checked again/);
    assert.match(f.out, /backup: /);
  } finally {
    w.done();
  }
});

test('quota, tokens, sessions, report and belt events with nothing yet, and with data', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ lang: 'en' });
  try {
    assert.match(cli(w, ['quota']).out, /No quota reading/i);
    assert.match(cli(w, ['sessions']).out, /No session|no session/i);
    assert.match(cli(w, ['belt', 'events']).out, /Nothing was blocked/);
    mkdirSync(join(w.data, 'state'), { recursive: true });
    const now = Date.now();
    writeFileSync(
      join(w.data, 'state', 'quota.json'),
      JSON.stringify({
        measuredAt: now,
        source: 'mod',
        windows: [
          { kind: 'five_hour', used: 42, resetsAt: now + 3600_000 },
          { kind: 'seven_day', used: 97.5, resetsAt: now + 86400_000 },
        ],
      }),
    );
    const q = cli(w, ['quota']);
    assert.match(q.out, /42%/);
    assert.match(q.out, /wrap|limit|stop/i, 'at 97.5% of the week the guard speaks');
    const proj = join(w.claudeDir, 'projects', 'C--work-app');
    mkdirSync(proj, { recursive: true });
    const ts = new Date(now - 60_000).toISOString();
    writeFileSync(
      join(proj, 's1.jsonl'),
      [
        { type: 'user', sessionId: 's1', cwd: 'C:/work/app', timestamp: ts, message: { role: 'user', content: 'fix the bug' } },
        {
          type: 'assistant',
          sessionId: 's1',
          timestamp: ts,
          message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20 }, content: [] },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
    );
    assert.match(cli(w, ['tokens']).out, /Output|output/);
    assert.match(cli(w, ['tokens', '--by', 'model']).out, /claude-opus-5-5/);
    assert.match(cli(w, ['sessions']).out, /fix the bug/);
    assert.match(cli(w, ['report', '--week']).out, /7 days|week/i);
  } finally {
    w.done();
  }
});

test('belt test explains a decision in words; config get prints a section as JSON', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const w = world({ lang: 'en' });
  try {
    const b = cli(w, ['belt', 'test', '--command', 'git clean -fdx']);
    assert.match(b.out, /^ask/m);
    assert.match(b.out, /git\.clean/);
    assert.match(b.out, /nothing was run/);
    const c = cli(w, ['config', 'get', 'belt']);
    assert.doesNotThrow(() => JSON.parse(c.out));
    assert.match(cli(w, ['template', 'list']).out, /measured/);
    assert.match(cli(w, ['uninstall', '--dry-run']).out, /settings|kept/i);
  } finally {
    w.done();
  }
});

test("config explain gives a setting's four answers and the command that changes it; a wrong name gets the nearest ones", () => {
  const tr = world({ lang: 'tr' });
  try {
    const s = cli(tr, ['config', 'explain', 'bypass.enabled']);
    assert.equal(s.code, 0, s.err);
    const flat = s.out.replace(/\s+/g, ' ');
    assert.match(flat, /^Bypass'a izin ver \(bypass\.enabled\) · Otomasyon › Bypass/);
    assert.match(flat, /Bu ne Bypass, bir oturumda Claude'un bir süre sormadan çalışmasını sağlar/);
    assert.match(flat, /Şu an kapalı \(varsayılan\)\. \/bypass ve ⚡ yok/);
    assert.match(flat, /Değiştirirsen açık: Bir oturumda kendin açabilirsin/);
    assert.match(flat, /Geri almak Aynı yoldan eski hâline döndürebilirsin/);
    assert.match(flat, /Kim değiştirir Yalnız sen/);
    assert.match(flat, /Değiştirmek için: mode-code config set bypass\.enabled true\|false/);
    // No line starts with the space a break fell on, and none is wider than the terminal it was given.
    for (const line of s.out.split('\n')) assert.ok(line.length <= 120, line);
  } finally {
    tr.done();
  }
  const en = world({ lang: 'en' });
  try {
    const n = cli(en, ['config', 'explain', 'autonomy.stallMinutes']);
    assert.equal(n.code, 0, n.err);
    const flat = n.out.replace(/\s+/g, ' ');
    assert.match(flat, /Now 90 minutes \(default\)\. After 90 minutes without a finished step Claude is told/);
    assert.match(flat, /No effect now, because "Full autonomy" is off \(Automation › Full autonomy\)\./);
    assert.match(flat, /If you change it Type a number from 10 minutes to 720 minutes\./);
    assert.match(flat, /mode-code config set autonomy\.stallMinutes 10-720/);
    const bad = cli(en, ['config', 'explain', 'bypass']);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /Not a setting: bypass\./);
    assert.match(bad.out, /Did you mean: bypass\.enabled, bypass\.maxHours\?/);
    const typo = cli(en, ['config', 'explain', 'modules.keywrods']);
    assert.equal(typo.code, 2);
    assert.match(typo.out, /modules\.keywords/);
    const all = cli(en, ['config', 'explain']);
    assert.equal(all.code, 0);
    assert.match(all.out, /Settings › Features\n\s+modules\.modes\s+Modes and flows: on/);
    assert.match(all.out, /packs\.items\.ffmpeg\s+Audio and video: automatic/);
    assert.match(cli(en, ['help']).out, /config explain \[setting\]\s+What a setting does, before you change it/);
    const j = cli(en, ['config', 'explain', 'view', '--json']);
    assert.equal(j.code, 0);
    assert.equal(j.json?.path, 'view');
    assert.equal(j.json?.now, 'Recommended');
    assert.equal(cli(en, ['config', 'explain', '--json']).out.includes('"path": "packs.items.ffmpeg"'), true);
    const jb = cli(en, ['config', 'explain', 'bypas', '--json']);
    assert.equal(jb.code, 2);
    assert.deepEqual(jb.json, { error: 'not-a-setting', nearest: ['bypass.enabled', 'bypass.maxHours'] });
  } finally {
    en.done();
  }
});

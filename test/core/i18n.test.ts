// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { RULES, RULE_IDS } from '../../src/core/belt/rules.js';
import { CATEGORY_IDS } from '../../src/tui/nav.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';

const keys = Object.keys(en) as (keyof typeof en)[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every message exists in Turkish, with the same placeholders', () => {
  for (const k of keys) {
    const t = tr[k];
    assert.ok(typeof t === 'string' && t.trim().length > 0, `missing Turkish text for ${k}`);
    assert.deepEqual(placeholders(t), placeholders(en[k]), `placeholders differ for ${k}`);
  }
});

test('no message uses a long dash (the project writes plain sentences)', () => {
  for (const k of keys) {
    assert.ok(!/[—–]/.test(en[k]), `long dash in English ${k}`);
    assert.ok(!/[—–]/.test(tr[k]), `long dash in Turkish ${k}`);
  }
});

test('keys built at run time all exist', () => {
  const need: string[] = [];
  for (const id of RULE_IDS) need.push(`rule.${id}`, `rulename.${id}`, `rulecat.${RULES[id].category}`);
  for (const v of ['allow', 'warn', 'ask', 'deny']) need.push(`verdict.${v}`, `verdict.explain.${v}`);
  need.push('verdict.off');
  for (const s of ['ok', 'off', 'gray', 'red', 'absent']) need.push(`health.state.${s}`);
  for (const f of ['belt', 'selfProtection', 'mod', 'keywords', 'quota', 'footer', 'quietWork', 'memory', 'index', 'secrets']) need.push(`feature.${f}`);
  for (const s of ['managed', 'user', 'project', 'local']) need.push(`scope.${s}`);
  for (const i of ['user', 'project', 'project-dir', 'local', 'memory-index']) need.push(`instr.${i}`);
  for (const k of ['continue', 'manual', 'chat', 'quota', 'wrapUp', 'stop', 'status', 'help']) need.push(`kw.kind.${k}`);
  for (const m of Object.keys(DEFAULT_CONFIG.modules)) need.push(`mod.${m}`, `mod.${m}.help`);
  for (const a of Object.keys(DEFAULT_CONFIG.accessibility)) need.push(`a11y.${a}`, `a11y.${a}.help`);
  for (const s of ['data-folder', 'hook-program', 'marketplace', 'plugin', 'settings-hooks', 'config', 'self-test']) need.push(`install.step.${s}`);
  for (const s of ['plugin', 'marketplace', 'settings-hooks', 'files', 'data']) need.push(`uninstall.step.${s}`);
  for (const c of CATEGORY_IDS) need.push(`cat.${c}`);
  for (const p of ['deny', 'ask', 'allow']) need.push(`perm.${p}`);
  const missing = need.filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

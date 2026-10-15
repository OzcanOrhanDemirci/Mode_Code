// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedTemplates, repoKey, TEMPLATES, templateById, withTemplates } from '../../src/core/templates.js';
import { remoteMatches } from '../../src/core/belt/git.js';
import { cloneDefaults } from '../../src/core/config.js';

test('rules go into one marked block that is replaced, never duplicated, and removed when empty', () => {
  const original = '# My project\n\nUse pnpm.\n';
  const one = withTemplates(original, ['flutter'], 'en');
  assert.match(one, /^# My project\n\nUse pnpm\.\n\n<!-- mode-code:templates -->/);
  assert.deepEqual(appliedTemplates(one), ['flutter']);
  const two = withTemplates(one, ['flutter', 'measured'], 'en');
  assert.equal(two.split('<!-- mode-code:templates -->').length, 2);
  assert.deepEqual(appliedTemplates(two), ['flutter', 'measured']);
  assert.equal(withTemplates(two, [], 'en'), original);
  assert.equal(withTemplates(null, [], 'en'), '');
  assert.match(withTemplates(null, ['plain-docs'], 'tr'), /Mode_Code şablonlarından kurallar/);
});

test('a block written under an earlier name of the tool is recognised and rewritten under this one', () => {
  const old = withTemplates('# A\n', ['flutter'], 'en').replace(/mode-code:templates/g, 'terminal-code:templates');
  assert.deepEqual(appliedTemplates(old), ['flutter']);
  const next = withTemplates(old, ['flutter', 'measured'], 'en');
  assert.doesNotMatch(next, /terminal-code:templates/);
  assert.equal(next.split('<!-- mode-code:templates -->').length, 2);
  assert.deepEqual(appliedTemplates(next), ['flutter', 'measured']);
});

test('text after the block is kept', () => {
  const md = withTemplates('# A\n', ['measured'], 'en') + '\n## Later section\n';
  assert.match(withTemplates(md, ['flutter'], 'en'), /## Later section/);
  assert.doesNotMatch(withTemplates(md, ['flutter'], 'en'), /Measure before claiming/);
});

test('templates only tighten: they add to lists and turn packs on', () => {
  const c = cloneDefaults();
  for (const t of TEMPLATES)
    for (const ch of t.changes?.('github.com/me/app') ?? []) {
      const v = ch.apply(c);
      if (Array.isArray(v)) assert.ok(v.includes('github.com/me/app'));
      else assert.equal((v as { dockerVolumes: boolean }).dockerVolumes, true);
    }
  assert.ok(templateById('public-repo')?.needsRemote);
});

test('a recorded remote matches the same repository over https and ssh', () => {
  const key = repoKey('https://user:token@GitHub.com/Me/App.git');
  assert.equal(key, 'github.com/me/app');
  assert.ok(remoteMatches('https://github.com/me/app.git', [key]));
  const sshKey = repoKey('git@github.com:me/app.git');
  assert.ok(remoteMatches('git@github.com:me/app.git', [sshKey]));
});

test('a repository is the same however it was cloned, on both sides of a rule', () => {
  // An SSH clone kept its colon and matched no `github.com/ada/app` rule: it escaped them all.
  const ways = ['https://github.com/Ada/App.git', 'git@github.com:ada/app.git', 'ssh://git@github.com/ada/app', 'https://ada:tok@github.com/ada/app.git/'];
  for (const url of ways) {
    assert.equal(repoKey(url), 'github.com/ada/app', url);
    for (const rule of ['github.com/ada/app', 'github.com:ada/app', 'ada/app']) assert.ok(remoteMatches(url, [rule]), `${url} ~ ${rule}`);
  }
  assert.equal(remoteMatches('git@github.com:ada/app-old.git', ['github.com/ada/application']), false);
  assert.equal(repoKey('C:/repos/app'), 'c:/repos/app', 'a Windows path is not host:path');
});

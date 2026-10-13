// SPDX-License-Identifier: Apache-2.0
// scripts/rename.ts: the pieces of a rename, one by one (scripts/rename-rehearsal.mjs runs the whole of it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { badId, dropTemporary, noteRename, renameApp, renameText, shaped, shortStem, spellings, type RenamePlan } from '../../scripts/rename.js';
import { ROOT } from '../helpers/proc.js';

const plan: RenamePlan = {
  from: { id: 'terminal-code', name: 'terminal-code', repo: 'OzcanOrhanDemirci/terminal-code' },
  to: { id: 'harbor-light', name: 'Harbor Light', repo: 'OzcanOrhanDemirci/harbor-light' },
  final: true,
};

test('a new id is lower-case kebab, of a sensible length, not Anthropic’s, not the current one', () => {
  assert.equal(badId('harbor-light', 'terminal-code'), null);
  assert.equal(badId('hl2', 'terminal-code'), null);
  for (const bad of ['Harbor', 'harbor--light', '-harbor', 'harbor-', '2harbor', 'harbor_light', 'h', 'x'.repeat(41)])
    assert.notEqual(badId(bad, 'terminal-code'), null, bad);
  assert.match(badId('claude-helper', 'terminal-code')!, /Anthropic/);
  assert.match(badId('anthropic-x', 'terminal-code')!, /Anthropic/);
  assert.match(badId('terminal-code', 'terminal-code')!, /current/);
});

test('every spelling of an id, and an id written in the case another text used', () => {
  assert.deepEqual(spellings('harbor-light'), { kebab: 'harbor-light', upper: 'HARBOR_LIGHT', pascal: 'HarborLight', camel: 'harborLight' });
  assert.deepEqual(spellings('tool'), { kebab: 'tool', upper: 'TOOL', pascal: 'Tool', camel: 'tool' });
  assert.equal(shaped('harbor-light', 'terminal-code'), 'harbor-light');
  assert.equal(shaped('harbor-light', 'TERMINAL-CODE'), 'HARBOR-LIGHT');
  assert.equal(shaped('harbor-light', 'Terminal-Code'), 'Harbor-Light');
  assert.equal(shaped('harbor-light', 'Terminal-code'), 'Harbor-light');
  assert.equal(shaped('a-b-c', 'Terminal-Code'), 'A-B-C', 'more words than the model: the last word’s case carries on');
  assert.equal(shortStem('terminal-code'), 'TERMIN');
  assert.equal(shortStem('harbor-light'), 'HARBOR');
  assert.equal(shortStem('hl'), 'HL');
});

test('the text: every spelling and the repository, counted; nothing that only looks alike', () => {
  const before = [
    'npm i -g terminal-code && terminal-code doctor',
    'https://github.com/OzcanOrhanDemirci/terminal-code/issues',
    'TERMINAL_CODE_HOME=~/.terminal-code',
    'interface TerminalCodeFooters {} const terminalCode = 1;',
    "'c:/users/ADA/.Terminal-Code/Config.json' '/USERS/ADA/.TERMINAL-CODE'",
    'C:/Users/ada/TERMIN~1/x termin~12 TE1A2B~5',
    'terminal devam · terminal_code · TERMINAL~1 · mcp__terminal-code__flow_step',
  ].join('\n');
  const r = renameText(before, plan);
  assert.equal(
    r.text,
    [
      'npm i -g harbor-light && harbor-light doctor',
      'https://github.com/OzcanOrhanDemirci/harbor-light/issues',
      'HARBOR_LIGHT_HOME=~/.harbor-light',
      'interface HarborLightFooters {} const harborLight = 1;',
      "'c:/users/ADA/.Harbor-Light/Config.json' '/USERS/ADA/.HARBOR-LIGHT'",
      'C:/Users/ada/HARBOR~1/x harbor~12 HA1A2B~5',
      'terminal devam · terminal_code · TERMINAL~1 · mcp__harbor-light__flow_step',
    ].join('\n'),
  );
  assert.equal(r.count, 13);
  const moved = renameText('github.com/OzcanOrhanDemirci/terminal-code.git', { ...plan, to: { ...plan.to, repo: 'harbor-org/harbor' } });
  assert.equal(moved.text, 'github.com/harbor-org/harbor.git', 'the repository first, then the id: no half-renamed address');
});

test('the identity file: the old name recorded first, earlier ones kept as they were, the display name and finality set', () => {
  const app = readFileSync(join(ROOT, 'src', 'core', 'app.ts'), 'utf8');
  const once = renameApp(app, plan).text;
  assert.match(once, /export const APP_ID = 'harbor-light';/);
  assert.match(once, /export const APP_NAME = 'Harbor Light';/);
  assert.match(once, /export const NAME_IS_FINAL = true;/);
  assert.match(once, /PREVIOUS_NAMES: readonly \{ readonly id: string; readonly name: string \}\[\] = \[\{ id: 'terminal-code', name: 'terminal-code' \}\];/);
  assert.match(once, /export const LANG_ENV = 'HARBOR_LIGHT_LANG';/);
  const second: RenamePlan = {
    from: { id: 'harbor-light', name: 'Harbor Light', repo: plan.to.repo },
    to: { id: 'beacon', name: "Bea'con", repo: 'o/beacon' },
    final: false,
  };
  const twice = renameApp(once, second).text;
  assert.match(
    twice,
    /= \[\{ id: 'harbor-light', name: 'Harbor Light' \}, \{ id: 'terminal-code', name: 'terminal-code' \}\];/,
    'the earlier names are never renamed',
  );
  assert.match(twice, /export const APP_NAME = 'Bea\\'con';/);
  assert.match(twice, /export const NAME_IS_FINAL = false;/);
  const back = renameApp(twice, { ...second, from: second.to, to: { id: 'harbor-light', name: 'Harbor Light', repo: 'o/h' } }).text;
  assert.match(
    back,
    /= \[\{ id: 'beacon', name: 'Bea\\'con' \}, \{ id: 'terminal-code', name: 'terminal-code' \}\];/,
    'a name taken back is no longer an earlier one',
  );
  assert.throws(() => renameApp('nothing here', plan), /PREVIOUS_NAMES not found/);
});

test('the READMEs lose the notice that the name is temporary; the changelog gains the rename', () => {
  assert.equal(dropTemporary('# x\n\n<!-- name:temporary -->\n\n> temporary\n\n<!-- /name:temporary -->\n\n## Next\n'), '# x\n\n## Next\n');
  for (const f of ['README.md', 'README.tr.md']) assert.equal(dropTemporary(readFileSync(join(ROOT, f), 'utf8')).includes('name:temporary'), false, f);
  const changelog = noteRename('# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a\n\n### Changed\n\n- b\n\n## [0.1.0]\n\n### Changed\n\n- c\n', plan);
  assert.match(
    changelog,
    /### Changed\n\n- The tool is now called Harbor Light \(it was terminal-code\)\. `harbor-light install` moves[^\n]*`HARBOR_LIGHT_\*`[^\n]*\n- b\n\n## \[0\.1\.0\]\n\n### Changed\n\n- c\n$/,
  );
  const without = noteRename('## [Unreleased]\n\n### Added\n\n- a\n', plan);
  assert.match(without, /### Added\n\n- a\n\n### Changed\n\n- The tool is now called/);
  assert.throws(() => noteRename('# nothing', plan), /no \[Unreleased\]/);
});

// SPDX-License-Identifier: Apache-2.0
// scripts/rename.ts: the pieces of a rename, one by one (scripts/rename-rehearsal.mjs runs the whole of it).
// The names here are made up and never the tool's own: a rename of the tool leaves this file as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { badId, dropTemporary, noteRename, renameApp, renameText, shaped, shortStem, spellings, type RenamePlan } from '../../scripts/rename.js';
import { ROOT } from '../helpers/proc.js';

const plan: RenamePlan = {
  from: { id: 'old-tool', name: 'old-tool', repo: 'someone/old-tool' },
  to: { id: 'harbor-light', name: 'Harbor Light', repo: 'someone/harbor-light' },
  final: true,
};

/** An identity file shaped as src/core/app.ts is. */
const APP = [
  "export const APP_ID = 'old-tool';",
  "export const APP_NAME = 'old-tool';",
  'export const NAME_IS_FINAL = false;',
  'export const PREVIOUS_NAMES: readonly { readonly id: string; readonly name: string }[] = [];',
  "export const REPO_URL = 'https://github.com/someone/old-tool';",
  "export const LANG_ENV = 'OLD_TOOL_LANG';",
  '',
].join('\n');

test('a new id is lower-case kebab, of a sensible length, not Anthropic’s, not the current one', () => {
  assert.equal(badId('harbor-light', 'old-tool'), null);
  assert.equal(badId('hl2', 'old-tool'), null);
  for (const bad of ['Harbor', 'harbor--light', '-harbor', 'harbor-', '2harbor', 'harbor_light', 'h', 'x'.repeat(41)])
    assert.notEqual(badId(bad, 'old-tool'), null, bad);
  assert.match(badId('claude-helper', 'old-tool')!, /Anthropic/);
  assert.match(badId('anthropic-x', 'old-tool')!, /Anthropic/);
  assert.match(badId('old-tool', 'old-tool')!, /current/);
});

test('every spelling of an id, and an id written in the case another text used', () => {
  assert.deepEqual(spellings('harbor-light'), { kebab: 'harbor-light', upper: 'HARBOR_LIGHT', pascal: 'HarborLight', camel: 'harborLight' });
  assert.deepEqual(spellings('tool'), { kebab: 'tool', upper: 'TOOL', pascal: 'Tool', camel: 'tool' });
  assert.equal(shaped('harbor-light', 'old-tool'), 'harbor-light');
  assert.equal(shaped('harbor-light', 'OLD-TOOL'), 'HARBOR-LIGHT');
  assert.equal(shaped('harbor-light', 'Old-Tool'), 'Harbor-Light');
  assert.equal(shaped('harbor-light', 'Old-tool'), 'Harbor-light');
  assert.equal(shaped('a-b-c', 'Old-Tool'), 'A-B-C', 'more words than the model: the last word’s case carries on');
  assert.equal(shortStem('old-tool'), 'OLDTOO');
  assert.equal(shortStem('harbor-light'), 'HARBOR');
  assert.equal(shortStem('hl'), 'HL');
});

test('the text: every spelling and the repository, counted; nothing that only looks alike', () => {
  const before = [
    'npm i -g old-tool && old-tool doctor',
    'https://github.com/someone/old-tool/issues',
    'OLD_TOOL_HOME=~/.old-tool',
    'interface OldToolFooters {} const oldTool = 1;',
    "'c:/users/ADA/.Old-Tool/Config.json' '/USERS/ADA/.OLD-TOOL'",
    'C:/Users/ada/OLDTOO~1/x oldtoo~12 OL1A2B~5',
    'old devam · old_tool · OLDTOOL~1 · mcp__old-tool__flow_step',
  ].join('\n');
  const r = renameText(before, plan);
  assert.equal(
    r.text,
    [
      'npm i -g harbor-light && harbor-light doctor',
      'https://github.com/someone/harbor-light/issues',
      'HARBOR_LIGHT_HOME=~/.harbor-light',
      'interface HarborLightFooters {} const harborLight = 1;',
      "'c:/users/ADA/.Harbor-Light/Config.json' '/USERS/ADA/.HARBOR-LIGHT'",
      'C:/Users/ada/HARBOR~1/x harbor~12 HA1A2B~5',
      'old devam · old_tool · OLDTOOL~1 · mcp__harbor-light__flow_step',
    ].join('\n'),
  );
  assert.equal(r.count, 13);
  const moved = renameText('github.com/someone/old-tool.git', { ...plan, to: { ...plan.to, repo: 'harbor-org/harbor' } });
  assert.equal(moved.text, 'github.com/harbor-org/harbor.git', 'the repository first, then the id: no half-renamed address');
});

test('the identity file: the old name recorded first, earlier ones kept as they were, the display name and finality set', () => {
  const once = renameApp(APP, plan).text;
  assert.match(once, /export const APP_ID = 'harbor-light';/);
  assert.match(once, /export const APP_NAME = 'Harbor Light';/);
  assert.match(once, /export const NAME_IS_FINAL = true;/);
  assert.match(once, /PREVIOUS_NAMES: readonly \{ readonly id: string; readonly name: string \}\[\] = \[\{ id: 'old-tool', name: 'old-tool' \}\];/);
  assert.match(once, /export const LANG_ENV = 'HARBOR_LIGHT_LANG';/);
  const second: RenamePlan = {
    from: { id: 'harbor-light', name: 'Harbor Light', repo: plan.to.repo },
    to: { id: 'beacon', name: "Bea'con", repo: 'o/beacon' },
    final: false,
  };
  const twice = renameApp(once, second).text;
  assert.match(twice, /= \[\{ id: 'harbor-light', name: 'Harbor Light' \}, \{ id: 'old-tool', name: 'old-tool' \}\];/, 'the earlier names are never renamed');
  assert.match(twice, /export const APP_NAME = 'Bea\\'con';/);
  assert.match(twice, /export const NAME_IS_FINAL = false;/);
  const back = renameApp(twice, { ...second, from: second.to, to: { id: 'harbor-light', name: 'Harbor Light', repo: 'o/h' } }).text;
  assert.match(back, /= \[\{ id: 'beacon', name: 'Bea\\'con' \}, \{ id: 'old-tool', name: 'old-tool' \}\];/, 'a name taken back is no longer an earlier one');
  assert.throws(() => renameApp('nothing here', plan), /PREVIOUS_NAMES not found/);
  // The real identity file has the statement the rename looks for.
  assert.doesNotThrow(() => renameApp(readFileSync(join(ROOT, 'src', 'core', 'app.ts'), 'utf8'), plan));
});

test('the READMEs lose the notice that the name is temporary; the changelog gains the rename', () => {
  assert.equal(dropTemporary('# x\n\n<!-- name:temporary -->\n\n> temporary\n\n<!-- /name:temporary -->\n\n## Next\n'), '# x\n\n## Next\n');
  for (const f of ['README.md', 'README.tr.md']) assert.equal(dropTemporary(readFileSync(join(ROOT, f), 'utf8')).includes('name:temporary'), false, f);
  const changelog = noteRename('# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a\n\n### Changed\n\n- b\n\n## [0.1.0]\n\n### Changed\n\n- c\n', plan);
  assert.match(
    changelog,
    /### Changed\n\n- The tool is now called Harbor Light \(it was old-tool\)\. `harbor-light install` moves[^\n]*`HARBOR_LIGHT_\*`[^\n]*\n- b\n\n## \[0\.1\.0\]\n\n### Changed\n\n- c\n$/,
  );
  const without = noteRename('## [Unreleased]\n\n### Added\n\n- a\n', plan);
  assert.match(without, /### Added\n\n- a\n\n### Changed\n\n- The tool is now called/);
  assert.throws(() => noteRename('# nothing', plan), /no \[Unreleased\]/);
});

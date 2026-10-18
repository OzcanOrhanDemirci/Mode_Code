// SPDX-License-Identifier: Apache-2.0
// Skills (src/core/skills.ts, skills/, skills-managed/, skills-external/): each named once, each file where it should
// be and saying who runs it, the person's own turned so, what the plugin keeps, and the list of everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandsText, CORE_SKILLS, keptSkills, LIST_COMMANDS, personOnly, shortCommands, skillHeader } from '../../src/core/skills.js';
import { EXTERNAL_SKILLS } from '../../src/core/skills-external.js';
import { COMMANDS } from '../../src/core/controls.js';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test("Mode_Code's skills: unique names in both languages, each file where it belongs and saying who runs it", () => {
  const ids = CORE_SKILLS.map((s) => s.id);
  const trs = CORE_SKILLS.map((s) => s.tr);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(trs).size, trs.length);
  assert.equal(CORE_SKILLS.filter((s) => s.who === 'person').length, 20, 'the person runs 20 now; 2 more come with the project checks (A9)');
  assert.equal(CORE_SKILLS.filter((s) => s.who === 'model').length, 3);
  // No short command takes a control's name, nor the list's.
  for (const s of CORE_SKILLS) assert.ok(!COMMANDS.some((c) => c.name === s.tr) && !(LIST_COMMANDS as readonly string[]).includes(s.tr), s.tr);
  for (const s of CORE_SKILLS) {
    if (s.kind !== 'skill') {
      assert.equal(existsSync(join(root, 'skills', s.id)), false, `${s.id} is a ${s.kind}, not a skill file`);
      continue;
    }
    const file = s.managed ? `skills-managed/${s.id}/SKILL.md` : `skills/${s.id}/SKILL.md`;
    const text = read(file);
    const h = skillHeader(text);
    assert.equal(h.name, s.id, file);
    assert.ok(h.description && h.description.length < 300, `${file}: description`);
    assert.equal(h.personOnly, s.who === 'person', `${file}: who runs it`);
    assert.ok(!/[—–]/.test(text), `${file}: no long dash`);
    assert.ok(text.length < 3000, `${file}: ${text.length} characters`);
  }
  // Every folder is a skill of the list.
  for (const d of readdirSync(join(root, 'skills'))) assert.ok(ids.includes(d), `skills/${d}`);
  for (const d of readdirSync(join(root, 'skills-managed'))) assert.ok(CORE_SKILLS.find((s) => s.id === d)?.managed, `skills-managed/${d}`);
});

test('the skills of others: each folder with its skill and its licence, a permissive licence, no name taken twice', () => {
  const ids = Object.keys(EXTERNAL_SKILLS);
  assert.ok(ids.length >= 30, String(ids.length));
  const sources = JSON.parse(read('skills-external/sources.json')) as Record<string, { commit: string; license: string }>;
  assert.deepEqual(Object.keys(sources).sort(), [...ids].sort(), 'the code and the folder say the same');
  for (const id of ids) {
    const s = EXTERNAL_SKILLS[id]!;
    assert.ok(!CORE_SKILLS.some((c) => c.id === id), `${id}: a name of Mode_Code's own`);
    assert.match(s.commit, /^[0-9a-f]{40}$/, `${id}: pinned to a commit`);
    assert.match(s.license, /^(?:MIT|Apache-2\.0|BSD-[23]-Clause|CC0-1\.0)$/, `${id}: ${s.license}`);
    assert.ok(existsSync(join(root, 'skills-external', id, 'SKILL.md')), `${id}: SKILL.md`);
    assert.ok(existsSync(join(root, 'skills-external', id, 'LICENSE.source')), `${id}: its licence`);
    assert.equal(skillHeader(read(`skills-external/${id}/SKILL.md`)).name, id, `${id}: its own name`);
    for (const f of s.files) assert.ok(existsSync(join(root, 'skills-external', id, f)), `${id}: ${f}`);
  }
});

test("a skill made the person's alone: the flag set once, the rest of the file as it was", () => {
  const text = '---\nname: x\ndescription: Does x.\n---\n\nBody.\n';
  const once = personOnly(text);
  assert.equal(once, '---\nname: x\ndescription: Does x.\ndisable-model-invocation: true\n---\n\nBody.\n');
  assert.equal(personOnly(once), once, 'twice is once');
  assert.equal(personOnly('---\nname: x\ndisable-model-invocation: false\n---\nB'), '---\nname: x\ndisable-model-invocation: true\n---\nB');
  assert.equal(personOnly('No header.'), '---\ndisable-model-invocation: true\n---\n\nNo header.');
  assert.equal(personOnly('---\r\nname: x\r\n---\r\nB'), '---\nname: x\ndisable-model-invocation: true\n---\r\nB');
  assert.deepEqual(skillHeader(once), { name: 'x', description: 'Does x.', personOnly: true });
  assert.deepEqual(skillHeader('---\nname: \'y\'\ndescription: "Quoted: yes."\n---\n'), { name: 'y', description: 'Quoted: yes.', personOnly: false });
  assert.deepEqual(skillHeader('none'), { name: null, description: null, personOnly: false });
});

test('what the plugin keeps: the memory note once a memory is set up, the skills of others turned on, as the person chose', () => {
  assert.deepEqual(keptSkills({ memory: false, external: {} }), []);
  assert.deepEqual(keptSkills({ memory: true, external: { tdd: 'on', teach: 'me', humanizer: 'off' } }), [
    { id: 'memory-note', own: true, personOnly: false },
    { id: 'tdd', own: false, personOnly: false },
    { id: 'teach', own: false, personOnly: true },
  ]);
});

test("the short commands: in Turkish only, the person's skills; the list of everything in sections, empty ones left out", () => {
  assert.deepEqual(shortCommands('en'), []);
  const tr = shortCommands('tr').map((x) => x.name);
  assert.ok(tr.includes('dogrula') && tr.includes('geri-al') && !tr.includes('olc'));
  const text = commandsText(
    [
      { head: 'Keywords', rows: [{ name: 'continue', text: 'devam' }] },
      { head: 'Empty', rows: [] },
      { head: 'Skills', rows: [{ name: '/plugin-x:verify', text: 'Verify.' }] },
    ],
    'The end.',
  );
  assert.equal(text, 'Keywords\n  continue          devam\n\nSkills\n  /plugin-x:verify  Verify.\n\nThe end.');
});

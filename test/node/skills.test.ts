// SPDX-License-Identifier: Apache-2.0
// The skills kept in the plugin's folder (src/node/skills.ts): put there when they apply or are turned on, taken away
// when not, made the person's alone when they chose so; the skills the plugin ships never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneDefaults, type Config } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { memorySetUp, syncKeptSkills } from '../../src/node/skills.js';

function place() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-skills-'));
  const l = layout(join(dir, 'data'));
  const source = join(dir, 'source');
  const skill = (where: string, id: string, extra = '') => {
    mkdirSync(join(source, where, id), { recursive: true });
    writeFileSync(join(source, where, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id}.\n${extra}---\n\nBody of ${id}.\n`);
  };
  skill('own', 'memory-note');
  skill('external', 'tdd');
  skill('external', 'teach');
  writeFileSync(join(source, 'external', 'tdd', 'tests.md'), 'beside it');
  // A skill the plugin ships: never touched.
  mkdirSync(join(l.pluginDir, 'skills', 'verify'), { recursive: true });
  writeFileSync(join(l.pluginDir, 'skills', 'verify', 'SKILL.md'), 'shipped');
  return { dir, l, source, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const config = (over: { memory?: boolean; items?: Config['skills']['items'] } = {}): Config => {
  const c = cloneDefaults();
  if (over.memory) c.memory.dirs = ['/notes'];
  c.skills.items = over.items ?? {};
  return c;
};

test('kept: the memory note once a memory is set up, the skills of others turned on, each marked; taken away again', () => {
  const p = place();
  try {
    const dir = join(p.l.pluginDir, 'skills');
    assert.deepEqual(syncKeptSkills(p.l, config(), p.source), { added: [], removed: [] });
    const r = syncKeptSkills(p.l, config({ memory: true, items: { tdd: 'on', teach: 'me' } }), p.source);
    assert.deepEqual(r, { added: ['memory-note', 'tdd', 'teach'], removed: [] });
    assert.equal(readFileSync(join(dir, 'tdd', 'tests.md'), 'utf8'), 'beside it', 'the files beside it come too');
    assert.doesNotMatch(readFileSync(join(dir, 'tdd', 'SKILL.md'), 'utf8'), /disable-model-invocation/);
    assert.match(readFileSync(join(dir, 'teach', 'SKILL.md'), 'utf8'), /disable-model-invocation: true/, "the person's alone");
    assert.equal(readFileSync(join(dir, 'teach', '.kept'), 'utf8'), 'me');
    // Again: nothing changes.
    assert.deepEqual(syncKeptSkills(p.l, config({ memory: true, items: { tdd: 'on', teach: 'me' } }), p.source), { added: [], removed: [] });
    // A state changed: the copy is made again as chosen, and it counts as neither added nor removed.
    assert.deepEqual(syncKeptSkills(p.l, config({ memory: true, items: { tdd: 'me', teach: 'me' } }), p.source), { added: [], removed: [] });
    assert.match(readFileSync(join(dir, 'tdd', 'SKILL.md'), 'utf8'), /disable-model-invocation: true/);
    // Turned off, the memory gone: taken away; the shipped skill stays.
    assert.deepEqual(syncKeptSkills(p.l, config({ items: { teach: 'me' } }), p.source), { added: [], removed: ['memory-note', 'tdd'] });
    assert.equal(existsSync(join(dir, 'tdd')), false);
    assert.equal(readFileSync(join(dir, 'verify', 'SKILL.md'), 'utf8'), 'shipped');
  } finally {
    p.done();
  }
});

test('a name the plugin ships is never replaced, and a skill missing from the source is not kept', () => {
  const p = place();
  try {
    mkdirSync(join(p.source, 'external', 'verify'), { recursive: true });
    writeFileSync(join(p.source, 'external', 'verify', 'SKILL.md'), 'theirs');
    assert.deepEqual(syncKeptSkills(p.l, config({ items: { verify: 'on', ghost: 'on' } }), p.source), { added: [], removed: [] });
    assert.equal(readFileSync(join(p.l.pluginDir, 'skills', 'verify', 'SKILL.md'), 'utf8'), 'shipped');
    assert.equal(memorySetUp(config()), false);
    assert.equal(memorySetUp(config({ memory: true })), true);
  } finally {
    p.done();
  }
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The skills this tool keeps in its plugin's folder (docs/skills.md): Mode_Code's own that apply only sometimes (the
 * memory note, once a memory is set up) and the skills of others the person turned on. Claude Code reads the plugin
 * from its folder in place, so a skill put there or taken away is loaded at `/reload-plugins` or the next session.
 * Each kept skill carries a `.kept` mark: the skills the plugin ships are never touched.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../core/config.js';
import type { Layout } from '../core/layout.js';
import { keptSkills, personOnly } from '../core/skills.js';

const MARK = '.kept';

/** Where the skills to keep come from: copied beside the marketplace at install (own/, external/). */
export const skillsSource = (l: Layout) => join(l.marketplace, 'skills-source');

/** Whether a memory is set up here: the memory note applies. */
export const memorySetUp = (c: Config) => c.memory.store !== null || c.memory.dirs.length > 0;

/** The skills the settings keep that the plugin's folder lacks (the doctor's install.skills). */
export function missingKeptSkills(l: Layout, c: Config): string[] {
  return keptSkills({ memory: memorySetUp(c), external: c.skills.items })
    .filter((k) => !existsSync(join(l.pluginDir, 'skills', k.id, 'SKILL.md')))
    .map((k) => k.id);
}

/**
 * Puts the skills that should be kept into the plugin's skills folder and takes away the kept ones that should not.
 * `source` is where they are copied from (the marketplace's copy, or a build's folder). Returns what changed.
 */
export function syncKeptSkills(l: Layout, c: Config, source = skillsSource(l)): { added: string[]; removed: string[] } {
  const dir = join(l.pluginDir, 'skills');
  const want = keptSkills({ memory: memorySetUp(c), external: c.skills.items });
  const added: string[] = [];
  const removed: string[] = [];
  const kept = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, MARK))) : [];
  for (const id of kept) {
    const w = want.find((x) => x.id === id);
    const was = readFileSync(join(dir, id, MARK), 'utf8').trim();
    // Kept as it should be (and as the person chose: theirs alone or not): left in place.
    if (w && was === (w.personOnly ? 'me' : 'on')) continue;
    rmSync(join(dir, id), { recursive: true, force: true });
    if (!w) removed.push(id);
  }
  for (const w of want) {
    const target = join(dir, w.id);
    if (existsSync(join(target, MARK))) continue;
    // A skill the plugin ships under the same name is never replaced.
    if (existsSync(target)) continue;
    const from = join(source, w.own ? 'own' : 'external', w.id);
    if (!existsSync(join(from, 'SKILL.md'))) continue;
    mkdirSync(dir, { recursive: true });
    cpSync(from, target, { recursive: true });
    if (w.personOnly) writeFileSync(join(target, 'SKILL.md'), personOnly(readFileSync(join(target, 'SKILL.md'), 'utf8')));
    writeFileSync(join(target, MARK), w.personOnly ? 'me' : 'on');
    if (!kept.includes(w.id)) added.push(w.id);
  }
  return { added, removed };
}

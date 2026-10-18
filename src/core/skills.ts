// SPDX-License-Identifier: Apache-2.0
/**
 * Skills (A5 of 1.2.0, docs/skills.md): what Claude can be asked to do in one step, written as a `SKILL.md`. Mode_Code's
 * own are in its plugin (`/mode-code:verify`): those only the person runs cost nothing in the session (their
 * description is not listed), the two Claude may use itself are listed. A few are in a second plugin whose folder
 * this tool keeps (`mode-code-skills`), where a skill is there only when it applies (the memory note, once a memory
 * is set up) and where the skills of others are put, each off until the person turns it on. In Turkish, each of the
 * person's skills also has a short command of its own (`/dogrula`). Pure.
 */
import { APP_ID } from './app.js';
import type { Config } from './config.js';
import type { KeywordList } from './keywords.js';

/** Whether a memory is set up here: the memory note and the lessons at a wrap-up apply. */
export const memorySetUp = (c: Config) => c.memory.store !== null || c.memory.dirs.length > 0;

export type SkillWho = 'person' | 'model';

export interface CoreSkill {
  /** The skill's name in English: its folder, and `/mode-code:<id>`. */
  id: string;
  /** Its short command in Turkish (`/dogrula`). */
  tr: string;
  /** A skill file; a keyword's short form; or a short form of one of Claude Code's own commands. */
  kind: 'skill' | 'keyword' | 'builtin';
  /** The keyword a short form stands for. */
  keyword?: KeywordList;
  /** The Claude Code command a short form runs (`rewind`). */
  builtin?: string;
  /** Who runs it: the person only (nothing listed, nothing spent), or Claude too. */
  who: SkillWho;
  /** In the plugin this tool keeps, there only while this holds. */
  managed?: 'memory';
  /** One line for the commands page. */
  summary: string;
}

export const CORE_SKILLS: readonly CoreSkill[] = [
  {
    id: 'wrap-up',
    tr: 'toparla',
    kind: 'keyword',
    keyword: 'wrapUp',
    who: 'person',
    summary: 'Wrap up: finish the step, keep the work, write the handoff note.',
  },
  { id: 'status', tr: 'durum', kind: 'keyword', keyword: 'status', who: 'person', summary: 'Where the work, the mode and the quota stand.' },
  { id: 'handoff', tr: 'devir', kind: 'keyword', keyword: 'handoff', who: 'person', summary: 'Write the handoff note for the next session.' },
  // Claude Code keeps a checkpoint before each message and its /rewind puts the code (or the conversation) back.
  {
    id: 'undo',
    tr: 'geri-al',
    kind: 'builtin',
    builtin: 'rewind',
    who: 'person',
    summary: "Claude Code's rewind: the code or the conversation as it was before a message.",
  },
  { id: 'verify', tr: 'dogrula', kind: 'skill', who: 'person', summary: 'Verify the work with fresh evidence before calling it done.' },
  { id: 'second-opinion', tr: 'bagimsiz-goz', kind: 'skill', who: 'person', summary: 'An independent agent reviews the work against the request.' },
  { id: 'quota-report', tr: 'kota-rapor', kind: 'skill', who: 'person', summary: 'How the quota is being spent, from the measurements.' },
  { id: 'cost-estimate', tr: 'maliyet-tahmin', kind: 'skill', who: 'person', summary: 'What a planned task would take of the quota, from past work.' },
  { id: 'packs', tr: 'paket', kind: 'skill', who: 'person', summary: 'The tool packs, which are on here, which would help.' },
  { id: 'trust-audit', tr: 'guven-denetimi', kind: 'skill', who: 'person', summary: 'Audit the plugins, hooks, MCP servers and skills that run.' },
  { id: 'belt', tr: 'kemer', kind: 'skill', who: 'person', summary: 'What the safety belt stopped, and what it would do with a command.' },
  { id: 'security', tr: 'guvenlik', kind: 'skill', who: 'person', summary: 'Secrets, vulnerable dependencies and risky settings in the project.' },
  { id: 'project-intro', tr: 'proje-tanit', kind: 'skill', who: 'person', summary: 'A true introduction to the project, from its files.' },
  { id: 'release-prep', tr: 'surum-hazirla', kind: 'skill', who: 'person', summary: 'Prepare a release, stopping before anything is published.' },
  { id: 'pr-prep', tr: 'pr-hazirla', kind: 'skill', who: 'person', summary: 'Prepare a pull request, stopping before it is opened.' },
  { id: 'dependency-update', tr: 'bagimlilik-guncelle', kind: 'skill', who: 'person', summary: 'Update dependencies safely, each group tested.' },
  { id: 'memory-care', tr: 'hafiza-bakim', kind: 'skill', who: 'person', summary: 'The memory: what no longer loads, repeats or contradicts itself.' },
  { id: 'lessons', tr: 'ders-cikar', kind: 'skill', who: 'person', summary: 'The lessons of this session, as proposed memory notes.' },
  { id: 'session-search', tr: 'oturum-ara', kind: 'skill', who: 'person', summary: 'Find a past session by what was said or done in it.' },
  { id: 'report-issue', tr: 'sorun-bildir', kind: 'skill', who: 'person', summary: 'Draft an issue for Mode_Code, private details taken out.' },
  { id: 'commit', tr: 'commit', kind: 'skill', who: 'model', summary: 'Commit as the project expects: its style, one change, why and how.' },
  { id: 'measure', tr: 'olc', kind: 'skill', who: 'model', summary: 'Measure before stating a number.' },
  {
    id: 'memory-note',
    tr: 'bellek-yaz',
    kind: 'skill',
    who: 'model',
    managed: 'memory',
    summary: 'Save to the memory: one fact per file, the index short, no secrets.',
  },
];

/** The plugin whose skills folder this tool keeps. */
export const SKILLS_PLUGIN = `${APP_ID}-skills`;

/** The person's choice for a skill of someone else's: off (the default), only when they run it, or Claude may use it. */
export type SkillState = 'off' | 'me' | 'on';
export const SKILL_STATES: readonly SkillState[] = ['off', 'me', 'on'];

/** The short commands of the person's skills, in their language: only in Turkish, whose names nothing else takes. */
export function shortCommands(lang: 'en' | 'tr'): { name: string; skill: CoreSkill }[] {
  if (lang !== 'tr') return [];
  return CORE_SKILLS.filter((s) => s.who === 'person').map((skill) => ({ name: skill.tr, skill }));
}

/**
 * A skill made the person's alone: `disable-model-invocation: true` in its frontmatter, so Claude Code neither lists
 * it nor lets Claude load it; the rest of the file as it was. A file without frontmatter gets one.
 */
export function personOnly(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return `---\ndisable-model-invocation: true\n---\n\n${text}`;
  const lines = m[1]!.split(/\r?\n/).filter((l) => !/^disable-model-invocation\s*:/.test(l));
  return `---\n${[...lines, 'disable-model-invocation: true'].join('\n')}\n---${m[2]}${text.slice(m[0].length)}`;
}

/** The name and description a skill's frontmatter gives. */
export function skillHeader(text: string): { name: string | null; description: string | null; personOnly: boolean } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = (k: string) => {
    const v = m ? new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm').exec(m[1]!)?.[1]?.trim() : undefined;
    return v ? v.replace(/^(['"])(.*)\1$/, '$2') : null;
  };
  return { name: field('name'), description: field('description'), personOnly: field('disable-model-invocation') === 'true' };
}

/** The command that lists every keyword, command and skill: in both languages, as the controls are. */
export const LIST_COMMANDS = ['komutlar', 'commands'] as const;

/** The list `/komutlar` answers with: its sections, each a heading and one line per entry. */
export function commandsText(sections: readonly { head: string; rows: readonly { name: string; text: string }[] }[], tail: string): string {
  const width = Math.min(28, Math.max(0, ...sections.flatMap((s) => s.rows.map((r) => r.name.length))));
  return [...sections.filter((s) => s.rows.length).map((s) => [s.head, ...s.rows.map((r) => `  ${r.name.padEnd(width)}  ${r.text}`)].join('\n')), tail].join(
    '\n\n',
  );
}

/** The skills the kept plugin holds: Mode_Code's own whose condition holds, and the others' the person turned on. */
export function keptSkills(o: { memory: boolean; external: Readonly<Record<string, SkillState>> }): { id: string; own: boolean; personOnly: boolean }[] {
  const own = CORE_SKILLS.filter((s) => s.managed === 'memory' && o.memory).map((s) => ({ id: s.id, own: true, personOnly: false }));
  const others = Object.entries(o.external)
    .filter(([, state]) => state === 'me' || state === 'on')
    .map(([id, state]) => ({ id, own: false, personOnly: state === 'me' }));
  return [...own, ...others];
}

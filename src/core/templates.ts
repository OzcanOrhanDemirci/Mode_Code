// SPDX-License-Identifier: Apache-2.0
/**
 * Rule templates: ready-made rules for common situations, in two layers. The text layer is a few lines
 * Claude reads (kept in a marked block of the project's CLAUDE.md); the code layer is settings the safety
 * belt enforces (repository lists, rule packs). A template only ever tightens: it adds to lists and turns
 * packs on, it never switches a rule off. Pure.
 */
import { APP_ID, APP_NAME, PREVIOUS_NAMES } from './app.js';
import type { Config } from './config.js';
import { normalizeRemote } from './belt/git.js';
import type { Lang } from './i18n/index.js';

export interface ConfigChange {
  path: 'belt.prOnlyRepos' | 'belt.singleBranchRepos' | 'belt.packs';
  /** What the change does, for the preview, per language. */
  text: Record<Lang, string>;
  apply(c: Config): unknown;
}

export interface Template {
  id: string;
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  /** Short rules Claude reads. A few lines at most: a template is not a manual. */
  rules: Record<Lang, string[]>;
  /** Belt settings it adds; `remote` is the current repository's remote, when there is one. */
  changes?(remote: string | null): ConfigChange[];
  /** True when the template needs the folder to be a git repository with a remote. */
  needsRemote?: boolean;
}

const add = (list: readonly string[] | undefined, v: string) => (list?.includes(v) ? [...list] : [...(list ?? []), v]);

export const TEMPLATES: readonly Template[] = [
  {
    id: 'public-repo',
    name: { en: 'Public repository', tr: 'Herkese açık depo' },
    description: {
      en: 'For a repository anyone can read: no secrets in files, main changes only through pull requests.',
      tr: 'Herkesin okuyabildiği bir depo için: dosyalarda sır yok, ana dal yalnız pull request ile değişir.',
    },
    rules: {
      en: [
        'This repository is public. Never write secrets (keys, tokens, passwords) into files, including tests and examples.',
        'Change the main branch only through pull requests; work on a branch.',
      ],
      tr: [
        'Bu depo herkese açık. Dosyalara (testler ve örnekler dahil) asla sır (anahtar, token, parola) yazma.',
        'Ana dalı yalnız pull request ile değiştir; bir dalda çalış.',
      ],
    },
    needsRemote: true,
    changes: (remote) =>
      remote
        ? [
            {
              path: 'belt.prOnlyRepos',
              text: { en: `Direct pushes to main of ${remote} are blocked`, tr: `${remote} ana dalına doğrudan push engellenir` },
              apply: (c) => add(c.belt.prOnlyRepos, remote),
            },
          ]
        : [],
  },
  {
    id: 'pr-only',
    name: { en: 'Main only through pull requests', tr: 'Ana dal yalnız PR ile' },
    description: {
      en: 'The protected branches of this repository change only through pull requests.',
      tr: 'Bu deponun korunan dalları yalnız pull request ile değişir.',
    },
    rules: {
      en: ['Never push to the main branch directly; open a pull request.'],
      tr: ['Ana dala asla doğrudan push etme; pull request aç.'],
    },
    needsRemote: true,
    changes: (remote) =>
      remote
        ? [
            {
              path: 'belt.prOnlyRepos',
              text: { en: `Direct pushes to main of ${remote} are blocked`, tr: `${remote} ana dalına doğrudan push engellenir` },
              apply: (c) => add(c.belt.prOnlyRepos, remote),
            },
          ]
        : [],
  },
  {
    id: 'single-branch',
    name: { en: 'One branch', tr: 'Tek dal' },
    description: { en: 'Work happens on one branch; new branches are refused.', tr: 'İş tek dalda yürür; yeni dal açılması reddedilir.' },
    rules: {
      en: ['Work on the current branch only; do not create branches or worktrees with new branches.'],
      tr: ['Yalnız şu anki dalda çalış; dal ya da yeni dallı worktree açma.'],
    },
    needsRemote: true,
    changes: (remote) =>
      remote
        ? [
            {
              path: 'belt.singleBranchRepos',
              text: { en: `Creating branches in ${remote} is blocked`, tr: `${remote} içinde dal açmak engellenir` },
              apply: (c) => add(c.belt.singleBranchRepos, remote),
            },
          ]
        : [],
  },
  {
    id: 'server',
    name: { en: 'Production server', tr: 'Üretim sunucusu' },
    description: {
      en: 'For a machine that serves others: Docker data is not deleted, nothing outside the project is deleted in bulk.',
      tr: 'Başkalarına hizmet veren bir makine için: Docker verisi silinmez, proje dışında toplu silme yapılmaz.',
    },
    rules: {
      en: [
        'This machine is a production server. Do not delete Docker volumes or prune Docker data.',
        'Do not delete files outside this project; ask first when something must be removed.',
      ],
      tr: [
        'Bu makine bir üretim sunucusu. Docker birimlerini silme, Docker verisini budama.',
        'Bu projenin dışında dosya silme; bir şeyin kaldırılması gerekiyorsa önce sor.',
      ],
    },
    changes: () => [
      {
        path: 'belt.packs',
        text: { en: 'The Docker pack is turned on: deleting volumes and pruning are blocked', tr: 'Docker paketi açılır: birim silme ve budama engellenir' },
        apply: (c) => ({ ...c.belt.packs, dockerVolumes: true }),
      },
    ],
  },
  {
    id: 'flutter',
    name: { en: 'Flutter project', tr: 'Flutter projesi' },
    description: {
      en: 'Analyze before committing; leave generated files to the generator.',
      tr: 'Commit öncesi analiz; üretilen dosyalar üreticiye bırakılır.',
    },
    rules: {
      en: [
        'Run `flutter analyze` before each commit and fix what it reports.',
        'Do not edit generated files (`*.g.dart`, `*.freezed.dart`); change the source and run `dart run build_runner build`.',
      ],
      tr: [
        "Her commit'ten önce `flutter analyze` çalıştır ve bildirdiklerini düzelt.",
        'Üretilen dosyaları (`*.g.dart`, `*.freezed.dart`) elle düzenleme; kaynağı değiştir ve `dart run build_runner build` çalıştır.',
      ],
    },
  },
  {
    id: 'measured',
    name: { en: 'Measure before claiming', tr: 'İddiadan önce ölç' },
    description: { en: 'No result is reported that was not run and read.', tr: 'Çalıştırılıp okunmamış hiçbir sonuç bildirilmez.' },
    rules: {
      en: [
        'Do not report a result you did not measure: run it, read the output, then report.',
        'Say what was not verified, and when an earlier statement of yours turns out wrong, say so.',
      ],
      tr: ['Ölçmediğin bir sonucu bildirme: çalıştır, çıktıyı oku, sonra bildir.', 'Doğrulanmayanı söyle; önceki bir iddian yanlış çıkarsa bunu da söyle.'],
    },
  },
  {
    // The plan's "Compact Instructions" (A7 of 1.2.0): what a compaction loses costs the session a retelling.
    id: 'compact-keep',
    name: { en: 'Compaction keeps the work', tr: 'Sıkıştırma işi korur' },
    description: {
      en: 'A compacted conversation keeps decisions, paths, errors and what is unverified, so nothing is told twice.',
      tr: 'Sıkıştırılan konuşma kararları, yolları, hataları ve doğrulanmayanı korur; hiçbir şey iki kez anlatılmaz.',
    },
    rules: {
      en: [
        'When this conversation is compacted, keep in the summary: the decisions made, word for word; file paths with line ranges, not code; error messages exactly; what is not verified yet; the next step.',
      ],
      tr: [
        'Bu konuşma sıkıştırılırken özette şunları koru: alınan kararlar birebir; dosya yolları satır aralıklarıyla, kod değil; hata mesajları aynen; henüz doğrulanmamış olanlar; sıradaki adım.',
      ],
    },
  },
  {
    id: 'plain-docs',
    name: { en: 'Plain writing', tr: 'Sade yazı' },
    description: {
      en: 'Documents for people: short sentences, no long dashes, terms explained.',
      tr: 'İnsanlar için belgeler: kısa cümleler, uzun çizgi yok, terimler açıklanır.',
    },
    rules: {
      en: ['In documents for people, write plain sentences with one idea each, use no long dashes, and explain technical terms where they first appear.'],
      tr: ['İnsanlar için yazılan belgelerde her cümlede tek fikir olan sade cümleler kur, uzun çizgi kullanma, teknik terimleri ilk geçtikleri yerde açıkla.'],
    },
  },
];

/**
 * The form a remote is recorded in for the belt's repository lists: host and path, no protocol or user,
 * so it matches however the remote is spelled (https or ssh), the way the belt compares remotes.
 */
export function repoKey(url: string): string {
  return normalizeRemote(url);
}

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

const marks = (id: string) => ({ begin: `<!-- ${id}:templates -->`, end: `<!-- /${id}:templates -->` });
const { begin: BEGIN, end: END } = marks(APP_ID);

/** Where the marked block is: under this name's markers, or an earlier name's (written back under this name's). */
function marked(text: string): { a: number; b: number; begin: string; end: string } | null {
  for (const id of [APP_ID, ...PREVIOUS_NAMES.map((p) => p.id)]) {
    const { begin, end } = marks(id);
    const a = text.indexOf(begin);
    const b = text.indexOf(end);
    if (a !== -1 && b !== -1 && b > a) return { a, b, begin, end };
  }
  return null;
}

/** The template ids recorded in a CLAUDE.md's marked block. */
export function appliedTemplates(claudeMd: string | null): string[] {
  if (!claudeMd) return [];
  const block = between(claudeMd);
  if (block === null) return [];
  return [...block.matchAll(/<!-- template:([a-z0-9-]+) -->/g)].map((m) => m[1]!);
}

function between(text: string): string | null {
  const m = marked(text);
  return m ? text.slice(m.a + m.begin.length, m.b) : null;
}

/** CLAUDE.md with the marked block holding exactly these templates' rules (removed when the list is empty). */
export function withTemplates(claudeMd: string | null, ids: readonly string[], lang: Lang): string {
  const text = claudeMd ?? '';
  const known = ids.map(templateById).filter((t): t is Template => !!t);
  const block = known.length
    ? [
        BEGIN,
        lang === 'tr' ? `## ${APP_NAME} şablonlarından kurallar` : `## Rules from ${APP_NAME} templates`,
        '',
        ...known.flatMap((t) => [`<!-- template:${t.id} -->`, `### ${t.name[lang]}`, '', ...t.rules[lang].map((r) => `- ${r}`), '']),
        END,
      ].join('\n')
    : '';
  const m = marked(text);
  if (m) {
    const before = text.slice(0, m.a).replace(/\n+$/, '');
    const after = text.slice(m.b + m.end.length).replace(/^\n+/, '');
    return [before, block, after].filter((x) => x.length > 0).join('\n\n') + (block || before || after ? '\n' : '');
  }
  if (!block) return text;
  return text.trim() ? `${text.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;
}

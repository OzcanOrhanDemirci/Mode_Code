// SPDX-License-Identifier: Apache-2.0
/**
 * The first installation's choices (docs/design.md, Command line and setup). Five steps, each said with its place
 * and title, a sentence or two in plain words on what it decides, then its question, with room around it; the simple
 * view asks three and says why the other two are not asked. Then the summary the one yes rests on: the choices under
 * the steps' own names and in words rather than on or off, what the installation does, and how to change or undo it.
 * The questions go through a SetupIO, so the terminal and the tests drive the same steps.
 */
import type { SetupIO } from '../app/memory-setup.js';
import { cloneDefaults, type Config, type FooterMode, type ViewLevel } from '../core/config.js';
import { sampleFooter } from '../core/footer.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import type { PlanStep, StepKind } from '../node/install.js';
import { bold, cyan, dim, gray, green, padEnd, red, width } from './style.js';

/**
 * The installation's steps said in what they change rather than in their parts: Mode_Code's files, its plugin, the
 * protection connected to Claude Code, the self-test. Moving from an earlier name keeps the words of its own steps.
 */
const PART: Record<StepKind, 'files' | 'plugin' | 'settings' | 'test' | null> = {
  'data-folder': 'files',
  'hook-program': 'files',
  config: 'files',
  marketplace: 'plugin',
  plugin: 'plugin',
  'settings-hooks': 'settings',
  'self-test': 'test',
  migrate: null,
  'retire-previous': null,
};

function parts<S extends { kind: StepKind }>(steps: readonly S[]): { part: string; steps: S[] }[] {
  const out: { part: string; steps: S[] }[] = [];
  for (const s of steps) {
    const part = PART[s.kind] ?? s.kind;
    const found = out.find((p) => p.part === part);
    if (found) found.steps.push(s);
    else out.push({ part, steps: [s] });
  }
  return out;
}

/** What the installation will do, a line for each part; a part already in place is marked so. */
export function planLines(lang: Lang, steps: readonly PlanStep[], dataDir: string): string[] {
  return parts(steps).map(({ part, steps: s }) => {
    const text = PART[s[0]!.kind] ? tIn(lang, `install.plan.${part}` as MessageKey, { dir: dataDir }) : tIn(lang, `install.step.${part}` as MessageKey);
    return `    ${s.every((x) => x.done) ? gray('✓') : cyan('+')} ${text}`;
  });
}

/** What the installation did: a line for each part that went well; each step that failed in its own words, with why. */
export function resultLines(lang: Lang, steps: readonly { kind: StepKind; ok: boolean; detail?: string }[]): string[] {
  return parts(steps).flatMap(({ part, steps: s }) => {
    const failed = s.filter((x) => !x.ok);
    if (failed.length) return failed.map((x) => `  ${red('✗')} ${tIn(lang, `install.step.${x.kind}` as MessageKey)}${x.detail ? dim(` · ${x.detail}`) : ''}`);
    return [`  ${green('✓')} ${PART[s[0]!.kind] ? tIn(lang, `install.did.${part}` as MessageKey) : tIn(lang, `install.step.${part}` as MessageKey)}`];
  });
}

const STEPS = 5;
const VIEWS: readonly ViewLevel[] = ['simple', 'recommended', 'detailed'];
const FOOTERS: readonly FooterMode[] = ['draw', 'check', 'off'];

export type InstallChoices = Pick<Partial<Config>, 'view' | 'update' | 'packs' | 'memory' | 'footer'>;

export interface InstallAsk {
  lang: Lang;
  /** The control center's command, named where a choice can be changed later. */
  cli: string;
  /** The memory folder Enter takes (Claude Code's own for the folder the installation runs in), and how it is shown. */
  memory: { dir: string; shown: string };
  /** A memory folder given on the command line (--memory) is not asked for. */
  memoryGiven: boolean;
}

/** Asks the five steps: what the person chose, and whether they were asked for the memory folder (a "-" is a choice too). */
export async function askInstall(io: SetupIO, o: InstallAsk): Promise<{ chosen: InstallChoices; memoryAsked: boolean }> {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(o.lang, k, p);
  const note = (t: string) => (io.note ? io.note(t) : io.say(t));
  // Two empty lines before each step, one between what it decides and its question.
  const step = (n: number, key: string, about: string[], skipped?: string) => {
    io.say();
    io.step?.(n, STEPS, T(`install.ask.${key}.title` as MessageKey), skipped);
    if (skipped) return;
    for (const l of about) {
      if (l) note(`  ${l}`);
      else io.say();
    }
    io.say();
  };
  const chosen: InstallChoices = {};
  io.say();
  io.say(T('install.ask.intro', { cmd: o.cli }));

  step(1, 'view', [T('install.ask.view.about')]);
  const options = VIEWS.map((v) => `${T(`install.ask.${v}` as MessageKey)}\n${T(`install.ask.${v}.about` as MessageKey)}`);
  chosen.view = VIEWS[await io.choose(`  ${T('install.ask.view')}`, options, VIEWS.indexOf('recommended'))];

  // Asked in every view: it is the one thing that reaches the network unasked, so it is never on without a yes
  // (help.privacy). Enter is no.
  step(2, 'update', [T('install.ask.update.about')]);
  chosen.update = { check: await io.confirm(`  ${T('install.ask.update')}`, false) };

  // Automatic use of the tool packs (docs/packs.md): on unless the person says no (K5 of 1.2.0).
  step(3, 'packs', [T('install.ask.packs.about')]);
  chosen.packs = { autoUse: await io.confirm(`  ${T('install.ask.packs')}`, true), items: {} };

  const simple = chosen.view === 'simple';
  let memoryAsked = false;
  if (simple || o.memoryGiven) step(4, 'memory', [], T(simple ? 'install.ask.skipped' : 'install.ask.given'));
  else {
    memoryAsked = true;
    step(4, 'memory', [T('install.ask.memory.about')]);
    const m = await io.ask(`  ${T('install.ask.memory', { suggestion: o.memory.shown })}`, '');
    const dir = m === '' ? o.memory.dir : m === '-' ? null : m;
    if (dir) chosen.memory = { ...cloneDefaults().memory, dirs: [dir] };
  }

  if (simple) step(5, 'footer', [], T('install.ask.skipped'));
  else {
    step(5, 'footer', [T('install.ask.footer.about'), '', ...sampleFooter(o.lang).map((l) => `    ${l}`)]);
    const about = (m: FooterMode) => (m === 'off' ? '' : `\n${T(`install.ask.footer.${m}.about` as MessageKey)}`);
    const f = await io.choose(
      `  ${T('install.ask.footer')}`,
      FOOTERS.map((m) => T(`install.ask.footer.${m}` as MessageKey) + about(m)),
      FOOTERS.indexOf(cloneDefaults().footer.mode),
    );
    chosen.footer = { ...cloneDefaults().footer, mode: FOOTERS[f]! };
  }
  return { chosen, memoryAsked };
}

export interface SummaryOpts {
  lang: Lang;
  cli: string;
  /** How a folder is shown: shortened from the home folder. */
  show(dir: string): string;
  memoryAsked: boolean;
  /** The terminal's columns: the rules are no wider. */
  columns: number;
}

/** The lines the one yes rests on: the choices, what the installation does, and how to change or undo it, between two rules. */
export function installSummary(chosen: InstallChoices, o: SummaryOpts): string[] {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(o.lang, k, p);
  const defaults = cloneDefaults();
  const view = chosen.view ?? defaults.view;
  const footer = chosen.footer?.mode ?? defaults.footer.mode;
  const dirs = chosen.memory?.dirs ?? [];
  const memory = dirs.length
    ? T('install.summary.memory', { dir: dirs.map(o.show).join(', ') })
    : !o.memoryAsked && view === 'simple'
      ? T('install.summary.memory.later', { cmd: `${o.cli} memory setup` })
      : T('install.summary.memory.none');
  const rows: [string, string][] = [
    [T('install.ask.view.title'), T(`install.summary.view.${view}` as MessageKey)],
    [T('install.ask.update.title'), chosen.update?.check ? T('install.summary.update.on') : T('install.summary.update.off', { cmd: `${o.cli} update` })],
    [T('install.ask.packs.title'), T(chosen.packs?.autoUse === false ? 'install.summary.packs.off' : 'install.summary.packs.on')],
    [T('install.ask.memory.title'), memory],
    [T('install.ask.footer.title'), T(`install.summary.footer.${footer}` as MessageKey)],
  ];
  const label = Math.max(...rows.map(([k]) => width(k))) + 4;
  const rule = dim('─'.repeat(Math.max(20, Math.min(60, o.columns - 1))));
  return [
    '',
    '',
    rule,
    '',
    `  ${bold(T('install.summary.title'))}`,
    '',
    `  ${bold(T('install.summary.choices'))}`,
    ...rows.map(([k, v]) => `    ${padEnd(k, label)}${v}`),
    '',
    `  ${bold(T('install.summary.does'))}`,
    ...(['plugin', 'backup', 'test'] as const).map((k) => `    • ${T(`install.summary.does.${k}`)}`),
    '',
    `  ${T('install.summary.later', { cmd: o.cli })}`,
    `  ${T('install.summary.undo', { cmd: `${o.cli} uninstall` })}`,
    '',
    rule,
    '',
  ];
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The catalog (docs/design.md): every setting the person can change and every control of the strip, defined once, with what a surface needs to
 * answer the four questions where the setting stands: what is it, how is it now, what exactly happens if I change
 * it, can I take it back. The control center's rows and cards and `mode-code config explain` draw from here, and
 * so will the strip's cards and the cockpit; none writes its own. The words live in the dictionaries under
 * `ux.<setting>.*` (src/core/i18n/en-catalog.ts), so both languages are checked by the type system and the tests.
 * Pure: the in-process plugin may use it.
 */
import { DEFAULT_CONFIG, type Config } from '../config.js';
import type { ControlAction } from '../controls.js';
import { LANGUAGES, tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { percent } from '../format.js';
import { PACKS } from '../packs.js';
import { EXTERNAL_SKILLS } from '../skills-external.js';
import { editDistance, fold } from '../text.js';

export type Unit = 'percent' | 'hours' | 'minutes' | 'days' | 'count';

export type SettingKind = { kind: 'switch' } | { kind: 'choice'; options: readonly string[] } | { kind: 'number'; min: number; max: number; unit: Unit };

/**
 * When a change takes effect: `now` where it is made (a look of the control center); `nextPrompt` here at once and
 * in Claude Code from the person's next message (the plugin reads the settings again before each prompt).
 */
export type Takes = 'now' | 'nextPrompt';

/** What the less careful value risks: nothing, something to read first, or Claude acting without asking. */
export type Risk = 'none' | 'caution' | 'danger';

export interface SettingDef {
  /** The control center page it lives on (a navigation address). */
  page: string;
  kind: SettingKind;
  takes: Takes;
  risk: Risk;
  /** Turning it off or down lowers a protection: the control center asks twice. */
  protective?: boolean;
  /** Changing to this value asks twice, with these messages joined as the warning. */
  confirm?: { value: unknown; keys: readonly MessageKey[] };
  /** It matters only while this other setting (an id of this catalog) holds one of these values. */
  gate?: { id: string; when: readonly unknown[] };
  /** A template's default, for an item the person never set (a template has no place in the defaults). */
  fallback?: unknown;
  /** The effect of a number is told with the value; a template's name comes from its item. */
  template?: 'pack' | 'skill';
  /** A special word on taking it back (`ux.<id>.back`), beyond when it takes effect. */
  back?: true;
}

const sw = { kind: 'switch' } as const;
const pct = { kind: 'number', min: 0, max: 100, unit: 'percent' } as const;
const PACK_MODES = ['auto', 'always', 'me', 'never'] as const;
const SKILL_STATES = ['off', 'me', 'on'] as const;

const S = {
  // Settings › Language and view
  language: { page: 'settings/general', kind: { kind: 'choice', options: ['auto', ...Object.keys(LANGUAGES)] }, takes: 'nextPrompt', risk: 'none' },
  view: { page: 'settings/general', kind: { kind: 'choice', options: ['simple', 'recommended', 'detailed'] }, takes: 'now', risk: 'none' },
  'update.check': { page: 'settings/general', kind: sw, takes: 'nextPrompt', risk: 'none' },
  // Settings › Features
  'modules.modes': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'caution', protective: true },
  'modules.keywords': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'modules.footer': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'modules.quota': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'caution', protective: true },
  'modules.secrets': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'caution', protective: true },
  'modules.status': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'modules.notifications': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'modules.quietWork': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'modules.mascot': { page: 'settings/modules', kind: sw, takes: 'nextPrompt', risk: 'none' },
  // Settings › Footer and quota
  'footer.mode': {
    page: 'settings/footer-quota',
    kind: { kind: 'choice', options: ['draw', 'check', 'off'] },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'modules.footer', when: [true] },
  },
  'footer.showFiveFrom': { page: 'settings/footer-quota', kind: pct, takes: 'nextPrompt', risk: 'none', gate: { id: 'footer.mode', when: ['draw', 'check'] } },
  'footer.showWeekFrom': { page: 'settings/footer-quota', kind: pct, takes: 'nextPrompt', risk: 'none', gate: { id: 'footer.mode', when: ['draw', 'check'] } },
  'quota.fiveHourWrapUp': { page: 'settings/footer-quota', kind: pct, takes: 'nextPrompt', risk: 'none', gate: { id: 'modules.quota', when: [true] } },
  'quota.fiveHourStop': { page: 'settings/footer-quota', kind: pct, takes: 'nextPrompt', risk: 'none', gate: { id: 'modules.quota', when: [true] } },
  'quota.defaultWeeklyTarget': { page: 'settings/footer-quota', kind: pct, takes: 'nextPrompt', risk: 'none', gate: { id: 'modules.quota', when: [true] } },
  'quota.autoResume': { page: 'settings/footer-quota', kind: sw, takes: 'nextPrompt', risk: 'none', gate: { id: 'modules.quota', when: [true] } },
  'quota.clearHint': { page: 'settings/footer-quota', kind: sw, takes: 'nextPrompt', risk: 'none' },
  // Settings › Accessibility
  'accessibility.plain': { page: 'settings/accessibility', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'accessibility.highContrast': { page: 'settings/accessibility', kind: sw, takes: 'now', risk: 'none' },
  'accessibility.reduceMotion': { page: 'settings/accessibility', kind: sw, takes: 'nextPrompt', risk: 'none' },
  // Settings › Memory › Handoffs and morning report
  'memory.handoff.enabled': { page: 'settings/memory/handoffs', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'memory.handoff.onCompact': {
    page: 'settings/memory/handoffs',
    kind: sw,
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'memory.handoff.enabled', when: [true] },
  },
  'memory.handoff.onEnd': {
    page: 'settings/memory/handoffs',
    kind: sw,
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'memory.handoff.enabled', when: [true] },
  },
  'memory.handoff.keep': {
    page: 'settings/memory/handoffs',
    kind: { kind: 'number', min: 1, max: 500, unit: 'count' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'memory.handoff.enabled', when: [true] },
    back: true,
  },
  'memory.handoff.maxAgeDays': {
    page: 'settings/memory/handoffs',
    kind: { kind: 'number', min: 1, max: 365, unit: 'days' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'memory.handoff.enabled', when: [true] },
  },
  'memory.morning.enabled': { page: 'settings/memory/handoffs', kind: sw, takes: 'nextPrompt', risk: 'none' },
  'memory.morning.afterHours': {
    page: 'settings/memory/handoffs',
    kind: { kind: 'number', min: 1, max: 72, unit: 'hours' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'memory.morning.enabled', when: [true] },
  },
  // Automation › Full autonomy
  'autonomy.enabled': {
    page: 'automation/full-auto',
    kind: sw,
    takes: 'nextPrompt',
    risk: 'caution',
    confirm: { value: true, keys: ['auto.cli.warnBody', 'set.autonomy.confirm'] },
  },
  'autonomy.maxHours': {
    page: 'automation/full-auto',
    kind: { kind: 'number', min: 1, max: 72, unit: 'hours' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'autonomy.enabled', when: [true] },
  },
  'autonomy.atTimeLimit': {
    page: 'automation/full-auto',
    kind: { kind: 'choice', options: ['continue', 'pause'] },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'autonomy.enabled', when: [true] },
  },
  'autonomy.stallMinutes': {
    page: 'automation/full-auto',
    kind: { kind: 'number', min: 10, max: 720, unit: 'minutes' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'autonomy.enabled', when: [true] },
  },
  // Automation › Bypass
  'bypass.enabled': { page: 'automation/bypass', kind: sw, takes: 'nextPrompt', risk: 'danger', confirm: { value: true, keys: ['set.bypass.confirm'] } },
  'bypass.maxHours': {
    page: 'automation/bypass',
    kind: { kind: 'number', min: 1, max: 24, unit: 'hours' },
    takes: 'nextPrompt',
    risk: 'none',
    gate: { id: 'bypass.enabled', when: [true] },
  },
  // Automation › Parallel agents
  'agents.enabled': { page: 'automation/agents', kind: sw, takes: 'nextPrompt', risk: 'none', confirm: { value: true, keys: ['set.agents.confirm'] } },
  'agents.helpers': { page: 'automation/agents', kind: sw, takes: 'nextPrompt', risk: 'none', gate: { id: 'agents.enabled', when: [true] } },
  // Claude Code › Tool packs
  'packs.autoUse': { page: 'claude-code/packs', kind: sw, takes: 'nextPrompt', risk: 'caution', confirm: { value: true, keys: ['packs.autoConfirm'] } },
  'packs.items.*': {
    page: 'claude-code/packs',
    kind: { kind: 'choice', options: PACK_MODES },
    takes: 'nextPrompt',
    risk: 'none',
    confirm: { value: 'always', keys: ['packs.alwaysConfirm'] },
    fallback: 'auto',
    template: 'pack',
  },
  // Claude Code › Commands and skills
  'skills.items.*': {
    page: 'claude-code/skills',
    kind: { kind: 'choice', options: SKILL_STATES },
    takes: 'nextPrompt',
    risk: 'caution',
    confirm: { value: 'on', keys: ['skills.onConfirm'] },
    fallback: 'off',
    template: 'skill',
  },
} as const satisfies Record<string, SettingDef>;

export type SettingId = keyof typeof S;
type TemplateId = 'packs.items.*' | 'skills.items.*';
/** A setting as a config path: an entry's own id, or a template's id with its item (`packs.items.flutter`). */
export type SettingPath = Exclude<SettingId, TemplateId> | `packs.items.${string}` | `skills.items.${string}`;

export const SETTINGS: Readonly<Record<SettingId, SettingDef>> = S;
export const SETTING_IDS = Object.keys(S) as SettingId[];

/** The entry a config path belongs to, and the template's item when it is one: a pack or a skill that exists. */
export function settingOf(path: string): { id: SettingId; def: SettingDef; item: string | null } | null {
  if (Object.hasOwn(S, path) && !path.endsWith('.*')) return { id: path as SettingId, def: SETTINGS[path as SettingId], item: null };
  const m = /^(packs|skills)\.items\.([^.]+)$/.exec(path);
  if (!m) return null;
  const item = m[2]!;
  if (m[1] === 'packs' ? !PACKS.some((p) => p.id === item) : !Object.hasOwn(EXTERNAL_SKILLS, item)) return null;
  const id = `${m[1]}.items.*` as SettingId;
  return { id, def: SETTINGS[id], item };
}

function must(path: string) {
  const s = settingOf(path);
  if (!s) throw new Error(`not in the catalog: ${path}`);
  return s;
}

function at(obj: unknown, path: string): unknown {
  let v = obj;
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

/** The value a setting has in `config`; a template's item the person never set has the template's default. */
export function valueIn(config: Readonly<Config>, path: SettingPath): unknown {
  const s = must(path);
  return at(config, path) ?? s.def.fallback;
}

/** A setting's default: read from the defaults, never repeated here. */
export function defaultOf(path: SettingPath): unknown {
  return valueIn(DEFAULT_CONFIG, path);
}

const key = (id: SettingId, part: string) => `ux.${id}.${part}` as MessageKey;

/** The setting's name, as its row shows it. A template's item is named by the item: a pack by its name, a skill by its id. */
export function nameOf(path: SettingPath, lang: Lang): string {
  const s = must(path);
  if (s.def.template === 'pack') return tIn(lang, `ux.pack.${s.item}.name` as MessageKey);
  if (s.def.template === 'skill') return s.item!;
  return tIn(lang, key(s.id, 'name'));
}

/** What it is, in one plain sentence. A template's item says it itself (`ux.pack.<id>`, `skills.about.<id>`). */
export function whatOf(path: SettingPath, lang: Lang): string {
  const s = must(path);
  if (s.def.template === 'pack') return tIn(lang, `ux.pack.${s.item}` as MessageKey);
  if (s.def.template === 'skill') return tIn(lang, `skills.about.${s.item}` as MessageKey);
  return tIn(lang, key(s.id, 'what'));
}

/** A choice option's label by the entry's id, for a template whose item is not at hand (every skill's states read alike). */
export function optionLabel(id: SettingId, value: unknown, lang: Lang): string {
  return tIn(lang, key(id, `opt.${String(value)}`));
}

/** The words for one value: on / off, the option's label, or the number with its unit. */
export function valueText(path: SettingPath, value: unknown, lang: Lang): string {
  const s = must(path);
  const k = s.def.kind;
  if (k.kind === 'switch') return tIn(lang, value ? 'set.on' : 'set.off');
  if (k.kind === 'choice') {
    if (s.id === 'language') return value === 'auto' ? tIn(lang, 'set.auto') : (LANGUAGES[value as Lang] ?? String(value));
    return tIn(lang, key(s.id, `opt.${String(value)}`));
  }
  return amount(Number(value), k.unit, lang);
}

export function amount(n: number, unit: Unit, lang: Lang): string {
  if (unit === 'percent') return percent(n, lang);
  return tIn(lang, `ux.unit.${unit}${n === 1 ? '.one' : ''}` as MessageKey, { n });
}

/** What the setting does at `value`: the effect told before it is applied. */
export function effectOf(path: SettingPath, value: unknown, lang: Lang): string {
  const s = must(path);
  const k = s.def.kind;
  if (k.kind === 'switch') return tIn(lang, key(s.id, value ? 'on' : 'off'));
  if (k.kind === 'choice') return tIn(lang, key(s.id, `eff.${String(value)}`));
  return tIn(lang, key(s.id, 'eff'), { n: amount(Number(value), k.unit, lang) });
}

/** The value one press sets: a switch flips, a choice moves to its next option. A number is typed, so null. */
export function nextValue(path: SettingPath, value: unknown): unknown {
  const k = must(path).def.kind;
  if (k.kind === 'switch') return !value;
  if (k.kind === 'choice') return k.options[(k.options.indexOf(value as never) + 1) % k.options.length];
  return null;
}

/** Whether changing to `next` lowers a protection (off, or a smaller number), or is a value that asks first. */
export function asksFirst(path: SettingPath, value: unknown, next: unknown): boolean {
  const d = must(path).def;
  if (d.confirm && d.confirm.value === next) return true;
  if (!d.protective) return false;
  return next === false || (typeof next === 'number' && typeof value === 'number' && next < value);
}

/** The words a change that asks first shows, in place of the general "this lowers a protection". */
export function confirmText(path: SettingPath, next: unknown, lang: Lang): string | null {
  const c = must(path).def.confirm;
  return c && c.value === next ? c.keys.map((k) => tIn(lang, k).replace(/\n+/g, ' ')).join(' ') : null;
}

/**
 * Settings an agent's shell may not change (`mode-code config set` refuses them under Claude): they lower a
 * protection or widen what a session does unasked. Some lie outside the catalog (the belt's rules, projects, sync).
 */
const PERSON_ONLY = /^(?:belt|memory|modules\.(?:quota|secrets|modes)|autonomy|bypass|agents|projects|sync|update|packs|skills)(?:\.|$)/;

export function personOnly(path: string): boolean {
  return PERSON_ONLY.test(path);
}

/** The first setting along the gates that keeps this one from mattering now, with its value; null when nothing does. */
export function blockedBy(config: Readonly<Config>, path: SettingPath): { id: SettingPath; value: unknown } | null {
  let g = must(path).def.gate;
  const seen = new Set<string>();
  while (g && !seen.has(g.id)) {
    seen.add(g.id);
    const id = g.id as SettingPath;
    const v = valueIn(config, id);
    if (!g.when.includes(v as never)) return { id, value: v };
    g = SETTINGS[g.id as SettingId]?.gate;
  }
  return null;
}

/** Where a setting lives, as the control center names it ("Settings › Features"). */
export type PlaceName = (page: string, lang: Lang) => string;

export interface Explained {
  name: string;
  what: string;
  /** The value now, in words, and whether it is the default. */
  now: string;
  isDefault: boolean;
  /** The default in words. */
  defaultText: string;
  /** What the value now does. */
  nowEffect: string;
  /** Every other value and what it would do (one for a switch, the other options for a choice, the range for a number). */
  changes: { value: unknown; text: string; effect: string }[];
  /** For a number: the range a typed value must fall in. */
  range: { min: string; max: string } | null;
  /** When it takes effect, and anything special about taking it back. */
  back: string;
  /** Why it has no effect now, when another setting keeps it from mattering. */
  blocked: string | null;
  personOnly: boolean;
}

/** The four answers for one setting in `config`, in `lang`. `place` names a page for the "no effect, because" line. */
export function explain(config: Readonly<Config>, path: SettingPath, lang: Lang, place?: PlaceName): Explained {
  const s = must(path);
  const k = s.def.kind;
  const value = valueIn(config, path);
  const def = defaultOf(path);
  const others: unknown[] =
    k.kind === 'switch'
      ? [!value]
      : k.kind === 'choice'
        ? [...k.options.slice(k.options.indexOf(value as never) + 1), ...k.options.slice(0, k.options.indexOf(value as never))]
        : [];
  const b = blockedBy(config, path);
  const backs = [tIn(lang, `ux.takes.${s.def.takes}` as MessageKey)];
  if (s.def.back) backs.push(tIn(lang, key(s.id, 'back')));
  return {
    name: nameOf(path, lang),
    what: whatOf(path, lang),
    now: valueText(path, value, lang),
    isDefault: value === def,
    defaultText: valueText(path, def, lang),
    nowEffect: effectOf(path, value, lang),
    changes: others.map((v) => ({ value: v, text: valueText(path, v, lang), effect: effectOf(path, v, lang) })),
    range: k.kind === 'number' ? { min: amount(k.min, k.unit, lang), max: amount(k.max, k.unit, lang) } : null,
    back: backs.join(' '),
    blocked: b
      ? tIn(lang, 'ux.blocked', {
          name: nameOf(b.id, lang),
          value: valueText(b.id, b.value, lang),
          place: place ? place(must(b.id).def.page, lang) : must(b.id).def.page,
        })
      : null,
    personOnly: personOnly(path),
  };
}

/** Every setting as a config path, templates spelled out for each pack and each skill. */
export function allSettingPaths(): SettingPath[] {
  return SETTING_IDS.flatMap((id): SettingPath[] =>
    id === 'packs.items.*'
      ? PACKS.map((p) => `packs.items.${p.id}` as const)
      : id === 'skills.items.*'
        ? Object.keys(EXTERNAL_SKILLS).map((s) => `skills.items.${s}` as const)
        : [id as SettingPath],
  );
}

/** The settings a mistyped or partial name most likely meant: those that contain it, then those a typo or two away. */
export function nearestSettings(query: string, limit = 5): SettingPath[] {
  const q = fold(query);
  if (!q) return [];
  const all = allSettingPaths();
  const containing = all.filter((p) => fold(p).includes(q));
  const last = q.split('.').at(-1)!;
  const near = last ? all.filter((p) => !containing.includes(p) && p.split('.').some((part) => editDistance(fold(part), last, 2) <= 2)) : [];
  return [...containing, ...near].slice(0, limit);
}

/**
 * The words for each page a setting lives on, by address: the control center's own labels. A test holds them equal
 * to the labels its navigation draws, so the command line names a place as the control center does.
 */
const PLACE_KEYS: Readonly<Record<string, MessageKey>> = {
  settings: 'cat.settings',
  'settings/general': 'page.general',
  'settings/modules': 'page.modules',
  'settings/footer-quota': 'page.footerQuota',
  'settings/accessibility': 'page.accessibility',
  'settings/memory': 'page.memory',
  'settings/memory/handoffs': 'page.memoryHandoffs',
  automation: 'cat.automation',
  'automation/full-auto': 'page.autonomy',
  'automation/bypass': 'page.bypass',
  'automation/agents': 'page.agents',
  'claude-code': 'cat.claude-code',
  'claude-code/packs': 'page.packs',
  'claude-code/skills': 'page.skills',
};

/** A setting's page as the person reads it: "Settings › Features". */
export function placeOf(page: string, lang: Lang): string {
  const parts = page.split('/');
  return parts
    .map((part, i) => {
      const k = PLACE_KEYS[parts.slice(0, i + 1).join('/')];
      return k ? tIn(lang, k) : part;
    })
    .join(' › ');
}

// ── the strip's controls ──

/** Every control the strip and the `/` commands reach, by what it does. */
export type ControlId =
  | 'mode.chat'
  | 'mode.research'
  | 'mode.plan'
  | 'mode.code'
  | 'mode.free'
  | 'style.manual'
  | 'style.autonomous'
  | 'fullAuto'
  | 'flow'
  | 'menu'
  | 'continue'
  | 'quota'
  | 'bypass'
  | 'freeze'
  | 'agents'
  | 'close'
  | 'why';

export interface ControlDef {
  /** The four kinds of docs/design.md: picks one of several, flips, does something now, or opens a window. */
  kind: 'choice' | 'switch' | 'action' | 'opener';
  /** Only the person's own press or Enter, never a script of theirs; Claude never, for any control. */
  personOnly?: true;
  /** The settings that must be on for it to be there at all. */
  needs?: readonly SettingId[];
  /** How it is taken back: `ux.ctl.back.<back>`. */
  back: 'mode' | 'style' | 'fullAuto' | 'flow' | 'none' | 'continue' | 'quota' | 'bypass' | 'freeze' | 'agents' | 'close';
}

const mode = { kind: 'choice', needs: ['modules.modes'], back: 'mode' } as const;

export const CONTROLS: Readonly<Record<ControlId, ControlDef>> = {
  'mode.chat': mode,
  'mode.research': mode,
  'mode.plan': mode,
  'mode.code': mode,
  'mode.free': mode,
  'style.manual': { kind: 'choice', needs: ['modules.modes'], back: 'style' },
  'style.autonomous': { kind: 'choice', needs: ['modules.modes'], back: 'style' },
  fullAuto: { kind: 'opener', personOnly: true, needs: ['modules.modes', 'autonomy.enabled'], back: 'fullAuto' },
  flow: { kind: 'action', needs: ['modules.modes'], back: 'flow' },
  menu: { kind: 'opener', back: 'none' },
  continue: { kind: 'opener', back: 'continue' },
  quota: { kind: 'opener', back: 'quota' },
  bypass: { kind: 'switch', personOnly: true, needs: ['bypass.enabled'], back: 'bypass' },
  freeze: { kind: 'switch', personOnly: true, back: 'freeze' },
  agents: { kind: 'opener', personOnly: true, needs: ['agents.enabled'], back: 'agents' },
  close: { kind: 'action', back: 'close' },
  why: { kind: 'opener', back: 'none' },
};

export const CONTROL_IDS = Object.keys(CONTROLS) as ControlId[];

/** The control a command's action stands for. */
export function controlOf(a: ControlAction): ControlId {
  if (a.kind === 'mode') return `mode.${a.mode}`;
  if (a.kind === 'style') return `style.${a.style}`;
  return a.kind;
}

/** A control's words: what it is (one line, as the `/` menu shows it), what a press does, how it is taken back. */
export function controlText(id: ControlId, part: 'what' | 'press' | 'back', lang: Lang): string {
  return tIn(lang, part === 'back' ? (`ux.ctl.back.${CONTROLS[id].back}` as MessageKey) : (`ux.ctl.${id}.${part}` as MessageKey));
}

/** The settings, among those it needs, that are off now: while any is, the control is not there. */
export function controlMissing(id: ControlId, config: Readonly<Config>): SettingId[] {
  return (CONTROLS[id].needs ?? []).filter((s) => valueIn(config, s as SettingPath) !== true);
}

// ── the windows ──

export type WindowId = 'agents' | 'fullAuto' | 'quota' | 'flow' | 'bypass';

/**
 * A window a control opens inside Claude Code (docs/design.md, Window): every one is drawn to the same pattern, a
 * sentence on what it is for, how it is now, its controls, what applying does, the main action and Cancel. Here
 * are its id (the pane's), the control that opens it, and the words of its title, its sentence and its action.
 */
export interface WindowDef {
  pane: string;
  control: ControlId;
  title: MessageKey;
  what: MessageKey;
  apply: MessageKey;
}

export const WINDOWS: Readonly<Record<WindowId, WindowDef>> = {
  agents: { pane: 'parallel-agents', control: 'agents', title: 'agents.pane.title', what: 'agents.pane.what', apply: 'agents.pane.apply' },
  fullAuto: { pane: 'full-auto', control: 'fullAuto', title: 'ctl.autoPane.title', what: 'ctl.autoPane.what', apply: 'ctl.auto.start' },
  quota: { pane: 'weekly-budget', control: 'quota', title: 'ctl.quotaPane.title', what: 'ux.ctl.quota.press', apply: 'ctl.quotaPane.apply' },
  flow: { pane: 'start-flow', control: 'flow', title: 'ctl.flowPane.title', what: 'ctl.flowPane.what', apply: 'ctl.flowPane.apply' },
  bypass: { pane: 'bypass', control: 'bypass', title: 'ctl.bypassPane.title', what: 'ux.ctl.bypass.what', apply: 'ctl.bypass.yes' },
};

export const WINDOW_IDS = Object.keys(WINDOWS) as WindowId[];

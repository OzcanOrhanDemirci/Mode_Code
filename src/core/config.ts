// SPDX-License-Identifier: Apache-2.0
/**
 * The tool's settings: one JSON file in the data folder, read by every layer (the in-process mod, the
 * safety-net hook, the command line and the interface). Pure: parsing never throws. A value of the wrong
 * kind falls back to its default and is reported, so a typo in the file degrades one setting instead of
 * switching the tool off; protection settings can only be made stricter by the file, never weaker.
 */
import { isLang, type Lang } from './i18n/index.js';
import { RULE_IDS, RULES } from './belt/rules.js';
import { VERDICT_ORDER, type RuleConfig, type RuleId, type Verdict } from './belt/types.js';
import { KEYWORD_LISTS, type KeywordList } from './keywords.js';
import { PACK_MODES, PACKS, type PackMode } from './packs.js';
import { EXTERNAL_SKILLS } from './skills-external.js';
import { SKILL_STATES, type SkillState } from './skills.js';

export const CONFIG_VERSION = 1;

/** How much of the interface is shown. Protections are the same at every level. */
export type ViewLevel = 'simple' | 'recommended' | 'detailed';

/** Where the footer lines come from: drawn by the mod under the answer, written by the model and checked, or none. */
export type FooterMode = 'draw' | 'check' | 'off';

export interface ProjectEntry {
  /** Stable id, kebab-case. */
  id: string;
  /** Names that address the project in keywords ("terminal" in "terminal devam"). */
  names: string[];
  /** Project folder, absolute. Optional: a project can live only in the person's notes. */
  path?: string;
  /**
   * The person's own definition of done for the project: commands a full-autonomy run must pass at its
   * finish, which a run's plan can add to but never drop (docs/autonomy.md).
   */
  verify?: string[];
}

/** Where Claude Code's memory lives (docs/memory.md): this computer only, your GitHub only, or both. */
export type MemoryPlace = 'local' | 'github' | 'both';

export const MEMORY_PLACES: readonly MemoryPlace[] = ['local', 'github', 'both'];

export interface MemoryStore {
  place: MemoryPlace;
  /** The folder Claude Code reads and writes (its autoMemoryDirectory), absolute. */
  dir: string;
  /** The git remote it is kept in sync with: required for github and both, null for local. */
  remote: string | null;
  /** The GitHub repository as owner/name, when it is one. */
  repo: string | null;
  /** The folder has a git history (always with a remote; for local, when git was there at setup). */
  git: boolean;
  /**
   * auto: pull when a session starts, commit and push after a turn that changed it. pull: only bring in
   * changes that need no merge when a session starts; the person commits and pushes. manual: status only.
   */
  sync: MemorySyncMode;
  /** Handoff notes are kept in the store (else with mode-code: in the sync's shared place, or its data folder). */
  handoffs: boolean;
}

export type MemorySyncMode = 'auto' | 'pull' | 'manual';

export const MEMORY_SYNC_MODES: readonly MemorySyncMode[] = ['auto', 'pull', 'manual'];

/** Where the shared copy of mode-code's settings and history lives (docs/sync.md). */
export type SyncPlace = 'github' | 'folder';

export const SYNC_PLACES: readonly SyncPlace[] = ['github', 'folder'];

/** A computer's id in the shared place: its folder name under machines/. */
export const MACHINE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export interface SyncSetting {
  place: SyncPlace;
  /** The shared place on this computer, absolute: a folder in a git work tree (github), or the synced folder itself. */
  dir: string;
  /** github: the remote the work tree is kept in sync with. */
  remote: string | null;
  /** github: the repository as owner/name. */
  repo: string | null;
  /** This computer: its folder under machines/ and the name the others show. */
  machine: { id: string; name: string };
  /** How often a session sends after its turns, in minutes. */
  everyMinutes: number;
  /** Months of history each computer keeps in the shared place. */
  keepMonths: number;
  /** Handoff notes go into the shared place (when the memory store does not keep them). */
  handoffs: boolean;
}

export interface Config {
  version: number;
  /** Interface language, or "auto" to follow the system. */
  language: Lang | 'auto';
  view: ViewLevel;
  modules: {
    /** Keyword detection and the context it adds. */
    keywords: boolean;
    /** Footer lines under each answer. */
    footer: boolean;
    /** Quota guard: wrap up and stop at the budget. */
    quota: boolean;
    /** Secret scanning of written files and of the memory folder. */
    secrets: boolean;
    /** The tool's entry in Claude Code's status line. */
    status: boolean;
    /** Desktop notifications for things that need the person (red items only). */
    notifications: boolean;
    /** Leave out Claude Code's "the user has not heard from you" reminders, so long work stays quiet. */
    quietWork: boolean;
    /** Modes (chat, research, plan, code) and mode flows, enforced by code. */
    modes: boolean;
    /** Mo, the mascot: in the strip above the prompt it shows what Claude is doing; it greets in the control center. */
    mascot: boolean;
  };
  belt: RuleConfig;
  memory: {
    /** Memory folders: protected from deletion and shrinking, and reported in the footer when they are git repositories. */
    dirs: string[];
    /** Where the memory lives and how it is kept in sync; null until `mode-code memory setup` ran. */
    store: MemoryStore | null;
    /** Handoff notes: written on the keyword, before a compaction, at the end of a session; taken over by the next. */
    handoff: {
      enabled: boolean;
      /** Write one from the compaction's summary before Claude Code compacts. */
      onCompact: boolean;
      /** Write one from what code measured on /clear and at the end of a session, when none was written since the last change. */
      onEnd: boolean;
      /** Notes kept per project in the folder (older ones stay in the git history). */
      keep: number;
      /** Notes older than this are not offered to a new session. */
      maxAgeDays: number;
    };
    /** The morning report: told in one line on the first prompt after a while away. */
    morning: { enabled: boolean; afterHours: number };
  };
  footer: {
    mode: FooterMode;
    showFiveFrom: number;
    showWeekFrom: number;
  };
  quota: {
    fiveHourWrapUp: number;
    fiveHourStop: number;
    defaultWeeklyTarget: number;
    defaultWeeklyWrapUp: number;
    staleMinutes: number;
    /** Resume autonomous work by itself one minute after the binding window resets. */
    autoResume: boolean;
    /** After a commit or a push with a large context, the strip says /clear would start the next task small. */
    clearHint: boolean;
  };
  keywords: {
    /** Extra phrases per language, added to the built-in ones. */
    extra: Partial<Record<Lang, Partial<Record<KeywordList, string[]>>>>;
  };
  projects: ProjectEntry[];
  modes: {
    /** Where flows keep their drafts (the report, the plan); null: a mode-code folder in the temporary folder. */
    workDir: string | null;
  };
  /** Full autonomy (docs/autonomy.md). Off until the person turns it on in their own terminal. */
  autonomy: {
    enabled: boolean;
    /** Running hours after which a run pauses, or goes on with a fresh limit while it reaches milestones (atTimeLimit). */
    maxHours: number;
    /** Minutes without a milestone after which the run is warned, and twice that after which it pauses. */
    stallMinutes: number;
    /** At the time limit: `continue` while a milestone came within the stall time, else pause; `pause` always. */
    atTimeLimit: 'continue' | 'pause';
    /** The model of the independent reviews; null: the session's own model. */
    reviewModel: string | null;
  };
  /**
   * Bypass (docs/autonomy.md): a session may lift the belt for a while. Off until the person turns it on in
   * the control center or their own terminal; then they still switch it on in each session themselves.
   */
  bypass: {
    enabled: boolean;
    /** Hours after which bypass ends by itself in a session. */
    maxHours: number;
  };
  /**
   * Parallel agents (docs/agents.md): with the mode on, every session starts with agents off and the person sets
   * them on the strip. Off here, this tool never touches an agent.
   */
  agents: {
    enabled: boolean;
    /** Claude Code's read-only helpers (Explore, Plan) stay free while agents are off, and are not counted. */
    helpers: boolean;
  };
  /**
   * Updates (docs/cli.md, `mode-code update`): whether this computer asks once a day for the newest release, one
   * small download from it. Off until the person says yes; the installer asks.
   */
  update: {
    check: boolean;
  };
  /**
   * Notifications that reach the person away from the computer (docs/autonomy.md): a full-autonomy run that ends,
   * pauses or gets stuck is posted to this ntfy topic's address as well; null: the desktop alone.
   */
  notify: {
    ntfy: string | null;
  };
  /**
   * Tool packs (docs/packs.md). Automatic use: a project's markers turn its packs on there, and Claude may turn one
   * on through the catalog. Only the person changes it, as bypass. Each pack's own choice overrides it.
   */
  packs: {
    autoUse: boolean;
    items: Record<string, PackMode>;
  };
  /**
   * The skills of others (docs/skills.md): each off until the person turns it on, for themselves only (`me`) or for
   * Claude too (`on`). Only the person changes it.
   */
  skills: {
    items: Record<string, SkillState>;
  };
  accessibility: {
    /** Plain text: no box drawing, no emoji-only signals. */
    plain: boolean;
    highContrast: boolean;
    reduceMotion: boolean;
  };
  /** Sync across computers (docs/sync.md); null until `mode-code sync setup` ran. This computer's own. */
  sync: SyncSetting | null;
}

export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze({
  version: CONFIG_VERSION,
  language: 'auto',
  view: 'recommended',
  modules: { keywords: true, footer: true, quota: true, secrets: true, status: true, notifications: true, quietWork: true, modes: true, mascot: true },
  belt: {
    disabled: [],
    verdicts: {},
    protectedBranches: ['main', 'master', 'release/*'],
    prOnlyRepos: [],
    singleBranchRepos: [],
    packs: { dockerVolumes: false },
  },
  memory: {
    dirs: [],
    store: null,
    handoff: { enabled: true, onCompact: true, onEnd: true, keep: 20, maxAgeDays: 14 },
    morning: { enabled: true, afterHours: 6 },
  },
  footer: { mode: 'draw', showFiveFrom: 70, showWeekFrom: 85 },
  quota: { fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360, autoResume: true, clearHint: true },
  keywords: { extra: {} },
  projects: [],
  modes: { workDir: null },
  autonomy: { enabled: false, maxHours: 12, stallMinutes: 90, atTimeLimit: 'continue', reviewModel: null },
  bypass: { enabled: false, maxHours: 2 },
  agents: { enabled: false, helpers: true },
  update: { check: false },
  notify: { ntfy: null },
  packs: { autoUse: true, items: {} },
  skills: { items: {} },
  accessibility: { plain: false, highContrast: false, reduceMotion: false },
  sync: null,
}) as Config;

export interface ConfigProblem {
  /** Dotted path of the setting, e.g. "footer.mode". */
  path: string;
  /** What was wrong, in English: the interface translates by kind. */
  kind: 'type' | 'range' | 'unknown-key' | 'weakened' | 'invalid-json' | 'newer-version';
  detail: string;
}

export interface ParsedConfig {
  config: Config;
  problems: ConfigProblem[];
}

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const VERDICTS = new Set<Verdict>(['allow', 'warn', 'ask', 'deny']);
const RULE_SET = new Set<string>(RULE_IDS);
const KEYWORD_KINDS = new Set<string>(KEYWORD_LISTS);
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Reads the settings file's text. Never throws: invalid JSON gives the defaults and one problem. */
export function parseConfig(text: string | null): ParsedConfig {
  if (text === null || text.trim() === '') return { config: cloneDefaults(), problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { config: cloneDefaults(), problems: [{ path: '', kind: 'invalid-json', detail: (err as Error).message }] };
  }
  return normalizeConfig(raw);
}

export function cloneDefaults(): Config {
  return structuredClone(DEFAULT_CONFIG) as Config;
}

/** Turns any value into a valid Config, keeping what is valid and reporting the rest. */
/** An ntfy topic's address: https with a host and one topic name, or plain http to this computer (a server of one's own). */
export function ntfyAddress(s: string): boolean {
  return /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)\/[A-Za-z0-9_-]{1,64}$/.test(s.trim());
}

export function normalizeConfig(raw: unknown): ParsedConfig {
  const problems: ConfigProblem[] = [];
  const c = cloneDefaults();
  if (!isObj(raw)) {
    problems.push({ path: '', kind: 'type', detail: 'the settings file must hold an object' });
    return { config: c, problems };
  }
  const known = new Set(Object.keys(c));
  for (const k of Object.keys(raw)) if (!known.has(k) && k !== '$schema') problems.push({ path: k, kind: 'unknown-key', detail: 'not a setting' });

  if (typeof raw.version === 'number' && raw.version > CONFIG_VERSION)
    problems.push({ path: 'version', kind: 'newer-version', detail: `written by a newer version (${raw.version})` });

  if (raw.language !== undefined) {
    if (raw.language === 'auto' || isLang(raw.language)) c.language = raw.language;
    else problems.push({ path: 'language', kind: 'type', detail: 'expected "auto" or a language code' });
  }
  if (raw.view !== undefined) {
    if (raw.view === 'simple' || raw.view === 'recommended' || raw.view === 'detailed') c.view = raw.view;
    else problems.push({ path: 'view', kind: 'type', detail: 'expected simple, recommended or detailed' });
  }
  bools(raw.modules, c.modules, 'modules', problems);
  bools(raw.accessibility, c.accessibility, 'accessibility', problems);

  if (isObj(raw.footer)) {
    const f = raw.footer;
    if (f.mode !== undefined) {
      if (f.mode === 'draw' || f.mode === 'check' || f.mode === 'off') c.footer.mode = f.mode;
      else problems.push({ path: 'footer.mode', kind: 'type', detail: 'expected draw, check or off' });
    }
    c.footer.showFiveFrom = percent(f.showFiveFrom, c.footer.showFiveFrom, 'footer.showFiveFrom', problems);
    c.footer.showWeekFrom = percent(f.showWeekFrom, c.footer.showWeekFrom, 'footer.showWeekFrom', problems);
  } else if (raw.footer !== undefined) problems.push({ path: 'footer', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.quota)) {
    const q = raw.quota;
    for (const k of ['fiveHourWrapUp', 'fiveHourStop', 'defaultWeeklyTarget', 'defaultWeeklyWrapUp'] as const)
      c.quota[k] = percent(q[k], c.quota[k], `quota.${k}`, problems);
    if (q.staleMinutes !== undefined) {
      if (typeof q.staleMinutes === 'number' && q.staleMinutes >= 5 && q.staleMinutes <= 1440) c.quota.staleMinutes = Math.round(q.staleMinutes);
      else problems.push({ path: 'quota.staleMinutes', kind: 'range', detail: 'expected 5 to 1440' });
    }
    for (const k of ['autoResume', 'clearHint'] as const)
      if (q[k] !== undefined) {
        if (typeof q[k] === 'boolean') c.quota[k] = q[k];
        else problems.push({ path: `quota.${k}`, kind: 'type', detail: 'expected true or false' });
      }
    if (c.quota.fiveHourWrapUp > c.quota.fiveHourStop) {
      problems.push({ path: 'quota.fiveHourWrapUp', kind: 'range', detail: 'must not be above fiveHourStop' });
      c.quota.fiveHourWrapUp = c.quota.fiveHourStop;
    }
    if (c.quota.defaultWeeklyWrapUp > c.quota.defaultWeeklyTarget) {
      problems.push({ path: 'quota.defaultWeeklyWrapUp', kind: 'range', detail: 'must not be above defaultWeeklyTarget' });
      c.quota.defaultWeeklyWrapUp = c.quota.defaultWeeklyTarget;
    }
  } else if (raw.quota !== undefined) problems.push({ path: 'quota', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.memory)) normalizeMemory(raw.memory, c.memory, problems);
  else if (raw.memory !== undefined) problems.push({ path: 'memory', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.belt)) normalizeBelt(raw.belt, c.belt, problems);
  else if (raw.belt !== undefined) problems.push({ path: 'belt', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.keywords) && isObj(raw.keywords.extra)) {
    for (const [lang, table] of Object.entries(raw.keywords.extra)) {
      if (!isLang(lang) || !isObj(table)) {
        problems.push({ path: `keywords.extra.${lang}`, kind: 'type', detail: 'expected a language code with a table of phrases' });
        continue;
      }
      const out: Partial<Record<KeywordList, string[]>> = {};
      for (const [kind, list] of Object.entries(table)) {
        if (!KEYWORD_KINDS.has(kind)) {
          problems.push({ path: `keywords.extra.${lang}.${kind}`, kind: 'unknown-key', detail: 'not a keyword kind' });
          continue;
        }
        out[kind as KeywordList] = strings(list, `keywords.extra.${lang}.${kind}`, problems).filter((s) => s.trim().length > 0 && s.length <= 40);
      }
      c.keywords.extra[lang] = out;
    }
  } else if (raw.keywords !== undefined) problems.push({ path: 'keywords', kind: 'type', detail: 'expected { extra: { <lang>: { <kind>: [phrases] } } }' });

  if (isObj(raw.modes)) {
    for (const k of Object.keys(raw.modes)) if (k !== 'workDir') problems.push({ path: `modes.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    const w = raw.modes.workDir;
    if (w === null || w === undefined) c.modes.workDir = null;
    else if (typeof w === 'string' && w.trim()) c.modes.workDir = w.trim();
    else problems.push({ path: 'modes.workDir', kind: 'type', detail: 'expected a folder path or null' });
  } else if (raw.modes !== undefined) problems.push({ path: 'modes', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.autonomy)) {
    const a = raw.autonomy;
    for (const k of Object.keys(a))
      if (!['enabled', 'maxHours', 'stallMinutes', 'atTimeLimit', 'reviewModel'].includes(k))
        problems.push({ path: `autonomy.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (a.enabled !== undefined) {
      if (typeof a.enabled === 'boolean') c.autonomy.enabled = a.enabled;
      else problems.push({ path: 'autonomy.enabled', kind: 'type', detail: 'expected true or false' });
    }
    if (a.maxHours !== undefined) {
      if (typeof a.maxHours === 'number' && a.maxHours >= 1 && a.maxHours <= 72) c.autonomy.maxHours = Math.round(a.maxHours);
      else problems.push({ path: 'autonomy.maxHours', kind: 'range', detail: 'expected 1 to 72' });
    }
    if (a.stallMinutes !== undefined) {
      if (typeof a.stallMinutes === 'number' && a.stallMinutes >= 10 && a.stallMinutes <= 720) c.autonomy.stallMinutes = Math.round(a.stallMinutes);
      else problems.push({ path: 'autonomy.stallMinutes', kind: 'range', detail: 'expected 10 to 720' });
    }
    if (a.atTimeLimit !== undefined) {
      if (a.atTimeLimit === 'continue' || a.atTimeLimit === 'pause') c.autonomy.atTimeLimit = a.atTimeLimit;
      else problems.push({ path: 'autonomy.atTimeLimit', kind: 'type', detail: 'expected continue or pause' });
    }
    if (a.reviewModel !== undefined) {
      if (a.reviewModel === null) c.autonomy.reviewModel = null;
      else if (typeof a.reviewModel === 'string' && /^[A-Za-z0-9._:[\]-]{1,80}$/.test(a.reviewModel.trim())) c.autonomy.reviewModel = a.reviewModel.trim();
      else problems.push({ path: 'autonomy.reviewModel', kind: 'type', detail: 'expected a model name or null' });
    }
  } else if (raw.autonomy !== undefined) problems.push({ path: 'autonomy', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.bypass)) {
    const b = raw.bypass;
    for (const k of Object.keys(b))
      if (!['enabled', 'maxHours'].includes(k)) problems.push({ path: `bypass.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (b.enabled !== undefined) {
      if (typeof b.enabled === 'boolean') c.bypass.enabled = b.enabled;
      else problems.push({ path: 'bypass.enabled', kind: 'type', detail: 'expected true or false' });
    }
    if (b.maxHours !== undefined) {
      if (typeof b.maxHours === 'number' && b.maxHours >= 1 && b.maxHours <= 24) c.bypass.maxHours = Math.round(b.maxHours);
      else problems.push({ path: 'bypass.maxHours', kind: 'range', detail: 'expected 1 to 24' });
    }
  } else if (raw.bypass !== undefined) problems.push({ path: 'bypass', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.agents)) {
    const a = raw.agents;
    for (const k of Object.keys(a))
      if (k !== 'enabled' && k !== 'helpers') problems.push({ path: `agents.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    for (const k of ['enabled', 'helpers'] as const)
      if (a[k] !== undefined) {
        if (typeof a[k] === 'boolean') c.agents[k] = a[k];
        else problems.push({ path: `agents.${k}`, kind: 'type', detail: 'expected true or false' });
      }
  } else if (raw.agents !== undefined) problems.push({ path: 'agents', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.update)) {
    const u = raw.update;
    for (const k of Object.keys(u)) if (k !== 'check') problems.push({ path: `update.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (u.check !== undefined) {
      if (typeof u.check === 'boolean') c.update.check = u.check;
      else problems.push({ path: 'update.check', kind: 'type', detail: 'expected true or false' });
    }
  } else if (raw.update !== undefined) problems.push({ path: 'update', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.notify)) {
    const n = raw.notify;
    for (const k of Object.keys(n)) if (k !== 'ntfy') problems.push({ path: `notify.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (n.ntfy !== undefined) {
      if (n.ntfy === null) c.notify.ntfy = null;
      else if (typeof n.ntfy === 'string' && ntfyAddress(n.ntfy)) c.notify.ntfy = n.ntfy.trim();
      else problems.push({ path: 'notify.ntfy', kind: 'type', detail: 'expected an https:// address of an ntfy topic, or null' });
    }
  } else if (raw.notify !== undefined) problems.push({ path: 'notify', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.packs)) {
    const p = raw.packs;
    for (const k of Object.keys(p)) if (k !== 'autoUse' && k !== 'items') problems.push({ path: `packs.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (p.autoUse !== undefined) {
      if (typeof p.autoUse === 'boolean') c.packs.autoUse = p.autoUse;
      else problems.push({ path: 'packs.autoUse', kind: 'type', detail: 'expected true or false' });
    }
    if (isObj(p.items)) {
      for (const [id, mode] of Object.entries(p.items)) {
        if (!PACKS.some((x) => x.id === id)) problems.push({ path: `packs.items.${id}`, kind: 'unknown-key', detail: 'not a pack' });
        else if (typeof mode === 'string' && PACK_MODES.includes(mode as PackMode)) {
          if (mode !== 'auto') c.packs.items[id] = mode as PackMode;
        } else problems.push({ path: `packs.items.${id}`, kind: 'type', detail: 'expected auto, always, me or never' });
      }
    } else if (p.items !== undefined) problems.push({ path: 'packs.items', kind: 'type', detail: 'expected an object' });
  } else if (raw.packs !== undefined) problems.push({ path: 'packs', kind: 'type', detail: 'expected an object' });

  if (isObj(raw.skills)) {
    const s = raw.skills;
    for (const k of Object.keys(s)) if (k !== 'items') problems.push({ path: `skills.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (isObj(s.items)) {
      for (const [id, state] of Object.entries(s.items)) {
        if (!Object.hasOwn(EXTERNAL_SKILLS, id)) problems.push({ path: `skills.items.${id}`, kind: 'unknown-key', detail: 'not a skill' });
        else if (typeof state === 'string' && SKILL_STATES.includes(state as SkillState)) {
          if (state !== 'off') c.skills.items[id] = state as SkillState;
        } else problems.push({ path: `skills.items.${id}`, kind: 'type', detail: 'expected off, me or on' });
      }
    } else if (s.items !== undefined) problems.push({ path: 'skills.items', kind: 'type', detail: 'expected an object' });
  } else if (raw.skills !== undefined) problems.push({ path: 'skills', kind: 'type', detail: 'expected an object' });

  if (raw.sync !== undefined && raw.sync !== null) c.sync = syncSetting(raw.sync, problems);

  if (Array.isArray(raw.projects)) {
    const seen = new Set<string>();
    raw.projects.forEach((p, i) => {
      if (!isObj(p) || typeof p.id !== 'string' || !ID.test(p.id) || seen.has(p.id)) {
        problems.push({ path: `projects.${i}`, kind: 'type', detail: 'each project needs a unique kebab-case id' });
        return;
      }
      seen.add(p.id);
      const names = strings(p.names, `projects.${i}.names`, problems).filter((n) => n.trim() && n.length <= 40);
      const entry: ProjectEntry = { id: p.id, names };
      if (typeof p.path === 'string' && p.path.trim()) entry.path = p.path;
      if (p.verify !== undefined) {
        const verify = strings(p.verify, `projects.${i}.verify`, problems)
          .map((v) => v.trim())
          .filter(Boolean);
        if (verify.length) entry.verify = [...new Set(verify)];
      }
      c.projects.push(entry);
    });
  } else if (raw.projects !== undefined) problems.push({ path: 'projects', kind: 'type', detail: 'expected a list' });

  return { config: c, problems };
}

function normalizeMemory(src: Obj, dst: Config['memory'], problems: ConfigProblem[]): void {
  for (const k of Object.keys(src))
    if (!['dirs', 'store', 'handoff', 'morning'].includes(k)) problems.push({ path: `memory.${k}`, kind: 'unknown-key', detail: 'not a setting' });
  dst.dirs = strings(src.dirs, 'memory.dirs', problems);
  if (src.store !== undefined && src.store !== null) dst.store = memoryStore(src.store, problems);
  if (isObj(src.handoff)) {
    const h = src.handoff;
    for (const k of Object.keys(h))
      if (!['enabled', 'onCompact', 'onEnd', 'keep', 'maxAgeDays'].includes(k))
        problems.push({ path: `memory.handoff.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    for (const k of ['enabled', 'onCompact', 'onEnd'] as const)
      if (h[k] !== undefined) {
        if (typeof h[k] === 'boolean') dst.handoff[k] = h[k];
        else problems.push({ path: `memory.handoff.${k}`, kind: 'type', detail: 'expected true or false' });
      }
    dst.handoff.keep = whole(h.keep, dst.handoff.keep, 1, 500, 'memory.handoff.keep', problems);
    dst.handoff.maxAgeDays = whole(h.maxAgeDays, dst.handoff.maxAgeDays, 1, 365, 'memory.handoff.maxAgeDays', problems);
  } else if (src.handoff !== undefined) problems.push({ path: 'memory.handoff', kind: 'type', detail: 'expected an object' });
  if (isObj(src.morning)) {
    const m = src.morning;
    for (const k of Object.keys(m))
      if (k !== 'enabled' && k !== 'afterHours') problems.push({ path: `memory.morning.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    if (m.enabled !== undefined) {
      if (typeof m.enabled === 'boolean') dst.morning.enabled = m.enabled;
      else problems.push({ path: 'memory.morning.enabled', kind: 'type', detail: 'expected true or false' });
    }
    dst.morning.afterHours = whole(m.afterHours, dst.morning.afterHours, 1, 72, 'memory.morning.afterHours', problems);
  } else if (src.morning !== undefined) problems.push({ path: 'memory.morning', kind: 'type', detail: 'expected an object' });
}

/** GitHub's owner/name: an account of up to 39 letters, digits and hyphens; a name of up to 100 letters, digits, dots, hyphens and underscores. */
export const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** The memory store, or null when it cannot be one (reported): a place, a folder, and a remote where the place needs one. */
function memoryStore(v: unknown, problems: ConfigProblem[]): MemoryStore | null {
  if (!isObj(v)) {
    problems.push({ path: 'memory.store', kind: 'type', detail: 'expected an object or null' });
    return null;
  }
  for (const k of Object.keys(v))
    if (!['place', 'dir', 'remote', 'repo', 'git', 'sync', 'handoffs'].includes(k))
      problems.push({ path: `memory.store.${k}`, kind: 'unknown-key', detail: 'not a setting' });
  if (typeof v.place !== 'string' || !MEMORY_PLACES.includes(v.place as MemoryPlace)) {
    problems.push({ path: 'memory.store.place', kind: 'type', detail: 'expected local, github or both' });
    return null;
  }
  if (typeof v.dir !== 'string' || !v.dir.trim()) {
    problems.push({ path: 'memory.store.dir', kind: 'type', detail: 'expected a folder path' });
    return null;
  }
  const place = v.place as MemoryPlace;
  const remote = typeof v.remote === 'string' && v.remote.trim() ? v.remote.trim() : null;
  if (v.remote !== undefined && v.remote !== null && remote === null)
    problems.push({ path: 'memory.store.remote', kind: 'type', detail: 'expected a git remote or null' });
  if (place !== 'local' && remote === null) {
    problems.push({ path: 'memory.store.remote', kind: 'range', detail: `the place ${place} needs a remote` });
    return null;
  }
  const repo = typeof v.repo === 'string' && GITHUB_REPO.test(v.repo) ? v.repo : null;
  if (v.repo !== undefined && v.repo !== null && repo === null)
    problems.push({ path: 'memory.store.repo', kind: 'type', detail: 'expected owner/name or null' });
  let sync: MemoryStore['sync'] = 'auto';
  if (v.sync !== undefined) {
    if (MEMORY_SYNC_MODES.includes(v.sync as MemorySyncMode)) sync = v.sync as MemorySyncMode;
    else problems.push({ path: 'memory.store.sync', kind: 'type', detail: 'expected auto, pull or manual' });
  }
  let handoffs = true;
  if (v.handoffs !== undefined) {
    if (typeof v.handoffs === 'boolean') handoffs = v.handoffs;
    else problems.push({ path: 'memory.store.handoffs', kind: 'type', detail: 'expected true or false' });
  }
  if (v.git !== undefined && typeof v.git !== 'boolean') problems.push({ path: 'memory.store.git', kind: 'type', detail: 'expected true or false' });
  // A remote needs a git history; a local folder has one only when the file says so.
  const git = place !== 'local' || v.git === true;
  return { place, dir: v.dir.trim(), remote: place === 'local' ? null : remote, repo, git, sync, handoffs };
}

/** The sync setting, or null when it cannot be one (reported): a place, a folder, a remote for github, this computer. */
function syncSetting(v: unknown, problems: ConfigProblem[]): SyncSetting | null {
  if (!isObj(v)) {
    problems.push({ path: 'sync', kind: 'type', detail: 'expected an object or null' });
    return null;
  }
  for (const k of Object.keys(v))
    if (!['place', 'dir', 'remote', 'repo', 'machine', 'everyMinutes', 'keepMonths', 'handoffs'].includes(k))
      problems.push({ path: `sync.${k}`, kind: 'unknown-key', detail: 'not a setting' });
  if (typeof v.place !== 'string' || !SYNC_PLACES.includes(v.place as SyncPlace)) {
    problems.push({ path: 'sync.place', kind: 'type', detail: 'expected github or folder' });
    return null;
  }
  if (typeof v.dir !== 'string' || !v.dir.trim()) {
    problems.push({ path: 'sync.dir', kind: 'type', detail: 'expected a folder path' });
    return null;
  }
  const m = v.machine;
  if (!isObj(m) || typeof m.id !== 'string' || !MACHINE_ID.test(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) {
    problems.push({ path: 'sync.machine', kind: 'type', detail: 'expected { id: kebab-case, name: up to 60 characters }' });
    return null;
  }
  const place = v.place as SyncPlace;
  const remote = typeof v.remote === 'string' && v.remote.trim() ? v.remote.trim() : null;
  if (place === 'github' && remote === null) {
    problems.push({ path: 'sync.remote', kind: 'range', detail: 'github needs a remote' });
    return null;
  }
  const repo = typeof v.repo === 'string' && GITHUB_REPO.test(v.repo) ? v.repo : null;
  if (v.repo !== undefined && v.repo !== null && repo === null) problems.push({ path: 'sync.repo', kind: 'type', detail: 'expected owner/name or null' });
  let handoffs = true;
  if (v.handoffs !== undefined) {
    if (typeof v.handoffs === 'boolean') handoffs = v.handoffs;
    else problems.push({ path: 'sync.handoffs', kind: 'type', detail: 'expected true or false' });
  }
  return {
    place,
    dir: v.dir.trim(),
    remote: place === 'github' ? remote : null,
    repo: place === 'github' ? repo : null,
    machine: { id: m.id, name: m.name.trim() },
    everyMinutes: whole(v.everyMinutes, 30, 5, 1440, 'sync.everyMinutes', problems),
    keepMonths: whole(v.keepMonths, 3, 1, 24, 'sync.keepMonths', problems),
    handoffs,
  };
}

/** A whole number within a range, or the fallback (reported). */
function whole(v: unknown, fallback: number, min: number, max: number, path: string, problems: ConfigProblem[]): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return Math.round(v);
  problems.push({ path, kind: 'range', detail: `expected ${min} to ${max}` });
  return fallback;
}

function bools<T extends Record<string, boolean>>(src: unknown, dst: T, path: string, problems: ConfigProblem[]): void {
  if (src === undefined) return;
  if (!isObj(src)) {
    problems.push({ path, kind: 'type', detail: 'expected an object' });
    return;
  }
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dst)) problems.push({ path: `${path}.${k}`, kind: 'unknown-key', detail: 'not a setting' });
    else if (typeof v !== 'boolean') problems.push({ path: `${path}.${k}`, kind: 'type', detail: 'expected true or false' });
    else (dst as Record<string, boolean>)[k] = v;
  }
}

function percent(v: unknown, fallback: number, path: string, problems: ConfigProblem[]): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v);
  problems.push({ path, kind: 'range', detail: 'expected a number from 0 to 100' });
  return fallback;
}

function strings(v: unknown, path: string, problems: ConfigProblem[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    problems.push({ path, kind: 'type', detail: 'expected a list of strings' });
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  return [...v];
}

function normalizeBelt(src: Obj, dst: RuleConfig, problems: ConfigProblem[]): void {
  if (src.disabled !== undefined) {
    dst.disabled = strings(src.disabled, 'belt.disabled', problems).filter((id) => {
      if (!RULE_SET.has(id)) {
        problems.push({ path: 'belt.disabled', kind: 'unknown-key', detail: `no rule named ${id}` });
        return false;
      }
      if (RULES[id as RuleId].locked) {
        problems.push({ path: 'belt.disabled', kind: 'weakened', detail: `${id} protects the protection itself and cannot be switched off` });
        return false;
      }
      return true;
    }) as RuleId[];
  }
  if (src.verdicts !== undefined) {
    if (!isObj(src.verdicts)) problems.push({ path: 'belt.verdicts', kind: 'type', detail: 'expected { <rule>: allow | warn | ask | deny }' });
    else {
      const out: Partial<Record<RuleId, Verdict>> = {};
      for (const [id, v] of Object.entries(src.verdicts)) {
        if (!RULE_SET.has(id)) problems.push({ path: `belt.verdicts.${id}`, kind: 'unknown-key', detail: 'no such rule' });
        else if (typeof v !== 'string' || !VERDICTS.has(v as Verdict))
          problems.push({ path: `belt.verdicts.${id}`, kind: 'type', detail: 'expected allow, warn, ask or deny' });
        else if (RULES[id as RuleId].locked && VERDICT_ORDER[v as Verdict] < VERDICT_ORDER[RULES[id as RuleId].verdict])
          problems.push({ path: `belt.verdicts.${id}`, kind: 'weakened', detail: `${id} can only be made stricter than ${RULES[id as RuleId].verdict}` });
        else out[id as RuleId] = v as Verdict;
      }
      dst.verdicts = out;
    }
  }
  for (const k of ['protectedBranches', 'prOnlyRepos', 'singleBranchRepos'] as const) {
    if (src[k] !== undefined) dst[k] = strings(src[k], `belt.${k}`, problems).filter((s) => s.trim().length > 0);
  }
  if (src.packs !== undefined) {
    if (!isObj(src.packs)) problems.push({ path: 'belt.packs', kind: 'type', detail: 'expected an object' });
    else
      for (const [k, v] of Object.entries(src.packs)) {
        if (k !== 'dockerVolumes') problems.push({ path: `belt.packs.${k}`, kind: 'unknown-key', detail: 'no such pack' });
        else if (typeof v !== 'boolean') problems.push({ path: `belt.packs.${k}`, kind: 'type', detail: 'expected true or false' });
        else dst.packs = { ...dst.packs, dockerVolumes: v };
      }
  }
}

/** Writes a Config as the file's text: stable key order, two-space indent, trailing newline. */
export function serializeConfig(c: Config): string {
  return JSON.stringify(c, null, 2) + '\n';
}

/** Applies a change to one setting by dotted path and returns the new config plus what normalizing it reported. */
export function setConfigValue(c: Config, path: string, value: unknown): ParsedConfig {
  const next = structuredClone(c) as unknown as Obj;
  const keys = path.split('.');
  let cur: Obj = next;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Obj;
  }
  cur[keys[keys.length - 1]!] = value;
  return normalizeConfig(next);
}

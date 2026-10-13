// SPDX-License-Identifier: Apache-2.0
/** Derived views of the settings that several layers need in the same shape. Pure. */
import type { Config } from './config.js';
import type { RuleConfig } from './belt/types.js';
import { DEFAULT_KEYWORDS, type KeywordList, type KeywordTable, type ProjectRef } from './keywords.js';
import type { Lang } from './i18n/index.js';
import type { QuotaBudget } from './quota.js';
import type { ModSessionState } from './session.js';
import { fold } from './text.js';

/** The built-in keyword phrases plus the person's own, per language. */
export function keywordTables(c: Config): Record<Lang, KeywordTable> {
  const out = structuredClone(DEFAULT_KEYWORDS) as Record<Lang, KeywordTable>;
  for (const [lang, extra] of Object.entries(c.keywords.extra) as [Lang, Partial<Record<KeywordList, string[]>>][]) {
    const t = out[lang];
    if (!t || !extra) continue;
    for (const [kind, list] of Object.entries(extra) as [KeywordList, string[]][]) {
      for (const phrase of list ?? []) {
        const f = fold(phrase);
        if (f && !t[kind].includes(f)) t[kind].push(f);
      }
    }
  }
  return out;
}

export function projectRefs(c: Config): ProjectRef[] {
  return c.projects.map((p) => ({ id: p.id, names: p.names }));
}

export function budgetOf(c: Config, s: Pick<ModSessionState, 'weeklyTarget' | 'weeklyTargetSource'> | null): QuotaBudget {
  return {
    weeklyTarget: s?.weeklyTarget ?? null,
    ...(s?.weeklyTargetSource ? { weeklyTargetSource: s.weeklyTargetSource } : {}),
    fiveHourWrapUp: c.quota.fiveHourWrapUp,
    fiveHourStop: c.quota.fiveHourStop,
    defaultWeeklyTarget: c.quota.defaultWeeklyTarget,
    defaultWeeklyWrapUp: c.quota.defaultWeeklyWrapUp,
    staleMinutes: c.quota.staleMinutes,
  };
}

/** The belt's rule configuration with the feature switches applied (the secret scanner switch turns off secret-write notes). */
export function beltConfigOf(c: Config): RuleConfig {
  if (c.modules.secrets) return c.belt;
  return { ...c.belt, disabled: [...new Set([...(c.belt.disabled ?? []), 'secrets.write' as const])] };
}

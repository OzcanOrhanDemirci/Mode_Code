// SPDX-License-Identifier: Apache-2.0
/**
 * Interface language. English is the source dictionary; every other language must define every key
 * (the type system enforces it), so a missing translation is a build error, not an English word in a
 * Turkish screen. Language choice: setting → MODE_CODE_LANG → LC_ALL / LC_MESSAGES / LANG → the
 * system locale → English.
 */
import { format } from '../text.js';
import { en, type MessageKey } from './en.js';
import { tr } from './tr.js';

export type { MessageKey } from './en.js';

export const LANGUAGES = { en: 'English', tr: 'Türkçe' } as const;
export type Lang = keyof typeof LANGUAGES;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, tr };

let current: Lang = 'en';

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && Object.hasOwn(LANGUAGES, x);
}

/** Maps a locale string ("tr-TR", "tr_TR.UTF-8", "en_US") to a supported language, or null. */
export function langFromLocale(locale: string | undefined | null): Lang | null {
  if (!locale) return null;
  const code = locale.toLowerCase().split(/[-_.@]/)[0];
  return isLang(code) ? code : null;
}

export interface LangSources {
  configured?: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  intlLocale?: string | null;
}

export function detectLanguage(src: LangSources): Lang {
  if (isLang(src.configured)) return src.configured;
  const env = src.env ?? {};
  for (const v of [env.MODE_CODE_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    const l = langFromLocale(v);
    if (l) return l;
  }
  return langFromLocale(src.intlLocale) ?? 'en';
}

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function getLanguage(): Lang {
  return current;
}

/**
 * Looks a message up in the current language and fills its {placeholders}. The plugin carries only the messages its
 * code names (scripts/plugin-words.mjs): one it missed shows its key rather than fail.
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return format(DICTS[current][key] ?? en[key] ?? key, params);
}

/** The same lookup in an explicit language, for text that goes somewhere other than this screen. */
export function tIn(lang: Lang, key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return format(DICTS[lang][key] ?? en[key] ?? key, params);
}

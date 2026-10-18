// SPDX-License-Identifier: Apache-2.0
/**
 * The glossary (docs/design.md): one idea, one name, in each language, and the forms it must not take. A test reads
 * every message of both dictionaries against it (test/core/ux-glossary.test.ts), so a word the person found
 * confusing does not come back. Pure.
 */

export interface Term {
  /** The idea, in a few plain words. */
  idea: string;
  en: string;
  tr: string;
  /** Forms the idea must not take in English or in Turkish messages. */
  notEn?: RegExp;
  notTr?: RegExp;
}

/** A Turkish word on its own, so a longer word holding it is not taken for it. */
const word = (w: string) => new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'iu');

export const GLOSSARY: readonly Term[] = [
  // "koşu" read as a race; the plural and every case ("koşular", "koşunun") too, but never "koşul", a condition.
  { idea: 'a task Claude carries to its end alone', en: 'full-autonomy task', tr: 'tam otonom iş', notTr: /(?<!\p{L})koşu(?:lar|(?!l))/iu },
  {
    idea: "what keeps a full-autonomy task's writes in the project and its own folders",
    en: 'write limits',
    tr: 'yazma sınırları',
    notEn: /\bfence\b/i,
    notTr: word('çit'),
  },
  { idea: 'a session where the safety belt asks nothing', en: 'bypass (works without asking)', tr: 'bypass (sormadan çalış)', notTr: /izinsiz/iu },
  { idea: 'helper Claudes that run beside the main one', en: 'agents', tr: 'ajanlar', notEn: /\bsub-?agents?\b/i, notTr: /alt ajan/iu },
  {
    idea: 'the 5-hour and weekly periods of the quota',
    en: 'period',
    tr: 'dönem',
    notEn: /\b(?:5-hour|weekly|quota|subscription)\s+windows?\b|\bwindows? resets?\b/i,
    notTr: /(?:saatlik|haftalık|kota|abonelik)\s+pencere|pencere(?:si|ler)?\s+sıfırlan/iu,
  },
  { idea: 'thousands of tokens', en: '250K tokens', tr: '250 bin token', notTr: /\d\s?B\s+token|\}\s?B\b/u },
];

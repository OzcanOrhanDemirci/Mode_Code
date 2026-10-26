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

export const GLOSSARY: readonly Term[] = [
  // "koşu" read as a race; the plural and every case ("koşular", "koşunun") too, but never "koşul", a condition.
  { idea: 'the way of working that asks the person nothing', en: 'full autonomy', tr: 'tam otonom', notTr: /(?<!\p{L})koşu(?:lar|(?!l))/iu },
  { idea: 'helper Claudes that run beside the main one', en: 'agents', tr: 'ajanlar', notEn: /\bsub-?agents?\b/i, notTr: /alt ajan/iu },
  {
    idea: 'the 5-hour and weekly periods of the quota',
    en: 'period',
    tr: 'dönem',
    notEn: /\b(?:5-hour|weekly|quota|subscription)\s+windows?\b|\bwindows? resets?\b/i,
    notTr: /(?:saatlik|haftalık|kota|abonelik)\s+pencere|pencere(?:si|ler)?\s+sıfırlan/iu,
  },
  { idea: 'thousands of tokens', en: '250K tokens', tr: '250 bin token', notTr: /\d\s?B\s+token|\}\s?B\b/u },
  // Its old names said where it stands ("footer", "under answers"), not what it is.
  {
    idea: "the summary under each of Claude's answers",
    en: 'answer summary',
    tr: 'cevap sonu özeti',
    notEn: /\bfooter lines?\b|\bthe footer\b|\blines under (?:the |each |your )?answers?\b/i,
    notTr: /cevap altı satır|cevab(?:ın|ının|ların) altındaki satır|\balt satır/iu,
  },
];

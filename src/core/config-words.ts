// SPDX-License-Identifier: Apache-2.0
/**
 * Why a value of the settings is refused, in the person's language (docs/design.md, Command line and setup: no
 * English left in a Turkish line). The settings' own check (src/core/config.ts) says it in English, for `--json` and
 * the logs; this says it to the person, wherever a refusal is shown. A reason it does not know is said as it is. Pure.
 */
import { tIn, type Lang, type MessageKey } from './i18n/index.js';

const TR_FIXED: Readonly<Record<string, string>> = {
  'expected an object': 'bir nesne bekleniyordu',
  'expected an object or null': 'bir nesne ya da null bekleniyordu',
  'not a setting': 'böyle bir ayar yok',
  'expected true or false': 'açık (true) ya da kapalı (false) bekleniyordu',
  'expected owner/name or null': 'sahip/ad ya da null bekleniyordu',
  'expected a folder path': 'bir klasör yolu bekleniyordu',
  'expected a folder path or null': 'bir klasör yolu ya da null bekleniyordu',
  'expected a git remote or null': 'bir git uzak depo adresi ya da null bekleniyordu',
  'expected a list': 'bir liste bekleniyordu',
  'expected a list of strings': 'metinlerden bir liste bekleniyordu',
  'expected a model name or null': 'bir model adı ya da null bekleniyordu',
  'expected an https:// address of an ntfy topic, or null': 'bir ntfy konusunun https:// adresi ya da null bekleniyordu',
  'expected "auto" or a language code': '"auto" ya da bir dil kodu bekleniyordu',
  'expected a language code with a table of phrases': 'bir dil kodu ve onun ifade tablosu bekleniyordu',
  'not a keyword kind': 'böyle bir anahtar kelime türü yok',
  'expected { extra: { <lang>: { <kind>: [phrases] } } }': '{ extra: { <dil>: { <tür>: [ifadeler] } } } biçimi bekleniyordu',
  'each project needs a unique kebab-case id': 'her projenin kendine özgü, küçük harf ve tireli bir kimliği olmalı',
  'expected { id: kebab-case, name: up to 60 characters }': '{ id: küçük harf ve tireli, name: en çok 60 karakter } biçimi bekleniyordu',
  'expected { <rule>: allow | warn | ask | deny }': '{ <kural>: allow | warn | ask | deny } biçimi bekleniyordu',
  'not a skill': 'böyle bir beceri yok',
  'not a pack': 'böyle bir paket yok',
  'no such pack': 'böyle bir paket yok',
  'no such rule': 'böyle bir kural yok',
  'must not be above fiveHourStop': '5 saatlik durma eşiğinin (fiveHourStop) üstünde olamaz',
  'must not be above defaultWeeklyTarget': 'haftalık bütçenin (defaultWeeklyTarget) üstünde olamaz',
  'github needs a remote': 'GitHub için bir uzak depo adresi gerekir',
  'the settings file must hold an object': 'ayar dosyası bir nesne tutmalı',
};

const TR_PATTERNS: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  [/^expected a number from (-?\d+) to (-?\d+)$/, (m) => `${m[1]} ile ${m[2]} arası bir sayı bekleniyordu`],
  [/^expected (-?\d+) to (-?\d+)$/, (m) => `${m[1]} ile ${m[2]} arası bir sayı bekleniyordu`],
  [/^expected ((?:[\w-]+, )*[\w-]+) or ([\w-]+)$/, (m) => `${m[1]} ya da ${m[2]} bekleniyordu`],
  [/^written by a newer version \((.+)\)$/, (m) => `daha yeni bir sürümün yazdığı ayar (${m[1]})`],
  [/^no rule named (.+)$/, (m) => `${m[1]} adında bir kural yok`],
  [/^the place (.+) needs a remote$/, (m) => `${m[1] === 'github' ? 'GitHub' : m[1]} için bir uzak depo adresi gerekir`],
  [/^(.+) protects the protection itself and cannot be switched off$/, (m) => `${m[1]} korumanın kendisini korur, kapatılamaz`],
  [/^(.+) can only be made stricter than (allow|warn|ask|deny)$/, (m) => `${m[1]} yalnızca "${verdict(m[2]!)}" kararından daha sıkı yapılabilir`],
];

/** A verdict in Turkish words, as the protection's pages say it. */
const verdict = (v: string): string => tIn('tr', `verdict.${v}` as MessageKey);

/** A refusal's reason as the person reads it. */
export function problemWords(detail: string, lang: Lang): string {
  if (lang !== 'tr') return detail;
  const fixed = TR_FIXED[detail];
  if (fixed) return fixed;
  for (const [re, say] of TR_PATTERNS) {
    const m = re.exec(detail);
    if (m) return say(m);
  }
  return detail;
}

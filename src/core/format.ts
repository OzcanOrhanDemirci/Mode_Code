// SPDX-License-Identifier: Apache-2.0
/** Numbers, times and bars as people read them, in their language. Pure. */
import { tIn, type Lang } from './i18n/index.js';

const locale = (lang: Lang) => (lang === 'tr' ? 'tr-TR' : 'en-US');

/** 1234 → "1.2 K", 2_500_000 → "2.5 M" (Turkish: "1,2 B", "2,5 Mn"). */
export function compact(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  const units = lang === 'tr' ? ['', ' B', ' Mn', ' Mr', ' Tn'] : ['', ' K', ' M', ' B', ' T'];
  let i = 0;
  let v = abs;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return (n < 0 ? '-' : '') + v.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 }) + units[i];
}

/** 1234.5 → "1,234.50" (Turkish: "1.234,50"), always `digits` after the point. */
export function decimal(n: number, lang: Lang, digits = 2): string {
  if (!Number.isFinite(n)) return '?';
  return n.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function integer(n: number, lang: Lang): string {
  return Math.round(n).toLocaleString(locale(lang));
}

/** "%14" in Turkish, "14%" in English. */
export function percent(n: number | null | undefined, lang: Lang, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '?';
  const v = n.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return lang === 'tr' ? `%${v}` : `${v}%`;
}

/** How long ago, coarse: "now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at: number | null | undefined, now: number, lang: Lang): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return tIn(lang, 'time.never');
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return tIn(lang, 'time.now');
  const m = Math.round(s / 60);
  if (m < 60) return tIn(lang, 'time.minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 36) return tIn(lang, 'time.hourAgo', { n: h });
  return tIn(lang, 'time.dayAgo', { n: Math.round(h / 24) });
}

/** How long until, coarse: "in 4 h 10 min", "in 3 days". */
export function until(at: number | null | undefined, now: number, lang: Lang): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return '?';
  const m = Math.max(0, Math.round((at - now) / 60000));
  if (m < 60) return tIn(lang, 'time.inMin', { n: m });
  const h = Math.floor(m / 60);
  if (h < 48) return tIn(lang, 'time.inHourMin', { h, m: m % 60 });
  return tIn(lang, 'time.inDay', { n: Math.round(h / 24) });
}

export function duration(ms: number, lang: Lang): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return tIn(lang, 'time.sec', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return tIn(lang, 'time.min', { n: m });
  return tIn(lang, 'time.hourMin', { h: Math.floor(m / 60), m: m % 60 });
}

/** A local date and time: "12.10.2026 08:31" / "10/12/2026 08:31". */
export function dateTime(at: number, lang: Lang): string {
  const d = new Date(at);
  return d.toLocaleString(locale(lang), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function clock(at: number, lang: Lang): string {
  return new Date(at).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
}

/**
 * A horizontal bar of `width` cells for 0-100. Eighth blocks give sub-cell precision; `plain` uses only
 * ASCII for terminals and screen readers that do not show block characters.
 */
export function bar(pct: number, width: number, plain = false): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  if (plain) {
    const full = Math.round((p / 100) * width);
    return '#'.repeat(full) + '-'.repeat(Math.max(0, width - full));
  }
  const eighths = Math.round((p / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const rest = eighths % 8;
  const parts = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const s = '█'.repeat(full) + (rest ? parts[rest] : '');
  return s + ' '.repeat(Math.max(0, width - full - (rest ? 1 : 0)));
}

/** A one-line chart of values, eight levels (▁…█); ASCII levels when `plain`. */
export function sparkline(values: readonly number[], plain = false): string {
  if (!values.length) return '';
  const max = Math.max(...values, 0);
  const levels = plain ? ['_', '.', '-', '~', '=', '+', '*', '#'] : ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return values.map((v) => (max <= 0 ? levels[0] : levels[Math.min(7, Math.floor((v / max) * 7.999))])).join('');
}

/** Shortens a path for display: home becomes ~, the middle is cut when longer than max. */
export function shortPath(path: string | null | undefined, home: string, max = 60): string {
  if (!path) return '?';
  let p = path.replace(/\\/g, '/');
  const h = home.replace(/\\/g, '/');
  if (p.toLowerCase().startsWith(h.toLowerCase())) p = '~' + p.slice(h.length);
  if (p.length <= max) return p;
  const keep = max - 1;
  return p.slice(0, Math.ceil(keep / 3)) + '…' + p.slice(p.length - Math.floor((keep * 2) / 3));
}

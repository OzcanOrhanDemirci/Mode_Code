// SPDX-License-Identifier: Apache-2.0
/**
 * A call's running time in a few cells, as the cockpit counts it on (src/mod/cockpit-clock.ts): "12 s", "3 min 04 s",
 * "1 h 02 min"; in Turkish "12 sn", "3 dk 04 sn", "1 sa 02 dk". Its own file with no imports: the surface module that
 * draws it carries nothing else. Pure.
 */
export function elapsedText(ms: number, lang: 'en' | 'tr'): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const [sec, min, hour] = lang === 'tr' ? ['sn', 'dk', 'sa'] : ['s', 'min', 'h'];
  if (s < 60) return `${s} ${sec}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${min} ${String(s % 60).padStart(2, '0')} ${sec}`;
  return `${Math.floor(m / 60)} ${hour} ${String(m % 60).padStart(2, '0')} ${min}`;
}

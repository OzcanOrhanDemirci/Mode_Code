// SPDX-License-Identifier: Apache-2.0
/**
 * "Why is it so?" (docs/design.md, rule 7): the reason for a state, worked out by code from the settings and the
 * session, never guessed. Each subject says how it is now and the chain behind it, each link a setting (with the page
 * where it is changed) or something done in the session. `/neden` (`/why`) shows them; Claude asks through the `why`
 * tool. Pure: the settings and the session's facts in, sentences out.
 */
import type { Config } from '../config.js';
import { RULES } from '../belt/rules.js';
import type { RuleId } from '../belt/types.js';
import { tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { clock } from '../format.js';
import type { ModSessionState } from '../session.js';
import { bypassOn } from '../session.js';
import { nameOf, placeOf, SETTINGS, valueIn, valueText, type SettingId, type SettingPath } from './catalog.js';

/** A link of the chain: in words; the setting behind it and its page, when it is one. */
export interface Reason {
  text: string;
  setting?: SettingPath;
  address?: string;
}

export interface WhyAnswer {
  subject: WhySubject;
  title: string;
  /** How it is now, in words. */
  now: string;
  because: Reason[];
}

/** What the reasons are read from: the settings in effect, the session (null outside one), the clock. */
export interface WhyFacts {
  config: Readonly<Config>;
  session: Pick<ModSessionState, 'mode' | 'interaction' | 'bypass' | 'tainted' | 'frozen' | 'agents'> | null;
  now: number;
  /** Mode_Code's development switch has the belt off in this session (temporary, src/core/dev-switch.ts). */
  beltOff?: boolean;
}

export const WHY_SUBJECTS = [
  'belt',
  'mode',
  'style',
  'autonomy',
  'bypass',
  'agents',
  'helpers',
  'freeze',
  'taint',
  'quota',
  'clearHint',
  'footer',
  'strip',
  'keywords',
  'notifications',
  'handoff',
  'morning',
  'packs',
  'secrets',
  'mascot',
  'update',
  'memory',
  'sync',
] as const;
export type WhySubject = (typeof WHY_SUBJECTS)[number];

/** Every subject's answer, in order. */
export function whyAll(f: WhyFacts, lang: Lang): WhyAnswer[] {
  return WHY_SUBJECTS.map((s) => why(s, f, lang));
}

/** The subject a word names, in either language, or null. */
export function whySubjectNamed(word: string): WhySubject | null {
  for (const l of ['en', 'tr'] as Lang[]) {
    const w = word.trim().toLocaleLowerCase(l);
    if (!w) return null;
    for (const s of WHY_SUBJECTS) {
      const title = tIn(l, `why.title.${s}` as MessageKey).toLocaleLowerCase(l);
      // Its id, its title, or the title's first word ("kota" for "Kota bütçesi").
      if (s.toLowerCase() === w || title === w || title.split(/\s+/)[0] === w) return s;
    }
  }
  return null;
}

/** One subject's answer. */
export function why(subject: WhySubject, f: WhyFacts, lang: Lang): WhyAnswer {
  const t = (k: string, p?: Record<string, string | number>) => tIn(lang, k as MessageKey, p);
  /** A setting as a reason: "Allow bypass" is off (Working › Bypass). */
  const setting = (path: SettingPath): Reason => {
    const page = SETTINGS[path as SettingId]?.page ?? null;
    return {
      text: t('why.setting', { name: nameOf(path, lang), value: valueText(path, valueIn(f.config, path), lang), place: page ? placeOf(page, lang) : '' }),
      setting: path,
      ...(page ? { address: page } : {}),
    };
  };
  const on = (path: SettingPath) => valueIn(f.config, path) === true;
  const said = (key: string, p?: Record<string, string | number>): Reason => ({ text: t(key, p) });
  const answer = (now: string, because: Reason[]): WhyAnswer => ({ subject, title: t(`why.title.${subject}`), now, because });
  /** A subject that is on or off by one switch. */
  const sw = (path: SettingPath, onKey: string, offKey: string): WhyAnswer => answer(t(on(path) ? onKey : offKey), [setting(path)]);
  const s = f.session;
  switch (subject) {
    case 'belt':
      if (f.beltOff) return answer(t('why.belt.devOff'), [said('why.r.devSwitch')]);
      if (bypassOn(s, f.now))
        return answer(t('why.belt.bypass', { until: clock(s!.bypass!.until, lang) }), [said('why.r.bypassOn'), setting('bypass.enabled')]);
      return answer(t('why.belt.on'), [said('why.r.beltAlways')]);
    case 'mode': {
      if (!on('modules.modes')) return answer(t('why.mode.off'), [setting('modules.modes')]);
      const mode = s?.mode ?? 'free';
      return answer(t('why.mode.now', { mode: t(`mode.name.${mode}`) }), [mode === 'free' ? said('why.r.modeDefault') : said('why.r.modeChosen')]);
    }
    case 'style': {
      if (!on('modules.modes')) return answer(t('why.style.off'), [setting('modules.modes')]);
      const style = s?.interaction === 'autonomous' ? 'autonomous' : s?.interaction === 'full' ? 'full' : 'manual';
      return answer(t(`why.style.${style}`), [s?.interaction && s.interaction !== 'default' ? said('why.r.styleChosen') : said('why.r.styleDefault')]);
    }
    case 'autonomy':
      if (!on('autonomy.enabled')) return answer(t('why.autonomy.off'), [setting('autonomy.enabled')]);
      if (!on('modules.modes')) return answer(t('why.autonomy.noStrip'), [setting('modules.modes')]);
      return answer(t('why.autonomy.on'), [setting('autonomy.enabled'), setting('autonomy.maxHours')]);
    case 'bypass':
      if (!on('bypass.enabled')) return answer(t('why.bypass.off'), [setting('bypass.enabled')]);
      if (bypassOn(s, f.now)) return answer(t('why.bypass.on', { until: clock(s!.bypass!.until, lang) }), [said('why.r.bypassOn'), setting('bypass.maxHours')]);
      return answer(t('why.bypass.ready'), [setting('bypass.enabled'), said('why.r.bypassSession')]);
    case 'agents': {
      if (!on('agents.enabled')) return answer(t('why.agents.claude'), [setting('agents.enabled')]);
      const a = s?.agents;
      if (!a || a.mode === 'off') return answer(t('why.agents.none'), [setting('agents.enabled'), said(a ? 'why.r.agentsOff' : 'why.r.agentsStart')]);
      return answer(t(a.mode === 'free' ? 'why.agents.free' : 'why.agents.assigned', { n: a.n }), [said('why.r.agentsSet')]);
    }
    case 'helpers':
      if (!on('agents.enabled')) return answer(t('why.helpers.claude'), [setting('agents.enabled')]);
      return sw('agents.helpers', 'why.helpers.free', 'why.helpers.counted');
    case 'freeze':
      return s?.frozen ? answer(t('why.freeze.on', { folder: s.frozen }), [said('why.r.frozen')]) : answer(t('why.freeze.off'), [said('why.r.notFrozen')]);
    case 'taint':
      return s?.tainted
        ? answer(t('why.taint.on'), [said('why.r.tainted', { source: s.tainted.source, at: clock(s.tainted.at, lang) })])
        : answer(t('why.taint.off'), [said('why.r.notTainted')]);
    case 'quota': {
      if (!on('modules.quota')) return answer(t('why.quota.off'), [setting('modules.quota')]);
      const five = valueIn(f.config, 'quota.fiveHourWrapUp') as number;
      const stop = valueIn(f.config, 'quota.fiveHourStop') as number;
      const week = valueIn(f.config, 'quota.defaultWeeklyTarget') as number;
      return answer(t('why.quota.on', { five, stop, week }), [
        setting('quota.fiveHourWrapUp'),
        setting('quota.fiveHourStop'),
        setting('quota.defaultWeeklyTarget'),
        said('why.r.quotaKeyword'),
      ]);
    }
    case 'clearHint':
      return sw('quota.clearHint', 'why.clearHint.on', 'why.clearHint.off');
    case 'footer':
      if (!on('modules.footer')) return answer(t('why.footer.off'), [setting('modules.footer')]);
      return answer(t('why.footer.on', { mode: valueText('footer.mode', valueIn(f.config, 'footer.mode'), lang) }), [
        setting('modules.footer'),
        setting('footer.mode'),
      ]);
    case 'strip':
      return sw('modules.modes', 'why.strip.on', 'why.strip.off');
    case 'keywords':
      return sw('modules.keywords', 'why.keywords.on', 'why.keywords.off');
    case 'notifications':
      return sw('modules.notifications', 'why.notifications.on', 'why.notifications.off');
    case 'handoff':
      return sw('memory.handoff.enabled', 'why.handoff.on', 'why.handoff.off');
    case 'morning':
      return sw('memory.morning.enabled', 'why.morning.on', 'why.morning.off');
    case 'packs':
      return sw('packs.autoUse', 'why.packs.on', 'why.packs.off');
    case 'secrets':
      return sw('modules.secrets', 'why.secrets.on', 'why.secrets.off');
    case 'mascot':
      return sw('modules.mascot', 'why.mascot.on', 'why.mascot.off');
    case 'update':
      return sw('update.check', 'why.update.on', 'why.update.off');
    case 'memory':
      return f.config.memory.store
        ? answer(t('why.memory.on', { dir: f.config.memory.store.dir }), [said('why.r.memorySetUp')])
        : answer(t('why.memory.off'), [said('why.r.memoryNotSetUp')]);
    case 'sync':
      return f.config.sync
        ? answer(t('why.sync.on', { name: f.config.sync.machine.name }), [said('why.r.syncSetUp')])
        : answer(t('why.sync.off'), [said('why.r.syncNotSetUp')]);
  }
}

/**
 * Why a rule of the safety belt does what it does: its own verdict, the one your settings give it, whether it is off,
 * locked, or lifted by bypass.
 */
export function whyRule(id: RuleId, f: WhyFacts, lang: Lang): WhyAnswer {
  const t = (k: string, p?: Record<string, string | number>) => tIn(lang, k as MessageKey, p);
  const rule = RULES[id];
  const name = t(`rulename.${id}`);
  const verdict = f.config.belt.verdicts?.[id] ?? rule.verdict;
  const off = !rule.locked && (f.config.belt.disabled ?? []).includes(id);
  const because: Reason[] = [];
  if (rule.locked) because.push({ text: t('why.r.ruleLocked') });
  if (off) because.push({ text: t('why.r.ruleDisabled'), address: `protection/rules/${id}` });
  else if (f.config.belt.verdicts?.[id])
    because.push({ text: t('why.r.ruleVerdict', { verdict: t(`verdict.${verdict}`) }), address: `protection/rules/${id}` });
  else because.push({ text: t('why.r.ruleDefault', { verdict: t(`verdict.${verdict}`) }), address: `protection/rules/${id}` });
  if (bypassOn(f.session, f.now) && !rule.locked) because.push({ text: t('why.r.ruleBypass') });
  return { subject: 'belt', title: name, now: off ? t('verdict.off') : t(`verdict.${verdict}`), because };
}

/** An answer as plain lines (the command's output, the tool's answer). */
export function whyText(a: WhyAnswer): string {
  return [`${a.title}: ${a.now}`, ...a.because.map((r) => `  - ${r.text}`)].join('\n');
}

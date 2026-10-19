// SPDX-License-Identifier: Apache-2.0
/**
 * What the strip above the prompt says in words (docs/design.md, the four questions): the line under it, which
 * tells what Claude does now; the card of each control, in one line for the pointer and in full for the keyboard;
 * and Mo's state. Built from the catalog (src/core/ux/catalog.ts), never written by a surface of its own. Pure: the
 * in-process plugin draws them (src/mod/register.ts).
 */
import { commandNamed, commandOf, type StripView } from '../controls.js';
import { stripAgents } from '../agents.js';
import { tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { MODE_ICON } from '../modes.js';
import type { MoState } from '../mo/art.js';
import { CONTROLS, controlOf, controlText, type ControlId } from './catalog.js';
import type { Meaning } from './tokens.js';

/** The control a strip item stands for, by its command's name ("3", "tam-otonom"); null for none. */
export function controlOfItem(id: string): ControlId | null {
  const a = commandNamed(id);
  return a ? controlOf(a) : null;
}

/** Whether a control is in effect now, as the strip lights it. */
export function controlOn(id: ControlId, v: StripView): boolean {
  switch (id) {
    case 'mode.chat':
    case 'mode.research':
    case 'mode.plan':
    case 'mode.code':
    case 'mode.free':
      return (v.flow === null || v.flow.state === 'paused') && v.mode === id.slice('mode.'.length);
    case 'style.manual':
    case 'style.autonomous':
      return v.style === id.slice('style.'.length);
    case 'fullAuto':
      return v.style === 'full';
    case 'flow':
      return v.flow !== null && v.flow.state !== 'paused';
    case 'bypass':
      return v.bypass.on;
    case 'freeze':
      return !!v.frozen;
    case 'agents':
      return !!v.agents && (v.agents.state.mode !== 'off' || v.agents.state.ultracode);
    case 'cockpit':
      return !!v.cockpit;
    default:
      return false;
  }
}

const t = (lang: Lang, key: string, params?: Readonly<Record<string, string | number>>) => tIn(lang, key as MessageKey, params);

function modeName(v: StripView, lang: Lang): string {
  const icon = MODE_ICON[v.mode];
  return `${icon ? `${icon} ` : ''}${t(lang, `mode.name.${v.mode}`)}`;
}

/**
 * The line under the strip: what Claude does now, in words. "📐 plan: reads and plans; writes the plan only ·
 * manual: one step, then it waits for you", and after it what else holds: a flow, bypass, a freeze, the agents.
 */
export function stripNow(v: StripView, lang: Lang): string {
  const parts = [`${modeName(v, lang)}: ${t(lang, `ux.say.mode.${v.mode}`)}`, `${t(lang, `ctl.style.${v.style}`)}: ${t(lang, `ux.say.style.${v.style}`)}`];
  if (v.flow) parts.push(t(lang, `ux.say.flow.${v.flow.state}`, { at: v.flow.at }));
  if (v.bypass.on) parts.push(t(lang, 'ux.say.bypass'));
  if (v.frozen) parts.push(t(lang, 'ux.say.frozen', { folder: v.frozen }));
  const a = v.agents;
  if (a?.shown && a.state.ultracode) parts.push(t(lang, 'ux.say.agents.ultracode'));
  else if (a?.shown && a.state.mode !== 'off') parts.push(t(lang, `ux.say.agents.${a.state.mode}`, { n: a.state.n }));
  return parts.join(' · ');
}

/** What a press on the flow does in each of its states: an open flow closes, a paused one goes on, an armed one is put away. */
const FLOW_PRESS = {
  running: 'ux.ctl.flow.pressRunning',
  approval: 'ux.ctl.flow.pressRunning',
  paused: 'ux.ctl.flow.pressPaused',
  armed: 'ux.ctl.flow.pressArmed',
} as const satisfies Record<NonNullable<StripView['flow']>['state'], MessageKey>;

/** What a press does now: a control in effect is pressed to end it (a switch, the flow, a run); the rest as the catalog says. */
function pressText(id: ControlId, v: StripView, lang: Lang): string {
  if (id === 'flow' && v.flow) return tIn(lang, FLOW_PRESS[v.flow.state]);
  if ((id === 'bypass' || id === 'freeze' || id === 'fullAuto' || id === 'cockpit') && controlOn(id, v)) return t(lang, `ux.ctl.${id}.pressOn`);
  return controlText(id, 'press', lang);
}

/** How the control is now, in words: chosen or not, on or off, or what it opens. */
export function nowText(id: ControlId, v: StripView, lang: Lang): string {
  const on = controlOn(id, v);
  switch (CONTROLS[id].kind) {
    case 'choice':
      return t(lang, on ? 'ux.card.chosen' : 'ux.card.notChosen');
    case 'switch':
      return id === 'freeze' && v.frozen ? t(lang, 'ux.card.frozen', { folder: v.frozen }) : t(lang, on ? 'ux.card.on' : 'ux.card.off');
    default:
      break;
  }
  if (id === 'agents' && v.agents) return stripAgents(v.agents.state, v.agents.running, t(lang, 'ctl.strip.agents'), false);
  if (id === 'flow') return v.flow ? t(lang, `ux.say.flow.${v.flow.state}`, { at: v.flow.at }) : t(lang, 'ux.card.flowOff');
  if (id === 'fullAuto') return t(lang, on ? 'ux.card.runOn' : 'ux.card.runOff');
  return t(lang, CONTROLS[id].kind === 'opener' ? 'ux.card.opens' : 'ux.card.acts');
}

/** The slash command that does what the control does: "/3", "/tam-otonom". */
export function commandText(id: string, lang: Lang): string {
  const a = commandNamed(id);
  return a ? `/${commandOf(a, lang)}` : `/${id}`;
}

/**
 * A control's card in one line, for the pointer resting on it (the line under the strip shows it): how it is
 * now, what a press does, how it is taken back, its command. "◉ In effect: Claude reads and plans… · Undo: pick
 * another mode · /3". Cut at the edge where the room ends; the keyboard's card has every answer in full.
 */
export function cardLine(id: string, v: StripView, lang: Lang): string {
  const c = controlOfItem(id);
  if (!c) return '';
  const on = controlOn(c, v);
  const kind = CONTROLS[c].kind;
  const lead =
    kind === 'choice' && on
      ? t(lang, 'ux.card.lineChosen')
      : kind === 'switch'
        ? `${t(lang, on ? 'ux.card.on' : 'ux.card.off')}. ${t(lang, 'ux.card.linePress')}`
        : t(lang, 'ux.card.linePress');
  return [`${lead} ${pressText(c, v, lang)}`, t(lang, `ux.ctl.backShort.${CONTROLS[c].back}`), commandText(id, lang)].join(' · ');
}

/** A control's card in full, for the keyboard's focus: what it is, how it is now, what a press does, how it is undone, the keys. */
export function cardRows(id: string, v: StripView, lang: Lang): { label: string; text: string; meaning?: Meaning }[] {
  const c = controlOfItem(id);
  if (!c) return [];
  const on = controlOn(c, v);
  return [
    { label: t(lang, 'ux.card.what'), text: controlText(c, 'what', lang) },
    { label: t(lang, 'ux.card.now'), text: nowText(c, v, lang), meaning: on ? (c === 'bypass' ? 'bypass' : 'on') : 'off' },
    { label: t(lang, 'ux.card.press'), text: pressText(c, v, lang) },
    { label: t(lang, 'ux.card.back'), text: controlText(c, 'back', lang) },
    { label: t(lang, 'ux.card.keys'), text: t(lang, 'ux.card.keysLine', { cmd: commandText(id, lang) }) },
  ];
}

/** What Mo is showing, in words, and what a click on Mo does. */
export function moLine(state: MoState, lang: Lang): string {
  return `${t(lang, `ux.say.mo.${state}`)} · ${t(lang, 'ux.say.mo.click')}`;
}

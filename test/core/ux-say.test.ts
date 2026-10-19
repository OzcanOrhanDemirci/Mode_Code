// SPDX-License-Identifier: Apache-2.0
/**
 * The strip in words (src/core/ux/say.ts): the line under it that tells what Claude does now, the card of every
 * control in one line and in full, and Mo's state, in both languages, from the catalog alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, stripRows, type StripView } from '../../src/core/controls.js';
import { DEFAULT_AGENTS } from '../../src/core/agents.js';
import { MO_STATES } from '../../src/core/mo/art.js';
import { CONTROL_IDS, CONTROLS, type ControlId } from '../../src/core/ux/catalog.js';
import { cardLine, cardRows, commandText, controlOfItem, controlOn, moLine, nowText, stripNow } from '../../src/core/ux/say.js';

const view: StripView = { mode: 'plan', style: 'manual', flow: null, fullAutoShown: false, bypass: { shown: false, on: false, count: 0 } };
const LANGS = ['en', 'tr'] as const;
/** A message key showing through: the plugin's dictionaries lacked it. */
const leaked = (s: string) => /\b(?:ux|ctl|mode|agents)\.[a-z]+\.[a-zA-Z.]+/.test(s);

test('the line under the strip says what Claude does now: the mode and the way of working in words, then what else holds', () => {
  assert.equal(stripNow(view, 'en'), '📐 plan: reads and plans; writes the plan only · manual: one step, then it waits for you');
  assert.equal(stripNow(view, 'tr'), '📐 plan: okur ve planlar; yalnız planı yazar · manuel: bir adım yapar, sonra seni bekler');
  const busy: StripView = {
    ...view,
    mode: 'research',
    style: 'autonomous',
    flow: { at: '1/4', state: 'running' },
    bypass: { shown: true, on: true, count: 2 },
    frozen: 'feature',
    agents: { shown: true, state: { ...DEFAULT_AGENTS, mode: 'free', n: 3 }, running: 1 },
  };
  assert.equal(
    stripNow(busy, 'en'),
    '🔍 research: reads and searches; writes a report only · autonomous: goes on without asking; stops for your decisions · flow 1/4 at work · ⚡ bypass: the belt asks nothing · ❄ writes stay in feature · 👥 at most 3 agents at once',
  );
  assert.match(stripNow({ ...view, style: 'full' }, 'tr'), /tam otonom: bir görevi sonuna kadar götürür$/);
  assert.match(stripNow({ ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS, ultracode: true }, running: 0 } }, 'en'), /workflows run the agents$/);
  // Agents shown but off add nothing: the line says what holds.
  assert.equal(stripNow({ ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS }, running: 0 } }, 'en'), stripNow(view, 'en'));
  for (const lang of LANGS)
    for (const mode of ['chat', 'research', 'plan', 'code', 'free'] as const)
      for (const style of ['manual', 'autonomous', 'full'] as const) assert.ok(!leaked(stripNow({ ...view, mode, style }, lang)), `${lang} ${mode} ${style}`);
});

test('every control on the strip has its card: how it is now, what a press does, how it is taken back, its command', () => {
  const all: StripView = {
    ...view,
    fullAutoShown: true,
    bypass: { shown: true, on: false, count: 0 },
    frozen: 'feature',
    agents: { shown: true, state: { ...DEFAULT_AGENTS }, running: 0 },
  };
  for (const lang of LANGS) {
    const ids = stripRows(all, lang, 200)
      .flat()
      .flatMap((s) => s.items.map((i) => i.id));
    for (const id of ids) {
      const line = cardLine(id, all, lang);
      assert.ok(line.endsWith(` · ${commandText(id, lang)}`), `${lang} ${id}: ${line}`);
      assert.equal(line.split(' · ').length >= 3, true, `${lang} ${id}: ${line}`);
      assert.ok(!leaked(line), `${lang} ${id}: ${line}`);
      const rows = cardRows(id, all, lang);
      assert.equal(rows.length, 5, `${lang} ${id}`);
      for (const r of rows) assert.ok(r.label && r.text && !leaked(r.text), `${lang} ${id} ${r.label}: ${r.text}`);
      assert.ok(rows.at(-1)!.text.includes(commandText(id, lang)));
    }
  }
  // In effect, a choice says so first; a switch says on or off; the rest say what a press does.
  assert.match(cardLine('3', view, 'en'), /^◉ In effect: Claude reads and plans/);
  assert.match(cardLine('4', view, 'en'), /^Press: Claude develops/);
  assert.match(cardLine('bypass', all, 'en'), /^○ Off\. Press: Its window says what bypass lifts and until when/);
  assert.match(
    cardLine('bypass', { ...all, bypass: { shown: true, on: true, count: 1 } }, 'en'),
    /^● On\. Press: Bypass ends at once; the safety belt asks again\. · Undo: press it again · \/bypass$/,
  );
  assert.match(cardLine('dondur', all, 'tr'), /^● Açık\. Basarsan: Dondurma biter/);
  assert.match(cardLine('00', view, 'tr'), / · Geri alınmaz · \/00$/);
  assert.equal(cardLine('nope', view, 'en'), '');
  assert.deepEqual(cardRows('nope', view, 'en'), []);
});

test('what a press does follows the state: the flow closes, goes on or is put away; a run attached ends', () => {
  const flow = (state: 'running' | 'approval' | 'paused' | 'armed') => cardLine('6', { ...view, flow: { at: '2/4', state } }, 'en');
  assert.match(flow('running'), /^Press: The flow closes; its record and what it wrote stay\./);
  assert.match(flow('approval'), /^Press: The flow closes/);
  assert.match(flow('paused'), /^Press: The flow goes on from the step where it paused\./);
  assert.match(flow('armed'), /^Press: Put away: your next message is an ordinary one\./);
  assert.match(cardLine('6', view, 'en'), /^Press: Its window offers the steps/);
  assert.match(cardLine('full-auto', { ...view, style: 'full' }, 'en'), /^Press: The run ends as "full auto cancel" ends it/);
  assert.match(cardLine('full-auto', { ...view, fullAutoShown: true }, 'en'), /^Press: Starts a full-autonomy run/);
  assert.equal(nowText('flow', { ...view, flow: { at: '2/4', state: 'paused' } }, 'en'), 'flow paused at 2/4');
  assert.equal(nowText('flow', view, 'tr'), 'Akış yok; mesajların sıradan mesajlar');
  assert.equal(nowText('fullAuto', { ...view, style: 'full' }, 'en'), '● A full-autonomy run is attached');
  // The cockpit is a switch: shown or not.
  assert.equal(nowText('cockpit', view, 'en'), '○ Off');
  assert.equal(nowText('cockpit', { ...view, cockpit: true }, 'tr'), '● Açık');
  assert.match(cardLine('0', { ...view, cockpit: true }, 'en'), /^● On\. Press: The cockpit closes; the session goes on\./);
  assert.equal(nowText('close', view, 'en'), 'Acts at once when pressed');
  assert.equal(nowText('freeze', { ...view, frozen: 'src' }, 'en'), '● On: writes stay in src');
  assert.equal(nowText('bypass', view, 'tr'), '○ Kapalı');
  assert.equal(nowText('agents', { ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS, mode: 'free', n: 4 }, running: 2 } }, 'en'), '👥 agents ≤4 · 2');
  // Each control says its own state, whatever else holds beside it.
  const crowded: StripView = { ...view, frozen: 'src', agents: { shown: true, state: { ...DEFAULT_AGENTS, mode: 'free', n: 4 }, running: 0 } };
  assert.equal(nowText('bypass', crowded, 'en'), '○ Off');
  assert.equal(nowText('cockpit', crowded, 'en'), '○ Off');
  assert.equal(nowText('why', crowded, 'en'), 'Opens a window; nothing changes until you act there');
  // The state's colour follows its meaning: bypass on is bypass's own, anything else on is on, off is off.
  const meaning = (id: string, v: StripView) => cardRows(id, v, 'en')[1]!.meaning;
  assert.deepEqual(
    [meaning('bypass', { ...view, bypass: { shown: true, on: true, count: 0 } }), meaning('3', view), meaning('4', view)],
    ['bypass', 'on', 'off'],
  );
});

test('in effect means what the strip lights: one mode, one way of working, the flow over the modes while it is on', () => {
  const on = (v: StripView) => CONTROL_IDS.filter((id) => controlOn(id, v));
  assert.deepEqual(on(view), ['mode.plan', 'style.manual']);
  assert.deepEqual(on({ ...view, flow: { at: '1/3', state: 'running' } }), ['style.manual', 'flow']);
  assert.deepEqual(on({ ...view, flow: { at: '1/3', state: 'paused' } }), ['mode.plan', 'style.manual']);
  assert.deepEqual(on({ ...view, style: 'full', bypass: { shown: true, on: true, count: 0 }, frozen: 'x' }), ['mode.plan', 'fullAuto', 'bypass', 'freeze']);
  assert.deepEqual(on({ ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS, mode: 'free' }, running: 0 } }), ['mode.plan', 'style.manual', 'agents']);
  assert.deepEqual(on({ ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS }, running: 0 } }), ['mode.plan', 'style.manual']);
  assert.deepEqual(on({ ...view, agents: { shown: true, state: { ...DEFAULT_AGENTS, ultracode: true }, running: 0 } }), [
    'mode.plan',
    'style.manual',
    'agents',
  ]);
  // The strip lights the same ones.
  const lit = (v: StripView) =>
    stripRows(v, 'en', 200)
      .flat()
      .flatMap((s) => s.items.filter((i) => i.active).map((i) => controlOfItem(i.id)));
  for (const v of [view, { ...view, flow: { at: '1/3', state: 'running' } as const }, { ...view, frozen: 'x' }]) assert.deepEqual(lit(v).sort(), on(v).sort());
});

test('every command names its control, and every control kind is one of the four', () => {
  for (const c of COMMANDS) {
    const id = controlOfItem(c.name);
    assert.ok(id && CONTROLS[id as ControlId], c.name);
  }
  assert.equal(controlOfItem('activity'), null);
  for (const id of CONTROL_IDS) assert.ok(['choice', 'switch', 'action', 'opener'].includes(CONTROLS[id].kind), id);
});

test("Mo's state in words, every state in both languages, with what a click does", () => {
  for (const lang of LANGS)
    for (const s of MO_STATES) {
      const line = moLine(s, lang);
      assert.match(line, /^Mo: .+ · (click: what happened|tıkla: neler oldu)$/, `${lang} ${s}`);
      assert.ok(!leaked(line), `${lang} ${s}`);
    }
  assert.equal(moLine('block', 'tr'), 'Mo: emniyet kemeri az önce bir çağrıyı durdurdu; /neden son nedenini söyler. · tıkla: neler oldu');
  assert.equal(new Set(MO_STATES.map((s) => moLine(s, 'en'))).size, MO_STATES.length, 'each state says something of its own');
});

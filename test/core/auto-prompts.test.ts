// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_BUDGETS,
  AUTO_PROMPTS_KEPT,
  budgetLabel,
  parseAutoPrompts,
  rememberAutoPrompt,
  serializeAutoPrompts,
  startBudgets,
  type AutoPrompt,
} from '../../src/core/auto-prompts.js';

const T = Date.parse('2026-10-15T14:00:00Z');
const p = (text: string, at: number, budget = '+10'): AutoPrompt => ({ text, budget, at });

test('the newest task goes on top and three are kept; a task given again moves up with its new budget and time', () => {
  let list: AutoPrompt[] = [];
  for (const [i, text] of ['one', 'two', 'three', 'four'].entries()) list = rememberAutoPrompt(list, p(text, T + i));
  assert.equal(AUTO_PROMPTS_KEPT, 3);
  assert.deepEqual(
    list.map((x) => x.text),
    ['four', 'three', 'two'],
  );
  const again = rememberAutoPrompt(list, p('  two  ', T + 9, '+20'));
  assert.deepEqual(again, [p('two', T + 9, '+20'), p('four', T + 3), p('three', T + 2)]);
  // An empty task changes nothing.
  assert.deepEqual(rememberAutoPrompt(list, p('   ', T + 10)), list);
  assert.deepEqual(rememberAutoPrompt([p('a', 1), p('b', 2), p('c', 3), p('d', 4)], p('', 5)).length, 3);
});

test('the file is read back as written; anything else in it is left out, never a crash', () => {
  const list = [p('Add rate limiting.\nThen the docs.', T, '+20'), p('Fix the login.', T - 1)];
  assert.deepEqual(parseAutoPrompts(serializeAutoPrompts(list)), list);
  assert.match(serializeAutoPrompts(list), /^\{\n {2}"v": 1,\n {2}"prompts": \[/);
  assert.ok(serializeAutoPrompts(list).endsWith('}\n'));
  assert.equal(JSON.parse(serializeAutoPrompts([p('a', 1), p('b', 2), p('c', 3), p('d', 4)])).prompts.length, 3);
  for (const text of [null, '', 'not json', 'null', '[]', '{}', '{"prompts": {}}']) assert.deepEqual(parseAutoPrompts(text), [], String(text));
  const mixed = {
    prompts: [
      p('kept', T),
      null,
      'text',
      { text: '  ', budget: '+5', at: T },
      { text: 'no budget', at: T },
      { text: 'no time', budget: '+5' },
      { text: 7, budget: '+5', at: T },
      { text: 'budget a number', budget: 5, at: T },
      { text: 'time a string', budget: '+5', at: '1' },
      p('second', T - 1),
      p('third', T - 2),
      p('fourth', T - 3),
    ],
  };
  assert.deepEqual(parseAutoPrompts(JSON.stringify(mixed)), [p('kept', T), p('second', T - 1), p('third', T - 2)]);
});

test('the start window offers three budgets and starts on the one given, else the last task’s, else +10', () => {
  assert.deepEqual(AUTO_BUDGETS, ['+5', '+10', '+20']);
  assert.deepEqual(startBudgets(null, []), { options: ['+5', '+10', '+20'], value: '+10' });
  assert.deepEqual(startBudgets(null, [p('a', T, '+20'), p('b', T - 1, '+5')]), { options: ['+5', '+10', '+20'], value: '+20' });
  // The last task's budget is not one of the three: the window starts on +10.
  assert.deepEqual(startBudgets(null, [p('a', T, '90')]), { options: ['+5', '+10', '+20'], value: '+10' });
  assert.deepEqual(startBudgets('+5', [p('a', T, '+20')]), { options: ['+5', '+10', '+20'], value: '+5' });
  // A budget given that is none of the three is offered too.
  assert.deepEqual(startBudgets('90', []), { options: ['+5', '+10', '+20', '90'], value: '90' });
  assert.deepEqual(startBudgets('+30', []), { options: ['+5', '+10', '+20', '+30'], value: '+30' });
  // One that is no budget is not.
  assert.deepEqual(startBudgets('abc', [p('a', T, '+5')]), { options: ['+5', '+10', '+20'], value: '+5' });
  assert.deepEqual(startBudgets('', []), { options: ['+5', '+10', '+20'], value: '+10' });
});

test('a budget is named by the weekly limit it sets, in the person’s language', () => {
  assert.equal(budgetLabel('+10', 41, 'en'), '+10 → 51%');
  assert.equal(budgetLabel('+10', 41, 'tr'), '+10 → %51');
  assert.equal(budgetLabel('+20', 40.6, 'en'), '+20 → 61%');
  // Never past the whole week.
  assert.equal(budgetLabel('+20', 95, 'en'), '+20 → 100%');
  // Without the week's reading, as written; a limit itself is that limit.
  assert.equal(budgetLabel('+10', null, 'en'), '+10');
  assert.equal(budgetLabel('90', 41, 'tr'), '%90');
  assert.equal(budgetLabel('90', null, 'en'), '90%');
  assert.equal(budgetLabel('abc', 41, 'en'), 'abc');
});

// SPDX-License-Identifier: Apache-2.0
/**
 * A secret in the person's own message, inside Claude Code's engine (A3-9): the person is told it went to the model's
 * provider, the model is told not to spread it; the kind only, never the value. The world beneath is in memory.
 */
import { test, expect } from 'claude-code/testing';
import { world } from './world.ts';

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const token = 'ghp' + '_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYzA1b';

test('a token pasted into a message: told to the person and the model by its kind, never its value', async ($, on) => {
  const w = world(on);
  const r: any = await $.prompt.submit(typed(`Deploy with this token: ${token}`));
  const said = (r.context ?? []).join('\n');
  expect(said).toMatch(/The person's message holds what looks like a secret \(github-token\)\. Use it only for what they asked/);
  expect(w.toasts.some((t: string) => /Your message held a secret \(github-token\)/.test(t))).toBe(true);
  expect(said.includes(token) || w.toasts.some((t: string) => t.includes(token))).toBe(false);
});

test('a message without one says nothing; with the secrets module off, nothing is scanned', async ($, on) => {
  const plain = world(on);
  const r: any = await $.prompt.submit(typed('Deploy the app.'));
  expect((r.context ?? []).join('\n')).not.toMatch(/looks like a secret/);
  expect(plain.toasts.some((t: string) => /held a secret/.test(t))).toBe(false);
});

test('the secrets module off: the message is not scanned', async ($, on) => {
  const w = world(on, { config: { modules: { secrets: false } } });
  const r: any = await $.prompt.submit(typed(`Deploy with this token: ${token}`));
  expect((r.context ?? []).join('\n')).not.toMatch(/looks like a secret/);
  expect(w.toasts.some((t: string) => /held a secret/.test(t))).toBe(false);
});

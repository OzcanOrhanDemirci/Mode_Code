// SPDX-License-Identifier: Apache-2.0
/**
 * When Anthropic's safeguards stop an answer (src/core/flagged.ts), inside Claude Code's engine: each way the stop
 * comes (a turn ended by a refusal, a turn ended by an API error with Claude Code's text for it, Claude Code's
 * StopFailure alone) is said once, under the answer, as a notice the model never reads, and kept in the activity; a
 * full-autonomy run's person is told the run waits. Nothing else changes. The events have the shape of the nine
 * records of 2026-10; they cannot be raised on purpose, so this is where they are held.
 */
import { test, expect, mock } from 'claude-code/testing';
import { world, PROJECT } from './world.ts';

/** Claude Code's text for the stop, as its records keep it (the ids made up). */
const TEXT =
  "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). Claude Code can't respond to your last message with Opus 5.5.\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nSend feedback with /feedback or learn more: https://support.claude.com/en/articles/8106465\n\nDetails: `[cyber]`\n\nRequest ID: req_000";
const REFUSAL = {
  category: 'cyber',
  explanation: "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy.",
};

/** A session that started, its turns ending as the engine's own would. */
async function begin($: any, on: any, lang: 'en' | 'tr' = 'en') {
  const w = world(on, { lang });
  const session = mock.session(on);
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('classic.StopFailure', () => ({}));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  const notices = () =>
    session
      .appended()
      .filter((r: any) => r.message.type === 'system')
      .map((r: any) => r.message.content[0].text as string);
  const flagged = () => w.events().filter((x: any) => x.kind === 'flagged');
  const end = async (turnId: string, more: Record<string, unknown>) => {
    await $.turn.start({ text: 'Go on.', turnId } as any);
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId, ...more } as any);
  };
  return { w, session, notices, flagged, end };
}

test("a turn the safeguards stopped is explained once, under it, in the person's language", async ($, on) => {
  const { w, session, notices, flagged, end } = await begin($, on, 'tr');
  await end('t1', { reason: 'refusal', refusal: REFUSAL });
  expect(notices()).toHaveLength(1);
  const said = notices()[0]!;
  expect(said.split('\n')[0]).toBe("Bu cevabı Anthropic'in güvenlik denetimi durdurdu (cyber).");
  expect(said).toMatch(/ne model ne Claude Code ne Mode_Code/);
  expect(said).toMatch(/Esc.*\n.*\/model.*\n.*\/feedback/);
  // A notice: the model never reads it, so nothing of it goes back to the classifier.
  expect(session.appended().some((r: any) => r.message.type === 'user')).toBe(false);
  // Claude Code's StopFailure for the same stop, a moment later: said once.
  await w.clock.advance(1000);
  await $.classic.StopFailure({ error: 'invalid_request', last_assistant_message: TEXT } as any);
  expect(notices()).toHaveLength(1);
  expect(flagged()).toEqual([expect.objectContaining({ kind: 'flagged', category: 'cyber', via: 'refusal' })]);
  // A later stop is a new one.
  await w.clock.advance(60_000);
  await end('t2', { reason: 'refusal', refusal: { category: null, explanation: null } });
  expect(notices()).toHaveLength(2);
  expect(notices()[1]!.split('\n')[0]).toBe("Bu cevabı Anthropic'in güvenlik denetimi durdurdu.");
});

test("an error whose text is the stop's is the stop; Claude Code's StopFailure alone says it too; another error does not", async ($, on) => {
  const { w, notices, flagged, end } = await begin($, on);
  await end('t1', { reason: 'error', answer: TEXT });
  expect(notices()).toHaveLength(1);
  expect(notices()[0]!.split('\n')[0]).toBe("Anthropic's safeguards stopped this answer (cyber).");
  expect(flagged()[0]).toMatchObject({ category: 'cyber', model: 'Opus 5.5', via: 'error' });
  await w.clock.advance(60_000);
  // The turn's end without the text (an error's answer can be empty): StopFailure carries it.
  await end('t2', { reason: 'error' });
  expect(notices()).toHaveLength(1);
  await $.classic.StopFailure({ error: 'invalid_request', last_assistant_message: TEXT } as any);
  expect(notices()).toHaveLength(2);
  expect(flagged().at(-1)).toMatchObject({ via: 'stopFailure' });
  // An error that is not the stop, a refusal-free answer quoting the text: nothing.
  await w.clock.advance(60_000);
  await $.classic.StopFailure({ error: 'overloaded', last_assistant_message: 'API Error: 529 Overloaded' } as any);
  await end('t3', { reason: 'answer', answer: TEXT });
  expect(notices()).toHaveLength(2);
  expect(flagged()).toHaveLength(2);
});

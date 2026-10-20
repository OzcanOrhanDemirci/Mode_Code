// SPDX-License-Identifier: Apache-2.0
/** English messages of full autonomy (docs/autonomy.md) and the parallel agents' page. */

export const enAuto = {
  'kw.kind.fullAuto': 'full auto',

  // ── full autonomy, a way of working ──
  'full.card': 'Full autonomy asks nothing. What cannot be undone it does not do: it leaves it to you, with the command.',
  'full.guard.ask':
    "🤖 Full autonomy asks nobody: the person chose to be asked nothing. Decide by their recorded decisions (the memory, the project's locks, the commit rule) or take the reversible, safe default, say which in your answer, and go on.",
  'full.guard.plan': "🤖 Full autonomy has no plan mode: it waits for the person's approval, and nobody is asked. Plan in your answer and go on with the work.",
  'full.notify.done': 'Full autonomy is done: {task}',
  'full.notify.waiting': 'Full autonomy stopped; {n} step(s) wait for you: {task}',
  'full.notify.flagged': "Full autonomy stopped: Anthropic's safeguards stopped an answer. The session waits for you.",

  // ── Working › Parallel agents ──
  'page.agents': 'Parallel agents',
  'desc.agents': 'Parallel agents: how many agents Claude starts, set by you on the strip for each session. Off until you turn it on here.',
  'set.agents.confirm':
    'With this on, every session starts with agents off: Claude starts no agent until you set them on the strip (the read-only helpers below aside). Press Enter again to turn it on.',
  'set.agents.modes': 'On the strip',
  'set.agents.mode.off': 'Off: Claude starts no agent and does the work itself.',
  'set.agents.mode.free': 'At most N at once: Claude decides when; the setting stays until you change it.',
  'set.agents.mode.assigned':
    'Exactly N for your next request, each with its own task, kind and model if you write one; once they are done the mode turns off by itself.',
  'set.agents.note':
    "Every session starts with agents off. Ultracode and Claude Code's workflows run their own agents: the mode stands aside while ultracode is on, and comes back when it is off.",
  'set.agents.sessions': 'Claude Code sessions on this computer',
  'set.agents.sessionsNone': 'None running.',
  'set.agents.sessionsUnread': "Could not be read: this Claude Code has no 'claude agents' command.",
} as const;

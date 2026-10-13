// SPDX-License-Identifier: Apache-2.0
/** English messages of the memory store, its sync, handoffs and the morning report (docs/memory.md). */

export const enMemory = {
  'kw.kind.handoff': 'handoff',

  // ── commits terminal-code makes in the store ──
  'memory.commit': 'memory: {what} (session {session})',
  'memory.commit.noSession': 'memory: {what}',
  'memory.commit.added': '{n} added',
  'memory.commit.changed': '{n} changed',
  'memory.commit.removed': '{n} removed',

  // ── the morning report ──
  'morning.title': 'While you were away · since {since}',
  'morning.nothing': 'Nothing happened that needs you.',
  'morning.runs': 'Full autonomy',
  'morning.run.active': 'still running',
  'morning.run.paused': 'paused',
  'morning.run.pausedFor': 'paused: {reason}',
  'morning.run.done': 'done',
  'morning.run.stuck': 'stuck',
  'morning.run.canceled': 'canceled',
  'morning.run.deferred': '{n} step(s) wait for you',
  'morning.flows': 'Flows',
  'morning.flowWaits': '{title}: the plan waits for your approval',
  'morning.notes': 'Notes',
  'morning.notesWait': '{n} note file(s) from full-autonomy runs wait for your approval: terminal-code memory notes',
  'morning.memory': 'Memory',
  'morning.memory.conflict': 'a pull needs you: {files} changed here and elsewhere',
  'morning.memory.held': 'held back, it looks like it holds a secret: {files}',
  'morning.memory.ahead': '{n} change(s) wait to go up to GitHub',
  'morning.memory.error': 'the last sync failed: {detail}',
  'morning.sessions': 'Sessions',
  'morning.sessionsText': '{n} session(s)',
  'morning.handoffs': 'Handoffs',
  'morning.belt': 'Safety belt',
  'morning.beltText': '{blocked} blocked, {asked} asked',
  'morning.quota': 'Quota',
  'morning.quotaText': 'weekly {from} → {to}',
  'morning.sum': '☀ While you were away: {what}. {cmd}',
  'morning.sum.ended': '{n} run(s) done',
  'morning.sum.waiting': '{n} run(s) wait for you',
  'morning.sum.flows': '{n} plan(s) wait for approval',
  'morning.sum.notes': '{n} note file(s) wait for approval',
  'morning.sum.memory': 'the memory sync needs you',
  'morning.sum.ahead': '{n} memory change(s) wait to go up',
  'morning.sum.handoffs': '{n} handoff note(s)',
} as const;

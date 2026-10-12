// SPDX-License-Identifier: Apache-2.0
/** A flow's record in words, for the command line and the control center. Pure. */
import { tIn, type Lang, type MessageKey } from './i18n/index.js';
import type { Flow, FlowEvidence, FlowStatus } from './flow.js';

export function statusText(s: FlowStatus, lang: Lang): string {
  return tIn(lang, `flow.status.${s}` as MessageKey);
}

/** A count with its noun, singular for one: "1 finding", "3 verification commands". */
export function count(lang: Lang, what: 'findings' | 'sources' | 'steps' | 'commands', n: number): string {
  return tIn(lang, (n === 1 ? `flow.n.${what}.one` : `flow.n.${what}`) as MessageKey, { n });
}

/** What a step's check found: "3 findings, 2 sources", "approved in the dialog". */
export function evidenceText(e: FlowEvidence, lang: Lang): string {
  switch (e.kind) {
    case 'research':
      return tIn(lang, 'flow.evidence.research', { findings: count(lang, 'findings', e.findings), sources: count(lang, 'sources', e.sources) });
    case 'plan':
      return tIn(lang, 'flow.evidence.plan', { steps: count(lang, 'steps', e.steps), commands: count(lang, 'commands', e.commands) });
    case 'approve':
      return tIn(lang, `flow.evidence.approve.${e.via}` as MessageKey);
    case 'code':
      return tIn(lang, 'flow.evidence.code', { commands: count(lang, 'commands', e.commands), seconds: e.seconds });
  }
}

/** The flow's title: the task's first line, or its id when it has no task. */
export function flowTitle(f: Flow, max = 60): string {
  const line = f.task.split('\n')[0]!.trim();
  if (!line) return f.id;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Guards that depend on the session's state rather than on the command alone: the chat mode (no writes)
 * and the quota guard (no new heavy work after the budget). They answer with a refusal or nothing. The
 * safety belt is separate and never depends on state, so it holds even when state cannot be read.
 */
import { classifyTurn, type ClassifyEnv } from './footer.js';
import type { QuotaAssessment } from './quota.js';
import type { ModSessionState } from './session.js';
import { tIn, type Lang } from './i18n/index.js';

export interface GuardRefusal {
  kind: 'chat' | 'quota';
  reason: string;
}

/** Tools that start more work rather than finishing the current one. */
const HEAVY = /^(?:Agent|Task|Workflow|WebSearch|WebFetch)$/;
/** Tools that only read or record, always allowed while stopping. */
const QUIET = /^(?:Read|Glob|Grep|LS|TodoWrite|ToolSearch|AskUserQuestion|ExitPlanMode|EnterPlanMode)$/;

export function checkGuards(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  state: ModSessionState | null,
  quota: QuotaAssessment | null,
  env: ClassifyEnv,
  lang: Lang,
): GuardRefusal | null {
  if (state?.mode === 'chat') {
    const acts = classifyTurn([{ name: tool, input }], env);
    const writes = acts.files + acts.memoryFiles + acts.settings + acts.git + acts.shell;
    if (writes > 0)
      return {
        kind: 'chat',
        reason: tIn(lang, 'guard.chat'),
      };
  }
  if (quota && quota.usable) {
    if (quota.level !== 'ok' && HEAVY.test(tool)) return { kind: 'quota', reason: tIn(lang, 'guard.quota.heavy') };
    if (quota.level === 'stop' && !QUIET.test(tool) && (tool === 'Bash' || tool === 'PowerShell' || /^(?:Write|Edit|MultiEdit|NotebookEdit)$/.test(tool))) {
      const acts = classifyTurn([{ name: tool, input }], env);
      const changes = acts.files + acts.settings + acts.shell + acts.external;
      if (changes > 0)
        return {
          kind: 'quota',
          reason: tIn(lang, 'guard.quota.stop'),
        };
    }
  }
  return null;
}

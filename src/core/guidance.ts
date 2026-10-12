// SPDX-License-Identifier: Apache-2.0
/**
 * What the model reads when a keyword is detected or a guard steps in. The model never sees these as the
 * person's words: they arrive as context beside the prompt. Written in English for the model (the answer
 * still follows the person's language), short, and each one says exactly what to do.
 */
import type { KeywordMatch } from './keywords.js';
import type { QuotaAssessment } from './quota.js';
import type { ModSessionState } from './session.js';
import { APP_NAME } from './app.js';

const P = `[${APP_NAME}]`;

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? 'unknown' : `${Math.round(n)}%`;
}

export function quotaLine(q: QuotaAssessment): string {
  if (!q.usable) return q.stale ? 'Quota reading is stale; treat the budget as reached.' : 'No quota reading yet.';
  const target = q.target.explicit ? `weekly target ${q.target.value}%` : `default weekly limit ${q.target.value}%`;
  return `Quota: 5-hour ${pct(q.five?.used)}, weekly ${pct(q.week?.used)} (${target}).`;
}

/** Context for a detected keyword, or [] when the keyword needs none. */
export function keywordContext(kw: KeywordMatch, state: ModSessionState, quota: QuotaAssessment, projectLabel: string | null): string[] {
  const project = projectLabel ? ` for project "${projectLabel}"` : '';
  // Tie the note to words the model can see in the person's own message, so it reads as their shorthand, not as an instruction from nowhere.
  const said = `${P} The person's message ${kw.standalone ? 'is' : 'ends with'} "${kw.text}", a keyword they set up in ${APP_NAME}, their Claude Code companion.`;
  const unknownProject =
    kw.project === null && kw.projectText
      ? kw.suggestion
        ? ` The person wrote "${kw.projectText}", which is not a registered project; they probably meant "${kw.suggestion}". Confirm in one line before acting.`
        : ` "${kw.projectText}" is not a registered project: find what it refers to from the conversation or memory; if unclear, ask.`
      : '';
  switch (kw.kind) {
    case 'continue':
      return [
        `${said} Keyword "continue"${project}: work autonomously. Do not ask for approval between steps; when a plan is done, write the next one and carry it out. ` +
          `Stop only for a decision the person must make (irreversible or outward-facing steps, a direction with no single right answer, a project lock); ` +
          `skip such a step if later work does not depend on it, and list your autonomous decisions in the final report. ${quotaLine(quota)}${unknownProject}`,
      ];
    case 'manual':
      return [
        `${said} Keyword "manual continue"${project}: work step by step. Before each step that changes something, say what you will do and wait for the person. ${quotaLine(quota)}${unknownProject}`,
      ];
    case 'chat':
      return [
        `${said} Keyword "chat": conversation only. Do not change the project or the memory and do not commit. Reading, measuring and experiments in a temporary folder are fine. ` +
          `The safety layer enforces this until the person types "continue".`,
      ];
    case 'quota':
      return state.weeklyTarget === null
        ? [`${said} Keyword "quota ${kw.plus ? '+' : ''}${kw.n}": no weekly reading yet, so a relative budget could not be set. Tell the person in one line.`]
        : [
            `${said} Keyword "quota": weekly budget set to ${state.weeklyTarget}% (accepted ${state.weeklyTarget - 1}…${state.weeklyTarget + 1}). ` +
              `Work until it; wrap up when the guard says so. ${quotaLine(quota)}`,
          ];
    case 'wrapUp':
      return [
        `${said} Keyword "wrap up": bring the current step to a consistent point (tests pass, work committed), update the notes or memory, cancel timers you started, give the final report and stop.`,
      ];
    case 'stop':
      return [
        `${said} Keyword "stop": stop now. Stop background agents and timers you started. Say in one line what was left half done. Do not start anything new.`,
      ];
    case 'status':
      return [
        `${said} Keyword "status": without stopping, say briefly where you are, what is done, what is next and the quota; then continue. ${quotaLine(quota)}`,
      ];
    case 'help':
      return [
        `${said} Keyword "help": summarize the keywords and working rules the person has set up${project}. The tool's keyword table is shown in its control center under Settings.`,
      ];
    default:
      return [];
  }
}

export function wrapUpContext(q: QuotaAssessment): string {
  return `${P} Quota guard: ${quotaLine(q)} The budget is reached. Wrap up now: bring the current step to a consistent point, commit, update notes, report, and stop. Do not start new heavy work (agents, workflows, web research).`;
}

export function stopContext(q: QuotaAssessment, resumeAt: number | null): string {
  const when = resumeAt ? ` Work resumes by itself after ${new Date(resumeAt).toISOString()}.` : '';
  return `${P} Quota guard: ${quotaLine(q)} The hard limit is reached. Only reading, saving notes and committing are allowed now; report and stop.${when}`;
}

export function resumePrompt(project: string | null): string {
  return project ? `${project} devam` : 'devam';
}

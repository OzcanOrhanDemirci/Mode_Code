// SPDX-License-Identifier: Apache-2.0
/**
 * What the model reads about a full-autonomy run beside the person's prompt: the start (the rules and the
 * plan's form), the refusal (which start checks failed), a short line on every prompt while the run goes
 * on, the resume, and the state kept across a compaction. In English for the model; what the person sees
 * (notices, tool answers, refusals) is in their language (i18n).
 */
import { APP_NAME } from './app.js';
import { tIn, type Lang, type MessageKey } from './i18n/index.js';
import type { GateResult } from './run-gate.js';
import { nextStep, progress, type Run } from './run.js';

const P = `[${APP_NAME}]`;

export const AUTO_TOOL = 'mcp__terminal-code__autonomy';

const PLAN_FORM = [
  '# <title>',
  '',
  '## Steps',
  '',
  '### 1. <step>',
  '<what changes>',
  'Acceptance: <how we know this step is right>',
  '',
  '### 2. <step>',
  '…',
  '',
  '## Verification',
  '',
  '- `<command that proves the whole work, e.g. npm test>`',
].join('\n');

const RULES = [
  `Nobody is at the keyboard: never ask the person anything (questions, plan mode and permission dialogs are refused). Where there is a sensible default, decide and note the decision for the report.`,
  `Steps that need the person (what the safety belt would ask about, pushing to a protected branch, merging, releases, publishing, outward tools) are refused as "deferred" and recorded for them: do not retry them or work around them; go on with the rest.`,
  `When something is in the way: solve it, work around it, record it (${AUTO_TOOL} action "blocker"); only when every path is blocked, end the run with action "stuck" and the report.`,
  `Writes stay inside the project, the temporary folders and the run's folder; credential files are not read; memory notes go to the run's notes file.`,
  `Each plan step ends with action "milestone" and its step number, on a commit of its own (commit first). Code records a rollback point and runs an independent review; a failed review refuses the milestone.`,
  `The run ends only through action "finish": every step has its milestone, everything is committed, every verification command passes and the report draft has "## Summary" and "## Decisions". Until then, a stop is turned back with what is missing.`,
  `If the current branch is protected (main, master, release/*), create a branch for the run before the first commit.`,
].join(' ');

/** Told to the model when a run starts. */
export function autoStartContext(r: Run, required: readonly string[]): string {
  const task = r.task ? `The person's request, word for word: "${r.task}".` : '';
  const req = required.length
    ? ` The person's own definition of done for this project is part of the verification and cannot be dropped: ${required.map((c) => `\`${c}\``).join(', ')}.`
    : '';
  return (
    `${P} The person started full autonomy (run ${r.id}, weekly budget ${r.budget.weeklyTarget}%). ${task} ${RULES}\n` +
    `First phase, plan: read what you need, then write the plan at ${r.planPath} in this form (numbered steps, each with an Acceptance line, and a Verification section with the commands that prove the work), and call ${AUTO_TOOL} with action "plan". Each step changes the project's files and ends on a commit of its own; creating the run's branch, reading, and running the verification are not steps (code runs the Verification commands at the finish). The project does not change until the plan is accepted.${req}\n` +
    PLAN_FORM
  );
}

/**
 * Told to the model when every start check measurable at the prompt passed: the last two (the permission
 * mode this prompt came with, and the live sandbox probe) are measured at its first call of the autonomy tool.
 */
export function autoPendingContext(resume: boolean): string {
  const what = resume ? 'to resume the paused full-autonomy run' : 'for full autonomy';
  return (
    `${P} The person asked ${what}. The start checks that can be measured now passed; the last two (Claude Code's permission mode for this prompt, and a live probe of the sandbox) are measured when you call ${AUTO_TOOL} with action "start". ` +
    `Call it now, before anything else: until it answers, every other tool call is held. Its answer says whether the run ${resume ? 'resumed' : 'started'} and what comes next; do not start on the task before it.`
  );
}

/** Told to the model when the person asked for full autonomy and a start check failed: say so, do not start. */
export function autoRefusedContext(g: GateResult, lang: Lang): string {
  const failed = g.checks.filter((c) => c.ok === false);
  const lines = failed.map((c) => `- ${tIn(lang, `auto.gate.name.${c.id}` as MessageKey)}: ${tIn(lang, c.key, c.params)}`);
  return `${P} The person asked for full autonomy, but ${failed.length} start check(s) failed, so no run started:\n${lines.join('\n')}\nTell the person in a few lines (in their language) which checks failed and what to do about each; do not start the task.`;
}

/** Told to the model when the person asked for full autonomy without a task: ask them for it. */
export function autoNoTaskContext(): string {
  return `${P} The person typed the full-autonomy keyword without a task, and there is no earlier request in this conversation. Ask them in one line to write the task followed by the keyword ("<task>. <project> full auto quota +N").`;
}

function where(r: Run): string {
  if (!r.plan || r.phase === 'plan') return `phase plan: write ${r.planPath} and call ${AUTO_TOOL} action "plan"`;
  const p = progress(r);
  const next = nextStep(r);
  return next
    ? `phase work, ${p.done}/${p.of} milestones; next: step ${next.n} (${next.title}), then ${AUTO_TOOL} action "milestone" step ${next.n}`
    : `every step has its milestone: write ${r.reportPath} and call ${AUTO_TOOL} action "finish"`;
}

/** Told to the model on each prompt while the run goes on (short: the rules came at the start). */
export function autoTurnContext(r: Run): string {
  return `${P} Full autonomy runs (${r.id}): ${where(r)}. Never ask the person; defer what needs them; record blockers.`;
}

/** Told to the model when a paused run is resumed (also in a new session). */
export function autoResumeContext(r: Run): string {
  const task = r.task ? ` The person's request, word for word: "${r.task}".` : '';
  return `${P} The full-autonomy run ${r.id} resumed.${task} ${RULES}\nWhere it stands: ${where(r)}. Read ${r.planPath} and the run's notes in ${r.workDir} first.`;
}

/** The run's state for the compaction note: the request word for word, and where the run stands. */
export function autoStateText(r: Run): string {
  const task = r.task ? `, the person's request: "${r.task.slice(0, 1500)}"` : '';
  // A paused run waits for the person; meanwhile the session works as they ask.
  if (r.status === 'paused')
    return `a full-autonomy run is paused (${r.id}${task}); the person resumes it with "continue", and until then the session works as they ask`;
  return `a full-autonomy run runs (${r.id}${task}): ${where(r)}; never ask the person, defer what needs them, call ${AUTO_TOOL} for every phase`;
}

/** Told to the model when no milestone came for the stall time: the second span ends the run. */
export function autoStallContext(r: Run, minutes: number): string {
  return `${P} Full autonomy: no milestone for ${minutes} minutes (${where(r)}). Reach the next milestone, revise the plan into smaller steps, or record the blockers and call action "stuck". In as long again without one, the run pauses as stalled.`;
}

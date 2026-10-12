// SPDX-License-Identifier: Apache-2.0
/**
 * What the model reads when a keyword is detected or a guard steps in. The model never sees these as the
 * person's words: they arrive as context beside the prompt. Written in English for the model (the answer
 * still follows the person's language), short, and each one says exactly what to do.
 */
import { MODE_KEYWORDS, type KeywordMatch } from './keywords.js';
import type { QuotaAssessment } from './quota.js';
import type { ModSessionState } from './session.js';
import { APP_NAME } from './app.js';
import { currentStep, progress, type Flow, type FlowStepKind } from './flow.js';
import type { WorkMode } from './modes.js';
import { tIn, type Lang, type MessageKey } from './i18n/index.js';

const P = `[${APP_NAME}]`;

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? 'unknown' : `${Math.round(n)}%`;
}

export function quotaLine(q: QuotaAssessment): string {
  if (!q.usable) return q.stale ? 'Quota reading is stale; treat the budget as reached.' : 'No quota reading yet.';
  const target = q.target.explicit ? `weekly target ${q.target.value}%` : `default weekly limit ${q.target.value}%`;
  return `Quota: 5-hour ${pct(q.five?.used)}, weekly ${pct(q.week?.used)} (${target}).`;
}

/** What a mode allows, for the model: one sentence each. */
const MODE_NOTE: Record<WorkMode, string> = {
  free: 'free mode: no restriction beyond the safety belt and the project locks.',
  chat: 'chat mode: conversation only. Do not change the project or the memory and do not commit. Reading, measuring and experiments in a temporary folder are fine.',
  research:
    'research mode: read, search the web, and write findings or reports only in the work folder{work} or a temporary folder. The project and the memory do not change and nothing is committed.',
  plan: "plan mode: read and plan. Write the plan only in the work folder{work}, Claude Code's plan file or a temporary folder; the project does not change until a plan is approved.",
  code: 'code mode: develop, test and commit; the safety belt and the project locks apply.',
};

export interface KeywordExtras {
  /** The flows' work folder, for research and plan notes. */
  workDir?: string;
  /** Set when a flow is attached: a mode keyword then changes one turn, or (as the whole message) pauses the flow. */
  flow?: { step: string; paused: boolean } | null;
}

/** Context for a detected keyword, or [] when the keyword needs none. */
export function keywordContext(
  kw: KeywordMatch,
  state: ModSessionState,
  quota: QuotaAssessment,
  projectLabel: string | null,
  extras: KeywordExtras = {},
): string[] {
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
    case 'research':
    case 'plan':
    case 'code':
    case 'free': {
      const mode = MODE_KEYWORDS[kw.kind];
      const note = MODE_NOTE[mode].replace('{work}', extras.workDir ? ` (${extras.workDir})` : '');
      if (extras.flow && !extras.flow.paused)
        return [`${said} Keyword "${kw.kind}": for this turn only, ${note} The flow stays at its ${extras.flow.step} step and goes on from the next message.`];
      if (extras.flow?.paused)
        return [
          `${said} Keyword "${kw.kind}": the person switched to ${note} The flow is paused at its ${extras.flow.step} step: keep its draft as it is and work in the new mode. "continue" resumes the flow.`,
        ];
      const until = mode === 'chat' ? 'until the person types "continue" or picks another mode' : 'until the person picks another mode';
      return [`${said} Keyword "${kw.kind}": ${note}${mode === 'free' || mode === 'code' ? '' : ` The safety layer enforces this ${until}.`}`];
    }
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

/** Told to the model when another session is working in the same folder. */
export function conflictContext(count: number): string {
  return `${P} ${count === 1 ? 'Another Claude Code session is' : `${count} other Claude Code sessions are`} working in this same folder right now. Avoid editing files the other session may be editing; commit small steps, check git status before you edit, and tell the person if you see changes you did not make.`;
}

/**
 * The instruction behind the "checked" footer mode: the model writes the lines and the Stop hook compares
 * them with the facts. Labels are given in the person's language, exactly as the check expects them.
 */
export function footerInstruction(lang: Lang, opts: { memory: boolean; showFiveFrom: number; showWeekFrom: number }): string {
  const yes = tIn(lang, 'footer.yes');
  const no = tIn(lang, 'footer.no');
  const lines: string[] = [];
  if (opts.memory)
    lines.push(
      `"${tIn(lang, 'footer.memory')}: ${yes}" or "${tIn(lang, 'footer.memory')}: ${no}": whether the memory repository was committed and pushed this turn.`,
    );
  lines.push(
    `"${tIn(lang, 'footer.changed')}: ${yes}" or "${tIn(lang, 'footer.changed')}: ${no}": whether files, settings, git or anything outside changed this turn (temporary folders do not count).`,
  );
  lines.push(`"${tIn(lang, 'footer.five')}: N" only when the 5-hour quota is at least ${opts.showFiveFrom}.`);
  lines.push(`"${tIn(lang, 'footer.week')}: N" only when the weekly quota is at least ${opts.showWeekFrom}, or "N/T" whenever a weekly target T is set.`);
  return [
    `${P} End every answer with these lines, after a blank line, each as its own paragraph, worded exactly like this:`,
    ...lines.map((l) => `- ${l}`),
    'A hook checks them against git, the tool calls of the turn and the measured quota, and sends wrong lines back once. When it does, answer with only the corrected lines.',
  ].join('\n');
}

/**
 * The prompt that resumes autonomous work after a quota reset. It ends with the person's own continue
 * keyword (in their language), so the keyword layer treats it exactly like their "continue".
 */
export function resumePrompt(project: string | null, lang: Lang): string {
  const word = lang === 'tr' ? 'devam' : 'continue';
  const lead =
    lang === 'tr'
      ? 'Kota penceresi sıfırlandı. Kaldığın yerden otonom çalışmaya devam et; önce devir notuna ve yarım kalan adıma bak.'
      : 'The quota window reset. Resume the autonomous work where it stopped; check the handoff notes and the step that was left half done first.';
  return `${lead}\n${project ? `${project} ${word}` : word}`;
}

// ── flows ─────────────────────────────────────────────────────────────────────────────────────────────

export function stepName(kind: FlowStepKind, lang: Lang): string {
  return tIn(lang, `flow.step.name.${kind}` as MessageKey);
}

/** The steps of a flow on one line: "🔍 research ✓ ▶ [📐 plan] → ⏸ approval → 🔨 code". */
export function stepsLine(f: Flow, lang: Lang): string {
  return f.steps
    .map((s, i) => {
      const name = stepName(s.kind, lang);
      const mark = s.status === 'done' ? `${name} ✓` : i === f.current ? `[${name}]` : name;
      if (i === 0) return mark;
      return `${s.kind === 'approve' || f.steps[i - 1]?.kind === 'approve' ? '→' : '▶'} ${mark}`;
    })
    .join(' ');
}

export interface StepTexts {
  /** Where the checked copies are kept (the data folder), for the code step's guidance. */
  copyDir: string;
  /** Claude Code's plan mode is on: the plan goes into its plan file and is approved through ExitPlanMode. */
  nativePlan: boolean;
  /** What the person types to approve, in their language. */
  approveWord: string;
}

/** What to do in the current step, in the person's language (the same words flow_step answers with). */
export function stepGuidance(f: Flow, lang: Lang, t: StepTexts): string {
  switch (currentStep(f)?.kind) {
    case 'research':
      return tIn(lang, 'flow.step.nextResearch', { path: f.reportPath, template: tIn(lang, 'flow.template.report') });
    case 'plan':
      return t.nativePlan
        ? tIn(lang, 'flow.step.nextPlanNative', { template: tIn(lang, 'flow.template.plan') })
        : tIn(lang, 'flow.step.nextPlan', { path: f.planPath, template: tIn(lang, 'flow.template.plan') });
    case 'approve':
      return tIn(lang, 'flow.step.waiting', { approve: t.approveWord });
    case 'code':
      return tIn(lang, 'flow.step.nextCode', { copy: `${t.copyDir}/plan.md`, commands: f.verification.map((c) => `\`${c}\``).join(', ') });
    default:
      return tIn(lang, 'flow.step.complete');
  }
}

const FLOW_RULES =
  "Steps run in order and none is skipped. Finish a step by calling the tool mcp__terminal-code__flow_step with its name (research, plan or code); code checks the step and says exactly what is missing. The approval is the person's alone; only the person pauses, resumes or cancels the flow.";

/** Told to the model when the person starts a flow. */
export function flowStartContext(f: Flow, lang: Lang, t: StepTexts): string {
  const task = f.task ? `Task, in the person's words: "${f.task}".` : 'Task: the one under discussion; state it in one line at the top of the first document.';
  return `${P} The person started a flow: ${stepsLine(f, lang)}. ${task} ${FLOW_RULES}\n${stepGuidance(f, lang, t)}`;
}

/** Told to the model on each prompt while a flow runs (short: the full rules came when it started). */
export function flowTurnContext(f: Flow, lang: Lang, t: StepTexts): string {
  const p = progress(f);
  const step = currentStep(f);
  const tail =
    step?.kind === 'approve'
      ? `The plan waits for the person's approval (they type "${t.approveWord}"); the project does not change before it.`
      : `Finish it, then call mcp__terminal-code__flow_step with step "${step?.kind ?? ''}".`;
  return `${P} A flow runs (${f.id}), step ${p.at}/${p.of}: ${stepsLine(f, lang)}. ${tail}`;
}

/** Told to the model when the person resumes a flow (also in a new session). */
export function flowResumeContext(f: Flow, lang: Lang, t: StepTexts): string {
  const task = f.task ? ` Task, in the person's words: "${f.task}".` : '';
  return `${P} The person resumed the flow ${f.id}: ${stepsLine(f, lang)}.${task} ${FLOW_RULES} Read the drafts in ${f.workDir} first.\n${stepGuidance(f, lang, t)}`;
}

/** Told to the model when the person cancels the flow or approves its plan by typing. */
export function flowNote(kind: 'canceled' | 'approved', f: Flow, lang: Lang, t: StepTexts): string {
  if (kind === 'canceled') return `${P} The person canceled the flow ${f.id}. Stop its work and say in one line what was left where.`;
  return `${P} The person approved the plan by typing. ${stepGuidance(f, lang, t)}`;
}

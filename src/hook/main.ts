// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook: one small program Claude Code runs for its settings hooks (exec form, absolute
 * node path, `onFailure: "block"`). The in-process mod does most of the work when it is loaded; this
 * program is what still stands when it is not (an older Claude Code, mods turned off by policy, a mod
 * that failed to load). The safety belt runs here on every call regardless, because protection never
 * depends on the mod. It has no dependencies, opens no network connection and never prompts.
 *
 * Usage: node hook.mjs <EventName>   (the event's JSON arrives on stdin)
 */
import { readFileSync } from 'node:fs';
import { evaluateToolCall, decisionText } from '../core/belt/evaluate.js';
import { parseModState, parseHookState, isApproved, applyKeyword } from '../core/session.js';
import { sessionFile, eventsFile } from '../core/layout.js';
import { maskSecrets } from '../core/secrets/scan.js';
import { tIn, setLanguage, type Lang } from '../core/i18n/index.js';
import { detectKeyword } from '../core/keywords.js';
import { footerInstruction, keywordContext } from '../core/guidance.js';
import { newModState } from '../core/session.js';
import { assessQuota, weeklyTargetFrom, type QuotaReading } from '../core/quota.js';
import { buildFooter, checkFooter, classifyTurn } from '../core/footer.js';
import { currentTurn } from '../core/transcript.js';
import { keywordTables, projectRefs, budgetOf } from '../core/settings-view.js';
import { APP_VERSION, SELF_TEST_SESSION } from '../core/app.js';
import { dataLayout, processLanguage } from '../node/env.js';
import { loadConfig, beltContext, classifyEnv, memoryDirs } from '../node/context.js';
import { readText, readJson, writeJsonAtomic, appendLine } from '../node/fsx.js';
import { memoryStatus } from '../node/git.js';
import { readTail } from '../node/tail.js';

type Input = Record<string, unknown>;

const RISKY_TOOLS = /^(?:Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit)$/;
/** A hook that is still running after this long answers for itself: deny for risky tools, pass otherwise. */
const DEADLINE_MS = 8000;

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

function preToolDeny(reason: string): void {
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

async function preToolUse(input: Input, lang: Lang): Promise<void> {
  const l = dataLayout();
  const { config } = loadConfig(l);
  const tool = str(input.tool_name) ?? '';
  const toolInput = (typeof input.tool_input === 'object' && input.tool_input !== null ? input.tool_input : {}) as Record<string, unknown>;
  const sessionId = str(input.session_id) ?? '';
  const cwd = str(input.cwd) ?? process.cwd();
  const now = Date.now();

  const modFile = sessionFile(l, sessionId, 'mod');
  const mod = modFile ? parseModState(readText(modFile)) : null;
  if (isApproved(mod, str(input.tool_use_id), now)) return; // the person approved this exact call when the mod asked

  const ctx = beltContext({ cwd, config, layout: l, lang });
  const d = await evaluateToolCall(tool, toolInput, ctx);
  if (d.verdict === 'allow') return;

  // The self-test's samples are not real calls: no session state, no events.
  const hookFile = sessionId === SELF_TEST_SESSION ? null : sessionFile(l, sessionId, 'hook');
  const state = parseHookState(hookFile ? readText(hookFile) : null, sessionId);
  let repeat = 0;
  if (d.verdict === 'deny') {
    for (const f of d.findings.filter((x) => x.verdict === 'deny')) state.blocks[f.rule] = (state.blocks[f.rule] ?? 0) + 1;
    repeat = Math.max(0, ...d.findings.filter((x) => x.verdict === 'deny').map((f) => state.blocks[f.rule] ?? 0));
  }
  state.lastRunAt = now;
  try {
    if (hookFile) writeJsonAtomic(hookFile, state);
    // The mod logs what it decides; the hook logs only what reached it on its own.
    if (sessionId !== SELF_TEST_SESSION && (!mod || d.verdict === 'deny'))
      appendLine(
        eventsFile(l, sessionId, 'hook', now),
        JSON.stringify({
          v: 1,
          at: now,
          kind: 'belt',
          source: 'hook',
          tool,
          verdict: d.verdict,
          rules: d.findings.map((f) => f.rule),
          reasons: d.findings.map((f) => maskSecrets(f.reason)),
          issues: d.issues,
          cwd,
          app: APP_VERSION,
        }),
      );
  } catch {
    /* logging must never change a decision */
  }

  const text = decisionText(d, ctx, { repeatCount: repeat });
  if (d.verdict === 'deny') preToolDeny(text);
  else if (d.verdict === 'ask') out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: text } });
  else if (!mod) out({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
}

function userPromptSubmit(input: Input): void {
  const l = dataLayout();
  const { config } = loadConfig(l);
  if (!config.modules.keywords) return;
  const sessionId = str(input.session_id) ?? '';
  const modFile = sessionFile(l, sessionId, 'mod');
  if (modFile && readText(modFile) !== null) return; // the mod handles keywords in this session
  const prompt = str(input.prompt) ?? '';
  const kw = detectKeyword(prompt, projectRefs(config), keywordTables(config));
  if (!kw) return;
  const reading = readJson<QuotaReading>(l.quota);
  const budget = kw.kind === 'quota' ? { n: kw.n ?? 0, plus: kw.plus ?? false } : kw.budget;
  const state = applyKeyword(newModState(sessionId, APP_VERSION, Date.now()), kw, budget ? weeklyTargetFrom(budget, reading, Date.now()) : null);
  const quota = assessQuota(reading, budgetOf(config, state), Date.now());
  const label = kw.project ? (config.projects.find((p) => p.id === kw.project)?.names[0] ?? kw.project) : null;
  const ctx = keywordContext(kw, state, quota, label);
  if (ctx.length) out({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx.join('\n') } });
}

function stop(input: Input, lang: Lang): void {
  const l = dataLayout();
  const { config } = loadConfig(l);
  if (!config.modules.footer || config.footer.mode !== 'check') return;
  if (input.stop_hook_active === true) return; // one correction per turn, never a loop
  const transcript = str(input.transcript_path);
  const reply = str(input.last_assistant_message);
  if (!transcript || reply === undefined) return;
  const cwd = str(input.cwd) ?? process.cwd();
  const turn = currentTurn(readTail(transcript, 8 * 1024 * 1024));
  const acts = classifyTurn(turn.uses, classifyEnv(cwd, config));
  const now = Date.now();
  const reading = readJson<QuotaReading>(l.quota);
  const sessionId = str(input.session_id) ?? '';
  const modFile = sessionFile(l, sessionId, 'mod');
  const mod = modFile ? parseModState(readText(modFile)) : null;
  const q = assessQuota(reading, budgetOf(config, mod), now);
  const footer = buildFooter(
    {
      memory: memoryStatus(memoryDirs(config, cwd), turn.startedAt),
      acts,
      five: q.usable ? (q.five?.used ?? null) : null,
      week: q.usable ? (q.week?.used ?? null) : null,
      weeklyTarget: mod?.weeklyTarget ?? null,
      showFiveFrom: config.footer.showFiveFrom,
      showWeekFrom: config.footer.showWeekFrom,
    },
    lang,
  );
  const problems = checkFooter(footer.expect, reply, lang);
  if (!problems.length) return;
  out({
    decision: 'block',
    reason: `${tIn(lang, 'footer.check.head', { problems: problems.join('; ') })}\n${tIn(lang, 'footer.check.tail')}\n\n${footer.lines.join('\n\n')}`,
  });
}

function sessionStart(input: Input, lang: Lang): void {
  const l = dataLayout();
  const { config } = loadConfig(l);
  const sessionId = str(input.session_id) ?? '';
  const hookFile = sessionFile(l, sessionId, 'hook');
  if (hookFile) {
    const state = parseHookState(readText(hookFile), sessionId);
    state.lastRunAt = Date.now();
    try {
      writeJsonAtomic(hookFile, state);
    } catch {
      /* a session must start even when the data folder is not writable */
    }
  }
  // In the "checked" footer mode the model writes the lines; it learns their exact wording here (also after a compaction).
  if (config.modules.footer && config.footer.mode === 'check')
    out({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: footerInstruction(lang, {
          memory: config.memory.dirs.length > 0,
          showFiveFrom: config.footer.showFiveFrom,
          showWeekFrom: config.footer.showWeekFrom,
        }),
      },
    });
}

async function main(): Promise<void> {
  const event = process.argv[2] ?? '';
  let input: Input = {};
  try {
    const raw = readFileSync(0, 'utf8');
    input = raw.trim() ? (JSON.parse(raw) as Input) : {};
  } catch {
    input = {};
  }
  let lang: Lang = 'en';
  try {
    lang = processLanguage(loadConfig(dataLayout()).config.language);
  } catch {
    lang = 'en';
  }
  setLanguage(lang);

  if (event === 'PreToolUse') {
    const tool = str(input.tool_name) ?? '';
    const timer = setTimeout(() => {
      if (RISKY_TOOLS.test(tool)) preToolDeny(tIn(lang, 'belt.failed', { error: `no answer in ${DEADLINE_MS / 1000} s` }));
      process.exit(0);
    }, DEADLINE_MS);
    try {
      await preToolUse(input, lang);
    } catch (err) {
      if (RISKY_TOOLS.test(tool)) preToolDeny(tIn(lang, 'belt.failed', { error: (err as Error)?.message ?? String(err) }));
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  try {
    if (event === 'UserPromptSubmit') userPromptSubmit(input);
    else if (event === 'Stop') stop(input, lang);
    else if (event === 'SessionStart') sessionStart(input, lang);
  } catch {
    /* outside the belt a failure passes silently: these features are conveniences, not protection */
  }
}

await main();

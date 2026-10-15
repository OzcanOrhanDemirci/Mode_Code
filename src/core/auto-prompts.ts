// SPDX-License-Identifier: Apache-2.0
/**
 * The tasks the person gave full autonomy, the newest first and the last three kept, so a task written in the
 * start window is never lost (the person, 2026-10-15): written when a start is asked for, from the window or
 * a typed keyword, and shown in the control center (Automation › Recent tasks), where one can be copied
 * again. Also the budgets the start window offers. Pure: the plugin writes the file, the control center
 * reads it (src/core/layout.ts, `state/auto-prompts.json`).
 */
import { percent } from './format.js';
import type { Lang } from './i18n/index.js';
import { parseBudget } from './controls.js';

/** How many tasks are kept. */
export const AUTO_PROMPTS_KEPT = 3;

export interface AutoPrompt {
  /** The task, as the person wrote it. */
  text: string;
  /** The budget it was given with, as written: "+10", "90". */
  budget: string;
  at: number;
}

function isPrompt(x: unknown): x is AutoPrompt {
  const p = x as Partial<AutoPrompt> | null;
  return typeof p?.text === 'string' && p.text.trim() !== '' && typeof p.budget === 'string' && typeof p.at === 'number';
}

/** The kept tasks in a file's text, newest first; none for a file that is missing or not this one's shape. */
export function parseAutoPrompts(text: string | null): AutoPrompt[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (raw as { prompts?: unknown } | null)?.prompts;
  return Array.isArray(list) ? list.filter(isPrompt).slice(0, AUTO_PROMPTS_KEPT) : [];
}

/** The list with `p` on top: a task given again moves up with its new budget and time; three are kept. */
export function rememberAutoPrompt(list: readonly AutoPrompt[], p: AutoPrompt): AutoPrompt[] {
  const text = p.text.trim();
  if (!text) return list.slice(0, AUTO_PROMPTS_KEPT);
  return [{ ...p, text }, ...list.filter((x) => x.text.trim() !== text)].slice(0, AUTO_PROMPTS_KEPT);
}

export function serializeAutoPrompts(list: readonly AutoPrompt[]): string {
  return `${JSON.stringify({ v: 1, prompts: list.slice(0, AUTO_PROMPTS_KEPT) }, null, 2)}\n`;
}

/** The budgets the start window offers, as `/kota` asks them. */
export const AUTO_BUDGETS: readonly string[] = ['+5', '+10', '+20'];

/**
 * What the start window offers and starts on: the budget given with `/tam-otonom` (offered too when it is not
 * one of the three), else the last task's when it is one of them, else +10.
 */
export function startBudgets(given: string | null, kept: readonly AutoPrompt[]): { options: string[]; value: string } {
  if (given && parseBudget(given)) return { options: AUTO_BUDGETS.includes(given) ? [...AUTO_BUDGETS] : [...AUTO_BUDGETS, given], value: given };
  const last = kept[0]?.budget;
  return { options: [...AUTO_BUDGETS], value: last && AUTO_BUDGETS.includes(last) ? last : '+10' };
}

/** A budget as the window names it: "+10 → %89" with the week's reading (the weekly limit it sets), else as written. */
export function budgetLabel(value: string, week: number | null, lang: Lang): string {
  const b = parseBudget(value);
  if (!b) return value;
  if (!b.plus) return percent(b.n, lang);
  return week === null ? value : `${value} → ${percent(Math.min(100, Math.round(week) + b.n), lang)}`;
}

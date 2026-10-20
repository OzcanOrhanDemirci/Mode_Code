// SPDX-License-Identifier: Apache-2.0
/**
 * When Anthropic's safeguards stop an answer (docs/design.md, When an answer is stopped). A classifier on Anthropic's
 * server can flag a session and stop the answer being written: not the model's choice, not Claude Code's, not the
 * belt's. Claude Code says so in English and as an error ("API Error: … safeguards flagged this session"), and it was
 * taken for a broken tool: nine times in three sessions of 2026-10, each in Mode_Code's own work, one of them ended
 * there. This tells it from a turn's end and says it calmly, in the person's language, with the three ways on that
 * Claude Code itself names. Nothing is done for the person: the model stays theirs to pick, and nothing is hidden from
 * the classifier. Pure.
 */
import { tIn, type Lang, type MessageKey } from './i18n/index.js';

export interface Flag {
  /** What the classifier named ("cyber"), or null when it named nothing. */
  category: string | null;
  /** The model whose safeguards they were ("Opus 5.5"), or null when unsaid. */
  model: string | null;
}

/** The flag in Claude Code's text for it, or null: "API Error: Opus 5.5's safeguards flagged this session … Details: `[cyber]`". */
export function flagInText(text: string | null | undefined): Flag | null {
  if (!text || !/safeguards flagged/i.test(text)) return null;
  return {
    category: /Details:\s*`?\[([\w-]{1,40})\]/.exec(text)?.[1] ?? null,
    model: /(?:^|\n)\s*(?:API Error:\s*)?([^\n]{1,40}?)'s safeguards flagged/.exec(text)?.[1] ?? null,
  };
}

/** A turn's end as `turn.complete` has it: why it ended, what the API said of a refusal, the text shown. */
export interface TurnEnd {
  reason: string;
  refusal?: { category: string | null } | null;
  answer?: string;
}

/**
 * The flag of a turn's end, or null. Two ways: a refusal the API reported (`reason: 'refusal'`, the classifier's
 * stop, with its category), or an API error whose text is the flag's (Claude Code's records keep it as an
 * `invalid_request` error). Any other refusal or error is not this.
 */
export function flagOfTurn(e: TurnEnd): Flag | null {
  const said = flagInText(e.answer);
  if (e.reason === 'refusal') return { category: e.refusal?.category ?? said?.category ?? null, model: said?.model ?? null };
  return e.reason === 'error' ? said : null;
}

/** What the person reads under the stopped answer: what happened, who said it, and the three ways on. */
export function flagLines(f: Flag, lang: Lang): string[] {
  const t = (k: MessageKey, p?: Record<string, string>) => tIn(lang, k, p);
  return [
    f.category ? t('flag.title.named', { category: f.category }) : t('flag.title'),
    t('flag.who'),
    t('flag.ways'),
    `  • ${t('flag.way.edit')}`,
    `  • ${t('flag.way.model')}`,
    `  • ${t('flag.way.feedback')}`,
  ];
}

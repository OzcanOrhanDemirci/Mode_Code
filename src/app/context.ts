// SPDX-License-Identifier: Apache-2.0
/** What every command and screen starts from: where the data is, the settings, and the language. */
import type { Config, ConfigProblem } from '../core/config.js';
import type { Pending } from '../core/sync.js';
import { setLanguage, type Lang } from '../core/i18n/index.js';
import type { Layout } from '../core/layout.js';
import { dataLayout, processLanguage } from '../node/env.js';
import { loadConfig } from '../node/context.js';

export interface AppContext {
  layout: Layout;
  /** The settings in effect (with the other computers' changes, docs/sync.md). */
  config: Config;
  problems: ConfigProblem[];
  lang: Lang;
  cwd: string;
  /** This computer's own settings, config.json as it is; the settings in effect when not given. */
  local?: Config;
  /** Settings from other computers waiting for the person. */
  pending?: Pending[];
}

export function appContext(opts: { lang?: Lang | null } = {}): AppContext {
  const layout = dataLayout();
  const { config, problems, local, pending } = loadConfig(layout);
  const lang = opts.lang ?? processLanguage(config.language);
  setLanguage(lang);
  return { layout, config, problems, lang, cwd: process.cwd(), local, pending };
}

/** Reloads the settings into an existing context (after the interface changed one). */
export function reloadConfig(ctx: AppContext): AppContext {
  const { config, problems, local, pending } = loadConfig(ctx.layout);
  const lang = processLanguage(config.language);
  setLanguage(lang);
  return { ...ctx, config, problems, lang, local, pending };
}

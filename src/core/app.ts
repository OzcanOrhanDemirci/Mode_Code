// SPDX-License-Identifier: Apache-2.0
/**
 * Identity of the tool in one place. The public name is not final yet. Folders, the plugin's and the
 * marketplace's ids are derived from these constants; the name also appears written out in messages,
 * documents and tests, so a rename is made by `scripts/rename.ts`, which changes every spelling in one
 * pass and records the old name in PREVIOUS_NAMES (docs/release.md, "Renaming").
 */

declare const __TC_VERSION__: string | undefined;

/** Machine id: npm package, plugin name prefix, data folder name. Kebab-case. */
export const APP_ID = 'terminal-code';

/** Human name shown in the interface. */
export const APP_NAME = 'terminal-code';

/** False while the name is a working name: the about screen says so. scripts/rename.ts sets it. */
export const NAME_IS_FINAL = false;

/**
 * Earlier names, newest first. An installation made under one of them is moved by the installer (its data
 * kept, its hooks and plugin replaced), and what it wrote into a person's folders is still recognised.
 * Only scripts/rename.ts writes this list.
 */
export const PREVIOUS_NAMES: readonly { readonly id: string; readonly name: string }[] = [];

/** Version string, injected by the build; "dev" when running from source. */
export const APP_VERSION: string = typeof __TC_VERSION__ === 'string' ? __TC_VERSION__ : 'dev';

/** Folder under the home directory that holds all of the tool's data. */
export const DATA_DIR_NAME = `.${APP_ID}`;

/** Claude Code plugin that carries the behavior layer (mod + safety-net hooks). */
export const PLUGIN_NAME = APP_ID;

/** Local marketplace the installer registers with Claude Code; its folder lives in the data folder. */
export const MARKETPLACE_NAME = `${APP_ID}-local`;

/** Plugin id as Claude Code writes it in enabledPlugins. */
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/** Lowest Claude Code version whose hooks support everything the safety net relies on (onFailure, exec form). */
export const MIN_CLAUDE_CODE_FOR_HOOKS = '2.1.295';

/** Lowest Claude Code version with the mods API the in-process layer is written against. */
export const MIN_CLAUDE_CODE_FOR_MODS = '2.1.290';

/** Project home, used for "report a problem" links and the about screen. */
export const REPO_URL = 'https://github.com/OzcanOrhanDemirci/terminal-code';

/** Environment variable a person can set to force the interface language. */
export const LANG_ENV = 'TERMINAL_CODE_LANG';

/** The session id the installer's and the health check's self-test use: what it triggers is not recorded. */
export const SELF_TEST_SESSION = 'install-self-test';

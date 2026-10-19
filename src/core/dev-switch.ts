// SPDX-License-Identifier: Apache-2.0
/**
 * TEMPORARY, for developing Mode_Code itself (the person, 2026-10-18): a session the person starts with
 * MODE_CODE_DEV_BELT_OFF=1 in its environment runs with the safety belt off. Nothing is asked or blocked, Mode_Code's
 * own files and the outside-content questions included, since the work is changing Mode_Code. The person's own
 * guards stay: a frozen folder, a mode's limits, a full-autonomy run's rules.
 *
 * Only the person sets it, by starting Claude Code with it: the model cannot change the environment of the program it
 * runs in. The strip says so for as long as it holds, and the model is told with every prompt.
 *
 * It goes before 1.2.0 is released: test/core/dev-switch.test.ts fails once the version is 1.2.0 while it is here. The
 * test runs' cleaner (test/helpers/clean-env.mjs) goes with it.
 */

/** The variable, and the one value that turns the belt off. */
export const DEV_BELT_OFF = 'MODE_CODE_DEV_BELT_OFF';

export function beltOffForDevelopment(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[DEV_BELT_OFF] === '1';
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Loaded before every test file (`--import`): a session the person started with the temporary switch that turns the
 * belt off (src/core/dev-switch.ts) still tests the belt. Without this, every test that spawns the hook in that
 * session sees the belt off and fails. The switch's own tests set the variable themselves. Goes with the switch.
 */
delete process.env.MODE_CODE_DEV_BELT_OFF;

// SPDX-License-Identifier: Apache-2.0
// App store uploads (publish.store) and payments (outbound.payment): always the person's (K5 of 1.2.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';

const ctx = (): BeltContext => ({
  platform: 'linux',
  home: '/home/ada',
  cwd: '/home/ada/dev/app',
  projectDir: '/home/ada/dev/app',
  env: {},
  dataDir: '/home/ada/.mode-code',
  memoryDirs: [],
  managedSettingsFiles: [],
  lang: 'en',
  config: {},
});
const rules = async (tool: string, input: Record<string, unknown>) =>
  (await evaluateToolCall(tool, input, ctx())).findings.map((f) => `${f.rule}:${f.verdict}`);

test('an app store upload, submission or release is asked', async () => {
  for (const command of [
    'asc builds upload --ipa build/app.ipa',
    'asc publish appstore --app 123 --ipa app.ipa --version 1.2.0 --submit --confirm',
    'asc publish testflight --group beta --wait',
    'asc submit cancel --version-id 9 --confirm',
    'asc release stage --app 123 --version 1.2.0',
    'asc builds add-groups --build 7 --group ext --submit --confirm',
    'gplay releases upload app.aab --package com.ada.app --track internal',
    'gplay releases promote --from internal --to beta',
    'eas submit -p ios',
    'fastlane deliver',
    'xcrun altool --upload-app -f app.ipa',
  ]) {
    assert.deepEqual(await rules('Bash', { command }), ['publish.store:ask'], command);
  }
});

test('checking and reading a store is not asked', async () => {
  for (const command of [
    'asc validate --app 123 --version 1.2.0 --strict',
    'asc review status',
    'asc submit status --version-id 9',
    'asc builds list',
    'asc release stage --app 123 --version 1.2.0 --dry-run',
    'gplay releases list --package com.ada.app',
    'gplay auth doctor --package com.ada.app',
    'maestro test flow.yaml',
  ])
    assert.deepEqual(await rules('Bash', { command }), [], command);
});

test('a payment through the Stripe command line or a connected service is asked', async () => {
  for (const command of ['stripe refunds create --charge ch_123', 'stripe payment_intents confirm pi_1', 'stripe subscriptions cancel sub_9']) {
    assert.deepEqual(await rules('Bash', { command }), ['outbound.payment:ask'], command);
  }
  for (const tool of ['mcp__stripe__create_refund', 'mcp__plugin_stripe_stripe__create_payment_link', 'mcp__billing__cancel_subscription']) {
    assert.ok((await rules(tool, {})).includes('outbound.payment:ask'), tool);
  }
  // Reading payments, and the CLI's own work, are not.
  for (const command of ['stripe refunds list', 'stripe listen --forward-to localhost:3000/webhook', 'stripe login'])
    assert.deepEqual(await rules('Bash', { command }), [], command);
  assert.deepEqual(await rules('mcp__stripe__list_payment_intents', {}), []);
});

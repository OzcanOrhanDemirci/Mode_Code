// SPDX-License-Identifier: Apache-2.0
// The project's own checks (quality.check-config): changing lint or format settings is asked; reading them is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext } from '../../src/core/belt/types.js';

const ctx: BeltContext = {
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
};
const rules = async (tool: string, input: Record<string, string>) => (await evaluateToolCall(tool, input, ctx)).findings.map((f) => `${f.rule}:${f.verdict}`);

test('writing the settings of a linter or a formatter is asked, by any tool', async () => {
  for (const file of [
    '.eslintrc.json',
    'eslint.config.js',
    '.prettierrc',
    'prettier.config.mjs',
    'biome.json',
    'analysis_options.yaml',
    'ruff.toml',
    '.golangci.yml',
  ])
    assert.deepEqual(await rules('Write', { file_path: `/home/ada/dev/app/${file}`, content: '{}' }), ['quality.check-config:ask'], file);
  assert.deepEqual(await rules('Edit', { file_path: '/home/ada/dev/app/packages/web/.eslintrc.cjs', old_string: "'error'", new_string: "'off'" }), [
    'quality.check-config:ask',
  ]);
  for (const command of [`sed -i 's/error/off/' .eslintrc.json`, 'echo "{}" > biome.json', 'cp ../relaxed.yaml analysis_options.yaml'])
    assert.deepEqual(await rules('Bash', { command }), ['quality.check-config:ask'], command);
});

test('reading them, and files that only look alike, are left alone', async () => {
  for (const command of ['cat .eslintrc.json', 'npx eslint .', 'npx prettier --check .', 'dart analyze'])
    assert.deepEqual(await rules('Bash', { command }), [], command);
  for (const file of ['package.json', 'eslint.config.backup.txt', 'docs/prettier.md', 'src/biome.ts'])
    assert.deepEqual(await rules('Write', { file_path: `/home/ada/dev/app/${file}`, content: 'x' }), [], file);
});

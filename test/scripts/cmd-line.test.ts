// SPDX-License-Identifier: Apache-2.0
// The scripts' copy of src/core/cmd-line.ts (scripts/cmd-line.mjs) builds the same lines, and runs npm without a shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cmdShimLine, windowsArg } from '../../src/core/cmd-line.js';
// @ts-expect-error: a plain JavaScript script, run without a build
import * as copy from '../../scripts/cmd-line.mjs';
import { fc } from '../helpers/prop.js';

test("the scripts' copy builds the same line, and refuses the same arguments", () => {
  const outcome = (f: (p: string, a: readonly string[]) => string, p: string, a: string[]) => {
    try {
      return f(p, a);
    } catch (e) {
      return `throws ${(e as Error).name}`;
    }
  };
  fc.assert(
    fc.property(fc.string(), fc.array(fc.string({ unit: 'binary' }), { maxLength: 6 }), (p, a) => {
      assert.equal(outcome(copy.cmdShimLine, p, a), outcome(cmdShimLine, p, a));
      for (const s of a) assert.equal(copy.windowsArg(s), windowsArg(s));
    }),
  );
});

test('npm runs without a shell, and the arguments arrive as given', () => {
  const npm = copy.npmCommand(['--version']) as { command: string; args: string[] };
  if (process.platform === 'win32') assert.equal(npm.command, process.execPath);
  else assert.deepEqual(npm, { command: 'npm', args: ['--version'] });
  assert.equal(npm.args.at(-1), '--version');
  const r = spawnSync(npm.command, npm.args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

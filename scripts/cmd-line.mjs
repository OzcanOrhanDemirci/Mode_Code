// SPDX-License-Identifier: Apache-2.0
/**
 * src/core/cmd-line.ts for the scripts, which run without a build: the cmd.exe line that starts a .cmd or
 * .bat program (npm's shims) with exactly the given arguments. test/core/cmd-line.test.ts holds the two to
 * the same output; change both together. npmCommand is the scripts' own.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const META = /[()\][%!^"`<>&|;, *?]/g;

export function windowsArg(arg) {
  let out = '"';
  let slashes = 0;
  for (const c of arg) {
    if (c === '\\') {
      slashes++;
      continue;
    }
    out += c === '"' ? `${'\\'.repeat(slashes * 2 + 1)}"` : `${'\\'.repeat(slashes)}${c}`;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

export function cmdShimLine(program, args) {
  if ([program, ...args].some((a) => /[\r\n]/.test(a))) throw new RangeError('a line break cannot pass through cmd.exe');
  const quoted = args.map((a) => windowsArg(a).replace(META, '^$&').replace(META, '^$&'));
  return [program.replace(META, '^$&'), ...quoted].join(' ');
}

/**
 * npm without a shell, as `{ command, args }` for spawnSync. On Windows npm is a .cmd shim, so its own
 * program is run by this Node.js: the one `npm run` names in npm_execpath, or the one installed beside it.
 */
export function npmCommand(args) {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const cli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(
    (f) => f && /npm-cli\.js$/i.test(f) && existsSync(f),
  );
  if (!cli) throw new Error(`npm's program (npm-cli.js) is neither in npm_execpath nor beside ${process.execPath}`);
  return { command: process.execPath, args: [cli, ...args] };
}

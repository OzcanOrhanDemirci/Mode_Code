// SPDX-License-Identifier: Apache-2.0
/**
 * The cmd.exe line that starts a .cmd or .bat program with exactly the given arguments. Windows starts
 * such a program (npm's shims: `claude.cmd`, `npm.cmd`) only through the shell, and the shell reads each
 * argument twice: once for `cmd /c`, once more when the shim passes `%*` on. So each argument is quoted as
 * a Windows program splits its command line, then every character cmd reads specially is escaped with `^`,
 * once per reading. This is cross-spawn's method, after https://qntm.org/cmd.
 *
 * scripts/cmd-line.mjs is the same function for the scripts, which run without a build; a test holds the
 * two to the same output.
 */

/** What cmd reads specially outside quotes. The quotes are among them: cmd never sees a quoted part. */
const META = /[()\][%!^"`<>&|;, *?]/g;

/** One argument as a Windows program splits its command line: quoted, the backslashes before a quote doubled. */
export function windowsArg(arg: string): string {
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

/**
 * The line for `spawnSync(line, { shell: true })` that runs the shim `program` with `args`. A line break
 * ends a cmd line wherever it stands, so an argument holding one cannot be passed and is refused.
 */
export function cmdShimLine(program: string, args: readonly string[]): string {
  if ([program, ...args].some((a) => /[\r\n]/.test(a))) throw new RangeError('a line break cannot pass through cmd.exe');
  const quoted = args.map((a) => windowsArg(a).replace(META, '^$&').replace(META, '^$&'));
  return [program.replace(META, '^$&'), ...quoted].join(' ');
}

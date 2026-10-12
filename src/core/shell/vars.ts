// SPDX-License-Identifier: Apache-2.0
/** Environment variables in a command's words, expanded from known values. Pure. */

/** Expands $NAME, ${NAME}, %NAME%, $env:NAME from `env`; null when something stays unknown. */
export function expandVars(text: string, home: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const lookup = (name: string): string | undefined => {
    const n = name.toUpperCase();
    if (n === 'HOME' || n === 'USERPROFILE') return home;
    // Own keys only: $constructor is an unknown variable, not Object's constructor.
    if (Object.hasOwn(env, name)) return env[name];
    return Object.hasOwn(env, n) ? env[n] : undefined;
  };
  let unknown = false;
  const out = text.replace(/\$\{env:(\w+)\}|\$env:(\w+)|\$\{(\w+)\}|\$(\w+)|%(\w+)%/gi, (whole, a, b, c, d, e) => {
    const v = lookup(a ?? b ?? c ?? d ?? e);
    if (v === undefined) unknown = true;
    return v ?? whole;
  });
  if (unknown || /\$\(|`|…|\$\{|\$[0-9@*#?!-]/.test(out)) return null;
  return out;
}

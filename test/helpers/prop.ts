// SPDX-License-Identifier: Apache-2.0
/**
 * Property tests: statements checked on many generated inputs (fast-check). The seed is fixed so a run
 * is repeatable; TC_SEED picks another seed and TC_RUNS more cases (a nightly run explores further). A
 * failure prints the seed and the smallest input that fails, so it can be replayed exactly.
 */
import fc from 'fast-check';

export const SEED = Number(process.env.TC_SEED ?? 20261012);
export const RUNS = Number(process.env.TC_RUNS ?? 300);

fc.configureGlobal({ seed: SEED, numRuns: RUNS, verbose: 1 });

export { fc };

/** Text that looks like shell input: the characters and tokens parsers find hard, mixed with plain words. */
export const shellish = fc
  .array(
    fc.oneof(
      {
        weight: 4,
        arbitrary: fc.constantFrom('git', 'rm', '-rf', 'echo', 'cd', 'ls', 'npm', 'node', '~', '/tmp', 'C:\\x', '$HOME', '%USERPROFILE%', 'a', 'b'),
      },
      { weight: 3, arbitrary: fc.constantFrom(' ', ' ', '\t', '\n', ';', '&&', '||', '|', '&', '>', '>>', '<', '2>&1', '<<', '<<EOF', 'EOF') },
      {
        weight: 3,
        arbitrary: fc.constantFrom("'", '"', '`', '\\', '$(', ')', '${', '}', '(', '{', '[', ']', '$', '#', '*', '?', '!', '`', '@(', '$env:', '^'),
      },
      { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 6 }) },
      // Members every JavaScript object has: a lookup by an untrusted name must not find them (the first run
      // of these tests found "__proto__" and "constructor" crashing the parser).
      { weight: 1, arbitrary: fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty', '$constructor', '${__proto__}', '%constructor%') },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(''));

/** A path segment: plain names, dots, Turkish letters, spaces, 8.3-looking names. */
export const segment = fc.oneof(
  fc.constantFrom('a', 'src', '.claude', '.terminal-code', 'Program Files', 'çağrı', 'İstanbul', 'node_modules', 'TERMIN~1', 'x.y.z', '..', '.'),
  fc.stringMatching(/^[A-Za-z0-9._ -]{1,12}$/),
);

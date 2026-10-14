// SPDX-License-Identifier: Apache-2.0
/**
 * Built-in self-tests: small suites of samples with known answers, shipped with the tool. The unit tests
 * run them in CI, and `mode-code doctor` runs the very same samples on the person's machine, so what
 * was tested is what is checked again where it matters (another JavaScript engine version, another locale).
 */

export interface SampleFailure {
  name: string;
  expected: string;
  actual: string;
}

export interface SuiteResult {
  suite: string;
  passed: number;
  failed: number;
  failures: SampleFailure[];
  ms: number;
}

/** Runs named samples; a sample that throws fails with the error as its answer. */
export async function runSuite(
  suite: string,
  samples: readonly { name: string; run: () => Promise<[string, string]> | [string, string] }[],
): Promise<SuiteResult> {
  const started = Date.now();
  const failures: SampleFailure[] = [];
  let passed = 0;
  for (const s of samples) {
    try {
      const [expected, actual] = await s.run();
      if (expected === actual) passed++;
      else failures.push({ name: s.name, expected, actual });
    } catch (err) {
      failures.push({ name: s.name, expected: '(no error)', actual: `error: ${(err as Error)?.message ?? String(err)}` });
    }
  }
  return { suite, passed, failed: failures.length, failures, ms: Date.now() - started };
}

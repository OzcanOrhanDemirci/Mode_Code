// SPDX-License-Identifier: Apache-2.0
// The record of Claude Code releases checked (scripts/claude-compat.mjs): one row per date and version, in docs/testing.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain JavaScript script, run by hand
import * as compat from '../../scripts/claude-compat.mjs';

const { compatRow, withRow } = compat;

test("a row: the date, the version, each step's result or that it did not run", () => {
  assert.equal(
    compatRow('2026-10-18', '2.1.302', [
      { name: 'check', ok: true },
      { name: 'mod', ok: false },
    ]),
    '| 2026-10-18 | 2.1.302 | pass | FAIL | not run |',
  );
  // The kit passed with no declarations to check its types against: the row says so, not a plain pass.
  assert.equal(
    compatRow('2026-10-21', '2.1.306', [
      { name: 'check', ok: true },
      { name: 'mod', ok: true, without: 'types' },
    ]),
    '| 2026-10-21 | 2.1.306 | pass | pass (no types) | not run |',
  );
  assert.equal(compatRow('2026-10-21', '2.1.306', [{ name: 'mod', ok: false, without: 'types' }]), '| 2026-10-21 | 2.1.306 | not run | FAIL | not run |');
});

test('the table: made under its heading at the end, rows added after the last, a row of the same date and version replaced', () => {
  const doc = '# Testing\n\ntext\n\n## Later\n\nmore\n';
  const first = withRow(doc, '| 2026-10-18 | 2.1.302 | pass | pass | not run |');
  assert.match(
    first,
    /## Later\n\nmore\n\n## Claude Code versions checked\n\n.+\n\n\| Date \| Claude Code \| check \| mod \(types, kit\) \| live \|\n\| --- \|.+\n\| 2026-10-18 \| 2\.1\.302 \| pass \| pass \| not run \|\n$/,
  );
  // Laid out by the formatter: padded cells still name the same row.
  const padded = first.replace('| 2026-10-18 | 2.1.302 | pass | pass | not run |', '| 2026-10-18 | 2.1.302     | pass  | pass             | not run |');
  const again = withRow(padded, '| 2026-10-18 | 2.1.302 | pass | pass | pass |');
  assert.equal((again.match(/2\.1\.302/g) ?? []).length, 1);
  assert.match(again, /\| 2026-10-18 \| 2\.1\.302 \| pass \| pass \| pass \|\n$/);
  const next = withRow(again, '| 2026-10-20 | 2.1.303 | FAIL | not run | not run |');
  assert.match(next, /2\.1\.302 \| pass \| pass \| pass \|\n\| 2026-10-20 \| 2\.1\.303/);
  // A section after the table keeps its place.
  const between = withRow(next.replace(/\n$/, '\n\n## After\n\nend\n'), '| 2026-10-21 | 2.1.304 | pass | pass | not run |');
  assert.match(between, /2\.1\.303 .+\n\| 2026-10-21 \| 2\.1\.304 .+\n\n## After\n\nend\n$/);
});

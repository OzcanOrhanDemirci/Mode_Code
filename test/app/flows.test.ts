// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFlow, flowFiles, loadFlows } from '../../src/app/flows.js';
import { layout } from '../../src/core/layout.js';
import { startFlow, type Flow } from '../../src/core/flow.js';
import { count, evidenceText, flowTitle, statusText } from '../../src/core/flow-view.js';

const flow = (id: string, updatedAt: number, task = 'Add sign-in'): Flow => ({
  ...startFlow({ id, variant: 'full', task, project: null, cwd: '/a', sessionId: 's', workDir: '/w', now: 1 }),
  updatedAt,
});

test('flows on record, newest change first; torn files, strange names and a record under another name are left out', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-flows-'));
  try {
    const l = layout(join(root, 'data'));
    assert.deepEqual(loadFlows({ layout: l }), [], 'no folder yet');
    const put = (dir: string, text: string) => {
      mkdirSync(join(l.flowsDir, dir), { recursive: true });
      writeFileSync(join(l.flowsDir, dir, 'flow.json'), text);
    };
    put('20261012-0900-a', JSON.stringify(flow('20261012-0900-a', 10)));
    put('20261012-1000-b', JSON.stringify(flow('20261012-1000-b', 20)));
    put('20261012-1100-torn', '{');
    put('Bad Name', JSON.stringify(flow('Bad Name', 30)));
    put('20261012-1200-c', JSON.stringify(flow('20261012-9999-other', 40)));
    mkdirSync(join(l.flowsDir, '20261012-1300-empty'));
    const list = loadFlows({ layout: l });
    assert.deepEqual(
      list.map((f) => f.id),
      ['20261012-1000-b', '20261012-0900-a'],
    );
    assert.equal(findFlow(list, '20261012-0900-a')?.id, '20261012-0900-a');
    assert.equal(findFlow(list, '20261012-10')?.id, '20261012-1000-b');
    assert.equal(findFlow(list, '20261012'), null, 'two flows start like this');
    assert.equal(findFlow(list, 'zzz'), null);
    const files = flowFiles({ layout: l }, list[0]!);
    assert.deepEqual(files, { report: null, plan: null, checkedReport: null, approvedPlan: null });
    writeFileSync(join(l.flowsDir, '20261012-1000-b', 'research.md'), '# r');
    writeFileSync(join(l.flowsDir, '20261012-1000-b', 'plan.md'), '# p');
    const f2 = flowFiles({ layout: l }, list[0]!);
    assert.equal(f2.checkedReport, join(l.flowsDir, '20261012-1000-b', 'research.md'));
    assert.equal(f2.approvedPlan, join(l.flowsDir, '20261012-1000-b', 'plan.md'));
    // The drafts count only for the steps the flow has, and only when they exist.
    mkdirSync(join(root, 'w'));
    writeFileSync(join(root, 'w', 'research.md'), '# r');
    const research = { ...list[0]!, reportPath: join(root, 'w', 'research.md'), planPath: join(root, 'w', 'plan.md') };
    assert.equal(flowFiles({ layout: l }, research).report, join(root, 'w', 'research.md'));
    assert.equal(flowFiles({ layout: l }, research).plan, null);
    const planOnly = { ...research, steps: research.steps.filter((s) => s.kind !== 'research') };
    assert.equal(flowFiles({ layout: l }, planOnly).report, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a flow in words: status, evidence of each step with singular counts, a title from the task', () => {
  assert.equal(statusText('waiting', 'en'), 'waiting for approval');
  assert.equal(statusText('paused', 'tr'), 'duraklatıldı');
  assert.equal(count('en', 'findings', 1), '1 finding');
  assert.equal(count('en', 'sources', 2), '2 sources');
  assert.equal(count('tr', 'commands', 3), '3 doğrulama komutu');
  assert.equal(evidenceText({ kind: 'research', findings: 1, sources: 3 }, 'en'), '1 finding, 3 sources');
  assert.equal(evidenceText({ kind: 'plan', steps: 1, commands: 2 }, 'en'), '1 step, 2 verification commands');
  assert.equal(evidenceText({ kind: 'approve', via: 'plan-mode' }, 'en'), "approved in Claude Code's plan dialog");
  assert.equal(evidenceText({ kind: 'approve', via: 'keyword' }, 'tr'), 'yazılarak onaylandı');
  assert.equal(evidenceText({ kind: 'code', commands: 1, seconds: 12 }, 'en'), '1 verification command passed in 12 s');
  assert.equal(flowTitle(flow('f1', 0, 'Add sign-in\nwith two factors')), 'Add sign-in');
  assert.equal(flowTitle(flow('f1', 0, '')), 'f1');
  assert.equal(flowTitle(flow('f1', 0, 'x'.repeat(80)), 10), `${'x'.repeat(9)}…`);
});

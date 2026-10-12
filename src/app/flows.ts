// SPDX-License-Identifier: Apache-2.0
/** The flows' records as the command line and the control center read them (the plugin writes them). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlow, type Flow } from '../core/flow.js';
import { flowDir } from '../core/layout.js';
import { readText } from '../node/fsx.js';
import type { AppContext } from './context.js';

/** Every flow on record, the most recently changed first. */
export function loadFlows(ctx: Pick<AppContext, 'layout'>): Flow[] {
  let names: string[];
  try {
    names = readdirSync(ctx.layout.flowsDir);
  } catch {
    return [];
  }
  const out: Flow[] = [];
  for (const n of names) {
    const dir = flowDir(ctx.layout, n);
    const f = dir ? parseFlow(readText(join(dir, 'flow.json'))) : null;
    if (f && f.id === n) out.push(f);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A flow by its id or the start of it (unique), or null. */
export function findFlow(flows: readonly Flow[], idOrPrefix: string): Flow | null {
  const exact = flows.find((f) => f.id === idOrPrefix);
  if (exact) return exact;
  const some = flows.filter((f) => f.id.startsWith(idOrPrefix));
  return some.length === 1 ? some[0]! : null;
}

export interface FlowFiles {
  /** The drafts Claude wrote (they may have been changed since, or cleaned with the temporary folder). */
  report: string | null;
  plan: string | null;
  /** The checked copies the plugin kept, out of Claude's reach. */
  checkedReport: string | null;
  approvedPlan: string | null;
}

export function flowFiles(ctx: Pick<AppContext, 'layout'>, f: Flow): FlowFiles {
  const dir = flowDir(ctx.layout, f.id);
  const has = (p: string | null) => (p && existsSync(p) ? p : null);
  const steps = new Set(f.steps.map((s) => s.kind));
  return {
    report: steps.has('research') ? has(f.reportPath) : null,
    plan: steps.has('plan') ? has(f.planPath) : null,
    checkedReport: dir ? has(join(dir, 'research.md')) : null,
    approvedPlan: dir ? has(join(dir, 'plan.md')) : null,
  };
}

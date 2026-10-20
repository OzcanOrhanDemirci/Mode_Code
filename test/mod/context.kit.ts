// SPDX-License-Identifier: Apache-2.0
/**
 * What costs context, inside Claude Code's engine (A7 of 1.2.0): after a commit or a push with a large context,
 * the strip says /clear would start the next task small, until the person types again; a large file read whole gets
 * a hint toward reading a part. The world beneath is in memory (see world.ts); the context's size is what the
 * engine's `session.usage` answers.
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA } from './world.ts';

const strip = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 } } as any;
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as any;
const bash = async ($: any, command: string, id: string) => (await $.tool.call({ tool: 'Bash', command, tool_use_id: id } as any)) as any;

async function band($: any): Promise<string | null> {
  const ui = await $.ui.mount({ plugin: 'mode-code', surface: 'terminal', component: 'AbovePrompt', props: strip } as any);
  const t = (await ui.findAll({ type: 'Text' })).find((x: any) => /^✓ (?:commit|push):/.test(String(x.text)))?.text ?? null;
  await ui.unmount();
  return t;
}

function context(on: any, size: { tokens: number }) {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: size.tokens, window: 1_000_000, percent: 30 }, rateLimits: [] } }));
}

test('a commit with a large context: the strip says /clear until the next prompt; a push says push', async ($, on) => {
  // Manual waits for the person before a commit or a push: here they say yes.
  world(on, { answer: 'allow' });
  context(on, { tokens: 300_000 });
  await $.prompt.submit(typed('fix the parser'));
  expect(await band($)).toBe(null);
  await bash($, 'npm test', 'b1');
  expect(await band($)).toBe(null);
  await bash($, 'git commit -m "fix the parser"', 'b2');
  expect(await band($)).toBe('✓ commit: a good moment for /clear before the next task; every call reads the 300 K of context again.');
  await $.prompt.submit(typed('now the docs'));
  expect(await band($)).toBe(null);
  await bash($, 'git commit -am docs && git push', 'b3');
  expect(await band($)).toMatch(/^✓ push: /);
});

test('a small context, a subagent, a failed commit or the setting off: nothing is said', async ($, on) => {
  const size = { tokens: 99_999 };
  const w = world(on, {
    results: { Bash: (e: any) => (/fail/.test(String(e.command)) ? { result: { result: 'x' }, isError: true } : { result: { result: 'ok' } }) },
  });
  context(on, size);
  await bash($, 'git commit -m small', 's1');
  expect(await band($)).toBe(null);
  size.tokens = 400_000;
  await bash($, 'git commit -m fail', 's2');
  expect(await band($)).toBe(null);
  await $.tool.call({ tool: 'Bash', command: 'git commit -m sub', tool_use_id: 's3', agentId: 'a1' } as any);
  expect(await band($)).toBe(null);
  w.write(`${DATA}/config.json`, JSON.stringify({ language: 'en', quota: { clearHint: false } }));
  await $.prompt.submit(typed('go on'));
  await bash($, 'git commit -m off', 's4');
  expect(await band($)).toBe(null);
});

test('a large file read whole: a hint toward grep and offset/limit, once in a session; a part, a small file or a subagent says nothing', async ($, on) => {
  const big = 'x'.repeat(40_000);
  world(on, { results: { Read: (e: any) => ({ result: { result: 'ok' }, text: String(e.file_path).includes('big') ? big : 'small' }) } });
  const read = async (input: Record<string, unknown>, id: string, agentId?: string) =>
    (((await $.tool.call({ tool: 'Read', ...input, tool_use_id: id, ...(agentId ? { agentId } : {}) } as any)) as any).context ?? []).join('\n');
  expect(await read({ file_path: '/w/small.ts' }, 'r1')).not.toMatch(/read whole/);
  expect(await read({ file_path: '/w/big.ts', offset: 100, limit: 50 }, 'r2')).not.toMatch(/read whole/);
  expect(await read({ file_path: '/w/big.ts' }, 'r3', 'a1')).not.toMatch(/read whole/);
  expect(await read({ file_path: '/w/big.ts' }, 'r4')).toMatch(/That file was read whole.*offset and limit/s);
  expect(await read({ file_path: '/w/big2.ts' }, 'r5')).not.toMatch(/read whole/);
});

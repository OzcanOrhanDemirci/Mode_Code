// SPDX-License-Identifier: Apache-2.0
/**
 * Skills inside Claude Code's engine (docs/skills.md): the short commands of the person's skills (one opens Claude
 * Code's own rewind), the list of everything, a skill's use logged once. The world beneath is in memory (see world.ts).
 */
import { test, expect } from 'claude-code/testing';
import { world, DATA, PROJECT } from './world.ts';

const NODE = '/usr/bin/node';
const CLI = '/home/ada/.local/share/mode-code/app/dist/cli.mjs';
const installed = (w: any) => {
  w.write(`${DATA}/install/manifest.json`, JSON.stringify({ v: 1, app: 'mode-code', node: NODE, cli: CLI }));
  w.write(CLI, '// the program');
};
const command = async ($: any, name: string, args = '') => (await $.command.run({ command: name, args, origin: { kind: 'composer' } } as any)) as any;

test("/geri-al opens Claude Code's own rewind, which keeps a checkpoint before each message", async ($, on) => {
  const w = world(on, { lang: 'tr' });
  const ran: string[] = [];
  on('command.run', (_$: any, e: any, next: any) => {
    if (e.command === 'rewind') {
      ran.push(e.command);
      return { text: '' };
    }
    return next(e);
  });
  await command($, 'geri-al');
  await w.clock.advance(5);
  expect(ran).toEqual(['rewind']);
});

test("a short command sends its skill's text as the person's message; a keyword's sends the keyword; the list names everything", async ($, on) => {
  // The skill's file in the plugin's folder.
  const w = world(on, {
    lang: 'tr',
    pluginFiles: {
      '/skills/verify/SKILL.md':
        '---\nname: verify\ndisable-model-invocation: true\n---\n\nVerify the work of this session (or what the person names: $ARGUMENTS) with fresh evidence.\n',
    },
  });
  const r = await command($, 'dogrula', 'giriş akışı');
  expect(String(r.text)).toBe('/mode-code:verify çalışıyor.');
  await w.clock.advance(5);
  const sent = String(w.submitted.at(-1));
  expect(sent).toMatch(
    /^\[Mode_Code\] The person ran \/dogrula, Mode_Code's `verify` skill\. Do what it says:\n\nVerify the work of this session \(or what the person names: giriş akışı\)/,
  );
  expect(sent).not.toMatch(/^---|disable-model-invocation/m);
  expect(w.events().some((e: any) => e.kind === 'skill' && e.skill === 'mode-code:verify' && e.via === 'short')).toBe(true);
  await command($, 'toparla');
  await w.clock.advance(5);
  expect(w.submitted.at(-1)).toBe('toparla');
  const list = String((await command($, 'komutlar')).text);
  expect(list).toMatch(/Anahtar kelimeler/);
  expect(list).toMatch(/\/dogrula +İşi bitti demeden önce taze kanıtla doğrula/);
  expect(list).toMatch(/\/mode-code:measure +Bir sayı söylemeden önce ölç/);
  // The memory note only once a memory is set up.
  expect(list).not.toMatch(/bellek-yaz|memory-note/);
  expect(list).toMatch(/\/magaza-hazirlik +Uygulama App Store ve Google Play için hazır mı/);
});

test('a skill that runs a script of its own is sent with its folder filled in, as Claude Code fills it', async ($, on) => {
  const w = world(on, {
    lang: 'tr',
    pluginFiles: { '/skills/store-check/SKILL.md': '---\nname: store-check\n---\n\nRun `node "${CLAUDE_SKILL_DIR}/check.mjs" .` and report.\n' },
  });
  await command($, 'magaza-hazirlik');
  await w.clock.advance(5);
  const sent = String(w.submitted.at(-1));
  expect(sent).toMatch(/Run `node "[^"]*\/skills\/store-check\/check\.mjs" \.` and report\./);
  expect(sent).not.toMatch(/CLAUDE_SKILL_DIR/);
});

test("a skill's use is logged once a session; the kept skills are put in line as the session starts", async ($, on) => {
  const w = world(on, {
    lang: 'en',
    programs: (argv) => (argv[2] === 'skills' ? { exitCode: 0, stdout: JSON.stringify({ added: [], removed: [] }) } : undefined),
  });
  installed(w);
  on('skill.prompt', (_$: any, e: any) => ({ text: `the ${e.skill} skill` }));
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  await $.session.start({ source: 'startup', cwd: PROJECT } as any);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(w.ran.some((a: string[]) => a.join(' ') === `${NODE} ${CLI} skills sync --json`)).toBe(true);
  await $.skill.prompt({ skill: 'mode-code:verify', text: 'x', frontmatter: {} } as any);
  await $.skill.prompt({ skill: 'mode-code:verify', text: 'x', frontmatter: {} } as any);
  expect(w.events().filter((e: any) => e.kind === 'skill' && e.skill === 'mode-code:verify').length).toBe(1);
});

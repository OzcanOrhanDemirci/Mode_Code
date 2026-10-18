// SPDX-License-Identifier: Apache-2.0
/**
 * What the doctor reads in Claude Code's setup beyond its own (setup.ts): the files a hook needs, hooks that start a
 * model or need jq, broad allow rules, tool search turned off, MCP servers at no pinned version. Each with the
 * spellings people actually write, and the near misses that must stay quiet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broadRule, hookFiles, hookLine, startsModel, toolSearchOff, unpinnedServer, usesJq } from '../../src/app/doctor/setup.js';

const win = { home: 'C:/Users/ada', project: 'C:/work/app', platform: 'win32' };
const mac = { home: '/Users/ada', project: '/work/app', platform: 'darwin' };
const files = (line: string, o = win) => hookFiles({ command: line, args: [] }, o);

test('a hook line is the command and its arguments as one string', () => {
  assert.equal(hookLine({ command: 'node', args: ['a.js', '--x'] }), 'node a.js --x');
  assert.equal(hookLine({ command: 'node a.js', args: [] }), 'node a.js');
});

test('the files a hook needs: absolute, under the home folder or the project, quoted as the docs write them', () => {
  assert.deepEqual(files('node "C:/hooks/guard.js"'), ['C:/hooks/guard.js']);
  assert.deepEqual(files('node C:\\hooks\\guard.mjs --strict'), ['C:\\hooks\\guard.mjs']);
  assert.deepEqual(files('bash ~/hooks/fmt.sh'), ['C:/Users/ada/hooks/fmt.sh']);
  assert.deepEqual(files('bash $HOME/hooks/fmt.sh', mac), ['/Users/ada/hooks/fmt.sh']);
  assert.deepEqual(files('bash ${HOME}/hooks/fmt.sh', mac), ['/Users/ada/hooks/fmt.sh']);
  assert.deepEqual(files('"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-style.sh'), ['C:/work/app/.claude/hooks/check-style.sh']);
  assert.deepEqual(files('python3 ${CLAUDE_PROJECT_DIR}/.claude/hooks/lint.py', mac), ['/work/app/.claude/hooks/lint.py']);
  assert.deepEqual(files("python3 '/opt/hooks/lint.py'", mac), ['/opt/hooks/lint.py']);
  assert.deepEqual(hookFiles({ command: 'node', args: ['/c/tools/hook.js', '/c/tools/hook.js'] }, win), ['C:/tools/hook.js'], 'a Git Bash drive path, once');
  assert.deepEqual(files('pwsh -File D:/scripts/check.ps1'), ['D:/scripts/check.ps1']);
});

test('what the doctor cannot place is left out, so a working hook is never called dead', () => {
  for (const line of [
    'node ./hooks/guard.js',
    'node hooks/guard.js',
    'node ${CLAUDE_PLUGIN_ROOT}/hooks/run.js',
    'node "$CLAUDE_PLUGIN_ROOT/hooks/run.js"',
    'node --require=/x/pre.js app',
    'curl -s https://example.com/hook.sh',
    'jq -r .tool_input.command',
    '/usr/local/bin/notify',
    'node /tmp/hook.js',
    'node C:/hooks/README',
    '%USERPROFILE%\\hooks\\x.ps1',
  ])
    assert.deepEqual(files(line), [], line);
  assert.deepEqual(files('node /tmp/hook.js', mac), ['/tmp/hook.js'], 'outside Windows a POSIX path is placed');
  assert.deepEqual(files('$CLAUDE_PROJECT_DIRX/a.sh', mac), [], 'only the variable itself, not a longer name');
});

test('a hook that starts a model of its own: claude -p or --print, wherever claude lives', () => {
  for (const yes of [
    'claude -p "summarize"',
    'claude --print "x"',
    'claude --model haiku -p "x"',
    '/usr/local/bin/claude -p x',
    'C:\\tools\\claude.exe -p x',
    'cat log | claude.cmd --print',
    'claude -p',
  ])
    assert.equal(startsModel(yes), true, yes);
  for (const no of ['claude --version', 'claude-hooks -p x', 'myclaude -p x', 'claude -pv', 'echo claude', 'node claude.js -p'])
    assert.equal(startsModel(no), false, no);
});

test('a hook that needs jq, and the words that only look like it', () => {
  for (const yes of ['jq -r .x', 'cat | jq .x', 'x;jq .', 'a && jq .', '$(jq .x)', 'jq.exe -r .x', '`jq .x`']) assert.equal(usesJq(yes), true, yes);
  for (const no of ['jquery', 'node jq.js', 'echo jqx', 'gojq .x']) assert.equal(usesJq(no), false, no);
});

test('broad allow rules: everything, or every use of a program that deletes, sends or runs what it is given', () => {
  for (const yes of [
    'Bash',
    'PowerShell',
    'Bash(*)',
    'Bash( * )',
    'Bash()',
    'Bash(rm:*)',
    'Bash(rm -rf:*)',
    'Bash(curl *)',
    'Bash(sudo apt install *)',
    'Bash(git push:*)',
    'Bash(npx:*)',
    'Bash(node*)',
    'PowerShell(Remove-Item:*)',
    'Bash(python3:*)',
  ])
    assert.equal(broadRule(yes), true, yes);
  for (const no of [
    'Read',
    'WebFetch',
    'Bash(npm test)',
    'Bash(npm run build:*)',
    'Bash(node scripts/build.mjs)',
    'Bash(git status:*)',
    'Bash(rm build/out.txt)',
    'Bash(rmdir:*)',
    'Bash(curl https://example.com/a.json)',
    'Edit(*)',
  ])
    assert.equal(broadRule(no), false, no);
});

test("tool search off, as Claude Code's own code decides it", () => {
  assert.deepEqual(toolSearchOff({}), []);
  for (const v of ['false', '0', 'no', 'OFF', ' false ', 'auto:100', 'auto:150'])
    assert.deepEqual(toolSearchOff({ ENABLE_TOOL_SEARCH: v }), ['ENABLE_TOOL_SEARCH'], v);
  for (const v of ['true', 'auto', 'auto:10', 'auto:99', '1']) assert.deepEqual(toolSearchOff({ ENABLE_TOOL_SEARCH: v }), [], v);
  assert.deepEqual(toolSearchOff({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }), ['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS']);
  assert.deepEqual(toolSearchOff({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true' }), ['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS']);
  assert.deepEqual(toolSearchOff({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '0' }), []);
  assert.deepEqual(toolSearchOff({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1', ENABLE_TOOL_SEARCH: 'force' }), [], 'force wins');
  const proxy = 'https://llm-proxy.example.com/v1';
  assert.deepEqual(toolSearchOff({ ANTHROPIC_BASE_URL: proxy }), ['ANTHROPIC_BASE_URL']);
  assert.deepEqual(toolSearchOff({ ANTHROPIC_BASE_URL: proxy, ENABLE_TOOL_SEARCH: 'true' }), [], 'turned on for the proxy');
  assert.deepEqual(toolSearchOff({ ANTHROPIC_BASE_URL: proxy, CLAUDE_CODE_USE_BEDROCK: '1' }), [], "another provider's own rules");
  for (const ok of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://anthropic.com', 'not a url', ' '])
    assert.deepEqual(toolSearchOff({ ANTHROPIC_BASE_URL: ok }), [], ok);
  assert.deepEqual(toolSearchOff({ ANTHROPIC_BASE_URL: 'https://anthropic.com.example.net' }), ['ANTHROPIC_BASE_URL'], 'a look-alike host');
  assert.deepEqual(toolSearchOff({ ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'yes' }), [
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    'ENABLE_TOOL_SEARCH',
  ]);
});

test('MCP servers at no pinned version, and the pinned ones and the ones that cannot be read left alone', () => {
  for (const yes of [
    'npx -y @playwright/mcp@latest',
    'npx -y @playwright/mcp',
    'npx @upstash/context7-mcp',
    'cmd /c npx -y firebase-tools mcp',
    'pnpm dlx some-mcp',
    'bunx some-mcp',
    'uvx mcp-server-git',
    'npx --yes -q server',
    'docker run ghcr.io/x/y@latest',
  ])
    assert.equal(unpinnedServer(yes), true, yes);
  for (const no of [
    'npx -y @playwright/mcp@0.0.41',
    'npx -y firebase-tools@15.34.0 mcp',
    'uvx mcp-server-git@2.1.0',
    'uvx --from mcp-server-git==2.1.0 mcp-server-git',
    'node C:/mcp/server.js',
    'https://mcp.example.com/sse',
    'npx',
  ])
    assert.equal(unpinnedServer(no), false, no);
});

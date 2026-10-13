// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAutonomy, credentialPaths, type AutoEnv, type AutoVerdict } from '../../src/core/run-guard.js';

const HOME = '/home/ada';
const E: AutoEnv = {
  platform: 'linux',
  home: HOME,
  cwd: '/home/ada/api',
  env: { HOME, TMPDIR: '/tmp' },
  writable: ['/home/ada/api', '/tmp', '/tmp/terminal-code/runs/r1'],
  memoryDirs: ['/home/ada/notes'],
  credentials: credentialPaths(HOME, '/home/ada/.claude'),
  protectedBranches: ['main', 'master', 'release/*'],
  branch: 'run/rate-limit',
};
const bash = (command: string, env: AutoEnv = E, extra: Record<string, unknown> = {}) => checkAutonomy('Bash', { command, ...extra }, env);
const kind = (v: AutoVerdict) => (v.kind === 'allow' ? 'allow' : v.kind === 'defer' ? `defer:${v.defer}` : `refuse:${v.why}`);

test("everyday work runs: builds, tests, commits, pushes to the run's own branch, reads of GitHub", () => {
  for (const c of [
    'npm test',
    'npm run build && npm test',
    'git add -A && git commit -m "feat: limiter"',
    'git switch -c run/rate-limit',
    'git push -u origin run/rate-limit',
    'git push',
    'git push --dry-run origin main',
    'gh pr view 12',
    'gh pr checks',
    'gh run list --limit 5',
    'gh api repos/o/r/pulls',
    'gh --version',
    'cat src/limiter.ts | head -40',
    'rg -n "limit" src',
    'docker ps',
  ])
    assert.equal(kind(bash(c)), 'allow', c);
});

test('pushes that reach a protected branch, or whose branch is not known, wait for the person', () => {
  assert.equal(kind(bash('git push origin main')), 'defer:push');
  assert.equal(kind(bash('git push origin HEAD:release/2.0')), 'defer:push');
  assert.equal(kind(bash('git -C . push origin master')), 'defer:push');
  assert.equal(kind(bash('git push --all')), 'defer:push');
  assert.equal(kind(bash('git push', { ...E, branch: 'main' })), 'defer:push', 'a push that names no branch goes to the current one');
  assert.equal(kind(bash('git push', { ...E, branch: null })), 'defer:push', 'a detached head: the target is not known');
  assert.equal(kind(bash('git push origin v1.2.0:refs/tags/v1.2.0')), 'defer:release');
  assert.equal(kind(bash('git push --tags')), 'defer:release');
  const v = bash('git push origin main');
  assert.equal(v.kind === 'defer' ? v.reason : '', 'pushes to the protected branch main');
});

test('GitHub writes wait for the person, each with its own kind', () => {
  assert.equal(kind(bash('gh pr merge 12 --squash')), 'defer:merge');
  assert.equal(kind(bash('gh release create v1.0.0')), 'defer:release');
  assert.equal(kind(bash('gh repo edit --visibility public')), 'defer:repo');
  assert.equal(kind(bash('gh secret set TOKEN')), 'defer:repo');
  assert.equal(kind(bash('gh pr create --fill')), 'defer:outward');
  assert.equal(kind(bash('gh issue comment 3 --body hi')), 'defer:outward');
  assert.equal(kind(bash('gh api -X POST repos/o/r/issues')), 'defer:outward');
  assert.equal(kind(bash('gh api repos/o/r/issues -f title=x')), 'defer:outward');
  assert.equal(kind(bash('gh api --method=DELETE repos/o/r/git/refs/heads/x')), 'defer:outward');
  assert.equal(kind(bash('docker push ghcr.io/o/api:1')), 'defer:publish');
});

test('the sandbox escape hatch and credential files are refused', () => {
  assert.equal(kind(bash('npm test', E, { dangerouslyDisableSandbox: true })), 'refuse:sandbox-escape');
  assert.equal(kind(bash('npm test', E, { dangerouslyDisableSandbox: false })), 'allow');
  for (const c of [
    'cat ~/.ssh/id_ed25519',
    'cat /home/ada/.aws/credentials',
    'cp ~/.git-credentials /tmp/x',
    'grep token ~/.config/gh/hosts.yml',
    'base64 ~/.claude/.credentials.json',
    'cat $HOME/.netrc',
  ])
    assert.equal(kind(bash(c)), 'refuse:fence-read', c);
  // A project's own .npmrc is not the home folder's.
  assert.equal(kind(bash('cat .npmrc')), 'allow');
  assert.equal(kind(bash('cat ~/.npmrc')), 'refuse:fence-read');
  assert.equal(kind(checkAutonomy('Read', { file_path: '/home/ada/.ssh/config' }, E)), 'refuse:fence-read');
  assert.equal(kind(checkAutonomy('Read', { file_path: '/home/ada/api/src/x.ts' }, E)), 'allow');
  assert.equal(kind(checkAutonomy('Grep', { pattern: 'key', path: '/home/ada/.aws' }, E)), 'refuse:fence-read');
  assert.equal(kind(checkAutonomy('Glob', { pattern: '**/.ssh/*' }, E)), 'refuse:fence-read');
});

test("file tools write inside the project, the temporary folders and the run's folder only; memory folders never", () => {
  assert.equal(kind(checkAutonomy('Write', { file_path: '/home/ada/api/src/limiter.ts', content: '' }, E)), 'allow');
  assert.equal(kind(checkAutonomy('Edit', { file_path: 'src/limiter.ts', old_string: 'a', new_string: 'b' }, E)), 'allow');
  assert.equal(kind(checkAutonomy('Write', { file_path: '/tmp/terminal-code/runs/r1/plan.md', content: '' }, E)), 'allow');
  assert.equal(kind(checkAutonomy('Write', { file_path: '/home/ada/.bashrc', content: '' }, E)), 'refuse:fence-write');
  assert.equal(kind(checkAutonomy('Edit', { file_path: '../other/x.ts', old_string: 'a', new_string: 'b' }, E)), 'refuse:fence-write');
  assert.equal(
    kind(checkAutonomy('Write', { file_path: '/home/ada/api-old/x.ts', content: '' }, E)),
    'refuse:fence-write',
    'a folder whose name starts like the project is not the project',
  );
  assert.equal(kind(checkAutonomy('Write', { content: '' }, E)), 'refuse:fence-write');
  assert.equal(kind(checkAutonomy('NotebookEdit', { notebook_path: '/home/ada/notes/a.ipynb' }, E)), 'refuse:memory');
  assert.equal(kind(checkAutonomy('Write', { file_path: '/home/ada/notes/today.md', content: '' }, E)), 'refuse:memory');
  assert.equal(kind(bash('echo note >> /home/ada/notes/today.md')), 'refuse:memory');
  assert.equal(kind(bash('echo note >> /home/ada/notes/today.md', { ...E, memoryDirs: [] })), 'allow', 'without memory folders the sandbox alone decides');
});

test('tools: reads run, questions for the person are refused, outward tools wait, unknown tools are refused', () => {
  for (const t of ['Read', 'Glob', 'Grep', 'Agent', 'Workflow', 'WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch', 'Skill', 'TaskList', 'LSP'])
    assert.equal(kind(checkAutonomy(t, {}, E)), 'allow', t);
  for (const t of ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'SuggestPluginInstall', 'EndConversation'])
    assert.equal(kind(checkAutonomy(t, {}, E)), 'refuse:person-only', t);
  for (const t of ['PushNotification', 'SendUserFile', 'SendMessage', 'CronCreate', 'ScheduleWakeup', 'RemoteTrigger', 'EnterWorktree', 'PublishPlugin'])
    assert.equal(kind(checkAutonomy(t, {}, E)), 'defer:outward', t);
  assert.equal(kind(checkAutonomy('Artifact', { action: 'read', url: 'x' }, E)), 'allow');
  assert.equal(kind(checkAutonomy('Artifact', { action: 'publish', file_path: 'x.html' }, E)), 'defer:outward');
  assert.equal(kind(checkAutonomy('BrandNewTool', {}, E)), 'refuse:unknown-tool');
  assert.equal(kind(checkAutonomy('mcp__terminal-code__autonomy', { action: 'milestone' }, E)), 'allow');
});

test('MCP tools: only those whose names say they read run', () => {
  for (const t of [
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_thread',
    'mcp__claude_ai_Google_Calendar__list_events',
    'mcp__claude_ai_Google_Drive__read_file_content',
    'mcp__db__query',
  ])
    assert.equal(kind(checkAutonomy(t, {}, E)), 'allow', t);
  for (const t of [
    'mcp__claude_ai_Gmail__send_message',
    'mcp__claude_ai_Gmail__create_draft',
    'mcp__claude_ai_Google_Drive__trash_file',
    'mcp__x__get_or_create',
    'mcp__claude_ai_Google_Calendar__suggest_time',
    'mcp__x__run',
  ])
    assert.equal(kind(checkAutonomy(t, {}, E)), 'defer:mcp', t);
});

test("credential paths cover the home folder and Claude Code's own credentials", () => {
  const p = credentialPaths('/home/ada', '/custom/claude');
  for (const x of ['/home/ada/.ssh', '/home/ada/.aws', '/home/ada/.config/gh', '/home/ada/.netrc', '/home/ada/.npmrc', '/custom/claude/.credentials.json'])
    assert.ok(p.includes(x), x);
});

test('options that take a value are not the subcommand; cd is followed; a refusal says what it refused', () => {
  assert.equal(kind(bash('gh -R ada/api pr merge 3')), 'defer:merge');
  assert.equal(kind(bash('gh --repo ada/api pr view 3')), 'allow');
  assert.equal(kind(bash('gh api -X GET repos/o/r/pulls')), 'allow');
  assert.equal(kind(bash('gh')), 'allow');
  assert.equal(kind(bash('docker -H tcp://host:2375 push img:1')), 'defer:publish');
  assert.equal(kind(bash('docker --context prod image ls')), 'allow');
  assert.equal(kind(bash('cd ~ && cat .npmrc')), 'refuse:fence-read');
  assert.equal(kind(bash('cd /home/ada/api && cat .npmrc')), 'allow');
  assert.equal(kind(bash('cd "$DIR" && cat .npmrc')), 'allow', 'an unknown folder: only absolute paths can be placed');
  assert.equal(kind(bash('cd "$DIR" && cat /home/ada/.npmrc')), 'refuse:fence-read');
  const glob = checkAutonomy('Glob', { pattern: '**/.ssh/*' }, E);
  assert.deepEqual(glob, { kind: 'refuse', why: 'fence-read', detail: '**/.ssh/*' });
});

test('what is written out of a run-time value places it; cd with options, alone and up', () => {
  assert.equal(kind(bash('cat ~/.aws/$PROFILE')), 'refuse:fence-read');
  assert.equal(kind(bash('cat ~/.aws/profile-')), 'refuse:fence-read');
  assert.equal(kind(bash('cat $OUT/report.txt')), 'allow');
  assert.equal(kind(bash('cat "$OUT"')), 'allow');
  assert.equal(kind(bash('cd -P ~ && cat .npmrc')), 'refuse:fence-read');
  assert.equal(kind(bash('cd && cat .npmrc')), 'refuse:fence-read', 'cd alone goes home');
  assert.equal(kind(bash('cd .. && cat .npmrc')), 'refuse:fence-read', 'from /home/ada/api, up is home');
  assert.equal(kind(bash('gh -R ada/api -- pr merge 1')), 'defer:merge');
});

test('nothing works inside a credential folder', () => {
  assert.equal(kind(bash('cd ~ && cd .aws && ls -l')), 'refuse:fence-read');
  assert.equal(kind(bash('cd /home/ada/.config/gh')), 'refuse:fence-read');
  assert.equal(kind(bash('cd /home/ada/.config && ls')), 'allow');
});

// SPDX-License-Identifier: Apache-2.0
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall, decisionText } from '../../src/core/belt/evaluate.js';
import { effectiveVerdict, RULES } from '../../src/core/belt/rules.js';
import type { BeltContext, GitFacts, RuleConfig, Verdict } from '../../src/core/belt/types.js';

function fakeGit(o: { branch?: string | null; remote?: string | null; aliases?: Record<string, string> } = {}): GitFacts {
  return {
    currentBranch: async () => (o.branch === undefined ? 'feature' : o.branch),
    remoteUrl: async () => (o.remote === undefined ? 'https://github.com/ada/app.git' : o.remote),
    alias: async (_d, name) => o.aliases?.[name] ?? null,
  };
}

function win(over: Partial<BeltContext> = {}, config: RuleConfig = {}): BeltContext {
  return {
    platform: 'win32',
    home: 'C:/Users/ada',
    cwd: 'C:/dev/app',
    projectDir: 'C:/dev/app',
    env: { TEMP: 'C:/Users/ada/AppData/Local/Temp', APPDATA: 'C:/Users/ada/AppData/Roaming' },
    dataDir: 'C:/Users/ada/.mode-code',
    memoryDirs: ['C:/dev/mem/hafiza'],
    managedSettingsFiles: ['C:/Program Files/ClaudeCode/managed-settings.json'],
    lang: 'en',
    config,
    git: fakeGit(),
    fileSize: async () => 4000,
    ...over,
  };
}

function linux(over: Partial<BeltContext> = {}): BeltContext {
  return win({
    platform: 'linux',
    home: '/home/ada',
    cwd: '/home/ada/app',
    projectDir: '/home/ada/app',
    env: {},
    dataDir: '/home/ada/.mode-code',
    memoryDirs: [],
    managedSettingsFiles: ['/etc/claude-code/managed-settings.json'],
    ...over,
  });
}

async function verdict(command: string, ctx: BeltContext = win(), tool = 'Bash'): Promise<Verdict> {
  return (await evaluateToolCall(tool, { command }, ctx)).verdict;
}

async function rules(command: string, ctx: BeltContext = win(), tool = 'Bash'): Promise<string[]> {
  return (await evaluateToolCall(tool, { command }, ctx)).findings.map((f) => f.rule);
}

const cases = async (ctx: BeltContext, table: [string, Verdict][], tool = 'Bash') => {
  for (const [cmd, want] of table) assert.equal(await verdict(cmd, ctx, tool), want, `${tool}: ${cmd}`);
};

describe('git', () => {
  test('force pushes: protected branches denied, others asked', async () => {
    await cases(win(), [
      ['git push origin main --force', 'deny'],
      ['git push -f origin master', 'deny'],
      ['git push origin +main', 'deny'],
      ['git push origin HEAD:main -f', 'deny'],
      ['git push --force-with-lease origin feature', 'ask'],
      ['git push -fu origin feature', 'ask'],
      ['git push origin main', 'allow'],
      ['git push --dry-run -f origin main', 'allow'],
      ['git push -n -f origin main', 'allow'],
    ]);
  });

  test('the spellings permission rules miss are still caught', async () => {
    await cases(win(), [
      ['git -C . push --force origin main', 'deny'],
      ['git -c user.name=x --no-pager push origin main --force', 'deny'],
      ["g'i't push -f origin main", 'deny'],
      ['sudo env FOO=1 git push --force origin main', 'deny'],
      ['bash -c "git push --force origin main"', 'deny'],
      ['echo $(git push -f origin main)', 'deny'],
    ]);
  });

  test('implicit target is the current branch', async () => {
    assert.equal(await verdict('git push --force', win({ git: fakeGit({ branch: 'main' }) })), 'deny');
    assert.equal(await verdict('git push --force', win({ git: fakeGit({ branch: 'feature' }) })), 'ask');
    assert.equal(await verdict('git push --force', win({ git: fakeGit({ branch: null }) })), 'deny'); // unknown is not assumed safe
  });

  test('remote branch deletion, including the refspec form', async () => {
    await cases(win(), [
      ['git push origin :main', 'deny'],
      ['git push origin :feature', 'ask'],
      ['git push origin --delete main', 'deny'],
      ['git push -d origin feature', 'ask'],
      ['git push --mirror', 'deny'],
      ['git push --prune origin', 'ask'],
    ]);
  });

  test('PR-only and single-branch repositories', async () => {
    const pr = win({}, { prOnlyRepos: ['github.com/ada/app'] });
    assert.equal(await verdict('git push origin main', pr), 'deny');
    assert.equal(await verdict('git push origin feature', pr), 'allow');
    assert.deepEqual(await rules('git push origin main', pr), ['git.push-pr-only']);
    const single = win({}, { singleBranchRepos: ['github.com/ada/app'] });
    assert.equal(await verdict('git checkout -b wip', single), 'deny');
    assert.equal(await verdict('git switch -c wip', single), 'deny');
    assert.equal(await verdict('git branch wip', single), 'deny');
    assert.equal(await verdict('git branch --list', single), 'allow');
  });

  test('other git rules', async () => {
    await cases(win(), [
      ['git branch -D feature', 'ask'],
      ['git branch -d feature', 'allow'],
      ['git reset --hard HEAD~1', 'warn'],
      ['git clean -fdx', 'ask'],
      ['git clean -n', 'allow'],
      ['git config core.hooksPath /tmp/hooks', 'deny'],
      ['git config --get core.hooksPath', 'allow'],
      ['git -c core.hooksPath=/tmp/x commit -m x', 'deny'],
      ['git commit --no-verify -m wip', 'warn'],
      ['git add .env', 'ask'],
      ['git add src/app.ts', 'allow'],
      ['git filter-repo --path secrets --invert-paths', 'ask'],
      ['git status', 'allow'],
    ]);
  });

  test('aliases are expanded', async () => {
    const ctx = win({ git: fakeGit({ branch: 'feature', aliases: { p: 'push --force', nuke: '!rm -rf ~' } }) });
    assert.equal(await verdict('git p origin main', ctx), 'deny');
    assert.equal(await verdict('git nuke', ctx), 'deny');
  });

  test('history of the memory repository is protected', async () => {
    const ctx = win({ cwd: 'C:/dev/mem/hafiza' });
    await cases(ctx, [
      ['git reset --hard HEAD~3', 'deny'],
      ['git push --force', 'deny'],
      ['git rebase -i HEAD~2', 'deny'],
      ['git rm old.md', 'deny'],
      ['git commit -m note', 'allow'],
      ['git push', 'allow'],
    ]);
  });
});

describe('filesystem', () => {
  test('critical paths are denied in every spelling', async () => {
    await cases(win(), [
      ['rm -rf ~', 'deny'],
      ['rm -rf ~/', 'deny'],
      ['rm -rf /', 'deny'],
      ['rm -rf /*', 'deny'],
      ['rm -rf C:/', 'deny'],
      ['rm -rf ~/*', 'deny'],
      ['rm -rf "$HOME"', 'deny'],
      ['rm -rf ~/Documents', 'deny'],
      ['rm -rf /c/Users', 'deny'],
      ['rm -rf ~/.claude', 'deny'],
      ['rm ~/.claude/settings.json', 'deny'],
      ['rm -rf C:/dev/mem', 'deny'], // contains the memory folder
      ['rm -rf .', 'deny'], // the project itself
      ['rm -rf *', 'deny'],
      ['cd ~ && rm -rf *', 'deny'],
      ['rm -rf C:/Windows/System32', 'deny'],
    ]);
  });

  test('normal work inside the project and in temp folders is allowed', async () => {
    await cases(win(), [
      ['rm -rf node_modules dist', 'allow'],
      ['rm -rf ./build/*', 'allow'],
      ['rm src/old.ts', 'allow'],
      ['rm -rf C:/Users/ada/AppData/Local/Temp/x', 'allow'],
      ['rm -rf "$TEMP/cache"', 'allow'],
      ['cd "$TEMP" && rm -rf *', 'allow'],
      ['find . -name "*.log" -delete', 'allow'],
    ]);
    assert.equal(await verdict('cd /tmp && rm -rf *', linux()), 'allow');
  });

  test('outside the project, git history and unknown targets ask', async () => {
    await cases(win(), [
      ['rm -rf ../other-project', 'ask'],
      ['rm -rf .git', 'ask'],
      ['rm -rf "$SOME_DIR"', 'ask'],
      ['find ~ -name "*.tmp" -delete', 'ask'],
      ['find ~ -delete', 'deny'],
      ['rm -rf ~/.claude/skills/old', 'ask'],
    ]);
  });

  test('PowerShell and cmd deletions', async () => {
    await cases(
      win(),
      [
        ['Remove-Item -Recurse -Force C:\\Users\\ada', 'deny'],
        ['rm -r $env:USERPROFILE\\Desktop', 'deny'],
        ['ri C:\\scratch -r', 'ask'],
        ['Remove-Item -Path C:\\dev\\app\\dist -Recurse', 'allow'],
        ['Remove-Item C:\\Users\\ada -Recurse -WhatIf', 'allow'],
        ["[System.IO.Directory]::Delete('C:\\Users\\ada\\.claude', $true)", 'deny'],
      ],
      'PowerShell',
    );
    await cases(win(), [
      ['cmd /c "rd /s /q C:\\Users\\ada\\Desktop"', 'deny'],
      ['cmd /c del /s /q C:\\scratch\\*', 'ask'],
    ]);
  });

  test('moving critical paths and memory files', async () => {
    await cases(win(), [
      ['mv ~/.claude ~/claude-old', 'deny'],
      ['mv C:/dev/mem/hafiza/a.md C:/dev/mem/hafiza/arsiv/a.md', 'allow'],
      ['mv C:/dev/mem/hafiza/a.md C:/Users/ada/a.md', 'deny'],
      ['rm C:/dev/mem/hafiza/x.md', 'deny'],
    ]);
  });

  test('disks', async () => {
    await cases(linux(), [
      ['dd if=/dev/zero of=/dev/sda bs=1M', 'deny'],
      ['dd if=/dev/zero of=./disk.img bs=1M count=10', 'allow'],
      ['mkfs.ext4 /dev/sdb1', 'deny'],
      ['sudo wipefs -a /dev/sdb', 'deny'],
    ]);
    assert.equal(await verdict('cmd /c format D: /q'), 'deny');
  });
});

describe('self-protection and configuration', () => {
  test('Claude Code settings and the tool files', async () => {
    await cases(win(), [
      ['echo {} > ~/.claude/settings.json', 'deny'],
      ['cp x.json C:/Users/ada/.claude/settings.local.json', 'deny'],
      ['echo x >> ~/.claude.json', 'deny'],
      ['rm -rf ~/.mode-code', 'deny'],
      ['echo x > .claude/settings.local.json', 'ask'],
      ['tee .mcp.json < servers.json', 'ask'],
      ['sed -i "s/a/b/" ~/.claude/settings.json', 'deny'],
      ['cat ~/.claude/settings.json', 'allow'],
      ['grep disableAllHooks ~/.claude/settings.json', 'allow'],
    ]);
    assert.equal(await verdict("Set-Content -Path $env:USERPROFILE\\.claude\\settings.json -Value '{}'", win(), 'PowerShell'), 'deny');
    assert.equal(await verdict('[System.IO.File]::WriteAllText("C:\\Users\\ada\\.claude\\settings.json", "{}")', win(), 'PowerShell'), 'deny');
  });

  test('turning hooks off is denied wherever it is written', async () => {
    assert.ok((await rules(`echo '{"disableAllHooks": true}' > .claude/settings.local.json`)).includes('self.disable-hooks'));
    const d = await evaluateToolCall('Write', { file_path: 'C:/dev/app/.claude/settings.json', content: '{ "disableAllHooks": true }' }, win());
    assert.equal(d.verdict, 'deny');
    const e = await evaluateToolCall('Edit', { file_path: 'C:/dev/app/x.json', old_string: 'a', new_string: '"disableAllHooks": true' }, win());
    assert.equal(e.verdict, 'deny');
  });

  test('the plugin, nested sessions and Claude configuration commands', async () => {
    await cases(win(), [
      ['claude plugin disable mode-code', 'deny'],
      ['claude plugin uninstall mode-code@mode-code-local', 'deny'],
      ['claude plugin marketplace remove mode-code-local', 'deny'],
      ['claude plugin install some-plugin@x', 'ask'],
      ['claude mcp add docs -- npx docs-server', 'ask'],
      ['claude mcp list', 'allow'],
      ['claude --bare -p "do it"', 'deny'],
      ['claude --setting-sources project -p x', 'deny'],
      [`claude -p x --settings '{"disableAllHooks":true}'`, 'deny'],
      ['claude -p "summarise the diff"', 'allow'],
      ['claude update', 'ask'],
    ]);
  });

  test('file tools: memory shrink is measured, settings are guarded', async () => {
    const shrink = await evaluateToolCall('Write', { file_path: 'C:/dev/mem/hafiza/notes.md', content: 'x'.repeat(100) }, win());
    assert.equal(shrink.verdict, 'ask');
    assert.deepEqual(
      shrink.findings.map((f) => f.rule),
      ['self.memory-shrink'],
    );
    const grow = await evaluateToolCall('Write', { file_path: 'C:/dev/mem/hafiza/notes.md', content: 'x'.repeat(3000) }, win());
    assert.equal(grow.verdict, 'allow');
    const edit = await evaluateToolCall('Edit', { file_path: 'C:/dev/mem/hafiza/notes.md', old_string: 'y'.repeat(2000), new_string: 'z' }, win());
    assert.equal(edit.verdict, 'ask');
    assert.equal(
      (await evaluateToolCall('Edit', { file_path: 'C:/Users/ada/.claude/settings.json', old_string: 'a', new_string: 'b' }, win())).verdict,
      'deny',
    );
    assert.equal((await evaluateToolCall('Write', { file_path: 'C:/Users/ada/.mode-code/config.json', content: '{}' }, win())).verdict, 'deny');
    assert.equal((await evaluateToolCall('Write', { file_path: 'C:/dev/app/src/index.ts', content: 'x' }, win())).verdict, 'allow');
    assert.equal((await evaluateToolCall('Write', { file_path: 'C:/Users/ada/.bashrc', content: 'x' }, win())).verdict, 'ask');
  });
});

describe('persistence, publishing, docker, inline code, uncertainty', () => {
  test('persistence', async () => {
    await cases(win(), [
      ['schtasks /create /tn x /tr calc.exe /sc onlogon', 'ask'],
      ['crontab -l', 'allow'],
      ['crontab mycron.txt', 'ask'],
      ['reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x /d y', 'ask'],
      ['echo ssh-ed25519 AAAA >> ~/.ssh/authorized_keys', 'deny'],
      ['cp run.sh ~/.config/autostart/run.desktop', 'ask'],
      ['echo "alias x=y" >> ~/.zshrc', 'ask'],
    ]);
    await cases(linux(), [
      ['launchctl load ~/Library/LaunchAgents/x.plist', 'ask'],
      ['systemctl --user enable x.service', 'ask'],
      ['systemctl status x', 'allow'],
    ]);
  });

  test('publishing and deploying ask', async () => {
    await cases(win(), [
      ['npm publish', 'ask'],
      ['npm install', 'allow'],
      ['gh repo create app --public', 'ask'],
      ['gh repo edit --visibility public', 'ask'],
      ['gh repo create app --private', 'allow'],
      ['gh release create v1.0.0', 'ask'],
      ['firebase deploy --only functions', 'ask'],
      ['npx wrangler deploy', 'ask'], // a package runner runs the package's program: the same as wrangler deploy
      ['wrangler deploy', 'ask'],
      ['terraform plan', 'allow'],
      ['terraform apply', 'ask'],
    ]);
  });

  test('docker volume pack is off by default', async () => {
    assert.equal(await verdict('docker volume prune -f'), 'allow');
    const on = win({}, { packs: { dockerVolumes: true } });
    await cases(on, [
      ['docker volume prune -f', 'deny'],
      ['docker compose down -v', 'deny'],
      ['docker system prune -a', 'deny'],
      ['docker compose down', 'allow'],
      ['docker run --rm alpine echo hi', 'allow'],
    ]);
  });

  test('inline interpreter code is checked as best effort', async () => {
    assert.equal(await verdict(`node -e "require('child_process').execSync('git push --force origin main')"`), 'deny');
    assert.equal(await verdict(`python -c "import shutil; shutil.rmtree('C:/Users/ada')"`), 'deny');
    assert.equal(await verdict(`node -e "console.log(1+1)"`), 'allow');
  });

  test('a secret written into a source file gets a note; into .env it does not', async () => {
    const token = 'ghp' + '_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY2z4c';
    const src = await evaluateToolCall('Write', { file_path: 'C:/dev/app/src/config.ts', content: `export const T = "${token}"` }, win());
    assert.equal(src.verdict, 'warn');
    assert.deepEqual(
      src.findings.map((f) => f.rule),
      ['secrets.write'],
    );
    assert.ok(!src.findings[0]!.reason.includes(token));
    const env = await evaluateToolCall('Write', { file_path: 'C:/dev/app/.env', content: `GITHUB_TOKEN=${token}` }, win());
    assert.equal(env.verdict, 'allow');
  });

  test('what cannot be followed is asked about', async () => {
    await cases(win(), [
      ['eval "$CMD"', 'ask'],
      ['$X -rf /', 'ask'],
      ['bash -c "$SCRIPT"', 'ask'],
      ['"$JAVA_HOME/bin/java" -version', 'allow'],
      ['echo "unterminated', 'allow'],
      ['rm -rf "unterminated', 'ask'],
    ]);
  });
});

describe('catalog and configuration', () => {
  test('locked rules cannot be disabled or weakened', () => {
    assert.equal(effectiveVerdict('self.claude-settings', { disabled: ['self.claude-settings'] }), 'deny');
    assert.equal(effectiveVerdict('self.claude-settings', { verdicts: { 'self.claude-settings': 'warn' } }), 'deny');
    assert.equal(effectiveVerdict('git.force-push', { disabled: ['git.force-push'] }), null);
    assert.equal(effectiveVerdict('git.force-push', { verdicts: { 'git.force-push': 'deny' } }), 'deny');
    assert.equal(effectiveVerdict('git.discard-work', { verdicts: { 'git.discard-work': 'ask' } }), 'ask');
    for (const r of Object.values(RULES)) if (r.category === 'self') assert.ok(r.locked, r.id);
  });

  test('a disabled rule no longer fires', async () => {
    assert.equal(await verdict('git push -f origin feature', win({}, { disabled: ['git.force-push'] })), 'allow');
  });

  test("the decision text is in the person's language and says not to work around it", async () => {
    const d = await evaluateToolCall('Bash', { command: 'rm -rf ~' }, win({ lang: 'tr' }));
    const text = decisionText(d, { lang: 'tr' });
    assert.match(text, /Emniyet kemeri engelledi/);
    assert.match(text, /dolanmaya çalışma/);
    assert.match(text, /\[fs\.delete-critical\]/);
    assert.match(decisionText(d, { lang: 'tr' }, { repeatCount: 3 }), /3 denemeyi engelledi/);
  });
});

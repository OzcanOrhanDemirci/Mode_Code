// SPDX-License-Identifier: Apache-2.0
/**
 * Two older guards, folded into the belt (decided with the person, 2026-10-15): the permission lists an
 * unattended-automation setup kept in Claude Code's managed settings (42 deny and 36 ask rules, every one
 * written for both the Bash and the PowerShell tool), and the command guards of a memory system's own hooks.
 * One system instead of three: each of their rules has a sample here, and the belt must ask or block it.
 * Where the belt asks what a list blocked (deleting a branch, overwriting Firebase data), the person can now
 * approve it; that was the point. Where the old patterns missed a spelling, the belt does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { BeltContext, Verdict } from '../../src/core/belt/types.js';

function ctx(over: Partial<BeltContext> = {}): BeltContext {
  return {
    platform: 'win32',
    home: 'C:/Users/ada',
    cwd: 'C:/dev/app',
    projectDir: 'C:/dev/app',
    env: { TEMP: 'C:/Users/ada/AppData/Local/Temp' },
    dataDir: 'C:/Users/ada/.mode-code',
    memoryDirs: [],
    managedSettingsFiles: ['C:/Program Files/ClaudeCode/managed-settings.json'],
    lang: 'en',
    config: {
      prOnlyRepos: ['github.com/ada/game'],
      singleBranchRepos: ['github.com/ada/car'],
      packs: { dockerVolumes: true },
    },
    git: { currentBranch: async () => 'feature', remoteUrl: async () => 'https://github.com/ada/app.git', alias: async () => null },
    ...over,
  };
}

/** [the old rule as written, a command it was meant to catch, what the belt does now]. */
const COMMANDS: [string, string, Verdict][] = [
  // deny, git
  ['git push --force*', 'git push --force origin feature', 'ask'],
  ['git push --force*', 'git push --force origin main', 'deny'],
  ['git push -f*', 'git push -f origin feature', 'ask'],
  ['git push * --force*', 'git push origin feature --force', 'ask'],
  ['git push * -f*', 'git push origin feature -f', 'ask'],
  ['git push * +*', 'git push origin +feature', 'ask'],
  ['git push --delete*', 'git push --delete origin old', 'ask'],
  ['git push -d *', 'git push -d origin old', 'ask'],
  ['git push * --delete*', 'git push origin --delete old', 'ask'],
  ['git push * -d *', 'git push origin -d old', 'ask'],
  ['git branch -D*', 'git branch -D old', 'ask'],
  ['git branch --delete --force*', 'git branch --delete --force old', 'ask'],
  // deny, Firebase data
  ['firebase firestore:delete*', 'firebase firestore:delete /users --recursive', 'deny'],
  ['npx firebase firestore:delete*', 'npx firebase firestore:delete /users --recursive', 'deny'],
  ['firebase database:remove*', 'firebase database:remove /orders', 'deny'],
  ['npx firebase database:remove*', 'npx firebase database:remove /orders', 'deny'],
  ['firebase database:set*', 'firebase database:set /config config.json', 'ask'],
  ['npx firebase database:set*', 'npx firebase database:set /config config.json', 'ask'],
  ['firebase database:update*', 'firebase database:update /config patch.json', 'ask'],
  ['npx firebase database:update*', 'npx firebase database:update /config patch.json', 'ask'],
  ['firebase database:push*', 'firebase database:push /log entry.json', 'ask'],
  ['npx firebase database:push*', 'npx firebase database:push /log entry.json', 'ask'],
  // ask, deployments and stores
  ['firebase deploy*', 'firebase deploy --only hosting', 'ask'],
  ['npx firebase deploy*', 'npx firebase deploy --only functions', 'ask'],
  ['wrangler deploy*', 'wrangler deploy', 'ask'],
  ['npx wrangler deploy*', 'npx wrangler deploy', 'ask'],
  ['wrangler publish*', 'wrangler publish', 'ask'],
  ['npx wrangler publish*', 'npx wrangler publish', 'ask'],
  ['wrangler secret*', 'wrangler secret put API_TOKEN', 'ask'],
  ['npx wrangler secret*', 'npx wrangler secret put API_TOKEN', 'ask'],
  ['wrangler kv*', 'wrangler kv key put --binding=CACHE k v', 'ask'],
  ['npx wrangler kv*', 'npx wrangler kv key put --binding=CACHE k v', 'ask'],
  ['flutter pub publish*', 'flutter pub publish', 'ask'],
  ['dart pub publish*', 'dart pub publish', 'ask'],
  ['*gradlew*publish*', './gradlew publish', 'ask'],
  ['*fastlane*', 'fastlane ios release', 'ask'],
  // the memory system's command guards
  ['docker-volume-delete', 'docker volume prune -f', 'deny'],
  ['docker-volume-delete', 'docker system prune -a', 'deny'],
  ['docker-volume-delete', 'docker compose down -v', 'deny'],
  ['docker-volume-delete', 'docker rm -v api', 'deny'],
];

/** The ask list's connected-service tools. */
const TOOLS: [string, Verdict][] = [
  ['mcp__claude_ai_Gmail__send_message', 'ask'],
  ['mcp__claude_ai_Gmail__reply', 'ask'],
  ['mcp__claude_ai_Gmail__forward', 'ask'],
  ['mcp__claude_ai_Google_Drive__share_file', 'ask'],
  ['mcp__claude_ai_Google_Calendar__create_event', 'ask'],
  ['mcp__claude_ai_Google_Calendar__update_event', 'ask'],
  ['mcp__claude_ai_Google_Calendar__delete_event', 'ask'],
  ['mcp__claude_ai_Google_Calendar__respond_to_event', 'ask'],
];

test('every deny and ask rule of the automation lists is asked or blocked by the belt, in Bash and in PowerShell', async () => {
  const rules = new Set<string>();
  for (const [rule, command, want] of COMMANDS) {
    rules.add(rule);
    for (const tool of ['Bash', 'PowerShell']) {
      const d = await evaluateToolCall(tool, { command }, ctx());
      assert.equal(d.verdict, want, `${tool}(${rule}): ${command} → ${d.findings.map((f) => f.rule).join(', ')}`);
    }
  }
  for (const [tool, want] of TOOLS) {
    rules.add(tool);
    assert.equal((await evaluateToolCall(tool, {}, ctx())).verdict, want, tool);
  }
  // 35 command patterns, each written for Bash and for PowerShell (70 entries), and 8 tools make the 78; the
  // memory system's Docker guard comes on top.
  assert.equal(rules.size, 35 + 8 + 1, 'every old rule has a sample');
});

test("the memory system's git guards: pull-request-only repositories and single-branch ones", async () => {
  const game = ctx({ git: { currentBranch: async () => 'main', remoteUrl: async () => 'https://github.com/ada/game.git', alias: async () => null } });
  assert.equal((await evaluateToolCall('Bash', { command: 'git push origin main' }, game)).verdict, 'deny');
  assert.equal((await evaluateToolCall('Bash', { command: 'git push' }, game)).verdict, 'deny', 'the current branch, main');
  assert.equal((await evaluateToolCall('Bash', { command: 'git push origin feature' }, game)).verdict, 'allow');
  const car = ctx({ git: { currentBranch: async () => 'main', remoteUrl: async () => 'git@github.com:ada/car.git', alias: async () => null } });
  assert.equal((await evaluateToolCall('Bash', { command: 'git switch -c idea' }, car)).verdict, 'deny');
  assert.equal((await evaluateToolCall('Bash', { command: 'git checkout -b idea' }, car)).verdict, 'deny');
});

test('what the old patterns let through, the belt does not', async () => {
  // A colon refspec deletes a remote branch; `-C` before push slipped past `git push --force*`.
  assert.equal((await evaluateToolCall('Bash', { command: 'git push origin :old' }, ctx())).verdict, 'ask');
  assert.equal((await evaluateToolCall('Bash', { command: 'git -C . push --force origin main' }, ctx())).verdict, 'deny');
  assert.equal((await evaluateToolCall('PowerShell', { command: 'git -c core.x=1 push origin --delete old' }, ctx())).verdict, 'ask');
});

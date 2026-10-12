// SPDX-License-Identifier: Apache-2.0
// A stand-in for the `claude` command in process tests. It answers the commands terminal-code runs
// (--version, plugin list/install/enable/uninstall, plugin marketplace remove) from a JSON state file
// named by FAKE_CLAUDE_STATE, and records every call there. It never contacts anything.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.env.FAKE_CLAUDE_STATE;
const state = (() => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { version: '2.1.296', plugins: [], calls: [] };
  }
})();
const args = process.argv.slice(2);
state.calls.push(args);
const a = args.join(' ');
let code = 0;
if (a === '--version') process.stdout.write(`${state.version} (Claude Code)\n`);
else if (a.startsWith('plugin list')) process.stdout.write(JSON.stringify(state.plugins) + '\n');
else if (a.startsWith('plugin install')) {
  const id = `${args[2]}@terminal-code-local`;
  state.plugins = [...state.plugins.filter((p) => p.id !== id), { id, enabled: true, version: state.pluginVersion ?? 'dev', scope: 'user' }];
  process.stdout.write(`Installed ${id}\n`);
} else if (a.startsWith('plugin enable')) {
  const p = state.plugins.find((x) => x.id === args[2]);
  if (p) p.enabled = true;
  else code = 1;
} else if (a.startsWith('plugin uninstall')) {
  const before = state.plugins.length;
  state.plugins = state.plugins.filter((p) => p.id !== args[2]);
  if (before === state.plugins.length) {
    process.stderr.write(`Plugin "${args[2]}" is not installed\n`);
    code = 1;
  }
} else if (a.startsWith('plugin marketplace remove')) process.stdout.write('Removed\n');
else {
  process.stderr.write(`fake claude: unknown command: ${a}\n`);
  code = 1;
}
if (file) writeFileSync(file, JSON.stringify(state, null, 2));
process.exit(code);

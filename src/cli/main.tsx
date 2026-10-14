// SPDX-License-Identifier: Apache-2.0
/**
 * Entry point of the `mode-code` command. With no command in a terminal it opens the control center;
 * piped or in CI it prints the status instead, so it never hangs waiting for keys that will not come.
 */
import { APP_NAME, APP_VERSION } from '../core/app.js';
import { tIn } from '../core/i18n/index.js';
import { appContext } from '../app/context.js';
import { parseArgs, flag } from './args.js';
import { setColor } from './style.js';
import {
  cmdBelt,
  cmdConfig,
  cmdInstall,
  cmdQuota,
  cmdSecrets,
  cmdSessions,
  cmdStatus,
  cmdTokens,
  cmdReport,
  cmdTemplate,
  cmdTry,
  cmdUninstall,
  helpText,
  cmdFlow,
  cmdAutonomy,
} from './commands.js';
import { runControlCenter } from '../tui/run.js';
import { cmdDoctor } from './doctor.js';
import { cmdMemory, cmdMorning } from './memory.js';
import { cmdSync } from './sync.js';

const MIN_NODE = [22, 13];

async function main(argv: string[]): Promise<number> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map((x) => parseInt(x, 10));
  if (major < MIN_NODE[0]! || (major === MIN_NODE[0] && minor < MIN_NODE[1]!)) {
    process.stderr.write(`${APP_NAME} needs Node.js ${MIN_NODE.join('.')} or newer; this is ${process.versions.node}.\n`);
    return 1;
  }
  const a = parseArgs(argv);
  if (flag(a, 'no-color', 'plain')) setColor(false);
  const [cmd, ...rest] = a.positionals;
  const sub = { ...a, positionals: rest };
  if (flag(a, 'version', 'v') && !cmd) {
    process.stdout.write(`${APP_VERSION}\n`);
    return 0;
  }
  if (flag(a, 'help', 'h') || cmd === 'help') {
    process.stdout.write(helpText(appContext().lang) + '\n');
    return 0;
  }
  switch (cmd) {
    case undefined:
      if (process.stdout.isTTY && process.stdin.isTTY) return runControlCenter({ address: null, plain: flag(a, 'plain') });
      return cmdStatus(sub);
    case 'open':
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        process.stderr.write(tIn(appContext().lang, 'tui.needsTerminal') + '\n');
        return 2;
      }
      return runControlCenter({ address: rest[0] ?? null, plain: flag(a, 'plain') });
    case 'status':
      return cmdStatus(sub);
    case 'doctor':
      return cmdDoctor(sub);
    case 'install':
      return cmdInstall(sub);
    case 'try':
      return cmdTry(sub);
    case 'uninstall':
      return cmdUninstall(sub);
    case 'quota':
      return cmdQuota(sub);
    case 'tokens':
      return cmdTokens(sub);
    case 'template':
    case 'templates':
      return cmdTemplate(sub);
    case 'report':
      return cmdReport(sub);
    case 'sessions':
      return cmdSessions(sub);
    case 'flow':
    case 'flows':
      return cmdFlow(sub);
    case 'autonomy':
      return cmdAutonomy(sub);
    case 'memory':
      return cmdMemory(sub);
    case 'morning':
      return cmdMorning(sub);
    case 'sync':
      return cmdSync(sub);
    case 'belt':
      return cmdBelt(sub);
    case 'secrets':
      return cmdSecrets(sub);
    case 'config':
      return cmdConfig(sub);
    case 'version':
      process.stdout.write(`${APP_VERSION}\n`);
      return 0;
    default:
      process.stderr.write(tIn(appContext().lang, 'cli.unknownCommand', { cmd }) + '\n');
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${APP_NAME}: ${(err as Error)?.stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);

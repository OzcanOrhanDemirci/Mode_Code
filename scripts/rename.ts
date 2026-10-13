// SPDX-License-Identifier: Apache-2.0
/**
 * Renames the tool in one pass: every spelling of its name in every tracked file (`terminal-code`,
 * `TERMINAL_CODE`, `TerminalCode`, `terminalCode`), the display name, the repository's address, and the
 * notices that call the name temporary. The old name is recorded in PREVIOUS_NAMES (src/core/app.ts), so the
 * renamed tool's installer moves an installation made under it, and a line in the changelog says so.
 * Nothing is written without --apply, and --apply needs a clean work tree: the rename is one commit.
 *
 * Usage: node --import tsx scripts/rename.ts --to <id> [--name <display name>] [--repo <owner/name>] [--not-final] [--apply]
 *   --to         the new id: lower case, digits and single hyphens (npm package, command, data folder)
 *   --name       the name the interface shows (default: the id)
 *   --repo       the GitHub repository's new owner/name (default: the same owner, the new id)
 *   --not-final  keep calling the name temporary
 * Rehearsed by scripts/rename-rehearsal.mjs; see docs/release.md, "Renaming".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { firstShortName } from '../src/core/paths.js';

export interface Names {
  id: string;
  name: string;
  /** owner/name of the GitHub repository. */
  repo: string;
}

export interface RenamePlan {
  from: Names;
  to: Names;
  /** The new name is the final one: the "temporary" notices go. */
  final: boolean;
}

/** Why an id cannot be the tool's name, or null. */
export function badId(id: string, current: string): string | null {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) return 'lower case letters, digits and single hyphens, starting with a letter';
  if (id.length < 2 || id.length > 40) return 'between 2 and 40 characters';
  if (/^claude|^anthropic/.test(id)) return 'names starting with "claude" or "anthropic" belong to Anthropic (TRADEMARK.md)';
  if (id === current) return 'that is the current name';
  return null;
}

/** The spellings of a kebab-case id: as is, CONSTANT_CASE, PascalCase, camelCase. */
export function spellings(id: string): { kebab: string; upper: string; pascal: string; camel: string } {
  const words = id.split('-');
  const pascal = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return { kebab: id, upper: words.join('_').toUpperCase(), pascal, camel: pascal[0]!.toLowerCase() + pascal.slice(1) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A kebab-case `id` written in the case of `like`, another id as some text spells it: lower, UPPER, or with
 * capitals where `like` has them (tests spell the data folder `.Terminal-Code` on purpose).
 */
export function shaped(id: string, like: string): string {
  if (like === like.toLowerCase()) return id;
  if (like === like.toUpperCase()) return id.toUpperCase();
  const capital = like.split('-').map((w) => !!w[0] && w[0] === w[0].toUpperCase());
  return id
    .split('-')
    .map((w, i) => (capital[Math.min(i, capital.length - 1)] ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join('-');
}

/** The letters before `~1` in the short name Windows gives the data folder `.<id>`: `TERMIN` for terminal-code. */
export function shortStem(id: string): string {
  return firstShortName(`.${id}`).replace(/~1$/, '');
}

/** Every spelling of the old name replaced with the new one's, and the repository's address. Pure. */
export function renameText(text: string, plan: RenamePlan): { text: string; count: number } {
  const a = spellings(plan.from.id);
  const b = spellings(plan.to.id);
  let count = 0;
  let out = text;
  // The repository first: its old address holds the old id, which the next steps would turn into the new id under the old owner.
  if (plan.from.repo !== plan.to.repo) out = out.replace(new RegExp(`(?<![\\w-])${escape(plan.from.repo)}(?![\\w-])`, 'g'), () => (count++, plan.to.repo));
  out = out.replace(new RegExp(escape(a.kebab), 'gi'), (m) => (count++, shaped(b.kebab, m)));
  for (const [x, y] of [
    [a.upper, b.upper],
    [a.pascal, b.pascal],
    [a.camel, b.camel],
  ] as const)
    out = out.replace(new RegExp(escape(x), 'g'), () => (count++, y));
  // The data folder's 8.3 short name, as tests and documents write it (`TERMIN~1`).
  const [sa, sb] = [shortStem(plan.from.id), shortStem(plan.to.id)];
  if (sa !== sb) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escape(sa)}~(?=\\d)`, 'gi'), (m) => (count++, `${m === m.toLowerCase() ? sb.toLowerCase() : sb}~`));
    // The form Windows falls back to after a few clashes: two letters of the name, four hex digits of a hash.
    if (sa.slice(0, 2) !== sb.slice(0, 2))
      out = out.replace(
        new RegExp(`(?<![A-Za-z0-9])${escape(sa.slice(0, 2))}([0-9A-F]{4})~(?=\\d)`, 'g'),
        (_, hash: string) => (count++, `${sb.slice(0, 2)}${hash}~`),
      );
  }
  return { text: out, count };
}

/** The statement that declares PREVIOUS_NAMES, with its value. */
const PREVIOUS = /export const PREVIOUS_NAMES: readonly \{ readonly id: string; readonly name: string \}\[\] = (\[[^;]*\]);/;

/**
 * src/core/app.ts renamed: the old name first in PREVIOUS_NAMES (whose earlier entries are kept as they
 * were, never renamed), the display name, and whether the name is final. Pure.
 */
export function renameApp(text: string, plan: RenamePlan): { text: string; count: number } {
  const m = PREVIOUS.exec(text);
  if (!m) throw new Error('src/core/app.ts: PREVIOUS_NAMES not found');
  // The list as JSON: its single-quoted strings (escapes undone), its keys quoted, trailing commas dropped.
  const earlier = JSON.parse(
    m[1]!
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, s: string) => JSON.stringify(s.replace(/\\(.)/g, '$1')))
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1'),
  ) as { id: string; name: string }[];
  const marker = '\u0000PREVIOUS_NAMES\u0000';
  const r = renameText(text.replace(m[0], marker), plan);
  const list = [{ id: plan.from.id, name: plan.from.name }, ...earlier.filter((e) => e.id !== plan.to.id)];
  const literal = `[${list.map((e) => `{ id: '${e.id}', name: '${e.name.replace(/'/g, "\\'")}' }`).join(', ')}]`;
  // The value is the statement's end: the first "[]" in it is the type's.
  const statement = `${m[0].slice(0, m[0].length - m[1]!.length - 1)}${literal};`;
  let out = r.text.replace(marker, () => statement);
  out = out.replace(/export const APP_NAME = '[^']*';/, () => `export const APP_NAME = '${plan.to.name.replace(/'/g, "\\'")}';`);
  out = out.replace(/export const NAME_IS_FINAL = (?:true|false);/, `export const NAME_IS_FINAL = ${plan.final};`);
  return { text: out, count: r.count };
}

/** The blocks a README marks as saying the name is temporary, removed (with the blank line after). Pure. */
export function dropTemporary(text: string): string {
  return text.replace(/<!-- name:temporary -->[\s\S]*?<!-- \/name:temporary -->\n\n?/g, '');
}

/** The changelog with the rename as the first change of the unreleased version. Pure. */
export function noteRename(text: string, plan: RenamePlan): string {
  const line = `- The tool is now called ${plan.to.name} (it was ${plan.from.name}). \`${plan.to.id} install\` moves an installation made under the old name: its settings and history are copied, its hooks swapped for the new ones in one write, its plugin and folder removed once the new installation tested itself. Environment variables are now \`${spellings(plan.to.id).upper}_*\`, and the JSON contracts' schema names start with \`${plan.to.id}.\`.`;
  const unreleased = text.indexOf('## [Unreleased]');
  if (unreleased < 0) throw new Error('CHANGELOG.md: no [Unreleased] section');
  const next = text.indexOf('\n## [', unreleased + 1);
  const end = next < 0 ? text.length : next;
  const section = text.slice(unreleased, end);
  const changed = section.indexOf('### Changed\n\n');
  const patched =
    changed >= 0
      ? section.slice(0, changed + '### Changed\n\n'.length) + line + '\n' + section.slice(changed + '### Changed\n\n'.length)
      : section.replace(/\n*$/, '') + `\n\n### Changed\n\n${line}\n`;
  return text.slice(0, unreleased) + patched + text.slice(end);
}

export interface FileChange {
  path: string;
  count: number;
  text: string;
}

/** Every change the rename makes to the tracked files of `root`. Reads only. */
export function planRename(root: string, plan: RenamePlan, files: readonly string[]): FileChange[] {
  const out: FileChange[] = [];
  for (const path of files) {
    const buf = readFileSync(join(root, path));
    if (buf.includes(0)) continue;
    const before = buf.toString('utf8');
    const r = path === 'src/core/app.ts' ? renameApp(before, plan) : renameText(before, plan);
    let text = r.text;
    if (plan.final && /^README(?:\.\w+)?\.md$/.test(path)) text = dropTemporary(text);
    if (path === 'CHANGELOG.md') text = noteRename(text, plan);
    if (text !== before) out.push({ path, count: r.count, text });
  }
  return out;
}

/** The current names, read from src/core/app.ts. */
export function currentNames(root: string): Names {
  const app = readFileSync(join(root, 'src', 'core', 'app.ts'), 'utf8');
  const id = /export const APP_ID = '([^']+)';/.exec(app)?.[1];
  const name = /export const APP_NAME = '([^']+)';/.exec(app)?.[1];
  const repo = /export const REPO_URL = 'https:\/\/github\.com\/([^']+)';/.exec(app)?.[1];
  if (!id || !name || !repo) throw new Error('src/core/app.ts: APP_ID, APP_NAME or REPO_URL not found');
  return { id, name, repo };
}

function main(argv: string[]): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const arg = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = currentNames(root);
  const id = arg('to');
  if (!id) {
    console.error('usage: node --import tsx scripts/rename.ts --to <id> [--name <display name>] [--repo <owner/name>] [--not-final] [--apply]');
    return 2;
  }
  const bad = badId(id, from.id);
  if (bad) {
    console.error(`rename: "${id}" cannot be the name: ${bad}.`);
    return 2;
  }
  const repo = arg('repo') ?? `${from.repo.split('/')[0]}/${id}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error(`rename: --repo takes owner/name, not "${repo}".`);
    return 2;
  }
  const plan: RenamePlan = { from, to: { id, name: arg('name') ?? id, repo }, final: !argv.includes('--not-final') };
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const changes = planRename(root, plan, files);
  const total = changes.reduce((n, c) => n + c.count, 0);
  for (const c of [...changes].sort((x, y) => y.count - x.count)) console.log(`${String(c.count).padStart(5)}  ${c.path}`);
  console.log(
    `rename: ${from.id} → ${id}${plan.to.name !== id ? ` ("${plan.to.name}")` : ''}, ${from.repo} → ${repo}: ${total} replacements in ${changes.length} of ${files.length} tracked files; ${from.id} recorded in PREVIOUS_NAMES${plan.final ? '; the "temporary" notices removed' : ''}.`,
  );
  if (!argv.includes('--apply')) {
    console.log('rename: nothing written; add --apply to write it.');
    return 0;
  }
  if (git(['status', '--porcelain']).trim()) {
    console.error('rename: the work tree has changes: commit or stash them first, so that the rename is one commit of its own.');
    return 1;
  }
  for (const c of changes) writeFileSync(join(root, c.path), c.text);
  // A longer or shorter name moves line breaks: the formatter puts them back where the project's style wants them.
  const formattable = changes.map((c) => c.path).filter((p) => /\.(?:ts|tsx|mjs|js|json|md|ya?ml)$/.test(p) && p !== 'package-lock.json');
  execFileSync(
    process.execPath,
    [join(dirname(createRequire(import.meta.url).resolve('prettier/package.json')), 'bin', 'prettier.cjs'), '--write', '--log-level', 'warn', ...formattable],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  console.log(
    [
      'rename: written and formatted. Next:',
      '  npm run check && npm run test:package && npm run test:rename',
      `  gh repo rename ${repo.split('/')[1]}   (the person: GitHub keeps redirecting the old address)`,
    ].join('\n'),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));

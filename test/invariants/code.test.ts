// SPDX-License-Identifier: Apache-2.0
/**
 * Rules about the code itself, checked on every change. Each one is a promise made somewhere (README,
 * SECURITY, the architecture notes) that would otherwise only be kept by care.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function files(dir: string, ext = /\.(?:ts|tsx|mjs|js|cjs)$/): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'golden' && e.name !== 'fixtures') walk(p);
      } else if (ext.test(e.name)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p: string) => readFileSync(p, 'utf8');

/** The module specifiers a file imports (static imports and re-exports; dynamic import() too). */
function imports(source: string): string[] {
  // Comments first: a doc comment that quotes "kota N" after the word "from" is not an import.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

test('every source, test and script file carries its license line', () => {
  const missing = [...files('src'), ...files('test'), ...files('scripts')]
    .filter((p) => !p.endsWith('.d.ts') || p.includes('contract'))
    .filter((p) => !/^(?:#!.*\n)?\/\/ SPDX-License-Identifier: Apache-2\.0/.test(read(p)));
  assert.deepEqual(missing.map(rel), []);
});

test('the core is pure: no Node.js module and nothing outside the core (it also runs inside Claude Code, where there is no Node)', () => {
  const bad: string[] = [];
  for (const p of files('src/core'))
    for (const spec of imports(read(p))) {
      if (spec.startsWith('node:') || !spec.startsWith('.')) bad.push(`${rel(p)}: ${spec}`);
      else if (
        /\/(?:node|app|tui|cli|hook|mod)\//.test(join(dirname(p), spec).replace(/\\/g, '/') + '/') &&
        !join(dirname(p), spec).replace(/\\/g, '/').includes('/src/core/')
      )
        bad.push(`${rel(p)}: ${spec}`);
    }
  assert.deepEqual(bad, []);
});

test('the mod imports only the core and Claude Code', () => {
  const bad = files('src/mod')
    .flatMap((p) => imports(read(p)).map((s) => [p, s] as const))
    .filter(([p, s]) => !(s === 'claude-code' || (s.startsWith('../core/') && join(dirname(p), s).includes(join('src', 'core'))) || s === './contract.js'))
    .map(([p, s]) => `${rel(p)}: ${s}`);
  assert.deepEqual(bad, []);
});

test('the hook program has no third-party code and no interface code', () => {
  const bad = files('src/hook')
    .flatMap((p) => imports(read(p)).map((s) => [p, s] as const))
    .filter(([, s]) => !(s.startsWith('node:') || s.startsWith('../core/') || s.startsWith('../node/')))
    .map(([p, s]) => `${rel(p)}: ${s}`);
  assert.deepEqual(bad, []);
  // And what it reaches through ../node stays free of the interface too.
  const reach = files('src/node').flatMap((p) =>
    imports(read(p))
      .filter((s) => /ink|react|\.\.\/tui|\.\.\/cli/.test(s))
      .map((s) => `${rel(p)}: ${s}`),
  );
  assert.deepEqual(reach, []);
});

test('no network but the update: one fetch, of a release file, reached only by `mode-code update` (no telemetry, checked rather than promised)', () => {
  const NET = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici|ws)(?:\/|$)/;
  const bad: string[] = [];
  for (const p of files('src')) {
    const text = read(p);
    for (const s of imports(text)) if (NET.test(s)) bad.push(`${rel(p)}: imports ${s}`);
    const calls = text.match(/\bfetch\s*\(|\bnew\s+WebSocket\b|\bXMLHttpRequest\b|\$\.http\./g) ?? [];
    // The one exception: node/update.ts reads a release's files (SHA256SUMS, an installer), and nothing else.
    const allowed = rel(p) === 'src/node/update.ts' ? 1 : 0;
    if (calls.length !== allowed) bad.push(`${rel(p)}: ${calls.length} network call(s)`);
  }
  assert.deepEqual(bad, []);
  // What reaches the network is used by the update command alone; the daily check is that command, started by
  // the plugin only when the person said yes (src/mod/register.ts, updateCheck; test/mod/update.kit.ts).
  const users = files('src')
    .filter((p) => rel(p) !== 'src/node/update.ts' && /\b(?:checkUpdate|runInstaller|fetchFile)\b/.test(read(p)))
    .map(rel);
  assert.deepEqual(users, ['src/cli/update.ts']);
});

test('the shipped bundles open no connection either; the hook and the plugin fetch nothing', (t) => {
  const bundles = ['dist/cli.mjs', 'dist/hook.mjs', 'dist/plugin/hooks/register.js'].map((p) => join(ROOT, p));
  if (!bundles.every(existsSync)) return t.skip('needs the build: npm run build');
  const NET = /(?:from|import|require\()\s*\(?\s*['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns)['"]/;
  for (const b of bundles) {
    const text = read(b);
    assert.doesNotMatch(text, NET, `${rel(b)} imports a network module`);
    assert.doesNotMatch(text, /\bfetch\s*\(\s*['"`]https?:/, `${rel(b)} fetches a URL`);
    if (!b.endsWith('cli.mjs')) assert.doesNotMatch(text, /\bfetch\s*\(/, `${rel(b)} fetches`);
  }
  // The hook and the mod are self-contained: the hook needs only Node's own modules, the mod only Claude Code.
  const hookImports = imports(read(bundles[1]!)).filter((s) => !s.startsWith('node:'));
  assert.deepEqual(hookImports, []);
  const modImports = imports(read(bundles[2]!)).filter((s) => s !== 'claude-code');
  assert.deepEqual(modImports, []);
});

test('no case conversion depends on the machine locale (a Turkish locale turns I into ı)', () => {
  const bad = files('src')
    .flatMap((p) =>
      read(p)
        .split('\n')
        .map((line, i) => [p, i + 1, line] as const),
    )
    .filter(([, , line]) => /\.toLocale(?:Lower|Upper)Case\(\s*\)|\.localeCompare\([^,)]*\)/.test(line))
    .map(([p, n]) => `${rel(p)}:${n}`);
  assert.deepEqual(bad, []);
});

test('the minimum versions agree everywhere they are written', () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as { engines: { node: string }; version: string };
  const min = pkg.engines.node.replace(/^>=/, '');
  assert.match(read(join(ROOT, 'src/cli/main.tsx')), new RegExp(`MIN_NODE = \\[${min.split('.').slice(0, 2).join(', ')}\\]`));
  assert.match(read(join(ROOT, 'src/app/doctor/checks.ts')), new RegExp(`MIN_NODE = '${min.replace(/\./g, '\\.')}'`));
  for (const readme of ['README.md', 'README.tr.md'])
    assert.match(read(join(ROOT, readme)), new RegExp(min.split('.').slice(0, 2).join('\\.')), `${readme} names Node.js ${min}`);
  const app = read(join(ROOT, 'src/core/app.ts'));
  const hooks = /MIN_CLAUDE_CODE_FOR_HOOKS = '([\d.]+)'/.exec(app)![1]!;
  for (const readme of ['README.md', 'README.tr.md']) assert.ok(read(join(ROOT, readme)).includes(hooks), `${readme} names Claude Code ${hooks}`);
});

test('every command is in the help text and in docs/cli.md', () => {
  const main = read(join(ROOT, 'src/cli/main.tsx'));
  const commands = [...main.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!).filter((c) => !['help', 'version', 'templates', 'flows'].includes(c)); // aliases of template and flow
  const help = read(join(ROOT, 'src/cli/commands.ts'));
  const doc = read(join(ROOT, 'docs/cli.md'));
  assert.ok(commands.length >= 14);
  for (const c of commands) {
    assert.match(help, new RegExp(`c\\('${c}\\b`), `help text lacks ${c}`);
    assert.match(doc, new RegExp(`\\\`${c}\\b`), `docs/cli.md lacks ${c}`);
  }
});

test('every flag a command reads is known to the argument reader as a flag or as a value', () => {
  const args = read(join(ROOT, 'src/cli/args.ts'));
  const booleans = new Set([...args.matchAll(/^\s+'([a-z-]+)',$/gm)].map((m) => m[1]!));
  const used = new Set<string>();
  for (const p of [...files('src/cli')])
    for (const m of read(p).matchAll(/flag\(a, '([a-z-]+)'(?:, '([a-z-]+)')?\)/g)) for (const f of [m[1], m[2]]) if (f) used.add(f);
  const unknown = [...used].filter((f) => !booleans.has(f));
  assert.deepEqual(unknown, [], 'a flag missing from BOOLEAN would swallow the next word as its value');
});

test('package contents: the files the package lists exist after a build, and nothing else is needed', (t) => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as { files: string[]; bin: Record<string, string> };
  if (!existsSync(join(ROOT, 'dist', 'cli.mjs'))) return t.skip('needs the build: npm run build');
  for (const f of pkg.files) assert.ok(existsSync(join(ROOT, f)), `${f} is listed but missing`);
  for (const b of Object.values(pkg.bin)) {
    assert.ok(existsSync(join(ROOT, b)), b);
    assert.match(read(join(ROOT, b)), /^#!\/usr\/bin\/env node\n/);
  }
  // The data the doctor compares the installed copy with ships too.
  assert.ok(statSync(join(ROOT, 'dist', 'hook.mjs')).size > 1000);
});

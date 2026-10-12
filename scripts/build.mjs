// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the three programs the package ships, each one self-contained (no runtime dependencies):
 *   dist/cli.mjs                 the command line and the control center (Node ≥ 22.13)
 *   dist/hook.mjs                the safety-net hook Claude Code runs for its settings hooks
 *   dist/plugin/hooks/register.js  the in-process mod (no Node: Claude Code's hook environment)
 * plus the plugin's manifest, and THIRD_PARTY_NOTICES.md for everything bundled.
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');
const banner = `// ${pkg.name} ${pkg.version} · SPDX-License-Identifier: Apache-2.0 · bundled third-party code: THIRD_PARTY_NOTICES.md`;
const define = { __TC_VERSION__: JSON.stringify(pkg.version) };

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'plugin', 'hooks'), { recursive: true });
await mkdir(join(dist, 'plugin', '.claude-plugin'), { recursive: true });

const common = { bundle: true, format: 'esm', legalComments: 'none', define, logLevel: 'warning', metafile: true, charset: 'utf8' };

const cli = await build({
  ...common,
  entryPoints: [join(root, 'src', 'cli', 'main.tsx')],
  outfile: join(dist, 'cli.mjs'),
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  // Ink and React are CommonJS in places: give the ESM bundle a require for them.
  banner: {
    js: `#!/usr/bin/env node\n${banner}\nimport { createRequire as __tcCreateRequire } from 'node:module';\nconst require = __tcCreateRequire(import.meta.url);`,
  },
  // react-devtools-core is an optional Ink dependency for debugging only; it is never loaded.
  external: ['react-devtools-core'],
});

const hook = await build({
  ...common,
  entryPoints: [join(root, 'src', 'hook', 'main.ts')],
  outfile: join(dist, 'hook.mjs'),
  platform: 'node',
  target: 'node22',
  banner: { js: banner },
});

const mod = await build({
  ...common,
  entryPoints: [join(root, 'src', 'mod', 'register.ts')],
  outfile: join(dist, 'plugin', 'hooks', 'register.js'),
  platform: 'neutral',
  target: 'es2023',
  external: ['claude-code'],
  // Keep top-level function names: the engine's validator reads them, and stack traces stay readable.
  keepNames: false,
  minify: false,
  banner: { js: banner },
});

const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: 'Behavior layer of terminal-code: safety belt, keywords, quota budget, footer lines, quiet long work.',
  author: { name: pkg.author },
  homepage: pkg.homepage,
  repository: pkg.repository.url.replace(/^git\+/, ''),
  license: pkg.license,
};
await writeFile(join(dist, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(dist, 'plugin', 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.js'] }, null, 2) + '\n');
for (const f of ['LICENSE', 'NOTICE']) await cp(join(root, f), join(dist, 'plugin', f));

// ── third-party notices: every package that ended up in a bundle, with its license text ──
const inputs = new Set();
for (const r of [cli, hook, mod]) for (const k of Object.keys(r.metafile.inputs)) inputs.add(k.replace(/\\/g, '/'));
const packages = new Map();
for (const input of inputs) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!m) continue;
  const name = m[1];
  if (packages.has(name)) continue;
  const dir = join(root, input.slice(0, input.indexOf(m[0]) + m[0].length));
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    /* keep going: the notice says the license is unknown and the check below fails */
  }
  const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENCE', 'LICENSE-MIT']
    .map((f) => join(dir, f))
    .find((f) => existsSync(f));
  packages.set(name, {
    name,
    version: meta.version ?? '?',
    license: typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'UNKNOWN'),
    repository: typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? ''),
    text: licenseFile ? readFileSync(licenseFile, 'utf8').trim() : '',
  });
}
const ALLOWED = /^(?:MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|\(MIT OR CC0-1\.0\)|MIT OR Apache-2\.0)$/;
const bad = [...packages.values()].filter((p) => !ALLOWED.test(p.license) || !p.text);
const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
let notices = `# Third-party notices\n\nThe published package of ${pkg.name} bundles the following open-source packages. Each is used under its own license, reproduced below.\n\n`;
notices += sorted.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n') + '\n';
for (const p of sorted)
  notices += `\n---\n\n## ${p.name} ${p.version}\n\nLicense: ${p.license}${p.repository ? `\nSource: ${p.repository}` : ''}\n\n\`\`\`\n${p.text}\n\`\`\`\n`;
await writeFile(join(dist, 'THIRD_PARTY_NOTICES.md'), notices);
await cp(join(dist, 'THIRD_PARTY_NOTICES.md'), join(root, 'THIRD_PARTY_NOTICES.md'));

const size = (r) => Object.values(r.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `built ${pkg.name} ${pkg.version}: cli ${(size(cli) / 1024).toFixed(0)} KiB · hook ${(size(hook) / 1024).toFixed(0)} KiB · mod ${(size(mod) / 1024).toFixed(0)} KiB · ${packages.size} bundled packages`,
);
if (bad.length) {
  console.error(`license check failed for: ${bad.map((p) => `${p.name} (${p.license}${p.text ? '' : ', no license file'})`).join(', ')}`);
  process.exit(1);
}

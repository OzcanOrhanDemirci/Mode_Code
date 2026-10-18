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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  // react-devtools-core is an optional Ink dependency for debugging only: replace it with an empty module.
  plugins: [
    {
      name: 'stub-react-devtools',
      setup(b) {
        b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default { initialize() {}, connectToDevTools() {} };', loader: 'js' }));
      },
    },
  ],
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

// Mo in the strip: a surface module Claude Code loads beside the hooks module, by the path the strip names.
const moStrip = await build({
  ...common,
  entryPoints: [join(root, 'src', 'mod', 'mo-strip.ts')],
  outfile: join(dist, 'plugin', 'hooks', 'mo-strip.js'),
  platform: 'neutral',
  target: 'es2023',
  external: ['claude-code'],
  minify: false,
  banner: { js: banner },
});

// The breathing control of the strip (a running flow's step): another surface module, drawn the same way.
const stripPulse = await build({
  ...common,
  entryPoints: [join(root, 'src', 'mod', 'strip-pulse.ts')],
  outfile: join(dist, 'plugin', 'hooks', 'strip-pulse.js'),
  platform: 'neutral',
  target: 'es2023',
  external: ['claude-code'],
  minify: false,
  banner: { js: banner },
});

const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: 'Behavior layer of mode-code: safety belt, keywords, quota budget, footer lines, quiet long work.',
  author: { name: pkg.author },
  homepage: pkg.homepage,
  repository: pkg.repository.url.replace(/^git\+/, ''),
  license: pkg.license,
  types: './types/index.d.ts',
};
await writeFile(join(dist, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(dist, 'plugin', 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.js'] }, null, 2) + '\n');
for (const f of ['LICENSE', 'NOTICE']) await cp(join(root, f), join(dist, 'plugin', f));
// The contract of the values the plugin keeps in Claude Code's session state; the validator checks it.
await mkdir(join(dist, 'plugin', 'types'), { recursive: true });
await cp(join(root, 'src', 'mod', 'contract.d.ts'), join(dist, 'plugin', 'types', 'index.d.ts'));

// ── tool packs (docs/packs.md): each hosted pack a plugin of its own, its skill the guide in packs/<id>.md ──
// The catalog in src/core/packs.ts is the one source: bundled for a moment to be read here, then removed.
const catalogFile = join(dist, '.packs-catalog.mjs');
await build({ ...common, metafile: false, entryPoints: [join(root, 'src', 'core', 'packs.ts')], outfile: catalogFile, platform: 'neutral', target: 'es2023' });
const { PACKS, hostedName } = await import(pathToFileURL(catalogFile).href);
await rm(catalogFile, { force: true });
await mkdir(join(dist, 'packs', 'guides'), { recursive: true });
for (const p of PACKS) {
  const guide = (await readFile(join(root, 'packs', `${p.id}.md`), 'utf8')).trim() + '\n';
  await writeFile(join(dist, 'packs', 'guides', `${p.id}.md`), guide);
  if (!p.plugin.hosted) continue;
  const dir = join(dist, 'packs', 'plugins', hostedName(p.id));
  await mkdir(join(dir, '.claude-plugin'), { recursive: true });
  await mkdir(join(dir, 'skills', p.id), { recursive: true });
  const env = Object.assign({}, ...p.tools.map((t) => t.telemetryOff ?? {}));
  const packManifest = {
    name: hostedName(p.id),
    version: pkg.version,
    description: `A ${pkg.name} tool pack. ${p.summary}`,
    author: { name: pkg.author },
    homepage: pkg.homepage,
    license: pkg.license,
    ...(p.server?.kind === 'mcp'
      ? { mcpServers: { [p.id]: { command: p.server.command, args: [...p.server.args], ...(Object.keys(env).length ? { env } : {}) } } }
      : {}),
  };
  await writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(packManifest, null, 2) + '\n');
  // The description is the one line Claude reads in the skill list; quoted, so a colon in it stays text.
  await writeFile(join(dir, 'skills', p.id, 'SKILL.md'), `---\nname: ${p.id}\ndescription: ${JSON.stringify(p.summary)}\n---\n\n${guide}`);
  await cp(join(root, 'LICENSE'), join(dir, 'LICENSE'));
}

// ── skills (docs/skills.md): Mode_Code's own in the plugin; those it keeps only sometimes, and the skills of others,
// beside it, for the installation to put in the plugin's folder when they apply or the person turns them on ──
await cp(join(root, 'skills'), join(dist, 'plugin', 'skills'), { recursive: true });
await cp(join(root, 'skills-managed'), join(dist, 'skills-source', 'own'), { recursive: true });
const external = JSON.parse(await readFile(join(root, 'skills-external', 'sources.json'), 'utf8'));
for (const id of Object.keys(external)) await cp(join(root, 'skills-external', id), join(dist, 'skills-source', 'external', id), { recursive: true });

// ── third-party notices: every package that ended up in a bundle, with its license text ──
const inputs = new Set();
for (const r of [cli, hook, mod, moStrip, stripPulse]) for (const k of Object.keys(r.metafile.inputs)) inputs.add(k.replace(/\\/g, '/'));
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
    // A few packages publish without their license file; the upstream text is kept in scripts/licenses/.
    text: licenseFile
      ? readFileSync(licenseFile, 'utf8').trim()
      : existsSync(join(root, 'scripts', 'licenses', `${name.replace('/', '__')}.txt`))
        ? readFileSync(join(root, 'scripts', 'licenses', `${name.replace('/', '__')}.txt`), 'utf8').trim()
        : '',
  });
}
const ALLOWED = /^(?:MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|\(MIT OR CC0-1\.0\)|MIT OR Apache-2\.0)$/;
const bad = [...packages.values()].filter((p) => !ALLOWED.test(p.license) || !p.text);
const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
let notices = `# Third-party notices\n\nThe published package of ${pkg.name} bundles the following open-source packages. Each is used under its own license, reproduced below.\n\n`;
notices += sorted.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n') + '\n';
for (const p of sorted)
  notices += `\n---\n\n## ${p.name} ${p.version}\n\nLicense: ${p.license}${p.repository ? `\nSource: ${p.repository}` : ''}\n\n\`\`\`\n${p.text}\n\`\`\`\n`;
// The skills of others the package carries, each under its own licence, whose full text is beside it
// (LICENSE.source, and NOTICE.source where its repository has one). Their authors do not endorse Mode_Code.
notices += `\n---\n\n# Skills by others\n\nThe package also carries these skills, off until the person turns one on, each copied unchanged from its author's repository at the commit named, under that repository's licence; the licence's full text, and its notice where there is one, is in the skill's folder (\`LICENSE.source\`, \`NOTICE.source\`). Their authors have not reviewed or endorsed ${pkg.name}.\n\n`;
notices +=
  Object.entries(external)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, s]) => `- ${id}: https://github.com/${s.repo}/tree/${s.commit}/${s.path} (${s.license})`)
    .join('\n') + '\n';
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

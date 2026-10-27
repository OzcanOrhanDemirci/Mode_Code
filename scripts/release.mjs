// SPDX-License-Identifier: Apache-2.0
/**
 * The release, from a version tag to the files a GitHub release carries (docs/release.md). Run by
 * .github/workflows/release.yml, and by hand to rehearse it.
 *
 *   node scripts/release.mjs check [--tag v1.2.3]   the tag, package.json, the changelog and the installers agree
 *   node scripts/release.mjs pack --out <dir>       the package (twice: versioned, and as mode-code.tgz for
 *                                                   "the newest"), the two installers and SHA256SUMS
 *   node scripts/release.mjs notes [--tag v1.2.3]   the release notes: how to install, then the changelog's section
 *
 * Exit: 0 fine · 1 a check failed.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The changelog's section for a version: its date and its text, or null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const head = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\](?: - (\\d{4}-\\d{2}-\\d{2}))?\\s*$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const date = head.exec(lines[start])[1] ?? null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  // Link definitions at the end of the file belong to no section.
  const body = lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]: \S+$/.test(l))
    .join('\n')
    .trim();
  return { date, body };
}

/** The `REPO=` / `$Repo =` an installer downloads from. */
export function installerRepo(text) {
  return /^REPO="([^"]+)"$/m.exec(text)?.[1] ?? /^\s*\$Repo = '([^']+)'$/m.exec(text)?.[1] ?? null;
}

/** Every disagreement between the tag, package.json, the changelog and the installers; empty when none. */
export function releaseProblems({ tag, pkg, changelog, installSh, installPs1, today }) {
  const problems = [];
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`package.json's version ${version} is not x.y.z`);
  if (tag !== undefined && tag !== `v${version}`) problems.push(`the tag ${tag} is not v${version}, package.json's version`);
  const section = changelogSection(changelog, version);
  if (!section) problems.push(`CHANGELOG.md has no "## [${version}] - <date>" section`);
  else {
    if (!section.date) problems.push(`CHANGELOG.md's section for ${version} has no date`);
    else if (today && section.date > today) problems.push(`CHANGELOG.md dates ${version} ${section.date}, after today (${today})`);
    if (!section.body) problems.push(`CHANGELOG.md's section for ${version} is empty`);
  }
  const repo = /github\.com\/([^/]+\/[^/.#]+)/.exec(pkg.repository?.url ?? '')?.[1];
  if (!repo) problems.push("package.json's repository is not a GitHub address");
  for (const [name, text] of [
    ['install.sh', installSh],
    ['install.ps1', installPs1],
  ]) {
    const r = installerRepo(text);
    if (r !== repo) problems.push(`${name} downloads from ${r ?? 'nowhere'}, not ${repo}`);
  }
  return problems;
}

/** The release notes: how to install, then the changelog's section, then how to check the download. */
/**
 * The changelog's links to the repository's own files (`docs/x.md#part`), made to point at them as the tag has them:
 * a release's page has no files beside it, so a relative link there leads nowhere.
 */
export function absoluteLinks(text, repo, tag) {
  return text.replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_, path) => `](https://github.com/${repo}/blob/${tag}/${path})`);
}

export function releaseNotes({ pkg, changelog }) {
  const repo = /github\.com\/([^/]+\/[^/.#]+)/.exec(pkg.repository.url)[1];
  const section = changelogSection(changelog, pkg.version);
  const raw = `https://raw.githubusercontent.com/${repo}/main`;
  return [
    '## Install',
    '',
    'macOS and Linux:',
    '',
    '```sh',
    `curl -fsSL ${raw}/install.sh | sh`,
    '```',
    '',
    'Windows (PowerShell):',
    '',
    '```powershell',
    `irm ${raw}/install.ps1 | iex`,
    '```',
    '',
    `Already installed? The same command updates it. Details: [the README](https://github.com/${repo}#install).`,
    '',
    absoluteLinks(section?.body ?? '', repo, `v${pkg.version}`),
    '',
    '## Verify the download',
    '',
    `\`SHA256SUMS\` lists the SHA-256 of every file here; the installers check it themselves. Each file also has a build provenance attestation: \`gh attestation verify ${pkg.name}-${pkg.version}.tgz --repo ${repo}\`.`,
    '',
  ].join('\n');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function main(argv) {
  const [cmd] = argv;
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const read = (f) => readFileSync(join(root, f), 'utf8');
  if (cmd === 'check') {
    const problems = releaseProblems({
      tag: opt('--tag'),
      pkg,
      changelog: read('CHANGELOG.md'),
      installSh: read('install.sh'),
      installPs1: read('install.ps1'),
      today: new Date().toISOString().slice(0, 10),
    });
    for (const p of problems) console.error(`release: ${p}`);
    if (!problems.length) console.log(`release: ${pkg.name} ${pkg.version}: the tag, package.json, the changelog and the installers agree`);
    return problems.length ? 1 : 0;
  }
  if (cmd === 'notes') {
    if (opt('--tag') && opt('--tag') !== `v${pkg.version}`) {
      console.error(`release: the tag ${opt('--tag')} is not v${pkg.version}`);
      return 1;
    }
    process.stdout.write(releaseNotes({ pkg, changelog: read('CHANGELOG.md') }));
    return 0;
  }
  if (cmd === 'pack') {
    const out = resolve(opt('--out') ?? 'release');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const isWin = process.platform === 'win32';
    const packed = spawnSync(isWin ? 'npm.cmd' : 'npm', ['pack', '--json', '--pack-destination', out], {
      cwd: root,
      encoding: 'utf8',
      shell: isWin,
    });
    if (packed.status !== 0) {
      console.error(`release: npm pack failed: ${packed.stderr}`);
      return 1;
    }
    const versioned = `${pkg.name}-${pkg.version}.tgz`;
    // The same file under a name without the version: what the installers download as "the newest".
    copyFileSync(join(out, versioned), join(out, `${pkg.name}.tgz`));
    copyFileSync(join(root, 'install.sh'), join(out, 'install.sh'));
    copyFileSync(join(root, 'install.ps1'), join(out, 'install.ps1'));
    const files = readdirSync(out).sort();
    writeFileSync(join(out, 'SHA256SUMS'), files.map((f) => `${sha256(join(out, f))}  ${f}\n`).join(''));
    console.log(`release: ${out}: ${[...files, 'SHA256SUMS'].join(', ')}`);
    return 0;
  }
  console.error('usage: node scripts/release.mjs check [--tag v1.2.3] | pack --out <dir> | notes [--tag v1.2.3]');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));

// SPDX-License-Identifier: Apache-2.0
/**
 * The skills of others that Mode_Code ships, off until the person turns one on (docs/skills.md): each copied from its
 * author's repository at a pinned commit, with that repository's licence beside it and where it came from in
 * SOURCE.json. A development script: run by hand, its result reviewed and committed (skills-external/).
 *
 *   node scripts/vendor-skills.mjs            fetch each skill at the commit recorded in skills-external/sources.json
 *   node scripts/vendor-skills.mjs --update   take each repository's newest commit, then fetch (review the diff)
 *
 * Needs the GitHub CLI (`gh`) signed in, for the commits and the licences. Only what a skill is made of is copied:
 * its SKILL.md, the documents and small scripts beside it; never another tool's agent files, tests or evals, nor a
 * file over 100 KB.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'skills-external');
const sourcesFile = join(out, 'sources.json');
const update = process.argv.includes('--update');

/** Each skill: its name here, its repository and folder there, and the state suggested when the person turns it on. */
const SKILLS = [
  // General.
  { id: 'grilling', repo: 'mattpocock/skills', path: 'skills/productivity/grilling', suggested: 'on' },
  { id: 'grill-me', repo: 'mattpocock/skills', path: 'skills/productivity/grill-me', suggested: 'me' },
  { id: 'diagnosing-bugs', repo: 'mattpocock/skills', path: 'skills/engineering/diagnosing-bugs', suggested: 'on' },
  { id: 'tdd', repo: 'mattpocock/skills', path: 'skills/engineering/tdd', suggested: 'on' },
  { id: 'codebase-design', repo: 'mattpocock/skills', path: 'skills/engineering/codebase-design', suggested: 'on' },
  { id: 'improve-codebase-architecture', repo: 'mattpocock/skills', path: 'skills/engineering/improve-codebase-architecture', suggested: 'me' },
  { id: 'domain-modeling', repo: 'mattpocock/skills', path: 'skills/engineering/domain-modeling', suggested: 'on' },
  { id: 'prototype', repo: 'mattpocock/skills', path: 'skills/engineering/prototype', suggested: 'on' },
  { id: 'teach', repo: 'mattpocock/skills', path: 'skills/productivity/teach', suggested: 'me' },
  { id: 'writing-for-agents', repo: 'mattpocock/skills', path: 'skills/productivity/writing-for-agents', suggested: 'on' },
  { id: 'systematic-debugging', repo: 'obra/superpowers', path: 'skills/systematic-debugging', suggested: 'on' },
  { id: 'verification-before-completion', repo: 'obra/superpowers', path: 'skills/verification-before-completion', suggested: 'on' },
  { id: 'receiving-code-review', repo: 'obra/superpowers', path: 'skills/receiving-code-review', suggested: 'on' },
  { id: 'source-driven-development', repo: 'addyosmani/agent-skills', path: 'skills/source-driven-development', suggested: 'on' },
  { id: 'gha-security-review', repo: 'getsentry/skills', path: 'skills/gha-security-review', suggested: 'on' },
  { id: 'humanizer', repo: 'blader/humanizer', path: '', only: ['SKILL.md'], suggested: 'on' },
  { id: 'frontend-design', repo: 'anthropics/claude-plugins-official', path: 'plugins/frontend-design/skills/frontend-design', suggested: 'on' },
  { id: 'claude-md-improver', repo: 'anthropics/claude-plugins-official', path: 'plugins/claude-md-management/skills/claude-md-improver', suggested: 'me' },
  { id: 'session-report', repo: 'anthropics/claude-plugins-official', path: 'plugins/session-report/skills/session-report', suggested: 'me' },
  // By field.
  { id: 'firebase-security-rules-auditor', repo: 'firebase/agent-skills', path: 'skills/firebase-security-rules-auditor', suggested: 'on' },
  { id: 'firestore-rules-creation', repo: 'firebase/agent-skills', path: 'skills/firestore-rules-creation', suggested: 'on' },
  { id: 'firebase-cloud-firestore', repo: 'evanca/flutter-ai-rules', path: 'skills/firebase-cloud-firestore', suggested: 'on' },
  { id: 'dart-3-updates', repo: 'evanca/flutter-ai-rules', path: 'skills/dart-3-updates', suggested: 'on' },
  { id: 'appstore-review', repo: 'devsemih/appstore-review-skill', path: 'skills/appstore-review', suggested: 'me' },
  { id: 'playstore-review', repo: 'devsemih/appstore-review-skill', path: 'skills/playstore-review', suggested: 'me' },
  { id: 'store-quirks', repo: 'tramlinehq/store-quirks', path: 'store-quirks', suggested: 'on' },
  { id: 'aso', repo: 'coreyhaines31/marketingskills', path: 'skills/aso', suggested: 'me' },
  { id: 'use-kicad-cli', repo: 'FradSer/dotclaude', path: 'hardware/skills/use-kicad-cli', suggested: 'me' },
  { id: 'wiring-safety-check', repo: 'wedsamuel1230/embedded-engineering-skills', path: 'skills/wiring-safety-check', suggested: 'on' },
  { id: 'power-budget-calculator', repo: 'wedsamuel1230/embedded-engineering-skills', path: 'skills/power-budget-calculator', suggested: 'on' },
  { id: 'i2c-bringup-diagnostician', repo: 'wedsamuel1230/embedded-engineering-skills', path: 'skills/i2c-bringup-diagnostician', suggested: 'on' },
  { id: 'openscad', repo: 'mitsuhiko/agent-stuff', path: 'skills/openscad', suggested: 'on' },
  { id: 'cuda-profiling', repo: 'mohitmishra786/low-level-dev-skills', path: 'skills/gpu/cuda-profiling', suggested: 'on' },
];

// The skill's own test scenarios (test-*.md) are for its authors, not for Claude.
const SKIP = /(?:^|\/)(?:agents|evals?|tests?|__pycache__)\/|(?:^|\/)(?:CREATION-LOG\.md|test-[\w-]+\.md|\.DS_Store)$/;
const MAX = 100_000;
const gh = (...args) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const recorded = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) : {};
const commits = new Map();
const commitOf = (repo) => {
  if (!commits.has(repo)) {
    const pinned = Object.values(recorded).find((s) => s.repo === repo)?.commit;
    commits.set(repo, !update && pinned ? pinned : gh(`repos/${repo}/commits/HEAD`, '--jq', '.sha').trim());
  }
  return commits.get(repo);
};
const trees = new Map();
const treeOf = (repo, sha) => {
  if (!trees.has(repo)) trees.set(repo, JSON.parse(gh(`repos/${repo}/git/trees/${sha}?recursive=1`)).tree);
  return trees.get(repo);
};
const raw = async (repo, sha, path) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!r.ok) throw new Error(`${repo}@${sha}:${path}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const sources = {};
for (const s of SKILLS) {
  const sha = commitOf(s.repo);
  const license = JSON.parse(gh(`repos/${s.repo}/license?ref=${sha}`));
  const prefix = s.path ? `${s.path}/` : '';
  const files = treeOf(s.repo, sha)
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
    .map((e) => ({ ...e, rel: e.path.slice(prefix.length) }))
    .filter((e) => (s.only ? s.only.includes(e.rel) : !SKIP.test(e.rel)) && e.size <= MAX);
  if (!files.some((e) => e.rel === 'SKILL.md')) throw new Error(`${s.id}: no SKILL.md at ${s.repo}/${s.path}`);
  const dir = join(out, s.id);
  rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.rel)), { recursive: true });
    writeFileSync(join(dir, f.rel), await raw(s.repo, sha, f.path));
  }
  writeFileSync(join(dir, 'LICENSE.source'), await raw(s.repo, sha, license.path));
  const notice = treeOf(s.repo, sha).find((e) => /^NOTICE(?:\.md|\.txt)?$/.test(e.path));
  if (notice) writeFileSync(join(dir, 'NOTICE.source'), await raw(s.repo, sha, notice.path));
  // Its own description, for the lists that show it before it is turned on.
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(dir, 'SKILL.md'), 'utf8'))?.[1] ?? '';
  const description = (/^description:\s*(.*)$/m.exec(head)?.[1] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^[>|]-?\s*$/, '');
  sources[s.id] = {
    repo: s.repo,
    commit: sha,
    path: s.path,
    license: license.license?.spdx_id ?? 'NOASSERTION',
    suggested: s.suggested,
    description: (description || (/^description:\s*[>|]-?\s*\n((?:[ \t]+.*\n?)+)/m.exec(head)?.[1] ?? '').replace(/\s+/g, ' ').trim()).slice(0, 300),
    files: files.map((f) => f.rel).sort(),
  };
  console.log(`${s.id}: ${files.length} files from ${s.repo}@${sha.slice(0, 7)} (${sources[s.id].license})`);
}
writeFileSync(sourcesFile, JSON.stringify(sources, null, 2) + '\n');
// The same list for the code (src/core/skills.ts reads it), formatted as the rest of the code.
const catalog = join(root, 'src', 'core', 'skills-external.ts');
writeFileSync(
  catalog,
  `// SPDX-License-Identifier: Apache-2.0\n/** The skills of others shipped in skills-external/, written by scripts/vendor-skills.mjs: do not edit by hand. */\n\nexport interface ExternalSkill {\n  repo: string;\n  commit: string;\n  path: string;\n  license: string;\n  suggested: 'me' | 'on';\n  description: string;\n  files: string[];\n}\n\nexport const EXTERNAL_SKILLS: Readonly<Record<string, ExternalSkill>> = ${JSON.stringify(sources, null, 2)};\n`,
);
execFileSync(process.execPath, [join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', catalog], { stdio: 'ignore' });

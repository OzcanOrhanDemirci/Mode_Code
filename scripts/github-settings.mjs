// SPDX-License-Identifier: Apache-2.0
/**
 * The GitHub repository's settings, kept as code (docs/release.md, "Going public"). It reads the repository
 * through the GitHub CLI (`gh`, signed in), shows what differs from what this project wants, and changes
 * only what it is told to:
 *
 *   node scripts/github-settings.mjs            show the differences; change nothing
 *   node scripts/github-settings.mjs --apply    apply what suits the repository as it is now, private or public
 *   node scripts/github-settings.mjs --public   make the repository public (you type its name to confirm), then
 *                                               apply everything, the settings only a public repository has too
 *
 * While the repository is private the rule set for main is created switched off: its required checks need
 * GitHub Actions, which a private repository pays for by the minute. Going public switches it on.
 *
 * Exit: 0 fine (or nothing differs) · 1 something failed · 2 differences shown, nothing changed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DESCRIPTION =
  'A local, open-source companion for Claude Code: a safety belt, modes and a quota guard inside Claude Code, and a control center in your terminal. One-line install. No telemetry.';

export const TOPICS = [
  'claude-code',
  'claude',
  'anthropic',
  'ai-agents',
  'ai-coding',
  'agentic-coding',
  'developer-tools',
  'cli',
  'tui',
  'terminal',
  'hooks',
  'plugin',
  'safety',
  'guardrails',
  'privacy',
  'nodejs',
  'typescript',
];

/** What the repository's main page and merge button should be. */
export const REPOSITORY = {
  description: DESCRIPTION,
  has_issues: true,
  has_discussions: true,
  has_wiki: false,
  has_projects: false,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_update_branch: true,
  // Commits made in the web editor carry a Signed-off-by line too (CONTRIBUTING.md, the DCO).
  web_commit_signoff_required: true,
};

/** Labels the issue forms, the pull request template and the contribution guide use. */
export const LABELS = [
  { name: 'bug', color: 'd73a4a', description: 'Something does not work as described' },
  { name: 'idea', color: 'a2eeef', description: 'A feature, a rule or an improvement to discuss' },
  { name: 'good first issue', color: '7057ff', description: 'A good place to start: small, clear, with pointers' },
  { name: 'help wanted', color: '008672', description: 'Extra hands or a machine we do not have would help' },
  { name: 'documentation', color: '0075ca', description: 'README, docs/ or messages' },
  { name: 'translation', color: 'c5def5', description: 'A new language or a better wording in one' },
  { name: 'rule template', color: 'fbca04', description: 'A rule template for CLAUDE.md and the belt' },
  { name: 'safety belt', color: 'b60205', description: 'What the belt allows, asks about or blocks' },
  { name: 'installer', color: '5319e7', description: 'install.sh, install.ps1, mode-code install and uninstall' },
  { name: 'platform: windows', color: 'ededed', description: 'Windows only' },
  { name: 'platform: macos', color: 'ededed', description: 'macOS only' },
  { name: 'platform: linux', color: 'ededed', description: 'Linux only' },
  { name: 'question', color: 'd876e3', description: 'Better asked in Discussions; kept for questions that become issues' },
];

/** The checks a pull request into main must pass: the CI jobs as GitHub names them (ci.yml, dco.yml). */
export const REQUIRED_CHECKS = [
  'ubuntu-latest · Node 22.x',
  'ubuntu-latest · Node 24.x',
  'windows-latest · Node 22.x',
  'windows-latest · Node 24.x',
  'macos-latest · Node 24.x',
  'installer · ubuntu-latest',
  'installer · macos-latest',
  'installer · windows-latest',
  'secrets in history · gitleaks',
  'Every commit is signed off',
];

/** main: changed only through a pull request whose checks pass, squashed; never force-pushed or deleted. */
export function mainRuleset(active) {
  return {
    name: 'main',
    target: 'branch',
    enforcement: active ? 'active' : 'disabled',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: ['squash'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
        },
      },
    ],
    // The maintainer can still push a fix straight to main when CI itself is broken; GitHub records it.
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  };
}

/**
 * What a public repository should have on and does not, by GitHub's own answers: the repository's
 * `security_and_analysis` and `private-vulnerability-reporting`. A setting GitHub did not answer for (it
 * answers an admin) is unknown, never on. Pure.
 */
export function securityGaps(analysis, reporting) {
  const off = [];
  const unknown = [];
  const sort = (name, value, on) => {
    if (value === undefined || value === null) unknown.push(name);
    else if (value !== on) off.push(name);
  };
  sort('secret scanning', analysis?.secret_scanning?.status, 'enabled');
  sort('push protection', analysis?.secret_scanning_push_protection?.status, 'enabled');
  sort('private vulnerability reporting', reporting?.enabled, true);
  return { off, unknown };
}

/** The keys of `want` whose values differ in `have`. Pure. */
export function differences(have, want) {
  return Object.keys(want).filter((k) => JSON.stringify(have?.[k]) !== JSON.stringify(want[k]));
}

// ── GitHub, through gh ──

function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), windowsHide: true });
  if (r.error) throw new Error(`gh: ${r.error.message} (is the GitHub CLI installed?)`);
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '').trim() };
}

function api(method, path, body) {
  const r = gh(['api', '-X', method, path, ...(body === undefined ? [] : ['--input', '-'])], body);
  let json = null;
  try {
    json = r.out ? JSON.parse(r.out) : null;
  } catch {
    /* not JSON */
  }
  return { ...r, json };
}

function repoName() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const m = /github\.com\/([^/]+\/[^/.#]+)/.exec(pkg.repository.url);
  if (!m) throw new Error("package.json's repository is not a GitHub address");
  return m[1];
}

async function main(argv) {
  const apply = argv.includes('--apply') || argv.includes('--public');
  const goPublic = argv.includes('--public');
  const name = repoName();
  const repo = api('GET', `repos/${name}`);
  if (!repo.ok) {
    console.error(`github-settings: cannot read ${name}: ${repo.err}`);
    return 1;
  }
  let isPrivate = repo.json.private;
  const steps = [];
  const say = (ok, what) => {
    steps.push(ok);
    console.log(`  ${ok === null ? '·' : ok ? '✓' : '✗'} ${what}`);
  };
  let pending = 0;
  const differs = (what) => {
    pending++;
    console.log(`  ~ ${what}`);
  };
  console.log(`${name}: ${isPrivate ? 'private' : 'public'}${apply ? '' : ' (showing differences; --apply changes them)'}`);

  if (goPublic && isPrivate) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`Make ${name} public? Anyone will see its code and its history. Type ${name} to confirm: `)).trim();
    rl.close();
    if (typed !== name) {
      console.log('Nothing was changed.');
      return 1;
    }
    const r = api('PATCH', `repos/${name}`, { private: false });
    say(r.ok, r.ok ? 'the repository is public' : `making it public failed: ${r.err}`);
    if (!r.ok) return 1;
    isPrivate = false;
  }

  // The main page and the merge button.
  const diff = differences(repo.json, REPOSITORY);
  if (!diff.length) say(null, 'description, features and merge settings as wanted');
  else if (!apply) differs(`differs: ${diff.join(', ')}`);
  else {
    const r = api('PATCH', `repos/${name}`, Object.fromEntries(diff.map((k) => [k, REPOSITORY[k]])));
    say(r.ok, r.ok ? `set: ${diff.join(', ')}` : `settings failed: ${r.err}`);
  }

  // Topics.
  const topics = api('GET', `repos/${name}/topics`).json?.names ?? [];
  if (JSON.stringify([...topics].sort()) === JSON.stringify([...TOPICS].sort())) say(null, `topics as wanted (${TOPICS.length})`);
  else if (!apply) differs(`topics differ: have ${topics.join(', ') || 'none'}`);
  else {
    const r = api('PUT', `repos/${name}/topics`, { names: TOPICS });
    say(r.ok, r.ok ? `topics: ${TOPICS.join(', ')}` : `topics failed: ${r.err}`);
  }

  // Labels: created or brought to the wanted color and description; other labels are left alone.
  const have = new Map((api('GET', `repos/${name}/labels?per_page=100`).json ?? []).map((l) => [l.name.toLowerCase(), l]));
  for (const l of LABELS) {
    const h = have.get(l.name.toLowerCase());
    if (h && h.color === l.color && (h.description ?? '') === l.description) continue;
    if (!apply) {
      differs(`label "${l.name}" ${h ? 'differs' : 'missing'}`);
      continue;
    }
    const r = h
      ? api('PATCH', `repos/${name}/labels/${encodeURIComponent(h.name)}`, { new_name: l.name, color: l.color, description: l.description })
      : api('POST', `repos/${name}/labels`, l);
    say(r.ok, r.ok ? `label "${l.name}"` : `label "${l.name}" failed: ${r.err}`);
  }

  // Dependabot alerts and security updates: free on private repositories too.
  for (const [path, what] of [
    ['vulnerability-alerts', 'Dependabot alerts'],
    ['automated-security-fixes', 'Dependabot security updates'],
  ]) {
    const on = path === 'vulnerability-alerts' ? api('GET', `repos/${name}/${path}`).ok : api('GET', `repos/${name}/${path}`).json?.enabled === true;
    if (on) say(null, `${what} on`);
    else if (!apply) differs(`${what} off`);
    else {
      const r = api('PUT', `repos/${name}/${path}`);
      say(r.ok, r.ok ? `${what} on` : `${what} failed: ${r.err}`);
    }
  }

  // The rule set for main: switched off while private (its checks need paid Actions minutes), on when public.
  const rulesets = api('GET', `repos/${name}/rulesets`).json ?? [];
  const existing = rulesets.find((r) => r.name === 'main');
  const wanted = mainRuleset(!isPrivate);
  if (!apply) {
    if (!existing || existing.enforcement !== wanted.enforcement) differs(existing ? `rule set "main" is ${existing.enforcement}` : 'rule set "main" missing');
    else say(null, `rule set "main" ${existing.enforcement}`);
  } else {
    const r = existing ? api('PUT', `repos/${name}/rulesets/${existing.id}`, wanted) : api('POST', `repos/${name}/rulesets`, wanted);
    say(
      r.ok,
      r.ok
        ? `rule set "main" (${wanted.enforcement}): pull requests only, squashed, ${REQUIRED_CHECKS.length} checks, no force-push`
        : `rule set failed: ${r.err}`,
    );
  }

  // Only a public repository has these (free): secret scanning with push protection, private vulnerability reports.
  if (isPrivate) say(null, 'secret scanning, push protection and private vulnerability reporting come with --public');
  else if (!apply) {
    const reporting = api('GET', `repos/${name}/private-vulnerability-reporting`);
    const gaps = securityGaps(repo.json.security_and_analysis, reporting.ok ? reporting.json : null);
    if (gaps.off.length) differs(`public: ${gaps.off.join(', ')} off (--apply turns them on)`);
    if (gaps.unknown.length) differs(`public: ${gaps.unknown.join(', ')} not readable (GitHub answers an admin's login)`);
    if (!gaps.off.length && !gaps.unknown.length) say(null, 'secret scanning, push protection and private vulnerability reporting on');
  } else {
    const s = api('PATCH', `repos/${name}`, {
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    });
    say(s.ok, s.ok ? 'secret scanning and push protection on' : `secret scanning failed: ${s.err}`);
    const p = api('PUT', `repos/${name}/private-vulnerability-reporting`);
    say(p.ok, p.ok ? 'private vulnerability reporting on' : `private vulnerability reporting failed: ${p.err}`);
  }

  // The runs made while the repository was private stopped for billing, not for the code; the README's
  // badge shows the newest run of main, so a fresh one is started the moment the repository is public.
  if (goPublic && !isPrivate) {
    const r = gh(['workflow', 'run', 'ci.yml', '--repo', name, '--ref', repo.json.default_branch ?? 'main']);
    say(r.ok, r.ok ? 'CI started on main, so the badge shows the code as it is' : `starting CI failed: ${r.err}`);
  }

  if (!apply) return pending ? 2 : 0;
  return steps.includes(false) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`github-settings: ${err.message}`);
      process.exit(1);
    },
  );

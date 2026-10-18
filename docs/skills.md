# Commands and skills

A **skill** is a task Claude can be asked to do in one step, written as a `SKILL.md` file: how to verify work with evidence, prepare a release, audit what runs inside Claude Code. Mode_Code brings its own, and carries a selection of other people's, each off until you turn it on.

In a session, `/komutlar` (or `/commands`) lists every keyword, command and skill in your language, with what each does.

## Mode_Code's own

You run these; Claude never loads them by itself, so they add nothing to a session until you do (measured in `scripts/test-live.mjs`, case 14: the same session with and without the sixteen skill files differs by 0 tokens). In Turkish each has a short command; in English it is `/mode-code:<name>`, and Claude Code's `/` menu finds it by its name.

| Turkish                | Skill               | What it does                                                       |
| ---------------------- | ------------------- | ------------------------------------------------------------------ |
| `/toparla`             | the keyword         | Wrap up: finish the step, keep the work, write the handoff note    |
| `/durum`               | the keyword         | Where the work, the mode and the quota stand                       |
| `/devir`               | the keyword         | Write the handoff note for the next session                        |
| `/geri-al`             | `/rewind` (below)   | The code or the conversation as it was before one of your messages |
| `/dogrula`             | `verify`            | Verify the work with fresh evidence before calling it done         |
| `/bagimsiz-goz`        | `second-opinion`    | An independent agent reviews the work against the request          |
| `/kota-rapor`          | `quota-report`      | How the quota is being spent, from Mode_Code's measurements        |
| `/maliyet-tahmin`      | `cost-estimate`     | What a planned task would take of the quota, from past work        |
| `/paket`               | `packs`             | The tool packs: which are on here, which would help                |
| `/guven-denetimi`      | `trust-audit`       | Audit the plugins, hooks, MCP servers and skills that run          |
| `/kemer`               | `belt`              | What the safety belt stopped, and what it would do with a command  |
| `/guvenlik`            | `security`          | Secrets, vulnerable dependencies and risky settings in the project |
| `/proje-tanit`         | `project-intro`     | A true introduction to the project, from its files                 |
| `/surum-hazirla`       | `release-prep`      | Prepare a release, stopping before anything is published           |
| `/pr-hazirla`          | `pr-prep`           | Prepare a pull request, stopping before it is opened               |
| `/bagimlilik-guncelle` | `dependency-update` | Update dependencies safely, each group tested                      |
| `/hafiza-bakim`        | `memory-care`       | The memory: what no longer loads, repeats or contradicts itself    |
| `/ders-cikar`          | `lessons`           | The lessons of this session, as proposed memory notes              |
| `/oturum-ara`          | `session-search`    | Find a past session by what was said or done in it                 |
| `/sorun-bildir`        | `report-issue`      | Draft an issue for Mode_Code, private details taken out            |

Three Claude may use by itself, when the work calls for them; each costs its one line in every session:

- `commit`: commit as the project expects: its style, one change per commit, why and how, its sign-off, never `--no-verify`;
- `measure`: measure before stating a number, and say how it was measured;
- `memory-note`: save to your memory with one fact per file and the index short, no secrets; there only once a memory is set up ([memory.md](memory.md)).

Everything a skill does stays under the safety belt; the ones that prepare a release or a pull request stop before anything is published.

## Undo

`/geri-al` opens Claude Code's own rewind (`/rewind`, or `Esc` twice): Claude Code keeps a checkpoint of the files its file tools change before each of your messages, and puts back the code, the conversation or both as they were at the message you pick ([checkpointing](https://code.claude.com/docs/en/checkpointing)). The 1.2.0 plan had Mode_Code keep its own copies; Claude Code already keeps them, for the last hundred messages and across a resumed session, so Mode_Code gives it a short name instead of a second store. As there: what a shell command changed is not undone.

## The skills of others

Mode_Code carries 33 skills by others, chosen in the 1.2.0 research and checked by hand: each is copied unchanged from its author's repository at a pinned commit, with that repository's licence beside it (`skills-external/<name>/LICENSE.source`) and where it came from in `skills-external/sources.json` (`scripts/vendor-skills.mjs` fetches them again; the result is reviewed before it is committed). Their authors have not reviewed or endorsed Mode_Code.

Each is **off** until you turn it on, in the control center (Claude Code › Commands and skills) or with `mode-code skills`:

- `on`: Claude may load it by itself when its description fits the work (its line is then in every session);
- `me`: only when you run it (`/mode-code:<name>`), at no cost until then;
- `off`: not there.

It loads at `/reload-plugins` or in the next session. Turning one on is yours: Claude cannot (the command refuses inside a Claude Code session, and the folder it is kept in is the belt's to protect).

| Field              | Skills                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning, design   | `grilling`, `grill-me`, `prototype`, `codebase-design`, `improve-codebase-architecture`, `domain-modeling` (mattpocock/skills, MIT)                                                          |
| Debugging, testing | `diagnosing-bugs`, `tdd` (mattpocock/skills); `systematic-debugging`, `verification-before-completion`, `receiving-code-review` (obra/superpowers, MIT)                                      |
| Writing            | `writing-for-agents`, `teach` (mattpocock/skills); `humanizer` (blader, MIT); `source-driven-development` (addyosmani, MIT)                                                                  |
| Anthropic          | `frontend-design`, `claude-md-improver`, `session-report` (claude-plugins-official, Apache-2.0)                                                                                              |
| Security           | `gha-security-review` (getsentry/skills, Apache-2.0)                                                                                                                                         |
| Firebase, Flutter  | `firebase-security-rules-auditor`, `firestore-rules-creation` (firebase/agent-skills, Apache-2.0); `firebase-cloud-firestore`, `dart-3-updates` (evanca/flutter-ai-rules, MIT)               |
| App stores         | `appstore-review`, `playstore-review` (devsemih, MIT); `store-quirks` (tramlinehq, CC0); `aso` (coreyhaines31/marketingskills, MIT)                                                          |
| Electronics, 3D    | `use-kicad-cli` (FradSer/dotclaude, MIT); `wiring-safety-check`, `power-budget-calculator`, `i2c-bringup-diagnostician` (wedsamuel1230, MIT); `openscad` (mitsuhiko/agent-stuff, Apache-2.0) |
| GPU                | `cuda-profiling` (mohitmishra786/low-level-dev-skills, MIT)                                                                                                                                  |

Chosen in the research but not carried: `k12-lesson-plan-creation` (its script installs a Python package by itself, and it leans on remote MCP servers), `play-policy-insights` and `scientific-writing` (their scripts, 100 KB and 70 KB, were not reviewed line by line), the Typst skill (10 MB of data; the `typst` [tool pack](packs.md) has a guide), `platformio-debug` (no licence found). The research's list of what was left out, and why, stands: skills that tell the model to obey them "ABSOLUTELY", that install skills unreviewed, that skip an approval step.

## Settings

```json
"skills": { "items": { "tdd": "on", "teach": "me" } }
```

Yours alone, as the packs' are; synced across computers, turning a skill on or letting Claude use it waits for you ([sync.md](sync.md)).

## Limits

- A skill is instructions: Claude follows it as written, within the belt. A skill of others turned `on` can be loaded whenever its description fits, which is its author's wording.
- Short commands are Turkish only; in English, `/mode-code:<name>`.
- The list a session shows reads the settings as the session started.

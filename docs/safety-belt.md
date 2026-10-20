# The safety belt

The belt reads every shell command (Bash, PowerShell, and the scripts Monitor runs), every file write (Write, Edit, MultiEdit, NotebookEdit) and every call to a connected service (MCP servers: mail, calendars, drives …) before it runs, and answers with one of four actions:

| Action | In the settings file | What happens                                                                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| block  | `deny`               | The call does not run. Claude is told what was blocked and not to work around it.                                                |
| ask    | `ask`                | You decide in a dialog. With no one to ask (a headless `claude -p` run) the call is blocked. Your decision covers that one call. |
| note   | `warn`               | The call runs and Claude gets a note about the risk.                                                                             |
| allow  | `allow`              | Nothing to say.                                                                                                                  |

## Two layers, one decision

The same code decides in two places:

1. **The plugin** inside Claude Code checks each call in-process and asks you directly when a rule says ask.
2. **The hook program** runs as a Claude Code settings hook (exec form, an absolute path to Node.js, `onFailure: "block"`), beneath the plugin. It honours your answer for that exact call, and when the plugin is not loaded it decides alone. If the hook program cannot start or crashes, Claude Code blocks the call. It checks commands and file writes; calls to connected services are checked by the plugin alone, so that each one does not start a program.

A protection never turns gray: if something is broken, the control center shows it red and the hook keeps blocking what it can.

## How commands are read

- bash, PowerShell and cmd syntax, including quotes, escapes, here-documents, substitutions and script blocks;
- wrappers are unwrapped (`sudo`, `env`, `nohup`, `xargs`, `bash -c`, `pwsh -Command`, encoded PowerShell) and interpreter code is read again;
- package runners are read as the program they run, in PowerShell as in bash: `npx wrangler deploy` is judged as `wrangler deploy`, and so are `pnpx`, `pnpm dlx`, `yarn dlx`, `bunx` and `bun x`;
- a dry run is not the real thing: `--dry-run` and its spellings exempt publishing and deployment from the question;
- git is read the way git reads it: global options (`-C`, `-c`, `--git-dir`), refspecs (`:branch` deletes it), and aliases (looked up in the repository); a repository is recognised by its remote however it was cloned (`https://github.com/me/app`, `git@github.com:me/app.git`);
- paths are resolved the way the shell would (`~`, `$HOME`, `%USERPROFILE%`, `/c/...`), case-insensitively on Windows and macOS;
- a protected place is recognised under every spelling of it: Windows 8.3 short names (`MODECO~1`), the trailing dots and spaces Windows drops from a name (`.claude.`), and folders that are links (a dotfiles repository behind `~/.claude`, under either name);
- a variable set once earlier in the same command, with a plain value, is filled in (`T=C:/tools/run.sh; $T` runs `run.sh`); a value set in a branch, a loop, after `||`, in a pipeline or more than once stays unknown;
- code that is only known at run time (`eval` of a computed string, code built from variables) is **asked about**, never assumed safe. A program name whose value comes from outside the command (`$ADB devices`) is asked about only when its own arguments look risky (`rm`, `--force`, `-rf`, …): agents use such variables all the time for long tool paths.

Permission rules in Claude Code match the command text; the belt reads the command. A rule like `Bash(git push --force*)` does not match `git -C . push --force`; the belt does.

## Rules

Run `mode-code belt rules` (or open Protection › Safety belt rules) for the current list with your changes applied. Groups:

- **git and GitHub:** force-push (protected branches blocked, others asked), deleting remote branches, mirror pushes and pruning, pushing past pull requests, new branches in one-branch repositories, history rewrites, the hooks path, `--no-verify`, `git clean`, discarding uncommitted work, force-deleting branches; merging a pull request with admin rights past the required checks; deleting or archiving on GitHub (releases, secrets, variables, `gh api -X DELETE`).
- **files and disks:** deleting or moving the home folder, a system folder, a drive root or anything that contains one; recursive deletes outside the project (inside the folders you registered as projects counts as inside; a session started in the home folder does not make the whole home folder a project; temporary folders are free); deleting a `.git` folder; formatting or overwriting disks.
- **self-protection (locked):** Claude Code's user and managed settings and its folder, turning hooks off, this tool's files and folder, removing its plugin, nested sessions without hooks, deleting memory, shrinking memory a lot in one write, rewriting memory history.
- **Claude Code configuration:** `claude plugin`, `claude mcp`, `claude config` changes.
- **things that start by themselves:** scheduled tasks and services, startup folders, shell profiles, SSH keys and settings.
- **publishing:** packages and releases, making repositories public, deployments; and an app store upload, submission or release (`asc`, `gplay`, `fastlane`, `eas submit`, `altool`), asked with bypass on too.
- **Docker** (optional pack, for a machine that holds live data): deleting volumes and pruning.
- **data elsewhere:** deleting data in the cloud is blocked (Firebase, storage buckets, managed databases, cloud projects, a GitHub repository); overwriting a live Firebase database is asked; dropping or resetting a database (`prisma migrate reset`, `supabase db reset`, `DROP DATABASE`, `FLUSHALL` …) is asked, since the command does not show whether it is a development copy. A Firebase emulator in the environment exempts Firebase.
- **security software:** turning off or weakening Defender (and adding exclusions to it), the firewall, account control, Gatekeeper or SELinux is blocked.
- **connected services:** sending, replying, forwarding, sharing, inviting and calendar events are asked: they reach other people and cannot be taken back; deleting or trashing there is asked too. Reading is never asked. A payment (a charge, a refund, a subscription; through the Stripe command line or a connected service) is asked with bypass on too.
- **secrets:** staging files that usually hold secrets, writing what looks like a secret into a file; and, locked, a secret leaving the computer: a key or credential file uploaded (`curl -F file=@…`, `scp`, `rsync`, a gist, piped into a network program) or a secret in a request body, a message or a document sent through a connected service. Authenticating to a service with a key (a header, a client certificate, an SSH identity) is not sending it.
- **outside content (in the plugin, not the safety-net hook):** once a session has read what someone else wrote (a web page or search, an issue or pull request through `gh`, a page fetched with `curl`, a connected service's data, a dependency's files, another session's message), an instruction hidden there could steer what comes next. From then on the session asks before it sends data out of the computer (a request body, an upload, a raw socket, a copy to another host, a comment through `gh`, a connected service's send), writes something that starts by itself or configures Claude Code (a plugin, an MCP server or a [tool pack](packs.md) turned on included), or writes to the memory; with bypass on too. Reading more, and the project's own work, are not asked. What such a source returns reaches Claude without the characters nobody sees (Unicode tags, direction overrides, zero-width spaces: instructions can be spelled in them), with a note saying how many were taken out.
- **the project's checks:** changing the settings of its linters and formatters (ESLint, Prettier, Biome, Stylelint, `analysis_options.yaml`, Ruff, golangci-lint …) is asked: loosening a rule is how a failing check is made to pass. Running them, or reading their settings, is not.
- **unverifiable commands (locked):** what the belt cannot follow: code built at run time (`eval "$X"`, `bash -c "$X"`, `| iex`), and code that comes down a pipe into a shell or an interpreter (`curl … | sh`, `… | base64 -d | bash`, `… | python3 -`) or is handed over by process substitution (`bash <(curl …)`). Data piped into a named script or into inline code is not asked about. Mode_Code's own one-line installer, run this way from inside a session, is asked about too: run it in your own terminal.

## What else runs

The belt judges what the model asks for. Plugins and their mods run unsandboxed in Claude Code's own process and can answer its tool calls; hooks run a command on every event they name; an MCP server reads what Claude sends it, and its tools describe themselves to the model in their own words. `mode-code trust` lists all of them with where each is set and marks what is new since you last looked (run in your own terminal: inside a session it only shows). The plugin keeps each MCP tool's description as first seen and tells you when one changes.

`claude --bare` runs without hooks or plugins, so without the belt: the belt blocks it from inside a session. A run of your own with `--bare` (a script, the Agent SDK) should narrow its tools with `--allowedTools`, or run in a sandbox. On Windows there is no sandbox for Claude Code yet; Anthropic's `sandbox-runtime` is an early option the doctor does not set up.

## Questions you already answered

Claude Code asks about a compound command (`cd app && npm test`, `npm run build && npm test`) even when your allow rules cover each part. The plugin answers yes for you when an allow rule in your settings (user, project or local: `Bash(npm test:*)`, `Bash(git status)`) covers every part, and a `cd`, `pushd` or `Set-Location` only moves into the project or a folder in it. A part no rule covers, a `cd` elsewhere, a redirect into a file or a nested command is asked as before. Each answer is recorded (`permission`, `parts` in the events). Measured in a real session (`scripts/test-live.mjs`, case 12): Claude Code asked, and the plugin's answer let the command run.

## Hints

Said to Claude once a session, after the call that earned it; a hint, never a rule:

- a file read through the shell (`cat`, `head`, `sed -n '1,80p'`, `grep -rn`) where Claude Code's Read or Grep tool reads it for less context (on the author's machine, 2026-10-16, shell reads were 9.3% of the quota);
- on Windows, an unquoted heredoc whose body holds backslashes: Git Bash expands them, and `$`, so the file may not get what was written;
- a build or a test piped into a filter (`npm test | tail -20`) without `pipefail`: the pipe's exit code is the filter's, so a failure reads as a success.

## Bypass

Bypass lifts the belt for one session, for a while, when you turn it on ([autonomy.md](autonomy.md)). It does not lift everything, and what it lifts it records:

| Tier                  | Rules                                                                                                                                                                                           | Without bypass   | With bypass                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- |
| never                 | self-protection; a secret leaving the computer                                                                                                                                                  | as set (blocked) | the same: there is no way around it |
| blocked, then asked   | deleting or moving a drive root, a system folder or the home folder; formatting a disk; deleting data in the cloud; Docker volumes (pack); security software                                    | blocked          | asked                               |
| always asked          | recursive deletes outside the project; a `.git` folder; a database reset; staging a secrets file; what the belt cannot follow; an app store upload; a payment; what outside content could steer | asked            | asked                               |
| let through, recorded | everything else                                                                                                                                                                                 | as set           | runs; recorded for you to review    |

A block in the second tier says so: with bypass on, the same call is asked instead. The person decides that, never Claude: bypass is turned on by you, and Claude cannot turn it on or off.

## Auto mode

In Claude Code's auto mode a classifier answers Claude Code's own permission questions in your place. The belt's questions are not among them: a command the belt asks about still comes to you, and in a session with no one to ask (`claude -p`) it is refused. Measured in the real engine with each release (`scripts/test-live.mjs`, case 16: in auto mode a commit the belt allows runs unasked, the same commit with `--no-verify` is refused; Claude Code 2.1.302, 2026-10-18). The doctor notes when your settings start Claude Code in auto mode.

## Folded in

Before the belt, two other guards often stood on the same machine: permission rules in Claude Code's settings (`permissions.deny` and `ask`, often in the managed settings an administrator writes) and command guards in a memory system's own hooks. They did part of the belt's work with patterns that match the command text, and a deny rule has no way to say yes: a deletion the person asked for was refused all the same. The belt covers them; `test/corpus/automation-parity.test.ts` holds one such setup's 78 rules and its guards, each with a sample the belt must ask about or block, and the spellings their patterns missed (`git push origin :branch`, `git -C . push --force`). Rules you keep in Claude Code's own settings still apply, and bypass does not touch them.

## Changing a rule

From your own terminal (not from inside a Claude Code session):

```sh
mode-code config set belt.verdicts.git.force-push deny
mode-code config set belt.disabled '["git.no-verify"]'
mode-code config set belt.protectedBranches '["main","develop"]'
```

Locked rules accept only stricter actions; the settings file cannot switch them off.

## Testing

`mode-code belt test --command "git clean -f"` or Protection › Test a command shows the decision without running anything.

## Limits

On native Windows there is no sandbox under Claude Code, and a script file can do what a single command cannot. There the belt prevents accidents; it is not a security boundary against a determined adversary. On macOS, Linux and WSL2, Claude Code's sandbox (`sandbox.filesystem.denyWrite`) adds a layer the belt does not replace; full autonomy requires it ([autonomy.md](autonomy.md)).

A command typed on Windows for a WSL distribution (`wsl -d <name> -- …`) is judged with the distribution's paths: its home and absolute paths are the distribution's (shown as `//wsl.localhost/<name>/…`), the Windows drives it mounts under `/mnt` are Windows paths with Windows' protection, a relative path is relative to where `wsl` starts, and deleting the distribution's root, home or system folders is refused.

During a full-autonomy run there is nobody to ask: what a rule would ask about is refused as **deferred**, recorded with its exact command, and listed in the run's report for the person.

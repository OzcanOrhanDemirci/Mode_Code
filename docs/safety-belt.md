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

Run `mode-code belt rules` (or open Security › Safety belt rules) for the current list with your changes applied. Groups:

- **git and GitHub:** force-push (protected branches blocked, others asked), deleting remote branches, mirror pushes and pruning, pushing past pull requests, new branches in one-branch repositories, history rewrites, the hooks path, `--no-verify`, `git clean`, discarding uncommitted work, force-deleting branches; merging a pull request with admin rights past the required checks; deleting or archiving on GitHub (releases, secrets, variables, `gh api -X DELETE`).
- **files and disks:** deleting or moving the home folder, a system folder, a drive root or anything that contains one; recursive deletes outside the project (inside the folders you registered as projects counts as inside; a session started in the home folder does not make the whole home folder a project; temporary folders are free); deleting a `.git` folder; formatting or overwriting disks.
- **self-protection (locked):** Claude Code's user and managed settings and its folder, turning hooks off, this tool's files and folder, removing its plugin, nested sessions without hooks, deleting memory, shrinking memory a lot in one write, rewriting memory history.
- **Claude Code configuration:** `claude plugin`, `claude mcp`, `claude config` changes.
- **things that start by themselves:** scheduled tasks and services, startup folders, shell profiles, SSH keys and settings.
- **publishing:** packages and releases, making repositories public, deployments.
- **Docker** (optional pack, for a machine that holds live data): deleting volumes and pruning.
- **data elsewhere:** deleting data in the cloud is blocked (Firebase, storage buckets, managed databases, cloud projects, a GitHub repository); overwriting a live Firebase database is asked; dropping or resetting a database (`prisma migrate reset`, `supabase db reset`, `DROP DATABASE`, `FLUSHALL` …) is asked, since the command does not show whether it is a development copy. A Firebase emulator in the environment exempts Firebase.
- **security software:** turning off or weakening Defender (and adding exclusions to it), the firewall, account control, Gatekeeper or SELinux is blocked.
- **connected services:** sending, replying, forwarding, sharing, inviting and calendar events are asked: they reach other people and cannot be taken back; deleting or trashing there is asked too. Reading is never asked.
- **secrets:** staging files that usually hold secrets, writing what looks like a secret into a file; and, locked, a secret leaving the computer: a key or credential file uploaded (`curl -F file=@…`, `scp`, `rsync`, a gist, piped into a network program) or a secret in a request body, a message or a document sent through a connected service. Authenticating to a service with a key (a header, a client certificate, an SSH identity) is not sending it.
- **unverifiable commands (locked):** what the belt cannot follow.

## Bypass

Bypass lifts the belt for one session, for a while, when you turn it on ([autonomy.md](autonomy.md)). It does not lift everything, and what it lifts it records:

| Tier                  | Rules                                                                                                                                                        | Without bypass   | With bypass                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------- |
| never                 | self-protection; a secret leaving the computer                                                                                                               | as set (blocked) | the same: there is no way around it |
| blocked, then asked   | deleting or moving a drive root, a system folder or the home folder; formatting a disk; deleting data in the cloud; Docker volumes (pack); security software | blocked          | asked                               |
| always asked          | recursive deletes outside the project; a `.git` folder; a database reset; staging a secrets file; what the belt cannot follow                                | asked            | asked                               |
| let through, recorded | everything else                                                                                                                                              | as set           | runs; recorded for you to review    |

A block in the second tier says so: with bypass on, the same call is asked instead. The person decides that, never Claude: bypass is turned on by you, and Claude cannot turn it on or off.

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

`mode-code belt test --command "git clean -f"` or Security › Test a command shows the decision without running anything.

## Limits

On native Windows there is no sandbox under Claude Code, and a script file can do what a single command cannot. There the belt prevents accidents; it is not a security boundary against a determined adversary. On macOS, Linux and WSL2, Claude Code's sandbox (`sandbox.filesystem.denyWrite`) adds a layer the belt does not replace; full autonomy requires it ([autonomy.md](autonomy.md)).

A command typed on Windows for a WSL distribution (`wsl -d <name> -- …`) is judged with the distribution's paths: its home and absolute paths are the distribution's (shown as `//wsl.localhost/<name>/…`), the Windows drives it mounts under `/mnt` are Windows paths with Windows' protection, a relative path is relative to where `wsl` starts, and deleting the distribution's root, home or system folders is refused.

During a full-autonomy run there is nobody to ask: what a rule would ask about is refused as **deferred**, recorded with its exact command, and listed in the run's report for the person.

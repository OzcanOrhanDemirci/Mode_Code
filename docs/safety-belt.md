# The safety belt

The belt reads every shell command (Bash, PowerShell) and every file write (Write, Edit, MultiEdit, NotebookEdit) before it runs, and answers with one of four actions:

| Action | In the settings file | What happens                                                                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| block  | `deny`               | The call does not run. Claude is told what was blocked and not to work around it.                                                |
| ask    | `ask`                | You decide in a dialog. With no one to ask (a headless `claude -p` run) the call is blocked. Your decision covers that one call. |
| note   | `warn`               | The call runs and Claude gets a note about the risk.                                                                             |
| allow  | `allow`              | Nothing to say.                                                                                                                  |

## Two layers, one decision

The same code decides in two places:

1. **The plugin** inside Claude Code checks each call in-process and asks you directly when a rule says ask.
2. **The hook program** runs as a Claude Code settings hook (exec form, an absolute path to Node.js, `onFailure: "block"`), beneath the plugin. It honours your answer for that exact call, and when the plugin is not loaded it decides alone. If the hook program cannot start or crashes, Claude Code blocks the call.

A protection never turns gray: if something is broken, the control center shows it red and the hook keeps blocking what it can.

## How commands are read

- bash, PowerShell and cmd syntax, including quotes, escapes, here-documents, substitutions and script blocks;
- wrappers are unwrapped (`sudo`, `env`, `nohup`, `xargs`, `bash -c`, `pwsh -Command`, encoded PowerShell) and interpreter code is read again;
- git is read the way git reads it: global options (`-C`, `-c`, `--git-dir`), refspecs (`:branch` deletes it), and aliases (looked up in the repository);
- paths are resolved the way the shell would (`~`, `$HOME`, `%USERPROFILE%`, `/c/...`), case-insensitively on Windows and macOS;
- code that is only known at run time (a variable that holds a command, `eval` of a computed string) is **asked about**, never assumed safe.

Permission rules in Claude Code match the command text; the belt reads the command. A rule like `Bash(git push --force*)` does not match `git -C . push --force`; the belt does.

## Rules

Run `terminal-code belt rules` (or open Security › Safety belt rules) for the current list with your changes applied. Groups:

- **git:** force-push (protected branches blocked, others asked), deleting remote branches, mirror pushes and pruning, pushing past pull requests, new branches in one-branch repositories, history rewrites, the hooks path, `--no-verify`, `git clean`, discarding uncommitted work, force-deleting branches.
- **files and disks:** deleting or moving the home folder, a system folder, a drive root or anything that contains one; recursive deletes outside the project; deleting a `.git` folder; formatting or overwriting disks.
- **self-protection (locked):** Claude Code's user and managed settings, turning hooks off, this tool's files, removing its plugin, nested sessions without hooks, deleting memory, shrinking memory a lot in one write, rewriting memory history.
- **Claude Code configuration:** `claude plugin`, `claude mcp`, `claude config` changes.
- **things that start by themselves:** scheduled tasks and services, startup folders, shell profiles, SSH keys and settings.
- **publishing:** packages and releases, making repositories public, deployments.
- **Docker** (optional pack): deleting volumes and pruning.
- **secrets:** staging files that usually hold secrets, writing what looks like a secret into a file.
- **unverifiable commands (locked):** what the belt cannot follow.

## Changing a rule

From your own terminal (not from inside a Claude Code session):

```sh
terminal-code config set belt.verdicts.git.force-push deny
terminal-code config set belt.disabled '["git.no-verify"]'
terminal-code config set belt.protectedBranches '["main","develop"]'
```

Locked rules accept only stricter actions; the settings file cannot switch them off.

## Testing

`terminal-code belt test --command "git clean -f"` or Security › Test a command shows the decision without running anything.

## Limits

On native Windows there is no sandbox under Claude Code, and a script file can do what a single command cannot. There the belt prevents accidents; it is not a security boundary against a determined adversary. On macOS, Linux and WSL2, Claude Code's sandbox (`sandbox.filesystem.denyWrite`) adds a layer the belt does not replace.

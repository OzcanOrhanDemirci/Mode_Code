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
- the code an interpreter is given is read where it stands: after its inline option (`python -c`, `node -e`, `ruby -e`, `perl -e`, `php -r`, `osascript -e`, `bun -e`, `deno eval`), or on its standard input, as the body of a here-document or a here-string (`python3 - <<'EOF'`, `node <<< '…'`, `bun run -`, `osascript <<EOF`; with `-`, `/dev/stdin` or neither, and the interpreter's own options before it). A here-document given to a shell is read as commands (`bash <<EOF`, `sh -s`). One that only carries data (`cat <<EOF > file`, `git commit -F - <<EOF`, a script or a module named beside it) stays data. Code is read as code, not as the text it is made of: a delete call written inside a string, a comment or a regular expression (a script that edits another script), or a function of the script's own named `rm`, is no call; an `open` reads unless its mode writes; a string that begins like a command (`git push`, `gh release create`) is a command when the code runs commands (`os.system`, `subprocess`, `execSync`, a backtick), not when it is searched for or printed;
- package runners are read as the program they run, in PowerShell as in bash: `npx wrangler deploy` is judged as `wrangler deploy`, and so are `pnpx`, `pnpm dlx`, `yarn dlx`, `bunx` and `bun x`;
- a dry run is not the real thing: `--dry-run` and its spellings exempt publishing and deployment from the question;
- git is read the way git reads it: global options (`-C`, `-c`, `--git-dir`), refspecs (`:branch` deletes it), and aliases (looked up in the repository); a repository is recognised by its remote however it was cloned (`https://github.com/me/app`, `git@github.com:me/app.git`);
- paths are resolved the way the shell would (`~`, `$HOME`, `%USERPROFILE%`, `/c/...`), case-insensitively on Windows and macOS;
- a protected place is recognised under every spelling of it: Windows 8.3 short names (`MODECO~1`), the trailing dots and spaces Windows drops from a name (`.claude.`), and folders that are links (a dotfiles repository behind `~/.claude`, under either name);
- a variable set once earlier in the same command, with a plain value, is filled in (`T=C:/tools/run.sh; $T` runs `run.sh`); a value set in a branch, a loop, after `||`, in a pipeline or more than once stays unknown;
- code that is only known at run time (`eval` of a computed string, code built from variables) is **asked about**, never assumed safe. A program name whose value comes from outside the command (`$ADB devices`) is asked about only when its own arguments look risky (`rm`, `--force`, `-rf`, …): agents use such variables all the time for long tool paths.

One reader, measured against a second (2026-10-21, the core protection's step 9). Tree-sitter's Bash grammar, which Codex and Gemini CLI use, read the 44,434 distinct Bash commands of the author's sessions beside Mode_Code's own reader: where both read a command whole they found the same commands word for word in 38,235, and of the 7 commands whose text Mode_Code's reader could not follow, tree-sitter read 1. It also passed over text without an error (the `-` in `python - <<'EOF'`, in 5,696 commands) and gave a redirection after `a && b` to the whole list instead of `b`. A second reading would have cleared 1 command in 44,434, so there is none: Claude Code gives a plugin no WebAssembly, the grammar is larger than a plugin's code may be, and each command would start a process. PowerShell's own parser was measured too (264 to 426 ms a start, for the 1.6 % of calls that are PowerShell) and is not used either. What the belt still cannot follow is mostly code built at run time (`bash -c "$X"`, `eval`, a script piped into an interpreter, a program named by a variable): 49 questions in 42,990 calls of the same sessions, in Autonomous, of which 6 are text it could not read. No parser reads those, and they stay asked.

Permission rules in Claude Code match the command text; the belt reads the command. A rule like `Bash(git push --force*)` does not match `git -C . push --force`; the belt does.

## Rules

Run `mode-code belt rules` (or open Protection › Safety belt rules) for the current list with your changes applied. Groups:

- **git and GitHub:** force-push (protected branches blocked, others asked), deleting remote branches, mirror pushes and pruning, pushing past pull requests, new branches in one-branch repositories, history rewrites, the hooks path, `--no-verify`, `git clean`, discarding uncommitted work, force-deleting branches; merging a pull request with admin rights past the required checks; deleting or archiving on GitHub (releases, secrets, variables, `gh api -X DELETE`).
- **files and disks:** deleting or moving the home folder, a system folder, a drive root or anything that contains one; recursive deletes outside the project (inside the folders you registered as projects counts as inside; a session started in the home folder does not make the whole home folder a project; temporary folders are free); deleting a `.git` folder; formatting or overwriting disks.
- **self-protection (locked):** Claude Code's user and managed settings and its folder, turning hooks off, this tool's files and folder, removing its plugin, nested sessions without hooks, deleting memory, shrinking memory a lot in one write, rewriting memory history.
- **Claude Code configuration:** `claude plugin`, `claude mcp`, `claude config` changes.
- **things that start by themselves:** scheduled tasks and services, startup folders, shell profiles, SSH keys and settings.
- **publishing:** packages and releases, making repositories public, deployments; and an app store upload, submission or release (`asc`, `gplay`, `fastlane`, `eas submit`, `altool`), always asked.
- **Docker** (optional pack, for a machine that holds live data): deleting volumes and pruning.
- **data elsewhere:** deleting data in the cloud is blocked (Firebase, storage buckets, managed databases, cloud projects, a GitHub repository); overwriting a live Firebase database is asked; dropping or resetting a database (`prisma migrate reset`, `supabase db reset`, `DROP DATABASE`, `FLUSHALL` …) is asked, since the command does not show whether it is a development copy. A Firebase emulator in the environment exempts Firebase.
- **security software:** turning off or weakening Defender (and adding exclusions to it), the firewall, account control, Gatekeeper or SELinux is blocked.
- **connected services:** sending, replying, forwarding, sharing, inviting and calendar events are asked: they reach other people and cannot be taken back; deleting or trashing there is asked too. Reading is never asked. A payment (a charge, a refund, a subscription; through the Stripe command line or a connected service) is always asked.
- **secrets:** staging files that usually hold secrets, writing what looks like a secret into a file; and, locked, a secret leaving the computer: a key or credential file uploaded (`curl -F file=@…`, `scp`, `rsync`, a gist, piped into a network program) or a secret in a request body, a message or a document sent through a connected service. Authenticating to a service with a key (a header, a client certificate, an SSH identity) is not sending it.
- **outside content (in the plugin, not the safety-net hook):** once a session has read what someone else wrote (a web page or search, an issue or pull request through `gh`, a page fetched with `curl`, a connected service's data, a dependency's files, another session's message), an instruction hidden there could steer what comes next. From then on the session asks before it sends data out of the computer to a host neither you named nor the project's remotes hold (a request body, an upload, a raw socket, a copy to another host, a comment through `gh`, a connected service's send), writes something that starts by itself or configures Claude Code (a plugin, an MCP server or a [tool pack](packs.md) turned on included), or writes into the memory something it read there ([Evidence](#evidence)). Reading more, the project's own work, and its own notes in the memory are not asked. What such a source returns reaches Claude without the characters nobody sees (Unicode tags, direction overrides, zero-width spaces: instructions can be spelled in them), with a note saying how many were taken out.
- **the project's checks:** changing the settings of its linters and formatters (ESLint, Prettier, Biome, Stylelint, `analysis_options.yaml`, Ruff, golangci-lint …) is asked: loosening a rule is how a failing check is made to pass. Running them, or reading their settings, is not.
- **unverifiable commands (locked):** what the belt cannot follow: code built at run time (`eval "$X"`, `bash -c "$X"`, `| iex`), and code that comes down a pipe into a shell or an interpreter (`curl … | sh`, `… | base64 -d | bash`, `… | python3 -`) or is handed over by process substitution (`bash <(curl …)`). Data piped into a named script or into inline code is not asked about, and an interpreter's own options before the dash do not hide code (`… | python3 -E -`, `… | bash -e`). Mode_Code's own one-line installer, run this way from inside a session, is asked about too: run it in your own terminal.

## Ways of working

The rules are the same in every way of working; the way of working on the strip says how much is asked (decided with the person, 2026-10-20: one protection, always on).

| Way of working | A rule that would ask                                                                                                 | Claude Code's own question                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Manual         | asks you                                                                                                              | stays yours: Claude Code asks you, one step at a time |
| Autonomous     | asks you where it matters; what is only the project's own (skipping its hooks, discarding uncommitted work) is a note | answered yes, once the belt let the call through      |
| Full autonomy  | asks nobody: the step is **left to you**, with the command exactly as it would run, and Claude goes on with the rest  | answered yes, once the belt let the call through      |

- **What is blocked stays blocked**, in every way of working: deleting the home folder or a system folder, a protected branch's history, the tool's own files. The refusal says what was meant and the command for you to run yourself (`! <command>`), every character shown, the invisible ones too.
- **A secret leaving the computer is stopped** outright: nobody is told to run it.
- **Your own question stays yours.** A rule in your Claude Code settings (or your organisation's), another hook's question and an option's own check are put to you, never to a classifier; in full autonomy, with nobody to ask, the step is left to you. What Claude Code or your rules deny stays denied.
- **Manual waits for you before a commit and a push**, whatever else lets them through (`git commit`, `git push`, in any spelling of git); with nobody to ask (a headless run) they do not run.
- **A safety net turns a question into an undoable step** in Autonomous and full autonomy (below): with what the call takes away kept first, it runs.
- `mode-code belt test --level autonomous --command "git reset --hard"` shows what a way of working decides; `mode-code belt rules` lists each rule's verdict in Manual.

## Three more families

- **Data sent off the computer** (`outbound.network`): a request body or method, an upload, a raw socket, a copy to another host, a comment through `gh`. Reading is free (`gh api` with `-X GET` or a GraphQL query too); this computer (`localhost`, `127.0.0.1`, `::1`) is no outside. `gh`'s GitHub is the tool's own host, written nowhere in the call: it is never taken for one read from outside. To a host you named in this session, or one of the project's remotes, it goes on with a note in Autonomous and full autonomy; to any other host it is asked in Autonomous and left to you in full autonomy; to a host found only in what the session read from outside, it is refused everywhere ([Evidence](#evidence)).
- **A file something more trusted runs later** (`persist.autorun`): a git hook (`.git/hooks/`), husky's (`.husky/`), direnv's `.envrc`, a macOS launch agent, a `package.json` given a script that runs on install. Asked, and in Autonomous a note when the text written is word for word yours; left to you in full autonomy unless you clearly asked for it ([A clear request](#a-clear-request-in-full-autonomy)). The broad ring (an editor's tasks, a dev container, CI workflows), run later by your own tools, is a note.
- **Another agent program started without its own approvals** (`codex --yolo`, `gemini --yolo`, `aider --yes-always`, `amp --dangerously-allow-all`): a session the belt does not watch, left to you in every way of working (`self.nested-session`).

With these, outside content no longer asks about sending or about what starts by itself on its own: those are the rules above, for every session. What it still asks is writing into the memory what was read from outside.

## Fewer false alarms

Measured on real sessions (the decision table's baseline), four kinds of question were the belt's own mistakes, now answered by what code can check:

- **A branch already merged** into the current one (`git branch -D old`): no commit is lost, so it is a note at every level, not a question.
- **A folder this session made** (a new file it wrote, a folder its `mkdir` made) is its own to remove, at every level: deleting it outside the project is not asked.
- **The home folder of a system user** (`/root` for an agent that runs as root in a container) is the person's own, as any home folder: its insides follow the ordinary rules; the folder itself and the system's own stay critical.
- **A test's own data** (its `test`, `spec`, `fixtures`, `mocks` folders, a file named `a.test.ts` or `a_test.go`): a token shaped like a real one there is no note when written; staging it for a commit is still checked.

Measured again on other agents' everyday work (`docs/testing.md`, Evaluation sets), five more:

- **Data piped to a script or a module** (`… | python -m sqlfluff lint -`, `… | python check.py -`): an interpreter's own options come first, and the first other word is a script (or Python's module), whose arguments are its own. Code piped into an interpreter or a shell is still asked.
- **A setting read** (`git config core.hooksPath`, `git config get core.hooksPath`): reading git's hooks path changes nothing; setting or unsetting it is still asked.
- **A cache** (`~/.cache`, macOS's `~/Library/Caches`, `$XDG_CACHE_HOME`) is deleted freely, as a temporary folder is: what is kept there is made again.
- **A language's package folder** inside a system folder (`site-packages`, `dist-packages`, `node_modules` under `/opt` or `/usr`): what a package manager installs again is no system file, so deleting or moving inside it follows the ordinary rules; the folder itself stays critical.
- **Code that deletes** (`python -c`, `node -e`, a here-document): the paths a delete call is given, directly or through a name the code assigns, are checked as deleted, not every path the code names (an XPath beside `os.unlink(tmp)`, a test of an in-memory filesystem). A name the code never assigns (a parameter) still makes every path it names count.

Measured on the author's own sessions, replayed with what each was told and read, four more:

- **A folder from `mktemp`** (`T=$(mktemp -d)`, flags only): a new name in the temporary folder, so deleting it is free. A template, `-p` or `--tmpdir` keeps it unknown.
- **A read through `gh api`** (`-X GET`, `--method GET`, a GraphQL query) sends nothing; a write method, a field without one, a GraphQL mutation or a query from a file still does.
- **gh's own host:** GitHub, named nowhere in a `gh` call, is never taken for a host read from outside; named by you or the project's remote, it is still evidence.
- **A name with a dot is a host only with a real ending** (`example.com`, `api.dev`, any two letters; `tool.check` or `prov.seen` are not), a URL's host always: a rule's or a field's name in a note was taken for a host read from outside.

Measured when the body of a here-document was first read as code (2026-10-21; 5,696 of the 44,434 commands of the author's sessions hand a script to an interpreter this way), the reader written for one-liners took text for code in 8 of them, and had taken it in 5 of the author's earlier `python -c` and `node -e` calls; three more:

- **A call is code, not text:** a delete call written inside a string, a comment, a regular expression or a template (a script that edits another script holds them as text), or a function the script defines itself (`const rm = …`), is no delete. A string that holds code and is then run (`exec`, `eval`) is text to the reader, as it was.
- **An `open` reads unless its mode writes:** `open(path)`, `'r'`, `'rb'`, `encoding=…` read; `'w'`, `'a'`, `'x'`, `'+'`, a mode the code does not show, and low-level flags (`O_WRONLY`, `O_APPEND`) write. Three reads of a settings file had been refused as writes.
- **A string that begins like a command is one where the code runs commands** (`os.system`, `subprocess`, `execSync`, a backtick, or a call reached by a string or a name), not where it is searched for or printed: `s.find('gh release create')` is no release.

The reader's lexer is checked against a real parser on JavaScript (the repository's own code and the code of its dependencies: the strings found are the same, except where a template holds a bare `$` or another template, which the reader leaves alone). Where it is not sure of a language's strings (Ruby, Perl, PHP, AppleScript), it blanks comments only, and a call written in a string still counts. Replayed again, the same sessions have none of the 8 and none of the 5.

A verdict you gave a rule holds over all of them.

## Safety net

Some risky calls take away only what can be kept first. In Autonomous and full autonomy the belt lets them through once it is kept; Manual asks as before. The safety-net hook keeps it, in a process of its own, before the call runs (`src/core/net.ts`, `src/node/net.ts`), and the activity says what was kept and how to put it back.

| Rule                                                                          | What is kept before the call                                                                                           | With it, Autonomous and full autonomy |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `git.discard-work` (`reset --hard`, `checkout -- .`, `restore`, `stash drop`) | every branch, tag and remote-tracking tip, the stash, and the changes not committed (as `git stash create` makes them) | runs without a word                   |
| `git.clean`                                                                   | the untracked files it would remove, asked of git itself with the call's own flags (`clean -n`)                        | runs without a word                   |
| `git.branch-force-delete`, `git.history-rewrite`                              | every branch, tag and remote-tracking tip, the stash, the changes not committed                                        | runs, and Claude is told              |
| `git.force-push`, `git.delete-remote-branch` (not a protected branch)         | the remote branch's tip as this computer last saw it (its remote-tracking branch)                                      | runs, and Claude is told              |
| `fs.delete-outside-project`, `fs.delete-git-dir`                              | the files and folders it would remove (a pattern still to be matched keeps nothing)                                    | runs, and Claude is told              |

- **Where it is kept.** The commits under `refs/modecode/net/<id>/` in the repository, so git's cleanup never takes them; files in Mode_Code's data folder (`net/<id>/`), a hard link per file where the drive allows (no copy, no space), else a copy up to 50 MB in all and 20,000 files. The belt keeps Claude out of both.
- **When it cannot be kept** (no git, no remote-tracking branch, a limit passed, more than five seconds, or the safety-net hook not running in the session), the call is decided as without a net: Autonomous asks, full autonomy leaves it to you.
- **A rule you gave a verdict of your own** keeps it: no net changes your decision.
- **Putting it back** never overwrites: `mode-code net` lists the nets, newest first; `mode-code net show <id>` says what each kept and the steps back as things stand now; `mode-code net restore <id>` takes them. A branch that is gone comes back under its name, one that moved gets a branch beside it at its old tip (`modecode/net-<id>/<branch>`), the changes go back into the stash list, a file or folder comes back only where nothing is now. A remote branch is yours to put back: its command is said (`git push --force-with-lease …`).
- **For how long.** Fourteen days, at most a hundred nets; older ones go at a session's start, with their refs.

## Evidence

Some risky calls are yours when what they act on is: a release you named, a recipient you wrote, a hooks folder in the project you set up. Where it came from is the evidence (`src/core/provenance.ts`), recorded as the session goes (`state/sessions/<id>.prov.json` in the data folder, which the belt keeps Claude out of):

- **Yours:** what you typed in this session's prompts, word for word (a key or a token in it kept masked). What you pasted into the prompt box is not counted (a paste reaches the plugin as one edit no key made); from the phone and in a headless run everything is typed.
- **The session's start:** the project's remotes (`git remote -v`): its host and its owner/repo.
- **Read from outside:** the hosts, addresses, owner/repo, paths and lines of what the session read from someone else (a page, an issue, a service's data, another session).

| Rule                                                                 | What it acts on                                                    | Yours (or the start record's)                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `github.delete`                                                      | the release, label, secret, gist, repository or API path deleted   | Autonomous and full autonomy: runs, and Claude is told                              |
| `git.hooks-path`                                                     | the hooks folder, inside the project only                          | Autonomous and full autonomy: runs, and Claude is told                              |
| `outbound.send`                                                      | every recipient; and the message carries nothing read from outside | Autonomous and full autonomy: runs, and Claude is told                              |
| `outbound.delete`                                                    | what is deleted, by its name (failing that, its id)                | Autonomous: runs, and Claude is told; full autonomy: left to you                    |
| `persist.scheduled-task`, `persist.startup`, `persist.shell-profile` | the command, or the text written, word for word                    | Autonomous: runs, and Claude is told; full autonomy: left to you                    |
| `self.memory-delete`, `self.memory-shrink`                           | the memory file, by its name                                       | Autonomous, once a [safety net](#safety-net) keeps a copy: runs, and Claude is told |

- **What came only from outside is refused**, in every way of working, Manual too: a host, an address, a path or a command found in what the session read and never in your words. Claude is told it came from outside, and that you say so yourself if you want it. A release's or a label's name read in a listing is no evidence either way: asked, as unknown.
- **Neither yours nor read** (Claude's own idea): decided as without evidence, asked or left to you.
- **Your own verdict holds**, and a rule you turned off stays off. Manual asks as before.
- **Words, not meaning.** "Delete v1.2.3" in your message is the evidence for deleting v1.2.3; the record cannot tell what you meant beyond the words.

## A clear request, in full autonomy

Full autonomy leaves to you what Autonomous would ask about. When you clearly asked for that very step in your own message, Claude shows it: it calls Mode_Code's `request` tool with your sentence word for word and the target it names (a release, a branch, a recipient, a path). Code checks that the sentence is in what you typed in this session (spacing aside, case kept; a paste, a page or a file is not your request) and that it names the target as a whole. Checked, the step on that target goes on with a note, and the activity shows your quoted words; until your next message, when the requests are done with.

- **Never for the short list**, even when asked for: the protection itself (Mode_Code's and Claude Code's settings, hooks, the memory), a payment, a disk, the home or a system folder. Your project's locks (pull requests only, one branch) and a verdict you gave a rule hold as they are.
- **A target read from outside** is refused all the same ([Evidence](#evidence)).
- Claude is told how in full autonomy's note; a request that does not check is answered with why, and the step stays yours.

## What else runs

The belt judges what the model asks for. Plugins and their mods run unsandboxed in Claude Code's own process and can answer its tool calls; hooks run a command on every event they name; an MCP server reads what Claude sends it, and its tools describe themselves to the model in their own words. `mode-code trust` lists all of them with where each is set and marks what is new since you last looked (run in your own terminal: inside a session it only shows). The plugin keeps each MCP tool's description as first seen and tells you when one changes.

`claude --bare` runs without hooks or plugins, so without the belt: the belt blocks it from inside a session. A run of your own with `--bare` (a script, the Agent SDK) should narrow its tools with `--allowedTools`, or run in a sandbox. On Windows there is no sandbox for Claude Code yet; Anthropic's `sandbox-runtime` is an early option the doctor does not set up.

## Questions you already answered

Claude Code asks about a compound command (`cd app && npm test`, `npm run build && npm test`) even when your allow rules cover each part. In every way of working, the plugin answers yes for you when an allow rule in your settings (user, project or local: `Bash(npm test:*)`, `Bash(git status)`) covers every part, and a `cd`, `pushd` or `Set-Location` only moves into the project or a folder in it. A part no rule covers, a `cd` elsewhere, a redirect into a file or a nested command is asked as before. Each answer is recorded (`permission`, `parts` in the events). Measured in a real session (`scripts/test-live.mjs`, case 12): Claude Code asked, and the plugin's answer let the command run.

## Hints

Said to Claude once a session, after the call that earned it; a hint, never a rule:

- a file read through the shell (`cat`, `head`, `sed -n '1,80p'`, `grep -rn`) where Claude Code's Read or Grep tool reads it for less context (on the author's machine, 2026-10-16, shell reads were 9.3% of the quota);
- on Windows, an unquoted heredoc whose body holds backslashes: Git Bash expands them, and `$`, so the file may not get what was written;
- a build or a test piped into a filter (`npm test | tail -20`) without `pipefail`: the pipe's exit code is the filter's, so a failure reads as a success.

## Auto mode

In Claude Code's auto mode a classifier answers Claude Code's own permission questions in your place. The belt's questions are not among them: a command the belt asks about still comes to you, and in a session with no one to ask (`claude -p`) it is refused. Measured in the real engine with each release (`scripts/test-live.mjs`, case 16: in auto mode a commit the belt allows runs unasked, the same commit with `--no-verify` is refused; Claude Code 2.1.302, 2026-10-18). The doctor notes when your settings start Claude Code in auto mode.

## Folded in

Before the belt, two other guards often stood on the same machine: permission rules in Claude Code's settings (`permissions.deny` and `ask`, often in the managed settings an administrator writes) and command guards in a memory system's own hooks. They did part of the belt's work with patterns that match the command text, and a deny rule has no way to say yes: a deletion the person asked for was refused all the same. The belt covers them; `test/corpus/automation-parity.test.ts` holds one such setup's 78 rules and its guards, each with a sample the belt must ask about or block, and the spellings their patterns missed (`git push origin :branch`, `git -C . push --force`). Rules you keep in Claude Code's own settings still apply.

## Changing a rule

From your own terminal (not from inside a Claude Code session):

```sh
mode-code config set belt.verdicts.git.force-push deny
mode-code config set belt.disabled '["git.no-verify"]'
mode-code config set belt.protectedBranches '["main","develop"]'
```

Locked rules accept only stricter actions; the settings file cannot switch them off. A verdict you set holds in every way of working; in full autonomy, where nobody is asked, a rule you set to ask leaves the step to you.

## Testing

`mode-code belt test --command "git clean -f"` or Protection › Test a command shows the decision without running anything.

## Limits

What the protection is for, what it is not for, and what it takes for granted: [threat-model.md](threat-model.md).

On native Windows there is no sandbox under Claude Code, and a script file can do what a single command cannot. There the belt prevents accidents; it is not a security boundary against a determined adversary. On macOS, Linux and WSL2, Claude Code's sandbox (`sandbox.filesystem.denyWrite`) adds a layer the belt does not replace; for work nobody watches, [autonomy.md](autonomy.md#limits) says where to run it.

A command typed on Windows for a WSL distribution (`wsl -d <name> -- …`) is judged with the distribution's paths: its home and absolute paths are the distribution's (shown as `//wsl.localhost/<name>/…`), the Windows drives it mounts under `/mnt` are Windows paths with Windows' protection, a relative path is relative to where `wsl` starts, and deleting the distribution's root, home or system folders is refused.

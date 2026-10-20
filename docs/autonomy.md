# Full autonomy

**Full autonomy** is the third way of working: manual (one step, then it waits for you) → autonomous (goes on, stops for your decisions) → full autonomy (asks nothing). Claude works through the task without a question to you. What only you may decide is not done: the step is **left to you**, with its command exactly as it would run, and the rest of the work goes on. What the safety belt or your own rules would ask you about is never done in your place.

## Choosing it

Like the other ways of working, on the strip, at any time:

| How                      | Example                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| the strip                | press `9 full auto` (`9 tam otonom`)                                  |
| a command                | `/9`, or by its word `/full-auto` (`/tam-otonom`)                     |
| a keyword, ending a task | `Add rate limiting, with tests. terminal full auto quota +10`         |
| back to another way      | `/8` autonomous, `/7` manual; `full auto cancel` (`tam otonom iptal`) |

The keyword works as the others do ([keywords.md](keywords.md)): a project name before it, and a budget after it (`quota N`, `quota +N`) if you want one for the week ([quota.md](quota.md)). The first time on a computer, one line says what it means: _Full autonomy asks nothing. What cannot be undone it does not do: it leaves it to you, with the command._

Only the person chooses a way of working; Claude cannot press the strip. A new session in the same folder never comes back in full autonomy by itself: it takes up autonomous ([modes.md](modes.md)).

## What changes

|                                                                      | Autonomous              | Full autonomy                                                                                      |
| -------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| a step the safety belt would ask about                               | asked, where it matters | **left to you**: refused with its command, Claude goes on with the rest and lists it in its answer |
| a step a rule of yours asks about (your settings, another hook)      | asked                   | **left to you**, the same way                                                                      |
| Claude Code's own permission question, once the belt let the call by | answered yes            | answered yes                                                                                       |
| what the belt blocks; a secret leaving the computer                  | blocked; stopped        | blocked; stopped                                                                                   |
| a question to you (`AskUserQuestion`), Claude Code's plan mode       | yours                   | refused: Claude decides by your recorded decisions or the reversible default, and says which       |

[safety-belt.md](safety-belt.md#ways-of-working) has the same table for all three ways of working, rule by rule. With each of your messages Claude is told what full autonomy means; when the project has its own definition of done (`projects[].verify` in the settings, for example `["npm run check"]`), Claude is told to run those commands and fix what fails before it calls the task done.

## Seeing what was left to you

Every step left to you is recorded with its command (masked for secrets):

- the cockpit and the activity: _Left to you, with its command_, in the colour of what waits;
- Activity › While you were away in the control center, and `mode-code morning`: _N step(s) full autonomy left to you, each with its command_;
- Claude's answer: each step with its command at the end. Type it yourself with `!` in front (`! git push origin main`) to run it in the session.

## Away from the computer

Full autonomy asks nothing, so it needs no one at the computer. To follow it from elsewhere, Claude Code's own `/remote-control` (`/rc`) connects the session to your phone or claude.ai/code. Mode_Code's notifications (Settings › Features) say when a turn in full autonomy ends: done, or how many steps wait for you, with the task's first line; and when Anthropic's safeguards stop an answer ([design.md](design.md#when-an-answer-is-stopped)), that the session waits. They show on the desktop and, once you give an [ntfy](https://ntfy.sh) topic (`mode-code config set notify.ntfy https://ntfy.sh/<your topic>`), on your phone, sent with `curl` and nothing else. Anyone who knows a topic's name on ntfy.sh can read it, so choose one nobody would guess, or a server of your own; a topic set from another computer waits for your approval like a lowered protection ([sync.md](sync.md)).

## Limits

- **It is a way of working, not a boundary.** The safety belt reads what a call says; a script can do what a command cannot. On native Windows Claude Code runs commands without a sandbox. For work nobody watches, run Claude Code inside a boundary the operating system enforces: WSL2 set up as below, a container or a virtual machine, with Claude Code's sandbox on.
- **A turn ends when Claude ends it.** Nothing turns a stop back: a task Claude leaves half done waits for your next message.
- **What Claude decides alone is in its answer.** The belt leaves to you each step its rules would ask about; whether a default Claude picked was the right one, you read afterwards.

## Setting up WSL2 for unattended work

Measured on Windows 11 with WSL 2.6.2 and Ubuntu 24.04, 2026-10-13. In PowerShell:

```powershell
wsl --install -d Ubuntu-24.04 --name mode-code --no-launch
```

Then, inside the distribution as root (`wsl -d mode-code -u root`):

```bash
apt-get update && apt-get install -y bubblewrap socat git ripgrep curl ca-certificates xz-utils
useradd -m -s /bin/bash <you>
# Node.js 22.13 or later, for example from nodejs.org (check its SHASUMS256.txt)
cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true

[user]
default=<you>

[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false
EOF
```

Restart only this distribution (`wsl --terminate mode-code`; `wsl --shutdown` would also stop every other distribution, Docker Desktop's included). Then, as your user inside it: install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`), sign in (`claude`), turn its sandbox on in its strict form in `~/.claude/settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false
  }
}
```

clone your project inside the distribution (its own file system, not `/mnt/c`), and install Mode_Code there.

With automount off the distribution cannot see your Windows files, and with interop off it cannot start Windows programs; Windows can still reach into it (`\\wsl.localhost\mode-code`), and its network goes out through WSL's own. Your work comes back the way it would from another machine: through git.

## Before 1.2.0

Until 1.2.0, full autonomy was a separate run with a window, a required budget, start checks, a plan phase, milestones with independent reviews, a time limit and a report, and it had to be turned on first. It is now a way of working like the others ([CHANGELOG.md](../CHANGELOG.md)): the protection that decides what is left to you is the one every way of working shares.

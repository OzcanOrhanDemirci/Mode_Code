# Security policy

Mode_Code includes a safety belt that stands between Claude Code and risky commands, so a weakness in it matters. Thank you for reporting one responsibly.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting: on the repository page, open **Security › Advisories › Report a vulnerability**. Only the maintainer sees the report.

Include what you can: the version (`mode-code --version`), your operating system, Claude Code's version, what you did, what happened and what you expected. For a way around the belt, describe the class of command or input; a minimal example is enough, and please do not include anything that could cause harm if it ran.

You will get an answer within a week. Once a fix is ready, a release with notes is published and, if you wish, you are credited.

## Scope

In scope: the safety belt's decisions, the self-protection rules, the hook and plugin, the installer and `mode-code update` (what they download, check, write and remove), the handling of secrets in what the tool stores, exports and pushes (the memory's push is held when a commit would send a secret), and the guards against outside content (a session that read a page, an issue or a service's data asks before it sends data out, persists or writes the memory; invisible characters are taken out of what it read; MCP tools' descriptions are pinned).

Known limits, documented and not treated as vulnerabilities: on native Windows the belt is an accident preventer rather than a security boundary (there is no sandbox under Claude Code, and a script can do what a single command cannot); code built at run time, or piped into a shell or an interpreter (`curl … | sh`), is asked about, not analysed; the guards against outside content live in the plugin, not in the safety-net hook, which keeps no session; `claude --bare` runs without hooks or plugins, so without the belt.

## Supported versions

| Version          | Fixes |
| ---------------- | ----- |
| 1.x, the newest  | yes   |
| older than 1.0.0 | no    |

Fixes come in a new release. Mode_Code never looks for updates by itself: watch the repository's releases (**Watch** › **Custom** › **Releases**) to hear of one, and run the install line again to update.

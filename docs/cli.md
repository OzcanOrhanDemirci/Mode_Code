# Command line

`terminal-code` with no command opens the control center in a terminal; piped or in CI it prints the status instead. Every command accepts `--json` and `--no-color` (also honoured: `NO_COLOR`, `FORCE_COLOR`). The interface language follows the settings file, then `TERMINAL_CODE_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`, then the system locale.

## JSON output

`--json` prints one JSON document. Its `schema` field names the command and a version, for example `terminal-code.status/1`. Within a version fields are only added, never renamed or removed, so scripts keep working. `version` is the tool's version.

## Commands

| Command                                                                                                | What it does                                                                                                                                 | Exit code                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `terminal-code`                                                                                        | Opens the control center (a terminal is needed)                                                                                              | 0                                |
| `open <address>`                                                                                       | Opens it at a screen, e.g. `security/rules/git.clean`, `measure/quota`                                                                       | 0, 2 without a terminal          |
| `status`                                                                                               | What is installed and working, quota, what was blocked today                                                                                 | 1 when a protection is broken    |
| `doctor`                                                                                               | Checks every feature (and runs the belt's self-test) and says how to fix each problem                                                        | 1 when a protection is broken    |
| `install [--dry-run] [--yes] [--lang en\|tr] [--view simple\|recommended\|detailed] [--memory <dir>]…` | Shows every change, asks once, installs                                                                                                      | 1 when something blocks or fails |
| `try [--print] [claude arguments…]`                                                                    | Starts one Claude Code session with the plugin and the hooks loaded from the built files; installs nothing. `--print` only shows the command | Claude Code's exit code          |
| `uninstall [--dry-run] [--yes] [--purge]`                                                              | Removes exactly what the installation recorded; `--purge` also deletes the data folder (asks you to type the name)                           | 1 on a failed step               |
| `quota`                                                                                                | The quota windows, resets and your budget                                                                                                    | 1 without a reading              |
| `tokens [--days N] [--by day\|model\|cwd]`                                                             | Token use from the transcripts, each API message once                                                                                        | 0                                |
| `sessions [search] [--limit N]`                                                                        | Past sessions, newest first                                                                                                                  | 0                                |
| `belt rules`                                                                                           | Every rule, its action and whether it is locked                                                                                              | 0                                |
| `belt events [--days N]`                                                                               | What the belt blocked, asked about or noted                                                                                                  | 0                                |
| `belt test --command "<cmd>" [--tool Bash\|PowerShell]` · `belt test --path <file>`                    | What the belt would do; nothing is run                                                                                                       | 0                                |
| `secrets [path…]`                                                                                      | Scans files or folders (default: the memory folders) for secrets; masked previews only                                                       | 1 when something is found        |
| `config path` · `config get [key]` · `config set <key> <value>`                                        | Reads or changes the settings file; values are JSON (`true`, `40`, `"check"`)                                                                | 1 when a value is refused        |

Commands that change your Claude Code setup or lower a protection (`install`, `uninstall`, `config set` on `belt.*`, `memory.*`, `modules.quota`, `modules.secrets`) refuse to run inside a Claude Code session: run them in your own terminal.

## Addresses

| Address                                                                                                                          | Screen      |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `home`, `home/overview`, `home/inbox`                                                                                            | Home        |
| `projects`, `projects/<folder, URL-encoded>`                                                                                     | Projects    |
| `sessions`, `sessions/<session id>`                                                                                              | Sessions    |
| `measure/quota`, `measure/tokens`, `measure/tools`, `measure/folders`                                                            | Measure     |
| `security/protection`, `security/rules`, `security/rules/<rule id>`, `security/events`, `security/test`, `security/secrets`      | Security    |
| `claude-code/instructions`, `/settings`, `/hooks`, `/permissions`, `/mcp`, `/plugins`, `/extensions`                             | Claude Code |
| `settings/general`, `/modules`, `/footer-quota`, `/memory`, `/projects`, `/keywords`, `/accessibility`, `/maintenance`, `/about` | Settings    |

## The settings file

`~/.terminal-code/config.json` (or `$TERMINAL_CODE_HOME/config.json`). Every key is optional; a wrong value falls back to its default for that key only, and `doctor` lists what was wrong. The safety belt's locked rules cannot be weakened from this file.

```json
{
  "language": "auto",
  "view": "recommended",
  "modules": { "keywords": true, "footer": true, "quota": true, "secrets": true, "status": true, "notifications": true, "quietWork": true },
  "belt": {
    "disabled": [],
    "verdicts": { "git.force-push": "deny" },
    "protectedBranches": ["main", "master", "release/*"],
    "prOnlyRepos": ["github.com/me/app"],
    "singleBranchRepos": [],
    "packs": { "dockerVolumes": false }
  },
  "memory": { "dirs": ["~/notes"] },
  "footer": { "mode": "draw", "showFiveFrom": 70, "showWeekFrom": 85 },
  "quota": { "fiveHourWrapUp": 95, "fiveHourStop": 99, "defaultWeeklyTarget": 99, "defaultWeeklyWrapUp": 97, "staleMinutes": 360, "autoResume": true },
  "keywords": { "extra": { "en": { "continue": ["go on"] } } },
  "projects": [{ "id": "my-app", "names": ["app"], "path": "~/dev/my-app" }],
  "accessibility": { "plain": false, "highContrast": false, "reduceMotion": false }
}
```

## Environment variables

| Variable                  | Effect                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| `TERMINAL_CODE_HOME`      | The data folder (default `~/.terminal-code`)                                  |
| `TERMINAL_CODE_LANG`      | Interface language, `en` or `tr`                                              |
| `CLAUDE_CONFIG_DIR`       | Where Claude Code's configuration is (read the same way Claude Code reads it) |
| `NO_COLOR`, `FORCE_COLOR` | Colors in command output                                                      |

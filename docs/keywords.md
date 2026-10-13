# Keywords

A keyword is a short phrase at the end of your message that steers the session. The tool detects it in code and adds a note for Claude that quotes your words and says what they mean, so the behavior does not depend on Claude remembering a convention.

## Rules

- A keyword counts when it is the **whole message** or **ends it** (the last sentence of the last line). Inside a sentence it is an ordinary word: "terminal devam ederken bir şey soracağım" is not a keyword.
- `stop` / `dur` and `wrap up` / `toparla` count **only as the whole message**, so they never fire by accident.
- Matching ignores case, accents and Turkish keyboard variants: `termınal devam`, `TERMİNAL DEVAM` and `terminal  devam` are the same. (The trap this avoids: in JavaScript `"İ".toLowerCase()` is `i` followed by a combining dot.)
- A project name one letter away from a registered one is **suggested, never taken**: Claude is asked to confirm in one line.
- The detected keyword is shown as a short notice, so you see what the tool understood.

## Table

| Kind             | English                                          | Turkish                                              | Effect                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| continue         | `continue`, `<project> continue`                 | `devam`, `devam et`, `devam edelim`, `<proje> devam` | Autonomous work; leaves chat mode; clears a wrap-up                                                                                                                                                  |
| manual           | `manual <project> continue`                      | `manuel <proje> devam`                               | Step by step                                                                                                                                                                                         |
| chat             | `chat`                                           | `sohbet`                                             | Chat mode ([modes.md](modes.md)): project and memory writes, commits and outward actions are refused by code until you say continue or pick another mode; experiments in a temporary folder are fine |
| free             | `free`                                           | `serbest`                                            | Free mode: whatever your instructions and the safety belt allow; the default                                                                                                                         |
| research         | `research`                                       | `araştırma`, `araştır`                               | Research mode: read and search; write only reports, in the flows' work folder or a temporary folder                                                                                                  |
| plan             | `plan`                                           | `plan`, `planla`                                     | Plan mode: read and plan; write only the plan (the work folder, Claude Code's plan file) or in a temporary folder                                                                                    |
| code             | `code`                                           | `kod`, `kodla`                                       | Code mode: develop, test and commit; nothing beyond the safety belt and the project locks                                                                                                            |
| flow             | `flow`                                           | `akış`                                               | Starts a flow on the task in the message: research ▶ plan → approval → code, each step checked by code                                                                                               |
| flow plan        | `flow plan`                                      | `akış plan`                                          | Starts a flow without research: plan → approval → code                                                                                                                                               |
| flow research    | `flow research`                                  | `akış araştırma`                                     | Starts a flow that ends with a checked, sourced report                                                                                                                                               |
| approve          | `approve`, `approved`                            | `onay`, `onayla`, `onaylıyorum`                      | Approves the plan waiting for approval; whole message only                                                                                                                                           |
| flow cancel      | `flow cancel`                                    | `akış iptal`                                         | Ends the running flow; its record stays                                                                                                                                                              |
| full auto        | `<project> full auto quota +10`, `full autonomy` | `<proje> tam otonom kota +10`                        | Runs the task in the message to its end without asking ([autonomy.md](autonomy.md)); the budget is required. Without a task or a budget it resumes the project's paused run                          |
| full auto cancel | `full auto cancel`                               | `tam otonom iptal`                                   | Ends the run; its record and report stay                                                                                                                                                             |
| quota            | `quota 40`, `quota +8`                           | `kota 40`, `kota +8`                                 | Weekly budget: an absolute percentage, or points above the current reading. At the end of a task message it also means "work autonomously within it"                                                 |
| continue + quota | `<project> continue quota 40`                    | `<proje> devam kota 40`                              | Both at once                                                                                                                                                                                         |
| wrap up          | `wrap up`, `wrap-up`                             | `toparla`, `toparlayalım`                            | Bring the step to a consistent point, commit, update notes, report, stop                                                                                                                             |
| stop             | `stop`                                           | `dur`                                                | Stop now, stop agents and timers, say what was left half done                                                                                                                                        |
| status           | `status`                                         | `durum`                                              | A short status without stopping                                                                                                                                                                      |
| help             | `help`, `<project> help`                         | `yardım`, `<proje> yardım`                           | Summarize the keywords and rules                                                                                                                                                                     |

While a flow runs, a mode keyword that ends a longer message changes only that turn; typed as the whole message it pauses the flow and switches modes. `stop` and `wrap up` pause a flow, `continue` resumes it at its step. See [modes.md](modes.md).

During a full-autonomy run, `stop` and `wrap up` pause it with its report, and `<project> continue` resumes it at its phase after its start checks pass again. See [autonomy.md](autonomy.md).

## Projects

Register projects under Settings › Projects and keywords (or `projects` in the settings file): an id, the names you type, and optionally the folder. Without a registered project, a single word before "continue" is still taken as a project name the model has to resolve from context.

## Your own phrases

Add phrases per language and kind in the settings file:

```json
{ "keywords": { "extra": { "en": { "continue": ["go on", "carry on"] }, "tr": { "wrapUp": ["kapat"] } } } }
```

## The quota budget

With a weekly budget N, work wraps up at N−1 and stops at N+1. Without one, the default limit is 99 (wrap up at 97). The 5-hour window wraps up at 95 and stops at 99. When autonomous work stops at a limit, it resumes by itself one minute after the window resets, through a prompt the plugin submits ("<project> devam").

# Threat model

What Mode_Code's protection is for, what it is not for, and what it takes for granted. The 1.2.0 core (one protection, always on, the same in every way of working) is built and measured against this page; where today's safety belt still works differently, the page says so. The belt's rules and how it reads a command are in [safety-belt.md](safety-belt.md).

## The system

One person works with Claude Code on their own computer (Windows 11, macOS, Linux or WSL2), in their own account, on their own projects. Mode_Code runs in three places:

- **the plugin**, inside Claude Code's process, which sees every tool call before it runs and answers Claude Code's permission questions (`tool.check`);
- **the safety-net hook**, a settings hook Claude Code starts for each call (exec form, `onFailure: "block"`), which decides alone when the plugin is not loaded;
- **the command line and the control center**, which the person starts.

MCP servers on the same computer run with the person's rights (stdio). Whatever protects the computer itself (the operating system, an antivirus, Claude Code's sandbox where it exists) stays in place; Mode_Code is a decision point in front of tool calls, not a replacement for any of it.

## What is protected

- **The work:** source code, and work not yet committed.
- **Secrets:** SSH keys, tokens, `.env` files, cloud credentials, and anything that reads like one.
- **The person's identity outside the computer:** pushes, releases, store uploads, messages, payments, anything sent in their name.
- **The computer's integrity:** what starts by itself (shell startup files, scheduled tasks, login items, services), and system settings.
- **The protection itself:** Mode_Code's settings and files, Claude Code's settings and hooks, permission rules, instruction files (`CLAUDE.md`), the memory.
- **The quota:** the person's subscription is not spent on work they did not ask for.

## Who can cause harm

1. **A remote party, through content.** A web page, a cloned repository, an issue, a pull request, a connected service's answer or a dependency's files carries instructions, and Claude reads them as if they were the person's.
2. **A supplier.** An MCP server, a plugin, a skill or a dependency that is, or becomes, hostile; a tool whose description changes after it was trusted.
3. **The agent itself.** Claude, without any attacker, goes further than asked: it misreads the task, works around a refusal, or takes a shortcut with consequences.
4. **A tired person.** Not an adversary, a way of failing: after dozens of questions, people approve almost all of them, the rare dangerous one included. Every question Mode_Code asks has a cost, so it asks only where the answer matters.

The first three are what the core decides against; the fourth is why it asks less.

## Where harm comes in

Tool results (fetched pages, files of a cloned repository, issue and pull request text, MCP answers), MCP tool descriptions, project files that configure tools (`CLAUDE.md`, `.mcp.json`, settings, a repository's git settings), install scripts of dependencies, memory files, what subagents return, and compaction summaries.

## Trust: what counts as evidence

- **Trusted intent** comes only from the person: their messages in this session, and what was true when the session started (the project's remote, the person's settings and rules).
- **Everything else is data**, however it is worded. An address, a recipient or a command that appears in content Claude read does not become trusted by appearing there.
- **Evidence** is a decision unit (a full host, an owner and repository, a recipient, an absolute path) that can be traced, literally, to trusted intent or to a known destination (the project's own remote, the package registries). A payload cannot be proven clean; a destination can be known.

## What the core decides on

Mode_Code does not judge whether code is good or a command is wise. It steps in on four kinds of action, and only there:

| Kind                      | Examples                                                                   | Frameworks                                                              |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Data leaving the computer | uploads, posts, pushes to an unknown remote, messages, secrets in requests | OWASP LLM02 · OWASP Agentic ASI02 · MITRE ATLAS AML.T0086               |
| Irreversible destruction  | deleting what no copy keeps, rewriting shared history, deleting accounts   | MITRE ATLAS AML.T0101 · OWASP Agentic ASI05                             |
| Persistence               | what starts by itself, changes that outlive the session                    | MITRE ATLAS AML.T0081, AML.T0080 · OWASP Agentic ASI06                  |
| The protection itself     | turning hooks off, changing permission rules, editing Mode_Code's files    | MITRE ATLAS AML.T0081 · CoSAI MCP Security §3.2.9 · CSA MAESTRO layer 6 |

Everything outside these four passes. Inside them:

- **Reversible and local** work passes without a question, because the safety net keeps what it would change (a copy, a git reference) and `mode-code net` puts it back.
- **Irreversible or outward** work goes ahead only with evidence; without it, the way of working decides: Manual and Autonomous ask the person, Full autonomy tells Claude to leave it for the person ("do it yourself").
- **Claude Code's own decision is never loosened.** What Claude Code or the person's rules deny stays denied, and what they ask about is asked of the person.

Mode_Code says "I protected you" only where it stopped an action with evidence of an attack or a leak.

## Assumptions

- The operating system account is not already compromised.
- Every tool call passes through a hook before it runs. Exceptions are known and listed: Claude Code started with hooks off or in a bare or safe mode, and the plugin unloaded after repeated crashes, where the settings hook still decides.
- Work is under version control, or the safety net holds it: that is what "reversible" means.
- The person reads the few questions that are left.
- Claude Code is at least the version Mode_Code requires.

## Out of scope, or only in part

- Flaws in the operating system or its kernel, and escaping a sandbox: those belong to the operating system.
- Malware already running on the computer.
- What the person does by hand, outside Claude.
- Training data and model poisoning, unless they show up as a tool call.
- Whether generated code is correct, and wrong information in answers.
- Several people sharing one account.
- Text in which Claude talks the person into something (in part: questions say plainly what will happen, not why Claude wants it).
- Covert channels through tools that are allowed (in part: an outward call is judged by its destination, not by a full reading of what it carries).
- What a connected service's tool does beyond what its name says (in part: the belt knows such a tool by the words in its name, split at `_`, `-`, a change of case and a digit; a name outside that vocabulary stays unjudged by construction, since no vocabulary is complete, and reserving, booking and changing account or credential data are not among the kinds it asks about).
- What a script file does once written, beyond what the command that runs it shows (in part: where a written file's content came from is tracked).
- Data that was encoded or disguised before it left (judged only by where it goes).
- A hostile MCP server that is named like Mode_Code's and carries a tool named like one of its five (in part: Mode_Code's own tools are known by their exact names, so every other tool such a server carries is judged as a connected service's; Claude Code hands the belt the tool's name alone, so a tool that takes one of the five names cannot be told from ours).

**On native Windows there is no sandbox under Claude Code, and a script file can do what a single command cannot. There Mode_Code prevents accidents; it is not a security boundary against a determined adversary.** On macOS, Linux and WSL2, Claude Code's sandbox adds a layer Mode_Code does not replace.

## The attacker

Adaptive and patient: they try many times and change what they try, and they can read Mode_Code's code and rules, which are open. So a rule is measured against attempts made to pass it, not only against the examples it was written from.

## Mode_Code's own actions

Mode_Code runs programs too (git for the facts it decides on, the status line, the control center), often before anyone has looked at the folder. It must not become a way in: a repository's own settings never choose a program for it, and on Windows no program is taken from the working folder ([architecture.md](architecture.md), "The folder never chooses what Mode_Code runs").

## How it is measured

Three numbers, measured for every release and written down, with the target at 100% and the real figure as it is:

- **False alarms:** of the person's own past, ordinary work replayed through the protection, how much it would have stopped as an attack (the target is none).
- **Protection:** of public attack sets for coding agents, how much it stops.
- **Freedom:** of the questions the person used to get, how many now pass without one.

Attack sets are kept out of the public repository; their runner prints totals, categories and digests only, never their content. An independent red team works in sessions of its own. The figures and the known limits go into this page when they are measured.

## Sources

- OWASP Top 10 for LLM Applications, 2026 edition (2026-08), and the OWASP Top 10 for Agentic Applications 2026 (2025-12): CC BY-SA 4.0.
- MITRE ATLAS, data v2026.09 (2026-09-15).
- NIST AI 600-1, Generative AI Profile (2024-07).
- CoSAI, MCP Security, v2.0 (2026-08-12).
- CSA MAESTRO (2025-02).

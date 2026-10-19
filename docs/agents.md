# Parallel agents

Claude Code can hand parts of a task to agents that work beside the session: a search, a plan, a change in another corner of the code. How many it starts is its own choice. With parallel agents turned on, it is yours: none, at most N at once, or exactly N for your next request, each with the task you write. Off until you turn it on; while it is off, Mode_Code never touches an agent.

## Turning it on

Control center › Automation › Parallel agents:

- **I set the number of agents.** Asked twice, because with it on every session starts with agents off: Claude starts no agent until you set them on the strip.
- **Read-only helpers stay free** (on by default). Claude Code's Explore and Plan agents only read and search: they run even with agents off and are not counted. Off, they count like any agent.

The same in the settings file: `"agents": { "enabled": true, "helpers": true }` ([cli.md](cli.md)). The page also lists the Claude Code sessions running on this computer (`claude agents --json`): their name, kind, status, age and folder, so another session at work in the same repository is seen before a commit sweeps up its changes.

## On the strip

Once turned on, the strip shows where the session stands, lit while agents may run (in a narrow terminal, 👥 alone stands for the word):

| On the strip             | Means                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `👥 agents…`, not lit    | off: Claude starts no agent and does the work itself            |
| `👥 agents… ≤5 · 2`      | at most 5 at once, 2 running now                                |
| `👥 agents… =3 · 1/3`    | exactly 3 for this request, 1 started                           |
| `👥 agents… · ultracode` | ultracode is on: Claude Code's workflows run the agents (below) |

The `…` says a press opens a window, and that nothing changes until you act there. A press (or `/ajan`, `/parallel`) opens it, drawn as every window is ([design.md](design.md#components)): what it is for, how it is now, the mode as its three options (each one a press; the arrows only move), how many, and for exactly N one agent at a time (**‹ previous**, **next ›**) with its task (empty: Claude writes it from your request), its kind and its model; then, before **Apply**, what applying will do in words. Under it the agents running now, each with **Open its conversation** (the agent's transcript in the main view, as Claude Code's own tasks list opens it; the line under the strip leads back) and **Stop**, and **Stop all**. From a phone, or without the window: `/ajan 5` (at most 5), `/ajan tam 7` (`/parallel exact 7`), `/ajan kapat` (`off`), `/ajan dur` (`stop`). Only you set it, from the keyboard, the phone or the strip; never Claude, a scheduled prompt or another session. Every session starts with agents off.

| Mode                  | What happens                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Off**               | Every agent is refused, the read-only helpers aside while they stay free.                                                                                                                                                                                                                                                                      |
| **At most N at once** | Claude uses as many as help, or none, never more than N at the same time. It stays for the session until you change it.                                                                                                                                                                                                                        |
| **Exactly N**         | For your next request. Each agent Claude starts takes a row, one of its own kind first: the row's task word for word (what Claude wrote follows it as context), its kind (code, research or plan) and its model (opus, sonnet, haiku, or the session's). Once all are done the mode turns off by itself, on the strip and in a note to Claude. |

## What code decides, and what Claude is told

Every agent's start passes through Mode_Code before Claude Code runs it, so the count holds whatever Claude decides: refused with the reason (off, N already running, none left to start), let through, or fitted to its row, labelled `[2/3]`. Workflows and ultracode aside, nothing gets past it.

What code cannot do is make Claude start an agent. When you set the mode, Claude is told with your next message, plainly: for exactly N, the rows in order and that it should not work around them. If it ends its turn with fewer started than you asked for, it is reminded once, with the rows still waiting; then it is left alone, as you decided (insisting backfires).

- **A later message.** Exactly N belongs to the request it was set for. Your next message closes it to new agents; the ones still running finish, and the mode turns off when they do.
- **A full-autonomy run attached.** Its plan decides the work, so exactly N cannot start; at most N works.
- **A read-only mode** (chat, research, plan): no code agent; a row is research or plan.
- **The quota guard comes first.** Past a budget no agent starts, whatever the mode ([quota.md](quota.md)).
- **An agent's own agents count** toward N; free helpers do not.
- **Above 20**, what really decides is how many Claude Code runs at once, and the quota; the window says so.

## Ultracode and workflows

Claude Code's workflows (the Workflow tool, ultracode) run their own agents, and Mode_Code never counts or refuses those. While ultracode is on (`/effort ultracode`, Claude Code's setting, or the word in your message) the mode stands aside and the strip says so; when it is off again in the same session, your setting is back.

## Stopping

**Stop** in the window, **Stop all**, or `/ajan dur` ask Claude Code to stop the agents running (its TaskStop tool, as Claude would). One that cannot be stopped from there is counted in the answer: tell Claude to stop it.

---
description: The commit skill fires when asked for a commit, and the message follows it.
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I renamed getUser to fetchUser and updated the three call sites, because "get" suggested a cache lookup and it is a network call. Write the commit message you would use for this change. Do not run git.

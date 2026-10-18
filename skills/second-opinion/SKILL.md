---
name: second-opinion
description: Have an independent agent review the work against the request, without this session's assumptions; run by the person.
disable-model-invocation: true
argument-hint: '[what to review]'
---

Get an independent review of the work of this session (or of what the person names: $ARGUMENTS). The point is a reader who did not take part: this conversation's assumptions must not reach it.

1. **Gather only facts:** the person's request in their own words, the files changed (`git diff` against where the work started, or the list of files written), and the project's checks. Do not include your own reasoning, your summary of what you did, or why you think it is right.
2. **Start one agent** (the Agent tool, general-purpose) with this brief: "Review this change against the request. Read the changed files and their surroundings yourself. Report: points of the request not met; bugs with a concrete failing input; risks (security, data loss, compatibility); what you could not verify. No style remarks unless they hide a bug. Quote file and line for each finding." Give it the facts from step 1.
3. **Check each finding yourself** before passing it on: read the code it points at; run what can be run. Mark each as confirmed, not reproduced, or wrong (and why).
4. **Report** the confirmed findings first, most severe first, then the rest. Change nothing until the person decides.

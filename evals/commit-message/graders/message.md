---
type: llm
---

PASS if the reply gives one commit message whose subject line is in the imperative mood ("Rename …", not "Renamed …"), at most 72 characters, and whose body says why the rename was made (it is a network call, not a cache lookup).
FAIL if there is no commit message, the subject is not imperative or is longer than 72 characters, or the reason for the change is missing.

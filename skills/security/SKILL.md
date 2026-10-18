---
name: security
description: Check this project for secrets in files and history, vulnerable dependencies and risky settings; run by the person.
disable-model-invocation: true
---

Check this project's security with what is installed here. Report; change nothing without the person.

1. **Secrets in files:** `mode-code secrets .` (masked previews only). Check `.gitignore` covers `.env*`, keys (`*.pem`, `*.p8`, `*.jks`, `*.keystore`), service account files and local settings (`.claude/settings.local.json`).
2. **Secrets in history:** if `gitleaks` is installed, `gitleaks git --no-banner --redact`; otherwise say it is not, and search the history for the patterns of step 1 (`git log --all --diff-filter=A --name-only` for key files ever added).
3. **Dependencies:** whatever the project uses and is installed: `npm audit --omit=dev`, `osv-scanner scan source -r .`, `pip-audit`, `flutter pub outdated`, `cargo audit`. Say which ran and which were not available.
4. **Settings that weaken protection:** CI workflows that run untrusted code with secrets (`pull_request_target` with a checkout of the pull request), debug flags in release builds, open database rules (`allow read, write: if true`), CORS `*` with credentials.
5. **Report** by severity: what was found, where (file and line), why it matters, the fix. A secret that was ever committed is rotated, not only deleted: say so.

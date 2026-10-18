---
name: live-check
description: Check that what runs in production is what this repository says (deployed code, the model served, secrets set, security rules, platform deadlines); run by the person.
disable-model-invocation: true
argument-hint: '[service or environment]'
---

Answer "does production run what the repository says?" for $ARGUMENTS (else every deployed part this project has), by measuring. Read only: deploying, changing a secret or a rule is the person's.

1. **List what is deployed** from the repository: functions and workers (`firebase.json`, `wrangler.toml`, `vercel.json`, `fly.toml`, Cloud Run or App Engine files), security rules (`firestore.rules`, `storage.rules`, `database.rules.json`), scheduled jobs, the app versions in the stores.
2. **Compare each with the live one,** with the project's own command line where it is installed and signed in (`firebase`, `wrangler`, `gcloud`, `gh`), reading only:
   - the deployed code's version or commit against `HEAD` (a version endpoint, a deploy log, `wrangler deployments list`);
   - the model a proxy serves: the id it is configured with against the one the code names, and that it answers (one small request, only where the person agrees it may cost a little);
   - secrets and environment variables: that each one the code reads is set, by name only; never print a value;
   - security rules: the deployed ones against the repository's file, line by line;
   - the stores: the live version and build against `pubspec.yaml`, and the platform deadlines that apply now (Google Play's target SDK, Apple's SDK and privacy requirements), looked up, not remembered.
3. **Report** a table: part, what the repository says, what is live, the same or not, and how it was measured. What could not be measured (no access, not signed in) is said, never guessed.

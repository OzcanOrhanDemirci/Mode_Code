App Store and Google Play from the command line. Checking and preparing are yours; **an upload, a submission and a release are the person's**: the safety belt asks before each, bypass or not.

**App Store Connect: `asc`.** The person signs in with an App Store Connect API key (`asc auth login`: key id, issuer id, the `.p8` file); the key never goes into the repository. Set `ASC_TELEMETRY_DISABLED=1`.

- Read and check: `asc auth doctor`, `asc system-status`, `asc builds list`, `asc validate --app <id> --version <v>` (`--strict` makes warnings blocking), `asc review status`, `asc metadata keywords audit`.
- The person's: `asc builds upload`, `asc publish appstore … --submit`, `asc publish testflight`, `asc release stage` (try `--dry-run` first).

**Google Play: `gplay`.** A service account with the least access the work needs (`gplay auth login --service-account <file>`, then `gplay auth doctor --package <id>`); its JSON never goes into the repository.

- The person's: `gplay releases upload <app.aab> --track internal`, `gplay releases promote`. A production upload stays a draft unless `--complete` or `--staged` is given: never add them unasked.

**UI flows: Maestro.** `maestro test flow.yaml` on a running emulator or device; set `MAESTRO_CLI_NO_ANALYTICS=1`.

**Before any submission, check:** the version and build number went up; the privacy answers (App Privacy, Data safety) match what the app really collects and sends; screenshots and texts are current; the build was tested on a device.

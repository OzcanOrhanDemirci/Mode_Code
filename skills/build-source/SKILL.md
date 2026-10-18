---
name: build-source
description: Tell which commit a built app package came from, and make future builds carry it; run by the person.
disable-model-invocation: true
argument-hint: '[path to the .apk, .aab or .ipa]'
---

Answer "which code is in this build?" for $ARGUMENTS (else the newest package under the build folder).

1. **Look for what the build carries:** a commit hash the project embeds (`--dart-define=GIT_SHA=…` read by the app, `BuildConfig.GIT_SHA`, a `version.json`, a Sentry or Crashlytics release name), found from the project's own build files and, in the package, by listing and searching it (`unzip -l`, `unzip -p <package> <file>`, `strings` on the app's library); the version name and build number (`aapt2 dump badging`, `bundletool dump manifest`, the `Info.plist` in an `.ipa`).
2. **Match it to the history:** the embedded hash against `git log`; without one, the version and build number against the commits that set them (`git log -S"version: x.y.z+n" -- pubspec.yaml`), and the package's time against the commits around it. Say how sure each match is.
3. **When builds carry nothing,** propose the smallest change that makes them: the build command passes the commit (`--dart-define=GIT_SHA=$(git rev-parse --short HEAD)`), and the app shows it on its about screen and in crash reports. Show the change; make it only on the person's yes.

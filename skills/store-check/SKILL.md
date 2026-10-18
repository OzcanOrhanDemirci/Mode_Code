---
name: store-check
description: Check whether this app project is ready for the App Store and Google Play, measured file by file and in the built package; run by the person.
disable-model-invocation: true
argument-hint: '[path to a built .apk or .aab]'
---

Answer "is it ready for the stores?" by measuring, not by remembering. Change nothing; report.

1. **Run the checker** on the project's root: `node "${CLAUDE_SKILL_DIR}/check.mjs" <project root>`, adding `--package <path>` for a built APK or AAB ($ARGUMENTS, else the newest under `build/app/outputs/`, when there is one). It reads one concrete condition per line and says why it matters: the application id is not `com.example`; the release is not signed with the debug key and `key.properties` is there; the manifest's INTERNET permission and the app's name; Info.plist's export encryption answer; `PrivacyInfo.xcprivacy` there and in the Xcode target; the Podfile; the default icon, and an iOS 1024 icon without alpha; a privacy text inside the app; account deletion wherever accounts are made; the version in `pubspec.yaml` against `lib/app_version.dart`; in the package, every native library aligned for 16 KB pages. Exit code 1 means at least one BLOCK.
2. **Read what it cannot**, from the files, and say what you found: `targetSdk` against Google Play's current requirement (look the requirement up; it changes each year), permissions the app asks for against what it does, the store listing's texts and screenshots if the repository keeps them, the data the app sends out (for the privacy forms; the `claims-check` skill goes further).
3. **Report** BLOCK first, then WARN, each with the file and the fix; then what was checked by hand and what could not be checked from here (the store consoles' own forms, signing keys that live elsewhere). Fix nothing unless the person asks.

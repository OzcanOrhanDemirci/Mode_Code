Flutter and Dart work, with the Dart SDK's own MCP server (`dart mcp-server`, Dart 3.9 / Flutter 3.35 or newer).

**The server.** Its tools analyze and fix code, format it, run tests, search and add pub packages, and, once a running app is connected through the Dart Tooling Daemon, read its widget tree and errors and hot reload it. Prefer them to reading tool output through the shell.

**Before calling a change done:**

1. `dart format --output=none --set-exit-if-changed .` (or format the files you touched),
2. `flutter analyze` with no new issue,
3. `flutter test` (a single file: `flutter test test/x_test.dart`),
4. for a change the person will see, the app on a device or an emulator; a screenshot is not a test.

**Care:**

- Generated code (`*.g.dart`, `*.freezed.dart`) comes from `dart run build_runner build --delete-conflicting-outputs`; never edit it by hand. Translations: `flutter gen-l10n`.
- `flutter pub upgrade --major-versions` and `flutter clean` change more than asked: only when the person says so.
- Signing material stays out of the repository: `key.properties`, `*.jks`, `*.keystore`, `GoogleService-Info.plist` and `google-services.json` when the project keeps them out.
- iOS builds need a Mac; on Windows say so rather than trying.

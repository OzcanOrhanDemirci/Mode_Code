---
name: machine-map
description: Map what this computer can build and release for this project (SDKs, toolchains, signing, simulators, sign-ins); run by the person.
disable-model-invocation: true
---

Map what this computer can do for this project, measured with each tool's own command. Install nothing and change nothing.

1. **What the project needs,** from its files: languages and frameworks (`pubspec.yaml`, `package.json`, `build.gradle`, `Podfile`, `Cargo.toml` …), their version constraints, the platforms it targets, how it is signed and released.
2. **What this computer has,** each with its version or "missing": the toolchains (`flutter --version`, `dart --version`, `node -v`, `java -version`, `python --version` …); Android (the SDK folder or `sdkmanager --list_installed`, build tools, an emulator, `adb devices`); Apple, only on a Mac (`xcodebuild -version`, `xcrun simctl list runtimes`, `pod --version`); signing (the keystores the build files name, `security find-identity -p codesigning -v` on a Mac; never print a password or a key); the command lines a release uses and whether they are signed in (`firebase login:list`, `gh auth status`).
3. **Report** a table: need, have, version, ready or not; then what this computer cannot do for the project (an iOS build on Windows, say) and the shortest way to each missing piece. Where one of Mode_Code's tool packs covers it, name the pack (`mode-code packs`).

---
name: claims-check
description: Check what this app says about data (privacy policy, the stores' data forms, AI consent) against what its code actually collects and sends; run by the person.
disable-model-invocation: true
---

Set what the app claims against what it does. Change nothing; report.

1. **Collect the claims:** the privacy policy and terms (in the app, the repository, its website if it is kept here), the store forms if the repository keeps their answers (Google Play's Data safety, Apple's App Privacy and `PrivacyInfo.xcprivacy`), consent screens (AI, analytics, tracking), and the store listing's texts.
2. **Trace the data from the code:** every place data leaves the device (HTTP clients, Firebase and other SDKs, analytics and crash reporting, AI calls through a proxy, ads), what each sends (identifiers, what the person typed, location, contacts, files, device data), whether it is linked to the person, kept and shared; what is asked for consent first, and what runs before any consent.
3. **Compare, item by item:** collected but not declared; declared but not collected; sent before consent; sent to a party the policy does not name; kept longer than said; an AI feature whose provider or purpose is not told. Quote the claim and point to the code (file and line).
4. **Report** the mismatches first, each with the fix on the claim's side or the code's; then what matches; then what could not be traced from here (a server's own logging, a third party's use).

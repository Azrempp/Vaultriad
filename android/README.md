# Vaultriad Android

Native Java Android 11+ app (`com.vaultriad.app`), MIT licensed. It uses native views, Android private storage, Bouncy Castle Argon2id (64 MiB, three iterations, parallelism one), AES-256-GCM and HMAC-protected `.vtbackup` envelopes. It has no WebView and no Internet permission. The desktop app stays in the repository root.

## Download

[Vaultriad.apk](https://github.com/felixzax/Vaultriad/releases/download/v1.0.0-android-preview/Vaultriad.apk) · [Android preview release](https://github.com/felixzax/Vaultriad/releases/tag/v1.0.0-android-preview)

Android requires permission to install apps from the chosen download source. Verify the release checksum and keep encrypted off-phone backups. The first preview is signed with a project-specific Android key, not published through Google Play. Updates must use that same signing key and a larger versionCode. Never uninstall your only vault copy to work around a signing mismatch: export and verify an encrypted backup first.

## Build

Requires JDK 21, Android SDK 35/build-tools 35.0.0, and an emulator or Android 11+ device for instrumented tests. The checked-in Gradle wrapper downloads Gradle 8.13. Set ANDROID_HOME or local.properties (`sdk.dir=...`).

```sh
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease
./gradlew :app:connectedDebugAndroidTest
```

Debug application ID ends in `.debug` and its instrumented tests refuse to wipe a production package. A release without signing credentials produces **app-release-unsigned.apk**, which cannot be installed as-is. Do not distribute it as an installable release.

For repeatable signed releases, create and privately back up a release keystore with alias `vaultriad`, and provide `ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` to Gradle. GitHub's Android APK workflow supports repository secrets `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`; neither belongs in source control. When those secrets are absent, CI stages an unsigned APK in a maintainer-only draft for local signing. It never publishes that unsigned APK as the installable release.

For local signing handoff, the **Publish locally signed Android APK** workflow accepts a Git blob containing the signed APK, its expected hash, and the successful native build run/source commit. It verifies the signing certificate against `android/SIGNING-CERT-SHA256.txt`, compares application contents to the native-tested unsigned APK (allowing only signing metadata), checks the offline manifest/license, and publishes the verified APK. No private key is sent through that workflow. Forks must replace the certificate fingerprint with their own when adopting a new application ID and signing key.

If the connected integration cannot write repository secrets, a maintainer must add them in GitHub Settings → Secrets and variables → Actions. Local signing keys and passwords must be backed up privately before discarding the development workspace. Keep the same key for updates; a lost release key is not recoverable from an APK. Increment `versionCode` for every update. Fork distributors must use their own key/application ID and preserve MIT/dependency notices.

## Vaults and recovery

The file in app-private `files/vault.vtriad` uses the same authenticated unbound `VAULTRIAD-BACKUP` v1 format as desktop. Each write has a fresh nonce and preserves one encrypted rolling copy. Android AtomicFile handles interrupted writes. Credentials use the same length-delimited encoding and answer normalization; a synthetic desktop fixture (including Unicode and `</`) plus reverse verification test compatibility in both directions. Keys/temporary byte buffers are wiped where practical; Java immutable strings and OS memory/swap cannot be reliably erased.

All enabled password/PIN/question groups are required. Questions are never a bypass. Retry delay increases to 30 seconds without hard lockout and resets on app recreation. Current remains unchanged until Pending is explicitly confirmed; discard never loses Current. Old secrets move to Past. Manual secrets are never trimmed or normalized.

Export/restore uses Android's document picker. The app locks when that picker backgrounds it. Backups are encrypted before a selected document provider receives them. A provider may upload the ciphertext if the user chose cloud storage; the app itself has no Internet permission. Reset requires RESET and a successfully written/read-back-verified encrypted backup before local files are removed. Rolling copies can be exported separately. Bound desktop backups are rejected; export a portable desktop backup first. The mobile file limit is 32 MiB encrypted / 20 MiB serialized plaintext. Original credentials remain necessary for backups after biometric enrollment. For a desktop portable export, use its separate export passphrase rather than the original desktop master credentials.

Uninstalling or clearing app data deletes the vault and local biometric keys. Automatic Android backup/device transfer is disabled; OEM behavior still needs verification. Keep your own encrypted backup somewhere else. This preview has no credential recovery, sync or autofill service.

## Biometrics and protections

Android strong fingerprint/face authentication is optional and off by default. Enabling it first verifies the original credentials, then authenticates an AES-GCM Android Keystore wrapping operation. The per-use authentication key is invalidated by biometric enrollment changes; actual hardware backing depends on the device. Authentication-bound decryption is required to unwrap a stored vault key. Missing/invalidated biometrics fall back to original credentials. Reset or credential changes remove the biometric key. Biometric quick unlock is an alternative route to the full credential combination, not an additional factor.

`FLAG_SECURE` is enabled, overlays are hidden on supported Android versions, sensitive view state/autofill is disabled, and leaving the foreground or inactivity locks and clears the visible vault. Clipboard clearing is conditional on still containing the copied value. Background locking preserves a copied value for the configured paste handoff; only a fingerprint, not the copied plaintext, remains in app cleanup state. The timeout attempts clearing, and an expired fingerprint is checked again when the app regains focus. Manual lock also attempts immediate clearing. Android background restrictions, process termination, clipboard managers and OEM behavior can retain copies. Screen-capture flags do not stop a camera or a compromised OS. Accessibility services/keyboards can read entered or revealed text. There is no analytics or crash-reporting SDK.

## Mobile preview scope

Implemented: categories/search, entry metadata, current/history/pending, confirmation/discard, manual double entry, generator with preserved desktop restrictions, basic mobile rule edits, local health/rotation review, credential changes, backup/reset/restore and optional strong biometrics.

Use desktop for CSV/JSON imports, preset management, full advanced rule editing and optional breach checks. Desktop-imported entries can be transferred in an encrypted portable backup. No Android autofill service, TOTP, network breach check, background sync or automatic updates are included. Test real device biometrics, document providers, locking and capture protection before relying on this preview for irreplaceable secrets. No independent security audit has been performed.

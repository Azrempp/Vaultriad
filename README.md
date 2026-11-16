# Vaultriad

**Free and open source · MIT licensed · Local first · Forks welcome**

A local-first desktop password manager for hardware, online accounts, and API keys. Vaultriad keeps a single encrypted vault on your device and makes password changes a deliberate two-step process: **Pending → “It worked, make it Current.”** The previous Current moves to Past only after confirmation.

## Free and open source

You can use, inspect, modify, fork and redistribute Vaultriad under the [MIT license](LICENSE), including commercially, while keeping the required license notices. There are no paid vault features, mandatory online accounts or hosted backend. Dependencies keep their own licenses; public source does not mean the app has passed an independent security audit.

- [Fork this project](https://github.com/felixzax/Vaultriad/fork)
- [Build and distribute a fork](FORKING.md)
- [Contribute changes](CONTRIBUTING.md)
- [Report security issues privately](SECURITY.md)

The app's MIT license is bundled with installers as `resources/LICENSE-Vaultriad.txt`.

## Downloads

| Platform | Installer | Release |
| --- | --- | --- |
| Windows x64 (Intel / AMD) | [Vaultriad-Setup.exe](https://github.com/felixzax/Vaultriad/releases/download/v1.0.0-windows-preview/Vaultriad-Setup.exe) | [Windows preview](https://github.com/felixzax/Vaultriad/releases/tag/v1.0.0-windows-preview) |
| macOS (Apple silicon + Intel) | [Vaultriad.dmg](https://github.com/felixzax/Vaultriad/releases/download/v1.0.0-macos-preview/Vaultriad.dmg) | [macOS preview](https://github.com/felixzax/Vaultriad/releases/tag/v1.0.0-macos-preview) |

Release assets include SHA-256 checksums. Installers are also retained temporarily as Actions artifacts; the release links above do not have that 14-day artifact expiry.

### Windows

Download and run **Vaultriad-Setup.exe**. This is the Windows x64 build for Intel/AMD 64-bit PCs. It is unsigned, so Windows may display an unknown-publisher warning. The **Windows installer** workflow builds/tests on Windows, verifies PE headers, the app's x64 architecture and bundled MIT license, then publishes the installer and checksum to GitHub Releases. Touch ID is macOS-only; Windows uses the configured credential groups.

### macOS

Download [Vaultriad.dmg](https://github.com/felixzax/Vaultriad/releases/download/v1.0.0-macos-preview/Vaultriad.dmg) from the [macOS preview release](https://github.com/felixzax/Vaultriad/releases/tag/v1.0.0-macos-preview). The universal app supports Apple silicon and Intel Macs. Open the DMG and drag Vaultriad to Applications. The release includes a SHA-256 checksum.

The preview is ad-hoc signed, without an Apple Developer ID or Apple notarization; Gatekeeper may block or warn about it. The **macOS DMG** GitHub Actions workflow builds on macOS, runs the tests, verifies the disk image, app signature and both CPU architectures, and publishes the downloadable DMG. It can be rerun from Actions → macOS DMG → Run workflow.

Touch ID is optional and requires a compatible Mac with enrolled fingerprints. Enable it in Settings → Credentials after credential verification. Automated tests simulate biometric/keychain APIs; real Touch ID hardware and prompts are not verified by hosted CI.

## Run

Requires Node.js 22.12+ (Node.js 24 LTS recommended), npm, and the desktop libraries required by Electron. On Linux, an X11/Wayland desktop and GTK/NSS libraries are required.

```sh
npm install
npm run dev
```

This opens the real Electron app, not a browser-only mock. The sandbox stays enabled. Never run this password manager with `--no-sandbox` in normal use.

```sh
npm test
npm run build
npm run test:desktop # real Electron UI smoke test on a desktop
npm run dist
```

`npm run dist` creates the installer for the host OS in `release/`: **Vaultriad-Setup.exe**, **Vaultriad.dmg**, or **Vaultriad.AppImage**. Build Windows on Windows, macOS on macOS, and Linux on Linux. Cross-platform builds require additional platform tooling. `npm run dist:dir` produces an unpacked app for local verification. Signing/notarization credentials are not included; configure electron-builder with your certificates before distributing a trusted release. Unsigned packages may trigger OS warnings. Installation downloads build tools; the installed app does not need network access.

## Organization

```text
src/main/       Electron lifecycle, validated IPC, crypto, atomic storage,
                encrypted backups/reset/restore, imports, password generation
src/preload/    Frozen, typed contextBridge with one validated request channel
src/renderer/   React UI, setup/unlock, categories, entry safety flow, settings
src/shared/     Types, rule validation, generator and category presets
assets/         Three-part shield/vault icon and tray icon
tests/          Security, generation, import and Pending flow tests
```

## Using the vault

1. Set up a password, a 6–12 digit PIN, three distinct questions, or a combination. At least one group is required. All enabled groups are required to unlock. Answers are normalized with Unicode NFKC, lowercase, punctuation removal, trimming and collapsed whitespace. Passwords and PINs are never normalized.
2. Choose an encrypted backup folder, then appearance, auto-lock and clipboard preferences. Keep an off-computer copy of backups.
3. Add Hardware, Online Domains, or API Keys & Tools entries. New secrets—manual or generated—start as Pending. Current is untouched until you confirm that the new secret works. Discarding Pending leaves Current and Past untouched.
4. Advanced view exposes per-entry password rules, service rejection restrictions, presets, import and local health checks. Simple view keeps the everyday controls readily available.

Manual secrets must be typed twice. Spaces are never silently trimmed. Rule warnings require acknowledgement; generation enforces constraints and rejects impossible combinations. Required type minimums apply when their type toggle is enabled. Toggling a generator type controls its generation pool; use “allowed characters only” or excluded characters to prohibit characters in manual secrets. Passphrase mode must also satisfy entry rules: required digits or uppercase may need to be adjusted. The local word list has about 8 bits per word; use eight or more words for important accounts. User-saved presets and entry-specific rules are encrypted with the vault.

Shortcuts: Ctrl/Cmd+F search, Ctrl/Cmd+N add, Ctrl/Cmd+L lock, Ctrl/Cmd+, settings. The Current / Past / New accordion supports Tab, Enter/Space, Arrow Up/Down, Home and End.

## Encryption and files

- AES-256-GCM with a fresh random 96-bit nonce on **every write**. The header—including factor flags, question labels, salt, nonce, version and KDF identifier—is authenticated as additional data.
- Argon2id through `hash-wasm` in a main-process worker (so sleep/lock events stay responsive), 64 MiB memory, 3 iterations, parallelism 1, 256-bit key, a random 128-bit salt per vault/credential change. Length-delimited JSON encoding combines all enabled factors unambiguously. Missing or wrong groups cannot decrypt the vault. No credential values are stored.
- App ID `com.vaultriad.app`. `app.getPath('userData')/vault.vtriad` contains a versioned `VAULTRIAD-BACKUP` envelope: encrypted payload, authenticated header and domain-separated HMAC-SHA-256 under the vault key. The HMAC is checked with constant-time comparison on unlock/restore. Public metadata reveals selected factors and the question text, not answers.
- Writes use an exclusive, permission-restricted temporary file, flush, rename and best-effort directory flush. `vault.vtriad.previous` is one rolling encrypted copy. There are never plaintext vault files.
- `settings.json` stores only the backup directory so locked resets remember it. Preferences, presets, entries, secret history and timestamps are encrypted. Files are created with mode 0600 and directories 0700 on POSIX; Windows uses the account’s application-data permissions.

A backup is the same authenticated encrypted envelope with a `.vtbackup` extension. Default location: Documents/Vaultriad Backups. Reset requires typing `RESET` and first saves a uniquely named encrypted copy, without decrypting it. If the backup fails, reset stops. It does not modify or reinstall the app binary. Restore is on first run, requires original credentials and rejects modified or unauthentic files. To replace an existing vault, back up/reset it first, then restore. Encrypted backups and rolling copies may retain secrets you later delete. No automatic secure deletion is promised.

If the primary vault is unreadable, the app exits without overwriting it. Preserve the application data folder. An intact `.previous` file uses the same format and may be copied to a `.vtbackup` for restoration. Move the damaged primary file aside yourself before reopening; do not delete your only copy. The app never silently restores an old copy.

Computer binding is optional and off by default. A random install secret protected by Electron `safeStorage` participates in derivation. Linux’s insecure `basic_text` backend is rejected. Bound files need the original keychain and install secret; copying just the file to another computer will not work. Reset retains the install binding so old bound backups remain usable. Portable export creates a separate, unbound encrypted backup protected by a new passphrase of at least 12 characters.

Changing credentials requires the originals and re-encrypts with a new salt. Existing backups still need the credentials they were made with. Optional quick unlock is implemented only for **macOS Touch ID**, explicitly enabled after credential and biometric verification. It wraps the derived key with safeStorage and is an alternative unlock route, so it changes the credential threat model. It is disabled by default and removed on reset or credential change. Other platforms use the normal credentials.

## Desktop protections

Crypto, generation, file access and CSV/JSON parsing run only in main. Renderer requests are schema validated, originate from the main frame of the app window, and serialize mutations. No renderer filesystem or Node access, no key material in the bridge. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, denied permissions, blocked navigation/new windows/webviews, single-instance lock, no remote module, production DevTools disabled. Secrets are absent from window titles and notifications; hidden secrets are masked in the DOM and renderer state is cleared on lock. System sleep, screen lock, manual lock and inactivity clear the in-memory session. An operation interrupted by lock cannot repopulate the renderer session.

Clipboard copies clear after the configured timeout (30 seconds by default), on lock, or before another vault copy, **only if the clipboard still contains the copied text**. Clipboard history tools can retain copies. Electron content protection is enabled, but OS/window-manager support varies and it is not a guarantee against capture. No crashReporter or telemetry is configured and the app never logs secrets. JavaScript strings, garbage collection, swap, hibernation and OS crash dumps cannot be reliably scrubbed; byte buffers are zeroed where practical.

Wrong credentials produce one generic message and increasing in-process delays of 1, 2, 4, 8, 16 and 30 seconds, with no hard lockout. Restarting resets the delay. This is a usability safeguard, not protection against an attacker copying the file. Argon2id and strong credentials provide the offline resistance.

## Imports

Advanced → Import passwords opens a native file dialog. Supports CSV exports from Chrome/Edge, Firefox, Bitwarden, 1Password, LastPass and KeePass, plus generic CSV and plaintext JSON arrays, Bitwarden JSON, Firefox JSON with plaintext fields, and 1Password-style JSON. Compressed `.1pux`/`.1pif` archives and browser-encrypted Firefox profiles are not supported; export CSV or plaintext JSON first. Import tests cover these supported layouts.

Main auto-detects/fuzzily matches headers and guesses URL/email/API fields conservatively. Preview exposes mapping, per-row category and skip controls. Uncertain categories require review. Duplicates match case-insensitive name + username. Keep existing, replace (old Current moves to Past), or keep both; identical secrets skip by default. In-file duplicates receive the selected action too. Replacing an entry with unresolved Pending is rejected. Nothing saves until confirmation. Imports become Current. The summary lists imported, skipped, duplicate counts and unmapped fields. Unsupported data such as TOTP seeds is not imported. Limits: 80 MB input, 10,000 rows, 46 MiB serialized plaintext vault capacity. Writes exceeding capacity are rejected before changing the file.

Source exports are plaintext. After successful import, optional confirmed best-effort deletion overwrites and removes that source file. SSD wear leveling, journaling, snapshots, backups and cloud copies prevent any promise of secure erasure.

## Network and security limits

The installed app makes **zero application network requests by default**. Renderer requests outside its own static assets are blocked. The sole feature using network is an optional, manually triggered Have I Been Pwned Pwned Passwords check. It is off by default and requires explicit opt-in. Main computes SHA-1 for the k-anonymity protocol (not for storage), sends only the first five hexadecimal characters to `api.pwnedpasswords.com`, downloads padded suffixes, and compares locally. The service sees the IP and hash prefix. Checks are never automatic. A clean result is not proof of a safe password.

This protects a **locked** vault against someone reading or altering its files, subject to credential strength and KDF cost. It helps prevent everyday mistakes by preserving Current and history until a change is verified. Numeric PINs and personal answers alone have low entropy; enabling all three does not turn guessable answers into strong authentication, and these are combined knowledge factors, not independent device-based MFA. Security questions are never a bypass or recovery method.

It **cannot** protect secrets from a compromised OS, keylogger, malicious administrator, modified application, process-memory access, a malicious Electron dependency, someone using the unlocked vault, clipboard history, external screenshots, or deletion/ransomware. There is no remote recovery, cloud sync, external security audit, automatic updater, hardware-backed credential isolation, browser autofill or TOTP support. Backups and original credentials are your recovery path. Review and independently audit before relying on this newly built software for irreplaceable secrets.

## License

MIT. See LICENSE.

### Container test note

The desktop smoke test uses an isolated temporary application-data directory and synthetic credentials. In a restricted CI container without a working Chromium sandbox helper, `VAULTRIAD_TEST_NO_SANDBOX=1` enables an explicitly test-only launch override. This is never used by `npm run dev` or packaged builds. It cannot validate OS sandbox enforcement, native biometrics, keychain availability, screen-lock notifications, or capture protection; verify these on each real target OS. The smoke script saves synthetic-data screenshots in ignored `work/screenshots/`.

To run the same smoke flow against a packaged Linux build, set `VAULTRIAD_TEST_EXECUTABLE` to the absolute path of `release/linux-unpacked/vaultriad` before running `node tests/electron.smoke.mjs`. This also verifies that production DevTools cannot be opened.

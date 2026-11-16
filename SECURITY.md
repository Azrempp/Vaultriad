# Security policy

Vaultriad is an early preview without an independent security audit. The README describes its threat model and limits. There is currently no promise of a stable encrypted-file migration policy or security-response SLA.

## Reporting a vulnerability

If GitHub private vulnerability reporting is enabled, use this repository's **Security → Report a vulnerability** flow:

https://github.com/felixzax/Vaultriad/security/advisories/new

If that option is unavailable, open an issue asking the maintainer for a private reporting channel, without publishing the vulnerability details. Do not post exploit instructions for an unpatched credential bypass in a public issue.

Never attach real vaults, encrypted backups, plaintext exports, passwords, PINs, security answers, keychain blobs, API tokens or screenshots containing secrets. Reproduce with a synthetic vault and provide affected version/commit, OS, reproduction steps, impact and suggested fixes through the private channel.

## Verification

The test suite covers authenticated encryption, credential combinations, backups, import parsing, password constraints, Pending transitions and simulated OS biometric/keychain flows. These checks do not establish protection against a compromised OS or replace an external audit. Hardware Touch ID, platform locking, capture protection and native OS keychain behavior need physical-platform validation.

Preview macOS downloads are ad-hoc signed and not Apple-notarized. Windows previews are unsigned unless release notes state otherwise. Download checksums are for integrity, not proof of publisher identity. Keep original credentials and off-computer encrypted backups.

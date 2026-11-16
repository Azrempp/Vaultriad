Download **Vaultriad.dmg** for Apple silicon and Intel Macs. Open the disk image and drag Vaultriad into Applications. The accompanying SHA256SUMS-macOS.txt records the DMG checksum.

This preview is built and tested on a native macOS GitHub Actions runner. The workflow verifies the DMG, the application's ad-hoc signature, the App ID, and both CPU architectures before publishing.

**Signing:** this build is ad-hoc signed, not signed with an Apple Developer ID or notarized by Apple. Gatekeeper may block or warn about it. A verified Developer ID/notarized distribution requires signing credentials that are not included in this repository.

**Touch ID:** optional and off by default. Enable it in Settings → Credentials after verifying your original credentials, on a supported Mac with Touch ID enrolled. Other Macs use the configured password/PIN/question groups. Tests simulate the biometric/keychain API; GitHub-hosted runners cannot validate a real fingerprint prompt or fingerprint hardware. Keychain-backed quick unlock is an alternative unlock route to the full credential combination.

Vaultriad is newly built software, not independently security audited. Review README's security model and keep encrypted backups before entrusting it with irreplaceable secrets.

Download **Vaultriad-Setup.exe** for Windows x64 (Intel/AMD 64-bit PCs), then run it to install Vaultriad. SHA256SUMS-Windows-x64.txt contains the installer checksum.

This preview is built on a native Windows GitHub Actions runner after the test suite and production build pass. The workflow verifies the installer PE header, the application's x64 architecture, and the bundled MIT license before publishing.

The installer is **unsigned**, without a verified Windows publisher certificate. Windows may display an unknown-publisher warning. This is newly built software without an independent security audit; review the README's security model and keep encrypted backups.

The Windows version uses your configured password/PIN/question groups. **Touch ID is macOS-only** and is not available on Windows. The vault works locally without a mandatory online account or paid feature tier. The optional breach check is off by default.

Source code is MIT licensed. Contributions and forks are welcome; see CONTRIBUTING.md and FORKING.md.

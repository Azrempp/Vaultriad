# Contributing to Vaultriad

Vaultriad is free and open-source software under the [MIT license](LICENSE). Contributions and forks are welcome. There is no contributor license agreement; contributions are provided under the project's MIT license. Preserve applicable copyright and third-party license notices.

## Getting started

Fork the repository on GitHub, clone your fork, and create a branch:

```sh
git clone https://github.com/YOUR_USERNAME/Vaultriad.git
cd Vaultriad
git switch -c my-change
npm ci
npm run dev
```

Use Node.js 24 LTS. Electron requires a working desktop and platform libraries. Keep the production sandbox enabled. Use only synthetic credentials and a separate development vault; do not test changes with your only copy of real secrets.

Before opening a pull request:

```sh
npm test
npm run build
npm run test:desktop
```

The desktop smoke test requires a display and isolates its test vault. See README for the restricted-container test override; do not use that override in releases or normal development. Run checks appropriate to the change. Docs-only contributions do not need application tests.

Describe the problem, resulting behavior, validation and security implications. Screenshots and fixtures must contain synthetic data only. Add meaningful tests when changing encryption, key derivation, IPC validation, persistence, backup/restore, import parsing, credential/biometric handling or the Pending/Current safety flow.

## Security-sensitive changes

Keep file access, cryptography and import parsing in main. Do not add analytics, automatic network requests, plaintext exports/logging, renderer Node access or credential recovery bypasses. New secrets must not replace Current before confirmation. Credential combinations, normalization, file formats and migration behavior need explicit review and compatibility planning.

Report suspected vulnerabilities using [SECURITY.md](SECURITY.md), not a public issue containing exploit details or vault data.

## Building and distributing forks

See [FORKING.md](FORKING.md) for platform builds, GitHub Actions, signing and release instructions. Maintainers review changes; an open-source license is not a claim of a completed security audit.

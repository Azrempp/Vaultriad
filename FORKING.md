# Forking and redistributing Vaultriad

The [MIT license](LICENSE) permits using, studying, modifying, redistributing and selling copies, including modified versions. Keep its copyright and permission notice with substantial copies. Dependencies retain their own licenses. No account, paid API or hosted backend is required to use the vault; its optional breach check is off by default.

## Fork on GitHub

1. Use GitHub's Fork button on this repository.
2. Clone your fork, use Node.js 24, run `npm ci`, then `npm run dev`.
3. Make changes on a branch and run the relevant checks in CONTRIBUTING.md.
4. Update README's repository, source and download links to your fork.

You do not need to create a second repository to modify an existing fork. GitHub's fork relationship is optional: MIT also permits independent source distributions with the required notices.

## Packaging

`npm run dist` builds the host platform's installer. Windows, macOS and Linux require their platform tooling. For one DMG containing both Mac architectures, build on macOS:

```sh
npm ci
npm test
npm run build
npx --no-install electron-builder --mac dmg --universal --publish never -c.mac.identity=-
```

This creates an **ad-hoc-signed preview**, not an Apple Developer ID/notarized distribution. Configure your own Apple signing/notarization credentials for trusted public macOS distribution. Use your own Windows code-signing certificate for signed Windows installers. Never commit certificates, signing passwords or OS keychain files.

GitHub Actions workflows are manual (`workflow_dispatch`). In your fork, enable Actions and review the workflows before running them:

- **Windows installer** builds/tests Windows x64 and provides a temporary Actions artifact.
- **macOS DMG** builds/tests a universal Mac app, verifies its disk image, signature and architectures, then creates or updates a `vVERSION-macos-preview` prerelease **in the repository running the workflow**. The publication step uses the repository-scoped `GITHUB_TOKEN` with contents-write permission. On a public fork, its release and assets are public.

The macOS workflow's output is `Vaultriad.dmg` with `SHA256SUMS-macOS.txt`. The checksum detects changed downloads; it does not establish a trusted publisher or replace a code signature. Keep the MIT license in your distributed installers; this project's electron-builder configuration explicitly bundles it in resources/LICENSE-Vaultriad.txt.

## Branding and vault compatibility

For a separately distributed product, choose a distinct application name, bundle/app ID and icon, and update package/build settings, `app.setName`, window/tray/About text and renderer branding. Explicitly use a separate `userData` location before running an independently branded fork so it cannot overwrite another installation's vault. Changing the package ID alone does not guarantee a different Electron data directory.

Do not change encryption or normalization and assume existing vaults remain compatible. Test migrations against copies of synthetic old vaults and encrypted backups. Computer-bound backups require the original install secret and OS keychain; a fork is not a way around those credentials. Export a portable encrypted backup from the original app before switching products.

## Touch ID

Touch ID depends on compatible Mac hardware, enrolled fingerprints, Electron/OS support and available keychain encryption. It is optional, off by default and an alternative to the full credential combination. Keep credential-based unlock available. CI's simulated biometric tests do not verify real fingerprint hardware. Verify the prompts and keychain behavior on supported physical Macs before claiming those integrations are tested.

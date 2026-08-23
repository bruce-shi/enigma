# Stable GitHub release process

Official releases are created only from version tags and are hosted entirely on
GitHub Releases. Enigma has one stable updater channel.

## Required configuration

1. Set a non-zero SemVer in `apps/desktop/src-tauri/tauri.conf.json`.
2. Generate a Tauri updater keypair, commit only the public key, and store the private
   key and password as GitHub Actions secrets.
3. Configure Apple certificate, identity, notarization, and team secrets.
4. Configure the base64 Windows code-signing certificate, password, and certificate
   thumbprint secrets.
5. Run `bun run release:check:production` and the complete validation suite.

The tag-triggered release workflow checks that the `v<version>` tag matches the Tauri
version and that every required secret is non-empty,
imports the Windows certificate on the Windows runner, and builds updater artifacts
into a draft GitHub release. A final job downloads and validates the complete
`latest.json` before making the release public. Any missing placeholder, credential,
signature, code-signing step, or build failure leaves the release unpublished.

## Safety acceptance

- Installers must be OS-signed; macOS artifacts must also be notarized.
- `latest.json` must contain HTTPS URLs for the same GitHub release and valid Tauri
  signatures for every target.
- Development builds keep `VITE_UPDATER_READY=false` and create no updater artifacts.
- Release builds set `VITE_UPDATER_READY=true`.
- Downloading may occur while idle, but installation must remain blocked whenever the
  durable dirty marker is set or simulation state is not idle.

Never upload updater private keys, certificate files, or notarization credentials as
release assets or logs.

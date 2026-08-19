# Desktop release hardening

The implementation is release-shaped, but the current build is unsigned, unnotarized,
versioned `0.0.0`, and has a placeholder updater public key. It must not be promoted or
presented as a public installer.

## Automated preflight

```sh
pnpm --filter @enigma/desktop release:check
pnpm lint
pnpm check
pnpm test:run
pnpm build
cargo fmt --all -- --check
cargo check --workspace --all-targets
cargo test --workspace --all-targets
```

The development preflight validates bundle targets, release-only updater artifacts, stable/beta
endpoint separation, minimum macOS version, updater capability, CSP invariants, and
the location permission string while allowing credential placeholders. Before a real
release, run `node scripts/verify-release-config.mjs` without `--development`; it must
reject `0.0.0` and the placeholder updater public key.

## Updater signing and channels

1. Generate the updater key once with Tauri's `signer generate`; back up the private
   key separately and never commit it.
2. Put the public key text in `tauri.conf.json`. Provide the private key and password
   only through the release environment.
3. Build stable with `--config src-tauri/tauri.release.conf.json`. Build beta with
   `--config src-tauri/tauri.beta.conf.json` and `VITE_UPDATE_CHANNEL=beta`. Ordinary
   development bundles do not request updater artifacts or signing secrets.
4. Copy the generated artifact signatures into a copy of the matching template.
5. Validate the final manifest without `--allow-placeholders`.
6. Upload artifacts first, verify their checksums, upload `latest.json` last, and then
   test from the immediately previous signed build.

Tauri signature verification is mandatory. `VITE_UPDATER_READY=true` may be set only
after the public key and a reachable signed manifest are present. Enigma may check or
download an update during a session, but the install function rechecks the durable
dirty marker and simulation state. Installation is allowed only when both are clear;
the user then quits and reopens Enigma. This avoids abandoning a location session,
including on Windows where installer execution may exit the application.

## macOS signing and notarization

Use a valid Developer ID Application identity, supplied by `APPLE_SIGNING_IDENTITY` or
the Tauri bundle configuration. Supply notarization credentials through either App
Store Connect API variables (`APPLE_API_ISSUER`, `APPLE_API_KEY`,
`APPLE_API_KEY_PATH`) or Apple ID variables (`APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`). Then build the DMG and verify:

```sh
pnpm --filter @enigma/desktop tauri build --bundles dmg
codesign --verify --deep --strict --verbose=2 "path/to/Enigma.app"
spctl --assess --type execute --verbose=4 "path/to/Enigma.app"
xcrun stapler validate "path/to/Enigma.app"
```

Record the identity, notarization request result, stapling result, artifact SHA-256,
and a clean-machine install/restore test. Never commit certificates or credentials.

## Windows signing

Build NSIS on the qualified Windows x64 runner and configure Tauri's Windows signing
command for the selected certificate provider. Verify the installer and installed
executable with Windows signature tooling, then run install, upgrade, uninstall, and
restore tests on Windows 10 and 11. Windows signing and physical qualification remain
deferred until the certificate and host are available.

## Review conclusions

- Security: restrictive CSP, scoped Tauri capabilities, signed-updater requirement,
  no embedded release credentials, encrypted local records, and strict GPX parsing.
- Privacy: no location or persistent device identifiers in D1, diagnostics, crash
  payloads, or map URLs; crash delivery is explicit opt-in and authenticated.
- Accessibility: shared axe, keyboard focus, theme, system-theme, reduced-motion, and
  dialog tests pass. Native screen-reader and high-contrast checks remain physical.
- Recovery: the durable dirty marker precedes device mutation; close and update
  installation respect it; restore remains account-independent.

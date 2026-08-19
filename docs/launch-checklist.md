# Public V1 launch checklist

All boxes are fail-closed. Leave the release unpublished if any item lacks evidence.

## Build and compatibility

- [ ] Choose a non-zero SemVer and exact Git commit.
- [ ] Complete every required row in `docs/physical-test-matrix.md` for macOS,
  Windows, USB, the iOS 17/18/26 paths, and the exact iOS 27 build.
- [ ] Complete native GUI set, move, clear, GPX recovery, joystick recovery, exit
  recovery, and update-during-session acceptance.
- [ ] Sign and notarize both macOS architectures; verify signatures and stapling.
- [ ] Sign Windows x64 installer and installed executable; test clean install, upgrade,
  uninstall, and restore on Windows 10 and 11.
- [ ] Generate Tauri updater artifacts and validate final stable manifest without
  placeholder allowance.

## Production services

- [ ] Publish and checksum one complete versioned map dataset; verify immutable rollback.
- [ ] Apply and verify 30-day deletion on the crash bucket only.
- [ ] Configure Stripe monthly/yearly prices, seven-day card-required trial, portal,
  webhook secret, and idempotent production delivery.
- [ ] Configure Email Service and prove magic-link delivery, expiry, and replay rejection.
- [ ] Prove purchase → authorization → activation → entitlement → offline grace →
  revocation on production D1.
- [ ] Prove restore while signed out, expired, and offline on the signed build.

## Public surfaces

- [ ] Complete legal review of the draft privacy and terms pages.
- [ ] Set public release version, exact iOS builds, price labels, billing flag, and all
  three signed artifact URLs.
- [ ] Verify `/downloads` exposes only the immutable signed artifacts and matching
  compatibility evidence.
- [ ] Deploy website and map Worker; verify `/api/health` and `/health` from outside the
  operator network.
- [ ] Run Stripe/email synthetics and the production health script.

## Promotion record

1. Copy `release/public-v1.template.json` to `release/generated/public-v1.json`.
2. Replace every placeholder with exact evidence.
3. Run `node scripts/validate-public-release.mjs release/generated/public-v1.json`.
4. Upload signed artifacts, verify checksums, and upload the stable updater manifest
   last.
5. Re-run production health and one clean purchase/activation/restore flow.
6. Record the release version, commit, artifact checksums, dataset version, supported
   iOS builds, and production evidence in `MILESTONES.md`.

Do not promote a locally merged commit, unsigned debug bundle, template manifest, or
successful source-level/device enumeration as Public V1.

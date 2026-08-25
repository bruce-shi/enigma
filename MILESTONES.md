# Enigma milestones

This file records the current open-source product boundary. Git history contains the
removed commercial/backend prototype; those services are not part of Enigma's runtime.

## Open-source standalone conversion

- [x] License desktop, embedded firmware, website, and shared packages under
  GPL-3.0-only.
- [x] Remove account, billing, activation, entitlement, crash-upload, D1, R2, email,
  and first-party map services.
- [x] Use OpenFreeMap directly and accept an optional user-owned Mapbox public token.
- [x] Separate desktop Wi-Fi setup from embedded-board provisioning.
- [x] Reduce the website to a single backend-free landing route.
- [x] Move stable downloads and updater metadata to GitHub Releases.
- [ ] Configure updater, Apple, and Windows signing secrets and publish the first
  signed stable release.

## Current physical evidence

- macOS 12+ with a previously paired iOS 27 device over the same LAN is the validated
  desktop path.
- The Lichuang ESP32-S3 ST7789 display and FT5x06 touch UI are physically verified.
- The embedded Wi-Fi/iPhone runtime is build-verified and still needs a complete
  physical set/move/restore acceptance pass.
- USB runtime control and all discovered iOS versions are software-enabled; USB and
  versions outside the exact tested matrix still need physical acceptance. Windows
  runtime control remains deferred.

## Release acceptance

- [ ] Complete every required row in `docs/physical-test-matrix.md`.
- [ ] Replace version and updater-public-key placeholders.
- [ ] Verify signed/notarized clean-machine installation on each published target.
- [ ] Verify updater install remains blocked while the durable restore marker is set.
- [ ] Publish `latest.json` and signed artifacts in one stable GitHub release.

Passing compilation or device enumeration is not physical compatibility evidence.

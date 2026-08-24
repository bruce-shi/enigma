# Enigma

Enigma is a desktop and embedded toolkit for precise iPhone location simulation. Pick
an exact point, draw a route, steer with a joystick, or replay a GPX track from one map
workspace. Routes can be tuned for speed, natural variation, repetition, and round
trips, then saved for repeat testing.

The Tauri desktop app controls a previously paired iPhone over the local network. An
optional Lichuang ESP32-S3 touch controller can be provisioned by the desktop and used
as a compact standalone interface.

- [Product website](https://enigma.bruceshi.com)
- [Getting started](https://enigma.bruceshi.com/docs)
- [Compatibility](https://enigma.bruceshi.com/docs/compatibility)
- [Downloads](https://github.com/bruce-shi/enigma/releases)

Use Enigma only with devices, applications, and services you are authorized to test.
Apple Trust, Developer Mode, and pairing approvals remain mandatory.

## Product structure

- `apps/desktop` — Tauri 2 app, device control, map and route tools, encrypted local
  library, recovery state, and signed updates.
- `apps/embedded` — portable movement workflow and ESP-IDF firmware for the supported
  Lichuang ESP32-S3 board.
- `apps/web` — product website and build-time Markdown documentation served by a
  binding-free Cloudflare Worker.
- `packages/contracts` — shared device and route contracts.
- `packages/route-engine` — deterministic WGS84 movement engine.
- `packages/ui` — shared HeroUI theme and components.

The desktop loads its basemap directly from OpenFreeMap. Optional place search goes
directly to Mapbox with a public `pk.` token saved in desktop Settings. Manual
coordinates, GPX playback, device Restore, and the embedded workflow do not depend on
Mapbox.

## Install and validate the workspace

JavaScript requires Bun 1.3.9 and Node.js 22 or newer:

```sh
bun install --frozen-lockfile
bun run lint
bun run check
bun run test:run
bun run build
```

The host Rust workspace uses Rust 1.94:

```sh
cargo check --workspace --all-targets
cargo test --workspace
```

## Build the desktop app

Run the browser UI during development:

```sh
bun --filter @enigma/desktop dev
```

Run or package the native app on the current host:

```sh
bun --filter @enigma/desktop tauri dev
bun --filter @enigma/desktop tauri build
```

GitHub Actions verifies unsigned DMG bundles for Apple Silicon and Intel Macs and an
unsigned NSIS installer for Windows x64. Stable release tags retain the stricter Apple,
Windows, and Tauri updater signing gates. See the public
[desktop setup guide](https://enigma.bruceshi.com/docs/desktop-setup) before connecting
a phone.

## Build the embedded firmware

The ESP-IDF package is isolated from the host Cargo workspace and uses Xtensa Rust
`1.95.0.0`. Install Espressif's toolchain plus `ldproxy` and `espflash`, then build
through the repository launcher:

```sh
cargo install espup --locked
espup install
. "$HOME/export-esp.sh"
cargo install ldproxy espflash --locked
cd apps/embedded
cargo run --release -- --build-only
```

Detailed development and hardware notes live in
[`apps/embedded/platforms/esp-idf/README.md`](./apps/embedded/platforms/esp-idf/README.md).
End users should follow the public
[embedded setup guide](https://enigma.bruceshi.com/docs/embedded-setup).

## Release artifacts

A stable `vX.Y.Z` tag creates one draft GitHub Release containing:

- signed and notarized macOS installers for Apple Silicon and Intel;
- a signed Windows x64 installer;
- Tauri updater signatures and a validated `latest.json` manifest;
- `enigma-firmware-lichuang-esp32s3-vX.Y.Z.zip`; and
- `enigma-firmware-lichuang-esp32s3-vX.Y.Z.zip.sha256`.

The firmware ZIP contains the merged `0x0` flash image, ELF, `FLASHING.md`, and schema-1
`manifest.json`. The manifest pins the product version, tag, commit, board, chip, flash
address, filenames, and payload SHA-256 hashes. Publication fails closed until desktop
signing, updater metadata, the ZIP checksum, and every manifest hash validate. Firmware
uses checksum verification; Secure Boot and artifact attestations are not configured.

Pull requests, `main`, and manual workflow runs build unsigned desktop packages and the
firmware bundle as 14-day workflow artifacts. They never publish a release.

## Version bump procedure

The root `package.json` is the authoritative product version. For each release:

1. Update its version and synchronize `apps/desktop/package.json`,
   `apps/desktop/src-tauri/tauri.conf.json`, the root Cargo workspace version, and the
   isolated ESP-IDF crate version.
2. Refresh Cargo lockfiles through normal Cargo checks.
3. Run `bun run release:version` and `bun run release:check`.
4. Commit the complete version bump before creating the matching `vX.Y.Z` tag.

The stable workflow repeats the verifier with the tag and rejects any disagreement.

## Website and documentation

The website imports the curated Markdown pages in `docs/` at build time. It has no
runtime database, API, storage binding, or application secret. Run it locally with:

```sh
bun --filter @enigma/web dev
```

Production is the `enigma-web` Cloudflare Worker at
[`enigma.bruceshi.com`](https://enigma.bruceshi.com). Cloudflare Workers Builds watches
`main` and deploys relevant changes from the public `bruce-shi/enigma` repository;
GitHub Actions does not deploy the site. A manual workstation deployment is:

```sh
cd apps/web
bun run check
bun run test:run
bun run build
bun run deploy
```

## Contributing and security

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), and
[`RESPONSIBLE_USE.md`](./RESPONSIBLE_USE.md) before opening a change. Maintainer release
hardening, acceptance checklists, and physical qualification matrices remain in the
repository rather than the public product documentation.

Never include Apple pairing records, device identifiers, locations, signing material,
or Mapbox tokens in issues or logs.

## License

Enigma is licensed under [GPL-3.0-only](./LICENSE). You may use it personally or
commercially under that license; redistributed derivatives must provide their
corresponding source under GPL-3.0.

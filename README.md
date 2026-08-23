# Enigma

Enigma is a GPL-3.0 open-source desktop and embedded location-simulation utility for
iPhone testing. It has no Enigma account, billing service, entitlement check, hosted
API, hosted database, object storage, analytics, or crash-upload backend.

Use Enigma only with devices, applications, and services you are authorized to test.
Apple Trust, Developer Mode, and pairing approvals remain mandatory.

## Architecture

- `apps/desktop` — Tauri 2 desktop app, encrypted local library, route editor, and
  direct same-LAN iPhone control.
- `apps/embedded` — portable workflow and ESP-IDF firmware for the Lichuang
  ESP32-S3 board. A one-time local desktop bridge provisions Apple pairing data;
  afterward the board works independently.
- `apps/web` — one React Router landing page served by a binding-free Cloudflare
  Worker.
- `packages/contracts` — local device and route contracts.
- `packages/route-engine` — deterministic WGS84 movement engine.
- `packages/ui` — shared HeroUI theme and components.

The desktop loads its basemap directly from OpenFreeMap. Optional place search sends
requests directly to Mapbox using a public `pk.` token supplied in desktop Settings.
The map and every device workflow continue to work without a Mapbox token.

## Build and test

JavaScript requires Bun 1.3.9 and Node.js 22 or newer:

```sh
bun install --frozen-lockfile
bun run check
bun run test:run
bun run build
```

The host Rust workspace uses Rust 1.94 or newer:

```sh
cargo check --workspace --all-targets
cargo test --workspace
```

Run a browser preview with `bun --filter @enigma/desktop dev`, or start the native
app with `bun --filter @enigma/desktop tauri dev`. See
[`docs/desktop-setup.md`](./docs/desktop-setup.md) for local iPhone setup.

The isolated Xtensa/ESP-IDF firmware toolchain is documented in
[`apps/embedded/platforms/esp-idf/README.md`](./apps/embedded/platforms/esp-idf/README.md).

## Releases and compatibility

Stable installers and the signed Tauri updater manifest are published through
[GitHub Releases](https://github.com/bruce-shi/enigma/releases). Publication fails
closed until updater signing, OS code signing, and notarization credentials are
configured. Development builds never contact the updater.

Only physically tested host, iOS, and transport combinations are support claims. See
[`docs/compatibility.md`](./docs/compatibility.md) and
[`docs/physical-test-matrix.md`](./docs/physical-test-matrix.md).

## Contributing and security

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), and
[`RESPONSIBLE_USE.md`](./RESPONSIBLE_USE.md) before opening a change. Never include
Apple pairing records, device identifiers, locations, signing material, or Mapbox
tokens in issues or logs.

## License

Enigma is licensed under [GPL-3.0-only](./LICENSE). You may use it personally or
commercially under that license; redistributed derivatives must provide their
corresponding source under GPL-3.0.

# Desktop setup

This build intentionally bypasses login and subscription checks. It enables a Mac on
the same LAN as a previously USB-paired iPhone. iOS versions without recorded physical
evidence remain experimental.

## Optional Mapbox location search

Search is disabled until the person building Enigma supplies their own Mapbox public
token. Copy the environment template:

```sh
cp apps/desktop/.env.example apps/desktop/.env.local
```

Open `apps/desktop/.env.local`, set `VITE_MAPBOX_ACCESS_TOKEN=pk.…`, and restart the
development server or rebuild the app. `.env.local` is git-ignored. A Vite environment
value is embedded in the client bundle, so use only a Mapbox public token—never an
`sk.…` secret token.

For development, run:

```sh
bun --filter @enigma/desktop tauri dev
```

## Build and launch the macOS app

Build the packaged Tauri application so the Vite frontend is embedded:

```sh
bun --filter @enigma/desktop tauri build --bundles app
open target/release/bundle/macos/Enigma.app
```

Do not launch the desktop from the workspace with `cargo run --release` or build it
with a plain `cargo build -p enigma-desktop --release`. Those commands compile the
Rust host outside Tauri's frontend build context and can produce an empty window.

## Before opening Enigma

1. Use macOS 12 or later.
2. Connect the unlocked iPhone to the Mac with a cable once and approve **Trust This
   Computer**.
3. In Finder, select the iPhone and enable **Show this iPhone when on Wi-Fi**.
4. On the iPhone, enable **Settings → Privacy & Security → Developer Mode**, restart,
   and confirm the prompt.
5. Put the Mac and iPhone on the same ordinary LAN. Avoid guest Wi-Fi, client
   isolation, VPN routing, and Personal Hotspot for this test.
6. Disconnect the cable only after Finder can still see the iPhone over Wi-Fi.

## First run

1. Connect the Lichuang board and unlocked iPhone to the Mac, then click **Provision
   board** beside the USB iPhone. Keep serial monitors closed while provisioning.
2. On the iPhone, join the SSID and password shown on the board. Choose **Use Without
   Internet** if iOS warns that the network has no internet access.
3. Select the Wi-Fi device. A physically qualified device is labeled **Validated
   same-LAN path**; other versions are labeled **Wi-Fi beta available**. USB entries
   remain disabled after provisioning.
4. Search to center the map, then click the map or enter decimal latitude and longitude.
5. Use **Set location**, **Route**, **Joystick**, or **GPX**.
6. Always choose **Restore** before disconnecting the device, installing an update,
   or quitting Enigma.

Routes, favorites, GPX contents, and history are encrypted before local SQLite
storage. Use **Export safe diagnostics** when asking for help; inspect the JSON before
sharing it.

## Physical acceptance

Follow `docs/desktop-m3-m4-acceptance.md` for the short end-to-end device pass and
record the exact host, iOS version/build, transport, Enigma commit, and results in
`docs/physical-test-matrix.md`.

# Device setup and M0 verification

This document describes the supported, Developer Mode based path. It does not
claim that a host/iOS combination is supported until its physical test is
recorded in `MILESTONES.md`.

## macOS

1. Use macOS 12 or later and unlock the iPhone.
2. Connect the iPhone directly over USB.
3. Approve **Trust This Computer** on the iPhone and enter its passcode.
4. Enable **Settings → Privacy & Security → Developer Mode**, then restart and
   confirm the prompt on the iPhone.
5. For Wi-Fi beta, enable **Show this iPhone when on Wi-Fi** in Finder. Complete
   the first Enigma connection over USB before removing the cable.

## Windows

1. Use Windows 10 or 11 x64.
2. Install Apple's current Apple Devices application or Apple Mobile Device
   Support. Enigma does not redistribute Apple drivers.
3. Start the Apple Mobile Device service, unlock the iPhone, connect over USB,
   and approve **Trust This Computer**.
4. Enable Developer Mode on the iPhone as described above.

## M0 probe

The probe intentionally prints no Apple UDID:

```sh
cargo run -p enigma-desktop --features m0-probe --bin m0-probe -- list
cargo run -p enigma-desktop --features m0-probe --bin m0-probe -- set --index 0 --expected-ios 27.0 -- 49.2827 -123.1207
cargo run -p enigma-desktop --features m0-probe --bin m0-probe -- move --index 0 --expected-ios 27.0 -- 49.2827 -123.1207 49.2830 -123.1190
cargo run -p enigma-desktop --features m0-probe --bin m0-probe -- clear --index 0 --expected-ios 27.0
```

The `set` command maintains the modern location-service connection and restores
the real location after Ctrl-C. `move` applies two points in one service session
and then restores automatically. `--expected-ios` prevents a changed device index
from targeting a different iOS version. Record the host version, exact iOS build,
transport, command, result, and any diagnostic code in `MILESTONES.md`.

## Wi-Fi beta boundary

- Initial USB pairing is mandatory.
- The supported beta topology is the same ordinary local network.
- Guest-network/client isolation and blocked multicast discovery prevent
  discovery.
- VPN subnets, Internet control, and iPhone personal-hotspot topology are not
  supported claims.
- A Wi-Fi failure must never prevent USB fallback or the restore command.

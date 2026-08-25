# Getting started

Enigma gives you four ways to simulate movement on a paired iPhone: teleport to an
exact point, follow a route, steer with a joystick, or replay a GPX track. Start with
the desktop app, then add the compact ESP32-S3 controller if it fits your workflow.

## What you need

- A Mac running macOS 12 or newer
- An iPhone you are authorized to test
- A USB cable for the initial Apple pairing
- A normal Wi-Fi network shared by the Mac and iPhone
- A Mapbox account and public `pk.` token for the street map, place search, and routing
- Optional: the supported Lichuang ESP32-S3 board for standalone control

Check [compatibility](compatibility.md) for the currently qualified iOS and transport
combinations before relying on Enigma for a test plan.

## Start with the desktop app

1. Download the current macOS installer from
   [GitHub Releases](https://github.com/bruce-shi/enigma/releases).
2. Connect and unlock the iPhone, approve **Trust This Computer**, and enable Developer
   Mode if the iOS build requires it.
3. Open Enigma, scan devices, and connect to the ready USB device entry. To use Wi-Fi,
   enable desktop Wi-Fi first, put both devices on the same LAN, disconnect USB, then
   scan and connect again.
4. Add a Mapbox public token in **Settings**, pick a point, and test **Set** followed by
   **Restore** before running a route.

The [desktop setup guide](desktop-setup.md) covers Mapbox maps, place search, road
routing, local route storage, and recovery behavior in more detail.

## Add the embedded controller

The Lichuang ESP32-S3 workflow is optional. The desktop provisions the board once over
serial; the board then creates its own Wi-Fi network and controls the joined iPhone
from its touch display. Follow [embedded setup](embedded-setup.md) for firmware flashing,
provisioning, and safe board transfer.

## Before each test

- Confirm that Enigma shows the expected iPhone.
- Use only devices, apps, and services you are authorized to test.
- Keep the device unlocked for the first Set/Restore check.
- Restore real location before closing Enigma or installing an update.

If setup stalls, use the [troubleshooting guide](troubleshooting.md). See
[privacy](privacy-and-reliability.md) for the exact local and network boundaries.

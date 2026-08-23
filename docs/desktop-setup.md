# Desktop setup

The desktop app works without an Enigma account or embedded board. Initial Apple
pairing is local and still requires an unlocked iPhone, Trust approval, and Developer
Mode where required by the iOS build.

## Desktop-only Wi-Fi setup

1. Connect the iPhone to the Mac by USB, unlock it, and approve **Trust This Computer**.
2. Open Enigma, scan devices, and select **Enable desktop Wi-Fi** on the USB entry.
3. Put the Mac and iPhone on the same normal Wi-Fi network.
4. Disconnect USB, scan again, and connect to the Wi-Fi device entry.
5. Select a map point and test Set/Restore before using routes or joystick movement.

The current qualified path is macOS 12+ with the exact iOS 27 build recorded in the
physical test matrix. Other visible devices remain unqualified until tested.

## Optional embedded-board provisioning

Connect the supported Lichuang ESP32-S3 board and the trusted iPhone to the Mac, then
choose **Provision embedded board** on the USB iPhone entry. Keep the phone unlocked,
approve Apple's modern pairing prompt, and close serial monitors that own the CH340K
port. The desktop transfers the pairing bundle directly to the board over serial.

After provisioning, join the board SSID from the iPhone and follow the embedded guide.
The board then works independently of the desktop and internet.

## Optional Mapbox search

Open **Settings**, paste a client-visible Mapbox public token beginning with `pk.`, and
save it. The token is stored in the desktop's local SQLite settings. Search queries and
proximity coordinates go directly to Mapbox; Enigma does not proxy or retain them.
OpenFreeMap and manual coordinate entry work without a token.

## Local data and recovery

Favorites, history, GPX-derived plans, and routes are encrypted in the local vault.
Every simulated session sets a durable recovery marker. Restore the real location
before exiting or installing an update.

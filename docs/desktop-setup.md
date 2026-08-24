# Desktop setup

Enigma controls a paired iPhone from its map workspace. Initial Apple pairing requires
an unlocked iPhone, Trust approval, and Developer Mode where required by the iOS build.

## Desktop-only Wi-Fi setup

1. Connect the iPhone to the Mac by USB, unlock it, and approve **Trust This Computer**.
2. Open Enigma, scan devices, and select **Enable desktop Wi-Fi** on the USB entry.
3. Put the Mac and iPhone on the same normal Wi-Fi network.
4. Disconnect USB, scan again, and connect to the Wi-Fi device entry.
5. Select a map point and test Set/Restore before using routes or joystick movement.

Review [compatibility](compatibility.md) before setup; visible devices outside the
qualified path may connect but are not yet supported.

## Optional embedded-board provisioning

Connect the supported Lichuang ESP32-S3 board and the trusted iPhone to the Mac, then
choose **Provision embedded board** on the USB iPhone entry. Keep the phone unlocked,
approve Apple's modern pairing prompt, and close serial monitors that own the CH340K
port. The desktop transfers the pairing bundle directly to the board over serial.

After provisioning, join the board SSID from the iPhone and follow the
[embedded setup guide](embedded-setup.md).
The board then works independently of the desktop and internet.

## Mapbox maps, search, and routing

Open **Settings**, paste a client-visible Mapbox public token beginning with `pk.`, and
save it. The token is stored in the desktop's local SQLite settings. Enigma uses
MapLibre to render Mapbox Streets, then calls Mapbox Search and Directions for place
results and routes that follow roads and paths. Choose driving, walking, or cycling in
Route mode.

Map style and tile requests, search queries, proximity coordinates, selected route
waypoints, and the routing profile go directly to Mapbox; Enigma does not proxy or
retain those requests. Mapbox usage is subject to the quota and billing rules of the
account that owns the token. Manual coordinate entry, local GPX playback, and device
Restore remain available without Mapbox.

## Local data and recovery

Favorites, history, GPX-derived plans, and routes are encrypted in the local vault.
Every simulated session sets a durable recovery marker. Restore the real location
before exiting or installing an update.

Continue with [troubleshooting](troubleshooting.md) if the iPhone, board, map, or updater
does not behave as expected.

# Troubleshooting

## The USB iPhone appears but Wi-Fi does not

Unlock the iPhone, approve Trust, run **Enable desktop Wi-Fi**, put the Mac and iPhone
on the same LAN, disconnect USB, and scan again. Finder or `usbmuxd` must retain the
local pairing record. Apple pairing cannot be bypassed.

## Board provisioning fails

Close serial monitors, connect the Lichuang board and iPhone by USB, keep the iPhone
unlocked, and approve the modern Apple pairing prompt. On macOS, verify the CH340K
driver and set `ENIGMA_BOARD_PORT` only when multiple physical boards are attached.

## The map loads but search is disabled

Open Settings and save your own Mapbox public `pk.` token. Secret `sk.` tokens are
rejected. Manual map selection and coordinate entry do not require Mapbox.

## OpenFreeMap or Mapbox is unavailable

Third-party map failures do not affect device Restore. Use decimal coordinates or a
local GPX file, and retry the provider later.

## Enigma reports an unfinished session

Reconnect the same iPhone over Wi-Fi and choose Restore. The durable marker remains
set until the device command succeeds. Never delete the local database merely to hide
the warning.

## Updates are disabled

Unsigned development builds intentionally do not contact GitHub. Official builds need
the committed updater public key and `VITE_UPDATER_READY=true`. Installation remains
blocked until the current location is restored and simulation state is idle.

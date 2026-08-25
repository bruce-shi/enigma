# Enigma ESP-IDF platform

Rust/ESP-IDF runtime for Enigma embedded targets. The default and currently
supported board is the **Lichuang Practical ESP32-S3 development board**
(`ESP32-S3-WROOM-1-N16R8`). The package is isolated from Enigma's host Cargo
workspace because it uses Espressif's Xtensa Rust target; portable application
behavior lives in `../../core`.

The firmware provides a physically verified ST7789/FT5x06 touch UI, location
selection, recent-location persistence, Set, and Restore. Because the stock
USB-C connector cannot host an iPhone, the desktop app performs a one-time
local provisioning bridge. The board then creates a private Wi-Fi access point
and connects directly to the joined iPhone using the imported Apple pairing
identity.

There is no Enigma login, account, or cloud authentication. Apple's initial
**Trust This Computer** and modern remote-pairing approval are still mandatory
and cannot be bypassed.

After the one-time local serial provisioning step, the board works independently
of the desktop and internet.

## Why the iPhone transport uses Wi-Fi

The board's only USB-C connector is wired to the upstream side of an on-board
CH334F hub. Hub downstream port D4 connects to the CH340K serial adapter and D3
connects to the ESP32-S3 native USB pins (GPIO19/20). A computer can enumerate
both devices, but the ESP32 has no downstream host connector or switched 5 V
VBUS for an iPhone.

The connector therefore remains the flash, power, serial-log, and one-time
provisioning link to a Mac. Runtime Set/Restore traffic goes over the
board-owned Wi-Fi network instead.

## Prerequisites and build

```sh
cargo install espup --locked
espup install
. "$HOME/export-esp.sh"
cargo install ldproxy espflash --locked
```

Use the repository launcher to compile without hardware:

```sh
cd apps/embedded
cargo run --release -- --build-only
```

Or build the platform package directly:

```sh
cd apps/embedded/platforms/esp-idf
. "$HOME/export-esp.sh"
cargo build --release
```

Private board-only location presets can be supplied in this package's gitignored
`.env` as `ENIGMA_PRIVATE_LOCATIONS="Name|latitude|longitude;..."`. They are read
only at firmware build time, omitted when the variable/file is absent, and are not
served by the web portal or city-map service. A locally built firmware binary still
contains the configured values, so do not publish that binary.

The first build installs a managed ESP-IDF v5.5.3 checkout beneath the ignored
`.embuild` directory. `partitions.csv` assigns an 8 MiB factory-app partition,
a 128 KiB `userdata` NVS partition, and the remaining 7.75 MiB to one validated
downloadable city pack within the board's 16 MiB flash. Pairing identities,
upstream Wi-Fi credentials, saved locations, and active-map state live in
`userdata`, beyond the factory image, so normal firmware flashes do not replace
them. The `mapdata` slot uses a tooling-recognized data subtype but is accessed
as raw, header-validated flash. A full-chip erase still removes all user data.

## One-time iPhone provisioning and Wi-Fi setup

1. Flash the current firmware, then close `espflash monitor` so it releases the
   CH340K serial port.
2. Connect both the board and iPhone to the Mac. Unlock the iPhone and approve
   **Trust This Computer** if prompted.
3. Open the Enigma desktop app, refresh devices, and choose **Provision board**
   on the USB iPhone. The app enables Apple's Wi-Fi debugging setting and
   provisions both the trusted Lockdown identity and the modern CoreDevice
   remote-pairing identity. Approve Apple's pairing prompt if it appears. The
   identities are sent to the board's persistent CH340K listener using a
   length-checked SHA-256 protocol. No board reset is required.
4. On the iPhone, join the SSID shown at the top of the board display
   (`Enigma-XXXX`). The password is `enigma-setup`. Before upstream Wi-Fi is
   configured, choose **Use Without Internet** if iOS warns that the network
   has no internet.
5. Complete the one-time HTTPS trust setup below if you want to save the
   iPhone's real GPS position from Safari.
6. Keep the iPhone unlocked for the first test. Enter the default operator PIN
   **1234** on the board; it unlocks immediately after the fourth digit. Select
   a location and tap **SET LOCATION**. Tap **RESTORE** to return to real GPS.

The board accepts one Wi-Fi client and learns its address from the ESP-IDF DHCP
lease. It discovers that phone's `_remotepairing._tcp` service with mDNS, then
opens the iOS 17+ CoreDevice TLS-PSK tunnel using the provisioned identity;
there is no manual IP or port entry. Provisioning remains available in a
background UART listener whenever the normal touch UI is running.
The desktop app therefore does not depend on the board's unreliable CH340K
auto-reset circuit or a short startup window.

## Save the iPhone's current location from Safari

The hotspot runs a captive HTTP onboarding page, an HTTPS location portal, and
a small DNS responder. While joined to `Enigma-XXXX`, `enigma.test` resolves to
the board rather than the internet. iOS requires a trusted HTTPS origin before
Safari exposes `navigator.geolocation`, so the first use needs a manual trust
step:

1. Open `http://enigma.test` in Safari. The captive-network window may open the
   same page automatically.
2. Tap **Download trust profile**. In Settings, tap **Profile Downloaded** and
   install **Enigma Location Portal Trust**. The local profile is intentionally
   unsigned, so iOS shows that fact during installation.
3. Go to Settings > General > About > Certificate Trust Settings and enable
   full trust for **Enigma Local Portal CA**.
4. Return to Safari and open `https://enigma.test`.
5. In the **New location** tab, choose bundled Vancouver or Richmond and tap its street
   map to select a point,
   or tap **Use my current location** and allow Safari location access. Drag and zoom the
   map to refine the coordinates, change **Location name** if desired, then tap **Save to
   board** or **Set on iPhone**.

Vancouver, Richmond, and the interaction code are served from firmware, so selection
works on the board hotspot without an internet route or Mapbox token. Each bundled city
contains a passive SVG plus gzip JSON with a deduplicated street table, street-label
anchors, and every `addr:housenumber` coordinate available from OpenStreetMap in the
stored bounds. The current bundles contain 129,632 Vancouver and 20,794 Richmond numbered
address records; OpenStreetMap coverage is community-maintained and is not a guarantee
that every real-world building has a number. Street names appear at medium zoom, building
numbers appear at close zoom, and tapping near one selects its full street address.
The active index is available from the board as `/offline-map.json`; Safari transparently
decodes its gzip response. In the compact schema, `streets` stores each name once,
each `streetLabels` tuple is `[streetIndex, latitude, longitude, angleDegrees]`, and each
compact `streetPaths` tuple is `[streetIndex, minX, minY, maxX, maxY, points]`, allowing
the portal to label every street whose geometry intersects the visible map. Each `buildings`
tuple is `[number, streetIndex, latitude, longitude]`. The website service
also exposes `/api/city-map.svg`, `/api/city-map.json`, and the board-oriented
`/api/city-map.pack` for any accepted city query.

To add another city, open
**City maps**, enter an upstream Wi-Fi name and password, and tap **Connect board**.
Then enter a city plus country and tap **Generate and download map**. The board stays in
AP+STA mode: the iPhone remains on `Enigma-XXXX` while the board asks the Enigma website
service to turn that city into an SVG plus detailed JSON pack over HTTPS. Once connected,
the board also
acts as an IPv4 NAPT gateway, so the iPhone can use normal internet services without
leaving `Enigma-XXXX`. Split DNS keeps `enigma.test` on the board and forwards other
names to the upstream network. The hotspot may briefly reconnect when its channel
follows the upstream network, and the upstream network must not overlap the board's
`192.168.71.0/24` subnet. One downloaded city is stored beside bundled Vancouver and
Richmond; installing another replaces that downloadable slot. The service caps
the geographic span and output size, caches generated results, and returns the map
bounds, dimensions, byte length, and SHA-256 digest as response metadata. The board
accepts only matching metadata, independent SVG/detail SHA-256 digests, passive SVG
content, and declared gzip size, then commits the flash header after both payloads. No
code sandbox is needed because the service runs one fixed OpenStreetMap-to-SVG/JSON
transformer rather than user-supplied code. The maps are derived
from [OpenStreetMap data](https://www.openstreetmap.org/copyright) and display the
required OpenStreetMap/ODbL attribution. Road routing remains desktop-only.
Saving adds the coordinates to the six-entry recent list in NVS and
refreshes the touch-screen catalog. The mobile portal then opens the **Saved** tab, whose
badge shows the current stored count. Tap **View** to reopen a row on the map, **Set** to
apply it to the connected iPhone, **Refresh** to reload NVS state, or **Restore real GPS**
to end simulation. The tab bar stays visible while scrolling, controls use iPhone-friendly
touch targets, and **Enter coordinates manually** remains collapsed until needed. Saving
alone does not start location simulation. The touch-screen **SET LOCATION** and
**RESTORE** controls remain available as before.

The firmware contains the `enigma.test` server certificate and its private key.
The installed profile contains only the public CA certificate; the CA signing
key is not stored in the repository or firmware. This prototype uses the same
portal identity on every image, so someone who extracts the firmware can
impersonate `enigma.test` to a phone that trusts this CA if they can also
control that phone's network. Remove **Enigma Location Portal Trust** from the
iPhone when the board is no longer used. Per-board certificates are required
for a production security boundary.

The pairing identities and upstream Wi-Fi credentials are sensitive and are currently
stored in ordinary NVS; this prototype does not yet enable ESP32 flash/NVS encryption.
Erase the board or hold BOOT during reset before transferring it to someone else; the
startup clearing flow removes both pairing identities and upstream Wi-Fi credentials.

## Touch UI and saved locations

At boot, the screen cycles through white, red, green, and blue for 500 ms each,
then opens a numeric lock screen. Enter the hardcoded prototype PIN **1234** to
reach the private build-time presets and saved locations; the fourth digit submits automatically so the
bottom-edge **ENTER** button is not required. The lock screen also shows the
board Wi-Fi SSID and password. Tap **LOCK** at the top right to protect the
controls again without restarting. Tap a row, or use **UP** and **DN**, then tap
**SET LOCATION**.
The latest six locations saved from the Safari portal or successfully applied
from the touch UI are stored in flash, moved to the top of the list, and remain
available after reset.

**RESTORE** clears simulation and lets the iPhone use its real GPS again. The
`idevice` cannot read the iPhone's actual GPS. The Safari portal obtains real
coordinates through the browser's separately permissioned Geolocation API.

The second physical button is the **BOOT/user** button on GPIO0. A short click
turns the LCD and backlight off; click **BOOT** again to redraw and wake the
display. Display sleep leaves Wi-Fi, the HTTPS portal, pairing, and any active
location simulation running, and touch input is ignored while the screen is
dark. Hold **BOOT** for two seconds and release it for the existing full
software-off flow: restore an active simulated location, turn off the LCD and
Wi-Fi, and enter low-power sleep. Press **BOOT** once to wake from software-off.
The reset button keeps its normal reset behavior. USB power remains connected
in both states and the board is not electrically disconnected.

The operator PIN is only a first-pass physical UI gate. It is compiled into the
firmware, has no secure retry limit, and does not encrypt pairing data or flash.
Replace it with a provisioned credential plus encrypted storage before treating
the board as resistant to a determined attacker.

## Flash and physical test

```sh
cd apps/embedded
cargo run --release
```

The serial monitor should progress through these checkpoints:

1. `transport target: board Wi-Fi with imported Apple pairing identities`
2. `persistent desktop pairing listener ready`
3. `Wi-Fi access point ready: SSID ...`
4. `location portal ready: onboarding http://enigma.test, secure portal https://enigma.test`
5. `display: LCD chip-select asserted; native ST7789 initialized`
6. `display: active-low GPIO42 backlight enabled`
7. Four `display: showing ... LCD self-test` messages
8. `display: first frame drawn; touch UI locked and ready`

After the iPhone joins, expect `Wi-Fi: iPhone received address ...`. A Set or
Restore tap should then log the discovered remote-pairing port, the announced
CoreDevice tunnel port, `iPhone modern location service ready over Wi-Fi`, and
the successful action. The legacy service is retained only for older iOS
versions. Wi-Fi/iPhone runtime behavior is build-verified but still awaits
physical acceptance; the display and touch path is physically verified.
For a portal save, expect `web portal: saving location ...`, then confirm the
new name appears at the top of the unlocked touch catalog after the browser
reports success. HTTPS trust, captive DNS, Safari geolocation, and NVS saving
are build-verified but still require physical iPhone acceptance.

If flash succeeds but the monitor loses its connection, reopen it from the
platform package:

```sh
espflash monitor \
  --elf target/xtensa-esp32s3-espidf/release/enigma-embedded-esp-idf
```

An idle board logs `touch UI alive; waiting for input` about every ten seconds.
Transient FT5x06 I2C failures are logged and retried. To discard the Apple
pairing identity, hold **BOOT** while resetting or powering on, release it after
the clearing message, then provision again. Waking from software-off with BOOT
does not clear pairing. This does not erase recent locations.

## Board facts retained from the C++ reference

- 16 MiB flash and 8 MiB octal PSRAM
- BOOT/user button: GPIO0; click to toggle the display, hold two seconds for
  software-off, and press to wake
- WS2812 status LED: GPIO48
- ST7789 320x240 display: MOSI GPIO40, SCLK GPIO41, D/C GPIO39
- active-low display backlight: GPIO42
- shared I2C: SDA GPIO1, SCL GPIO2, PCA9557 at `0x19`, FT5x06 at `0x38`
- single USB-C upstream port through CH334F to CH340K and ESP32 GPIO19/20
- board Wi-Fi: WPA2 access point, one DHCP client, channel 6 until it follows an
  upstream network; optional AP+STA IPv4 NAPT and split-DNS internet relay

References:

- <https://oshwhub.com/li-chuang-kai-fa-ban/li-chuang-shi-zhan-pai-esp32-s3-kai-fa-ban>
- <https://github.com/78/xiaozhi-esp32/tree/main/main/boards/lckfb/szpi-esp32s3>

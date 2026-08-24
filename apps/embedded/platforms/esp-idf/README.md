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

The first build installs a managed ESP-IDF v5.5.3 checkout beneath the ignored
`.embuild` directory. `partitions.csv` assigns an 8 MiB factory-app partition
and an 88 KiB NVS partition within the board's 16 MiB flash.

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
   (`Enigma-XXXX`). The password is `enigma-setup`. Choose **Use Without
   Internet** if iOS warns that the network has no internet.
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
5. In the **New location** tab, change **Location name** if desired, tap **Use
   my current location**, allow Safari location access, then tap **Save to
   board**.

Saving adds the coordinates to the six-entry recent list in NVS and refreshes
the touch-screen catalog. The mobile portal then opens the **Saved** tab, whose
badge shows the current stored count. Tap **Set** on any row to apply it to the
connected iPhone, or **Refresh** to reload NVS state. The tab bar stays visible
while scrolling, controls use iPhone-friendly touch targets, and **Enter
coordinates manually** remains collapsed until needed. Saving alone does not
start location simulation. The touch-screen **SET LOCATION** and **RESTORE**
controls remain available as before.

The firmware contains the `enigma.test` server certificate and its private key.
The installed profile contains only the public CA certificate; the CA signing
key is not stored in the repository or firmware. This prototype uses the same
portal identity on every image, so someone who extracts the firmware can
impersonate `enigma.test` to a phone that trusts this CA if they can also
control that phone's network. Remove **Enigma Location Portal Trust** from the
iPhone when the board is no longer used. Per-board certificates are required
for a production security boundary.

The pairing identities are sensitive and are currently stored in ordinary NVS;
this prototype does not yet enable ESP32 flash/NVS encryption. Erase the board
or hold BOOT during reset before transferring it to someone else.

## Touch UI and saved locations

At boot, the screen cycles through white, red, green, and blue for 500 ms each,
then opens a numeric lock screen. Enter the hardcoded prototype PIN **1234** to
reach the six built-in presets; the fourth digit submits automatically so the
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

The second physical button is the **BOOT/user** button on GPIO0. While the UI is
running, hold it for two seconds and release it to restore an active simulated
location, turn off the LCD and Wi-Fi, and enter low-power sleep. Press **BOOT** once
to wake. The reset button keeps its normal reset behavior. This is a low-power
software-off state; USB power remains connected and the board is not electrically
disconnected.

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
- BOOT/user button: GPIO0; hold two seconds for software-off, press to wake
- WS2812 status LED: GPIO48
- ST7789 320x240 display: MOSI GPIO40, SCLK GPIO41, D/C GPIO39
- active-low display backlight: GPIO42
- shared I2C: SDA GPIO1, SCL GPIO2, PCA9557 at `0x19`, FT5x06 at `0x38`
- single USB-C upstream port through CH334F to CH340K and ESP32 GPIO19/20
- board Wi-Fi: WPA2 access point, one DHCP client, channel 6

References:

- <https://oshwhub.com/li-chuang-kai-fa-ban/li-chuang-shi-zhan-pai-esp32-s3-kai-fa-ban>
- <https://github.com/78/xiaozhi-esp32/tree/main/main/boards/lckfb/szpi-esp32s3>

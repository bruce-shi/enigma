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

There is no Enigma login, account, cloud authentication, or remote pairing
record storage. Apple's initial **Trust This Computer** approval is still
mandatory and cannot be bypassed.

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
   on the USB iPhone. The app enables Apple's Wi-Fi debugging setting, exports
   the local usbmuxd pairing record, resets the board, and sends the record over
   the CH340K UART using a length-checked SHA-256 protocol.
4. On the iPhone, join the SSID shown at the top of the board display
   (`Enigma-XXXX`). The password is `enigma-setup`. Choose **Use Without
   Internet** if iOS warns that the network has no internet.
5. Keep the iPhone unlocked for the first test. Select a location on the board
   and tap **SET LOCATION**. Tap **RESTORE** to return to real GPS.

The board accepts one Wi-Fi client and learns its address from the ESP-IDF DHCP
lease, so there is no discovery server or manual IP entry. Provisioning is
available for five seconds when no pairing record exists and for three seconds
on later boots. The desktop app resets the board after opening its serial port,
so it can replace the record without requiring a long blank startup delay.

The pairing record is sensitive and is currently stored in ordinary NVS; this
prototype does not yet enable ESP32 flash/NVS encryption. Erase the board or
hold BOOT during reset before transferring it to someone else.

## Touch UI and saved locations

At boot, the screen cycles through white, red, green, and blue for 500 ms each,
then shows six built-in presets. The top status line shows the board Wi-Fi SSID
and password. Tap a row, or use **UP** and **DN**, then tap **SET LOCATION**.
The latest six successfully applied locations are stored in flash, moved to the
top of the list, and remain available after reset.

**RESTORE** clears simulation and lets the iPhone use its real GPS again. The
`idevice` service cannot read the iPhone's actual GPS, so the recent list only
contains simulated locations successfully applied from this UI.

The second physical button is the **BOOT/user** button on GPIO0. While the UI is
running, hold it for two seconds and release it to restore an active simulated
location, turn off the LCD and Wi-Fi, and enter low-power sleep. Press **BOOT** once
to wake. The reset button keeps its normal reset behavior. This is a low-power
software-off state; USB power remains connected and the board is not electrically
disconnected.

## Flash and physical test

```sh
cd apps/embedded
cargo run --release
```

The serial monitor should progress through these checkpoints:

1. `transport target: board Wi-Fi with imported Apple pairing identity`
2. `Wi-Fi access point ready: SSID ...`
3. `display: LCD chip-select asserted; native ST7789 initialized`
4. `display: active-low GPIO42 backlight enabled`
5. Four `display: showing ... LCD self-test` messages
6. `display: first frame drawn; touch UI ready`

After the iPhone joins, expect `Wi-Fi: iPhone received address ...`. A Set or
Restore tap should then log either `iPhone modern location service ready` or
the legacy fallback, followed by the successful action. Wi-Fi/iPhone runtime
behavior is build-verified but still awaits physical acceptance; the display
and touch path is physically verified.

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

# Enigma ESP-IDF platform

Rust/ESP-IDF runtime for Enigma embedded targets. The currently supported and
default board is the **Lichuang Practical ESP32-S3 development board**
(`ESP32-S3-WROOM-1-N16R8`). This package is isolated from Enigma's host Cargo
workspace because it uses Espressif's Xtensa Rust target; portable application
behavior lives in `../../core`.

The firmware provides a physically verified on-board touch UI on the board's
ST7789 display. It includes location selection, recent-location persistence,
Set, and Restore flows. The direct ESP-IDF USB Host/`idevice` transport compiles
as a prototype, but it cannot connect to an iPhone through the stock board's
single USB-C connector; see **USB hardware limitation** below.

The prototype transport does not use desktop `usbmuxd`. The `idevice`
dependency is pinned to the same revision used by the desktop application and
enables pairing, pure-Rust TLS, and location simulation only. Any eventual
iPhone path still requires Apple's on-device **Trust This Computer** approval;
there is no Enigma account or cloud authentication dependency.

## USB hardware limitation

The Lichuang board has one USB-C connector wired to the upstream side of an
on-board CH334F USB hub. Hub downstream port D4 connects to the CH340K serial
adapter and D3 connects to the ESP32-S3 native USB pins (GPIO19/20). This lets a
computer enumerate both devices, but it does not give the ESP32 a downstream
host connector or switched 5 V VBUS for an iPhone.

Consequently, **Set and Restore cannot reach an iPhone on an unmodified stock
board**. Do not interpret the compiled USB Host prototype as physical-board
support. A later design must choose a computer bridge, hardware modification
that isolates GPIO19/20 and adds a powered host connector, or a different board
with a dedicated USB-OTG host port.

## Prerequisites

```sh
cargo install espup --locked
espup install
. "$HOME/export-esp.sh"
cargo install ldproxy espflash --locked
```

## Build

The normal repository entry point is the launcher in `apps/embedded`:

```sh
cd apps/embedded
cargo run --release -- --build-only
```

For direct platform development, run Cargo in this package:

```sh
cd apps/embedded/platforms/esp-idf
. "$HOME/export-esp.sh"
cargo build
```

Board selection is explicit and compile-time. The equivalent non-default build
command is:

```sh
cargo build --no-default-features --features board-lichuang-esp32s3
```

The first build also installs a managed ESP-IDF v5.5.3 checkout beneath the
ignored `.embuild` directory and can take several minutes.
`partitions.csv` assigns an 8 MiB factory-app partition and an 88 KiB NVS
partition within the board's 16 MiB flash. The Cargo runner passes that table
to `espflash`, so the boot log should show `factory` at `0x20000` rather than
espflash's default app offset at `0x10000`.

## Touch UI and saved locations

At boot, the screen cycles through white, red, green, and blue for 500 ms each
as an LCD/backlight self-test, then shows six built-in presets from the shared
embedded core.
Tap a visible row, or use **UP** and **DN**, then tap **SET LOCATION**. The
latest six successfully applied locations are stored in flash, moved to the top
of the list, and remain available after a board reset.

When a viable iPhone transport is added, **RESTORE** will clear location
simulation and let the iPhone use its real GPS again. The `idevice` simulation
service cannot read the iPhone's actual GPS coordinates, so “recent locations”
means simulated locations successfully applied from this UI; the phone's real
location is never read or saved.

## Flash and test

Keep the board's programming/CH340 USB port connected for flashing, power, and
serial logs. From this directory run:

```sh
. "$HOME/export-esp.sh"
cargo run --release
```

The stock-board physical test covers the display, touch controller, selection,
and NVS-backed catalog. The serial monitor should progress through these
messages:

1. `display: LCD chip-select asserted; native ST7789 initialized`
2. `display: active-low GPIO42 backlight enabled`
3. Four `display: showing ... LCD self-test` messages
4. `display: first frame drawn; touch UI ready`

After the first frame, an idle board prints `touch UI alive; waiting for input`
about every ten seconds. Each press logs its mapped `(x, y)` coordinate and the
selected action. The two action buttons occupy the bottom of the display
(`y >= 190`): Set is on the left and Restore is on the right. Transient FT5x06
I2C failures are reported and retried without terminating the UI.

If the combined flash-and-monitor command loses its terminal connection after a
successful flash, reopen only the monitor from `platforms/esp-idf`:

```sh
espflash monitor \
  --elf target/xtensa-esp32s3-espidf/release/enigma-embedded-esp-idf
```

For a dark screen, watch for the four-color self-test. The Rust firmware uses
ESP-IDF's native ST7789 driver with the reference board's SPI mode 2, 80 MHz,
RGB order, inversion, XY swap, and X mirror settings. PCA9557 IO0 is the
active-low LCD chip-select; LCD reset is shared with the board RESET net. If
touch coordinates continue to arrive but neither the patterns nor UI are
visible, the last `display:` checkpoint distinguishes panel data from GPIO42
backlight control.

To discard the saved Trust record, hold **BOOT** while resetting or powering on
the board. Release BOOT after the startup log says the pairing record will be
cleared, then accept Trust again. This does not erase the recent-location list.

The source and target builds pass, and the display plus touch path is physically
verified on the Lichuang board. iPhone behavior remains blocked on choosing an
alternate connection design; the stock connector cannot provide it.

## Board facts retained from the C++ reference

- 16 MiB flash and 8 MiB octal PSRAM
- BOOT button: GPIO0
- WS2812 status LED: GPIO48
- ST7789 320x240 display: MOSI GPIO40, SCLK GPIO41, D/C GPIO39
- active-low display backlight: GPIO42
- shared I2C: SDA GPIO1, SCL GPIO2, PCA9557 at `0x19`, FT5x06 at `0x38`
- single USB-C upstream port through CH334F to CH340K and ESP32 GPIO19/20
- USB host maximum control transfer: 1536 bytes

References:

- <https://oshwhub.com/li-chuang-kai-fa-ban/li-chuang-shi-zhan-pai-esp32-s3-kai-fa-ban>
- <https://github.com/78/xiaozhi-esp32/tree/main/main/boards/lckfb/szpi-esp32s3>

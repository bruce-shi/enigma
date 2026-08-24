# Embedded setup

Enigma supports the Lichuang Practical ESP32-S3 development board
(`ESP32-S3-WROOM-1-N16R8`) as a compact touch controller. Provisioning happens through
the desktop app; normal board-to-iPhone control then runs over the board's private Wi-Fi
network.

## Download and verify firmware

Download these two matching assets from the same
[GitHub Release](https://github.com/bruce-shi/enigma/releases):

- `enigma-firmware-lichuang-esp32s3-vX.Y.Z.zip`
- `enigma-firmware-lichuang-esp32s3-vX.Y.Z.zip.sha256`

Verify the ZIP before extracting it:

```sh
shasum -a 256 -c enigma-firmware-lichuang-esp32s3-vX.Y.Z.zip.sha256
```

The bundle contains a merged flash image, its ELF debug image, `manifest.json`, and
`FLASHING.md`. The manifest records the product version, release tag, commit, target,
flash address, filenames, and SHA-256 hashes.

## Flash the board

Install `espflash` 4.5.0 or newer, extract the bundle, connect the board's USB-C port,
and run the command printed in its `FLASHING.md` file:

```sh
espflash write-bin 0x0 enigma-firmware-lichuang-esp32s3-vX.Y.Z.bin
```

Do not change the `0x0` address. The merged image already places the bootloader,
partition table, and application at their required offsets.

## Provision the iPhone pairing identity

1. Close serial monitors so they release the CH340K port.
2. Connect the flashed board and iPhone to the Mac.
3. Unlock the iPhone and approve **Trust This Computer** and Apple's modern pairing
   prompt when shown.
4. In Enigma, refresh devices and choose **Provision embedded board** on the USB iPhone.
5. Wait for the desktop to confirm that provisioning completed.

## Connect and test

1. Join the `Enigma-XXXX` Wi-Fi network shown on the board. The prototype password is
   `enigma-setup`; choose **Use Without Internet** if iOS asks.
2. To add the phone's real position, open `http://enigma.test` in Safari. Download and
   install **Enigma Location Portal Trust**, then enable its root under Settings >
   General > About > Certificate Trust Settings. This is required only once per iPhone.
3. Open `https://enigma.test`. In **New location**, optionally rename the location,
   tap **Use my current location**, then **Save to board**. The page switches to the
   **Saved** tab after saving; use a row's **Set** button to apply that location or
   **Refresh** to reload the list from NVS. Manual coordinate entry is collapsed
   under **Enter coordinates manually**. Saving alone does not apply the location.
4. Enter the prototype operator PIN `1234` on the board.
5. Select the saved or built-in location and tap **SET LOCATION**.
6. Tap **RESTORE** and confirm that the iPhone returns to real GPS before ending the
   session.

The board stores sensitive Apple pairing identities in ordinary NVS. Secure Boot and
flash encryption are not enabled. The prototype firmware also shares one embedded
`enigma.test` TLS server key across images; the CA signing key is not included. Hold
**BOOT** while resetting or powering on to clear pairing data, and remove **Enigma
Location Portal Trust** from the iPhone before giving the board to another person.

See [troubleshooting](troubleshooting.md) for provisioning and serial-port problems, and
[compatibility](compatibility.md) for the current qualification boundary.

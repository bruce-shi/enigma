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
partition table, and application at their required offsets. Pairing, upstream
Wi-Fi, saved locations, and active-map state are stored in the separate
`userdata` partition beyond this image and survive normal firmware updates.
Commands that erase the whole chip still remove that state.

## Provision the iPhone pairing identity

1. Close serial monitors so they release the CH340K port.
2. Connect the flashed board and iPhone to the Mac.
3. Unlock the iPhone and approve **Trust This Computer** and Apple's modern pairing
   prompt when shown.
4. In Enigma, refresh devices and choose **Provision embedded board** on the USB iPhone.
5. Wait for the desktop to confirm that provisioning completed.

## Connect and test

1. Join the `Enigma-XXXX` Wi-Fi network shown on the board. The prototype password is
   `enigma-setup`; before upstream Wi-Fi is configured, choose **Use Without Internet**
   if iOS asks.
2. To add the phone's real position, open `http://enigma.test` in Safari. Download and
   install **Enigma Location Portal Trust**, then enable its root under Settings >
   General > About > Certificate Trust Settings. This is required only once per iPhone.
3. Open `https://enigma.test`. In **New location**, tap the offline map to choose a
   point, or tap **Use my current location**. Pan the map by dragging and use its zoom
   controls to refine the exact coordinates. Rename the point if desired, then choose
   **Save to board** or **Set on iPhone**. The page switches to **Saved** after saving;
   use **View** to reopen a saved point on the map or **Set** to apply it. **Restore real
   GPS** ends simulation from the page. Manual coordinate entry remains available under
   **Enter coordinates manually**.
4. Vancouver and Richmond are included in firmware, including offline street names and
   the numbered-address records available from OpenStreetMap. Street labels appear at
   medium zoom and building numbers at close zoom; tap near a number to select its full
   address. To install another offline city, open **City
   maps**, enter an upstream Wi-Fi name and password, and tap **Connect board**. Enter a
   city plus country, then tap **Generate and download map**. The iPhone stays connected
   to `Enigma-XXXX`, and the board relays normal IPv4 internet traffic through the
   upstream network. `enigma.test` still resolves locally; other DNS names are forwarded
   upstream. Reconnect if the hotspot briefly changes channel. The upstream network
   cannot overlap the board's `192.168.71.0/24` subnet. The board stores one downloaded
   city alongside bundled Vancouver and Richmond, and a later download replaces that
   slot. Each city pack contains a passive SVG plus a gzip JSON street/address index.
5. Enter the prototype operator PIN `1234` on the board if you also want to use its
   physical controls.
6. Select a saved or private build-time location and tap **SET LOCATION**, or continue using
   the portal's map controls.
7. Tap **RESTORE** and confirm that the iPhone returns to real GPS before ending the
   session.

The board stores sensitive Apple pairing identities and upstream Wi-Fi credentials in
ordinary NVS. Secure Boot and flash encryption are not enabled. The prototype firmware also shares one embedded
`enigma.test` TLS server key across images; the CA signing key is not included. Hold
**BOOT** while resetting or powering on to clear pairing data, and remove **Enigma
Location Portal Trust** from the iPhone before giving the board to another person. The
BOOT startup gesture clears both pairing identities and upstream Wi-Fi credentials.

During normal operation, click the physical **BOOT/user** key to turn only the LCD and
backlight off; click it again to wake the display. Wi-Fi, the web portal, pairing, and
location simulation continue while the display is dark. Hold the key for two seconds
for full software-off instead.

See [troubleshooting](troubleshooting.md) for provisioning and serial-port problems, and
[compatibility](compatibility.md) for the current qualification boundary.

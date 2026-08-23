# Troubleshooting

## No iPhone appears

- Confirm the iPhone is unlocked and still visible in Finder over Wi-Fi.
- Reconnect by cable, approve Trust again, wait for Finder to finish syncing, then
  rescan before removing the cable.
- Put both devices on the same non-guest LAN and temporarily disconnect VPNs.
- Client isolation or blocked local discovery cannot be repaired by Enigma.

## The device appears but is disabled

A trusted device discovered over Wi-Fi can be selected regardless of its reported iOS
version. USB operation remains disabled. iOS versions without a completed physical test
are experimental, so successful enumeration does not guarantee that the location service
is available.

## Trust or pairing failure

Reconnect by cable, unlock the iPhone, choose **Trust**, enter the passcode, and verify
Finder access. A stale pairing record may require forgetting and pairing the device
again.

## Developer service unavailable

Verify Developer Mode remained enabled after restart. If the service still fails,
record the exact iOS build and export safe diagnostics. The tested iOS 26.5.2
same-LAN path currently enumerates but cannot open the location service.

## A simulated location remains after stop or quit

1. Keep the iPhone connected to the same LAN and unlocked.
2. Reopen Enigma.
3. Select the same device.
4. In the recovery prompt choose **Restore now**.

Restore is local and does not require login, subscription, account access, or the map
service. If Enigma cannot reconnect, rebooting the iPhone is the last-resort recovery;
record the failure before doing so.

## Maps are blank

Movement controls do not require a loaded basemap. Verify normal Internet access and
that the configured map style endpoint is reachable. Do not paste coordinates into a
map URL; the gateway rejects query strings by design.

## Updates are disabled

Unsigned development builds cannot contact the updater. A release build must contain
the production updater public key, set `VITE_UPDATER_READY=true`, and use a signed
stable or beta manifest. Enigma blocks installation until the durable recovery marker
is clear and the simulation state is idle.

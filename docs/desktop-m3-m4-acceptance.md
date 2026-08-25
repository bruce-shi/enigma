# M3-M4 macOS + iOS 27 Acceptance

Use only the qualified path: macOS, a previously USB-paired iPhone running iOS 27,
Developer Mode enabled, unlocked, and on the same LAN. USB is available but is not
part of this particular acceptance pass; Windows remains deferred.

## Launch

```sh
open /Volumes/data/enigma/target/debug/bundle/macos/Enigma.app
```

Keep the iPhone close and use nearby test coordinates. If any operation reports an
error, stop and use **Restore** before continuing.

## M3 — Desktop Core

- [ ] The device appears as `Validated same-LAN path` and can be selected.
- [ ] iOS 26, unknown-version, and USB entries remain selectable and are not labeled as
      the validated same-LAN path.
- [ ] **Center on this Mac** recenters after the macOS permission prompt.
- [ ] Type a full `latitude, longitude` value one character at a time; editing remains
      stable and Enter normalizes it to six decimal places.
- [ ] **Set location** changes the iPhone location; **Restore** returns the real location.
- [ ] Save a favorite, start a location, restore, quit, and reopen. Favorite and history
      persist locally.
- [ ] Start a location and close the window. **Restore and exit**, **Keep and exit**, and
      **Cancel** behave as labeled.
- [ ] Choose **Keep and exit**, reopen, select the same iPhone, and confirm startup
      recovery restores directly without any account or network-service step.

## M4 — Movement, Joystick, and GPX

- [ ] Add three nearby route points; distance, travel time, and cooldown appear.
- [ ] Test constant and natural profiles, two repetitions, and round trip.
- [ ] During a route, Pause, Resume, Restart, Stop, and Restore all work.
- [ ] In Joystick mode, hold and release each on-screen direction. Release pauses.
- [ ] Repeat with W/A/S/D and arrow keys, then Stop and Restore.
- [ ] Import [`m3-m4-test-route.gpx`](./fixtures/m3-m4-test-route.gpx), start it, Pause,
      Resume, Stop, and Restore.
- [ ] Export the imported GPX and re-import the exported file.
- [ ] While a route is stopped or has completed but is not restored, closing the window
      still shows the exit safety dialog.

## Result

Record the iOS version and build shown by Enigma, then report either:

- `M3/M4 acceptance passed — iOS <version> (<build>)`
- `M3/M4 acceptance failed at <check> — <exact error>`

Do not mark M3 or M4 complete until all checks above pass and the result is added to
`MILESTONES.md`.

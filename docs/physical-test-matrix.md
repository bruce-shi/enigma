# Physical test matrix

Fill one row per exact host, iOS build, and transport. Never replace a prior result;
append a new row when any version changes.

| Date | Enigma commit/version | Host model and OS build | iPhone model | iOS version/build | Transport | Enumerate/pair | Set | Move | Clear | GUI exit recovery | GPX recovery | Joystick recovery | Diagnostics code/notes | Tester |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-18 | pre-Git M0 probe | Local Mac, exact build not recorded | Not recorded | 27.0, exact build not returned | Same-LAN Wi-Fi after USB pairing | Pass | Pass | Pass | Pass | Not run | Not run | Not run | Non-fatal body-length warning | Local validation |

## Required sequence

1. Confirm no simulated location is active before starting.
2. Record exact host and iOS build identifiers without committing Apple UDIDs.
3. Run set, a two-point live move, and clear.
4. Run `docs/desktop-m3-m4-acceptance.md` through the native GUI.
5. Interrupt an active GPX and joystick session separately and prove restore.
6. Export safe diagnostics and confirm it contains no coordinates, names, device IDs,
   model/build identifiers, email, token, or raw error.
7. Record failures as failures. A successful retry does not erase the first result.

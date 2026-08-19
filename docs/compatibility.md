# Compatibility and support claims

This table distinguishes implemented code from physical qualification. Only rows with
recorded physical evidence may be advertised.

| Host | iOS | Transport | Current result | Public claim |
| --- | --- | --- | --- | --- |
| macOS 12+ | 27.0, exact build unknown | Previously paired same-LAN Wi-Fi | Set, move, clear passed through the guarded probe | Beta path validated locally; GUI acceptance pending |
| macOS 12+ | 26.5.2 | Previously paired same-LAN Wi-Fi | Enumeration passed; location service unavailable | Unsupported |
| macOS 12+ | 17 | USB or Wi-Fi | Not physically tested | Not supported yet |
| macOS 12+ | 18 | USB or Wi-Fi | Not physically tested | Not supported yet |
| macOS 12+ | 26 | USB | Not physically tested | Not supported yet |
| macOS 12+ | 27 | USB | Not physically tested | Not supported yet |
| Windows 10/11 x64 | 17, 18, 26, or 27 | USB or Wi-Fi | Deferred | Not supported yet |

The desktop UI and native command both reject every path except network iOS 27. This
fail-closed gate prevents an untested device from being selected accidentally.

Before changing a public claim, complete a row in `docs/physical-test-matrix.md`,
including set, two-point move, clear, exit recovery, GPX recovery, and joystick
recovery on the exact OS build.

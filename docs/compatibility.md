# Compatibility and support claims

This table distinguishes implemented code from physical qualification. Only rows with
recorded physical evidence may be advertised.

| Host | iOS | Transport | Current result | Public claim |
| --- | --- | --- | --- | --- |
| macOS 12+ | 27.0, exact build unknown | Previously paired same-LAN Wi-Fi | Set, move, clear passed through the guarded probe | Beta path validated locally; GUI acceptance pending |
| macOS 12+ | 26.5.2 | Previously paired same-LAN Wi-Fi | Enumeration passed; location service unavailable | Unsupported |
| macOS 12+ | 17 | USB or Wi-Fi | Wi-Fi path enabled but not physically tested; USB disabled | Experimental, not qualified |
| macOS 12+ | 18 | USB or Wi-Fi | Wi-Fi path enabled but not physically tested; USB disabled | Experimental, not qualified |
| macOS 12+ | 26 | USB | Not physically tested | Not supported yet |
| macOS 12+ | 27 | USB | Not physically tested | Not supported yet |
| Windows 10/11 x64 | 17, 18, 26, or 27 | USB or Wi-Fi | Deferred | Not supported yet |

The desktop UI and native command allow trusted devices discovered over the same LAN,
regardless of reported iOS version. The runtime tries the modern location service and
falls back to the legacy service. USB remains disabled. Only rows with recorded physical
evidence are qualified for public compatibility claims.

Before changing a public claim, complete a row in `docs/physical-test-matrix.md`,
including set, two-point move, clear, exit recovery, GPX recovery, and joystick
recovery on the exact OS build.

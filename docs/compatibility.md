# Compatibility

Support is intentionally narrower than the devices Enigma may discover. Use the
qualified combinations below for reliable testing.

| Host | iOS | Transport | Current result | Public claim |
| --- | --- | --- | --- | --- |
| macOS 12+ | 27.0, exact build unknown | Previously paired same-LAN Wi-Fi | Set, move, and clear passed through the guarded probe | Beta path validated locally; GUI acceptance pending |
| macOS 12+ | 26.5.2 | Previously paired same-LAN Wi-Fi | Enumeration passed; location service unavailable | Unsupported |
| macOS 12+ | 17 | USB or Wi-Fi | Wi-Fi path enabled but not physically tested; USB disabled | Experimental, not qualified |
| macOS 12+ | 18 | USB or Wi-Fi | Wi-Fi path enabled but not physically tested; USB disabled | Experimental, not qualified |
| macOS 12+ | 26 | USB | Not physically tested | Not supported yet |
| macOS 12+ | 27 | USB | Not physically tested | Not supported yet |
| Windows 10/11 x64 | 17, 18, 26, or 27 | USB or Wi-Fi | Deferred | Not supported yet |

The desktop app can show trusted devices discovered over the same LAN regardless of
reported iOS version. Discovery does not mean that the OS and transport combination is
qualified. Runtime control tries Apple's modern location service and falls back to the
legacy service; direct USB control remains disabled.

The embedded path targets the Lichuang Practical ESP32-S3 board
(`ESP32-S3-WROOM-1-N16R8`). Its display and touch path is verified; complete
board-to-iPhone acceptance remains in progress.

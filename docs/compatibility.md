# Compatibility

Enigma allows runtime control from any trusted, ready iPhone entry on macOS. Physical
validation is narrower than software availability, so the evidence column records what
has actually been exercised.

| Host | iOS | Runtime | Board provisioning | Support and evidence |
| --- | --- | --- | --- | --- |
| macOS 12+ | 27, including 27.0 | USB or paired same-LAN Wi-Fi | Available from any trusted, ready entry | Supported beta. Same-LAN Set, move, and clear passed; USB physical acceptance pending. |
| macOS 12+ | 26, including tested 26.5.2 | USB or paired same-LAN Wi-Fi | Available from any trusted, ready entry | Supported beta. The 26.5.2 Wi-Fi location service was unavailable in its recorded test; USB physical acceptance pending. |
| macOS 12+ | 17 or 18 | USB or paired same-LAN Wi-Fi | Available from any trusted, ready entry | Supported beta; physical acceptance pending. |
| macOS 12+ | Other or unknown reported version | USB or paired same-LAN Wi-Fi | Available from any trusted, ready entry | Supported beta; physical acceptance pending. |
| Windows 10/11 x64 | 17, 18, 26, or 27 | USB or Wi-Fi | Deferred | Not supported yet. |

The desktop app can show trusted devices discovered over the same LAN regardless of
reported iOS version. Discovery does not mean that the OS and transport combination is
physically qualified. Both ready USB and same-LAN entries are selectable. Runtime
control tries Apple's modern location service and falls back to the legacy service.

Provisioning availability is not an iOS-version qualification claim. The action is
shown for every trusted, ready iPhone and can reuse either its USB or existing same-LAN
pairing record. Complete physical provisioning acceptance, especially over Wi-Fi, is
still pending.

The embedded path targets the Lichuang Practical ESP32-S3 board
(`ESP32-S3-WROOM-1-N16R8`). Its display and touch path is verified; complete
board-to-iPhone acceptance remains in progress.

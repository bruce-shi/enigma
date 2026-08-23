# Enigma Embedded

Embedded Enigma targets are applications, so they live under `apps/embedded`
instead of a repository-level `firmware` directory. The code is split by the
boundary that changes when another board or runtime is added:

```text
apps/embedded/
├── bridge-protocol/              # checksummed desktop-to-board provisioning wire format
├── core/                         # portable no_std workflow and data model
└── platforms/
    └── esp-idf/                  # ESP-IDF runtime, Wi-Fi transport, and board support
        └── src/
            ├── board.rs          # abstract ESP-IDF board entry point
            ├── backend.rs        # core LocationBackend implementation
            └── boards/
                └── lichuang_esp32s3/
                    ├── mod.rs    # pins and board startup
                    └── ui.rs     # ST7789 and FT5x06 UI
```

`core` owns locations, actions, outcomes, recent-list ordering, and the
`LocationBackend` contract, plus the allocation-free operator PIN state
machine. It is `no_std` and host-testable. Platform packages own persistence
and device transport. Board modules own pins, peripherals, and physical
input/output. `bridge-protocol` is shared with the desktop app so a Mac can
transfer an existing Apple pairing identity to the board without putting
private pairing data in a cloud service.

## Build and deploy

From this directory, the default command selects ESP-IDF and its default
Lichuang board, then flashes the connected board and opens the serial monitor:

```sh
cd apps/embedded
cargo run --release
```

The top-level launcher deliberately starts Cargo again inside the selected
platform directory, where its target toolchain and `espflash` runner are
configured. On macOS it also detects the Lichuang board's CH340K USB adapter
when the required serial driver has not claimed it and links to the official
WCH driver instead of reporting that no board is connected. To compile the
exact same release image without accessing hardware:

```sh
cargo run --release -- --build-only
```

Platform and board selection are explicit extension points:

```sh
cargo run --release -- \
  --platform esp-idf \
  --board board-lichuang-esp32s3
```

## Extension points

- Add another ESP-IDF board under `platforms/esp-idf/src/boards`, implement
  `EspIdfBoard`, and expose a mutually exclusive Cargo board feature.
- Add another runtime as a sibling under `platforms/` and implement the core
  `LocationBackend` contract there.
- Keep product behavior in `core`; do not copy the set/restore workflow into
  individual board modules.

The current ESP-IDF package selects `board-lichuang-esp32s3` by default. See
[`platforms/esp-idf/README.md`](./platforms/esp-idf/README.md) for build,
one-time pairing provisioning, Wi-Fi setup, and physical test instructions.

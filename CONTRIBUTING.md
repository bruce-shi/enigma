# Contributing to Enigma

Enigma welcomes GPL-3.0-compatible contributions for authorized device testing.

## Development workflow

1. Create a focused branch from `main`.
2. Install the pinned JavaScript dependencies with `bun install --frozen-lockfile`.
3. Make narrow changes and preserve local-only data and restore safety boundaries.
4. Run `bun run check`, `bun run test:run`, `bun run build`,
   `cargo check --workspace --all-targets`, and `cargo test --workspace`.
5. Describe physical hardware testing separately from compilation or simulation.

ESP-IDF changes must also pass the build-only command in
`apps/embedded/platforms/esp-idf/README.md`. Do not claim hardware compatibility
without completing the matching physical test matrix.

## Privacy and secrets

Never commit or paste Apple pairing records, UDIDs, real routes or coordinates,
Mapbox tokens, updater private keys, code-signing certificates, or notarization
credentials. Tests must use obviously synthetic values.

By contributing, you agree that your contribution is licensed under GPL-3.0-only.

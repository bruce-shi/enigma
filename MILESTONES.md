# Enigma Milestones

Last updated: 2026-08-19
Overall status: Implementation
Current milestone: M7 — Public V1
Next release: Desktop v1

## Status Rules

- Status values: `not_started`, `in_progress`, `blocked`, `complete`.
- Only one milestone is the current milestone.
- A milestone becomes complete only when every exit criterion has evidence.
- Update this file in the same commit as work that changes milestone status.
- Record test commands, artifact links, and supported physical-device builds.
- Do not mark exploratory or reviewed work as implemented.

## Locked Decisions

- [x] Tauri 2 desktop application
- [x] React 19 + HeroUI v3 + Tailwind CSS 4 for desktop and website
- [x] Shared `packages/ui` design system
- [x] macOS 12+ and Windows 10/11 x64
- [x] iOS 17, 18, and 26; iOS 27 beta qualified per build
- [x] USB stable and same-LAN Wi-Fi beta
- [x] Developer Mode supported path
- [x] One active iPhone at a time
- [x] MapLibre + global PMTiles
- [x] No search or road routing in v1
- [x] Local encrypted routes, favorites, GPX, and history
- [x] Better Auth + Stripe monthly/yearly subscriptions
- [x] Seven-day card-required trial
- [x] Two computer activations and seven-day offline grace
- [x] Cloudflare Workers, D1, R2, and Email Service
- [x] Stable and beta update channels
- [x] Opt-in Cloudflare/R2 crash reporting

## M0 — Protocol Feasibility

Status: `in_progress`

- [x] Pin an `idevice` revision for evaluation
- [ ] Enumerate and pair an iPhone over USB on macOS
- [ ] Set, move, and clear location on macOS
- [ ] Enumerate and pair an iPhone over USB on Windows
- [ ] Set, move, and clear location on Windows
- [ ] Validate iOS 17, 18, and 26 service paths
- [ ] Test the current iOS 27 beta build
- [x] Test prior-USB-paired same-LAN Wi-Fi
- [x] Document Apple driver, Developer Mode, and image requirements
- [ ] Complete five-engineer-day no-Developer-Mode research spike

Exit criteria:

- USB set/move/clear succeeds on both host platforms.
- Failure states produce actionable diagnostics.
- A tested `idevice` revision and compatibility matrix are recorded.
- Wi-Fi is classified as beta or unsupported without blocking USB.

Evidence:

- `idevice` revision: `63a341d7f624b5c1f2540e4cecb269151a2caf52`.
- 2026-08-18 source audit: revision exposes usbmuxd USB/network discovery,
  legacy `com.apple.dt.simulatelocation`, and modern CoreDevice/RSD/DVT location
  clients. This is source evidence only; no physical compatibility is claimed.
- 2026-08-18 macOS same-LAN probe: two previously USB-paired network devices
  enumerated without exposing their UDIDs. iOS 27.0 accepted a test location and
  acknowledged restore after Ctrl-C. iOS 26.5.2 enumeration succeeded, but set
  failed with `DEVICE_ERROR: service not found`; no location was applied.
- 2026-08-18 guarded iOS 27.0 sequence on macOS same-LAN Wi-Fi: the exact-version
  guard selected only the iOS 27.0 device; the first coordinate, a second coordinate
  in the same live session, automatic restore, and a separate idempotent clear all
  succeeded. Service setup emitted a non-fatal `Body length ... received bytes ...`
  warning that remains a reliability observation.
- The probe did not return an iOS build number, so the iOS 27 beta-build task
  remains open. No USB or Windows compatibility is claimed from the Wi-Fi test.
- Host setup and M0 commands are documented in `docs/device-setup.md`.

## M1 — Workspace and Design System

Status: `complete`

- [x] Scaffold pnpm/Turborepo and Rust workspace
- [x] Scaffold desktop, website, and map Worker
- [x] Pin React, HeroUI, Tailwind, Tauri, and Cloudflare dependencies
- [x] Create shared Enigma HeroUI theme
- [x] Create shared shell, status, dialog, form, and feedback components
- [x] Add light, dark, system, reduced-motion, and accessibility tests
- [x] Configure linting, type checks, Rust checks, tests, and CI

Exit criteria:

- Both applications render the same HeroUI theme and shared components.
- Production builds pass for desktop and Workers.
- Keyboard and theme behavior pass automated checks.

Evidence:

- Six shared UI tests cover announced device status; persisted light, dark, and
  system themes; live operating-system theme changes; reduced-motion and visible-focus
  safeguards; axe checks; and exit-dialog focus trapping, Escape, and focus return.
- The exit confirmation uses HeroUI/React Aria alert-dialog primitives while preserving
  Restore as the initial safe action.
- Local browser QA rendered the SSR website, navigated to pricing, and found no
  application console or hydration errors after the theme fix.
- `pnpm lint`, `pnpm check`, `pnpm test:run`, and `pnpm build` pass locally.
  Fourteen JavaScript tests pass. The build includes desktop Vite assets, React Router
  SSR, and a map Worker dry run; Vite reports a non-failing large-chunk warning.
- `cargo check --workspace --all-targets` and `cargo test --workspace --all-targets`
  pass on macOS. The configured macOS/Windows CI matrix has not run remotely.
- `tauri build --debug --no-bundle` links the native macOS application binary.
  This is not evidence of a universal, signed, notarized, or packaged release.

## M2 — Accounts, Billing, and Entitlements

Status: `in_progress`

- [x] Create D1 schema and migrations
- [x] Configure Better Auth magic-link sign-in
- [ ] Configure Cloudflare Email Service
- [ ] Configure monthly/yearly Stripe plans and seven-day trial
- [x] Implement verified, idempotent Stripe webhooks
- [x] Implement PKCE desktop authorization and deep link
- [x] Implement two-computer activation management
- [x] Implement rotating tokens and signed offline entitlements
- [x] Build HeroUI pricing, sign-in, dashboard, and billing pages

Exit criteria:

- Trial, payment, cancellation, revocation, and offline-grace tests pass.
- Deep-link replay, PKCE, CSRF, and webhook-order tests pass.
- No location data exists in D1.

Evidence:

- Fresh local D1 migration applies both migrations successfully: 19 account and
  entitlement commands plus four webhook-receipt commands. Partial unique constraints
  enforce two active activation slots, one authorization-code exchange, and one
  refresh-token successor even under concurrent requests.
- Drizzle ORM is the canonical typed D1 boundary for Better Auth, subscriptions,
  desktop authorization, activations, refresh tokens, entitlements, and webhook
  receipts; application routes contain no direct prepared D1 queries.
- A local Worker probe issued and consumed a Better Auth magic link through the
  Drizzle adapter, created and read its D1 session, produced a message through the
  local Cloudflare email binding, and inserted a desktop authorization request.
- Four webhook tests cover signature rejection, event-ID replay, retry release, and
  stale/same-second subscription ordering. A signed local Worker/D1 probe processed a
  subscription event once, acknowledged its replay, ignored an older snapshot, and
  retained the newer subscription cursor.
- Entitlement-policy tests cover active payment, trialing, cancellation and failed
  payment states, activation revocation, monthly/yearly intervals, and the signed
  seven-day offline window. Grant tests cover state, PKCE, expiry, and consumed-code
  replay rejection; browser mutation tests cover same-origin CSRF enforcement.
- `pnpm lint`, `pnpm check`, `pnpm test:run`, and `pnpm build` pass after the Drizzle
  migration. Twenty-nine JavaScript tests pass across the workspace, including all
  17 web account, entitlement, token-signing, CSRF, and webhook tests.
- Production Email Service, Stripe prices,
  webhook delivery, checkout, portal, and offline-grace flows remain unverified.
- Production email and Stripe configuration are intentionally deferred while the
  desktop application is completed. The current desktop build does not enforce
  login, trial, subscription, or entitlement state.
- D1 schema contains identity, billing, activation, and hashed credential data only;
  it contains no location fields.

## M3 — Desktop Core

Status: `in_progress`

Implementation: complete; physical acceptance is scheduled for 2026-08-19.

- [x] Implement device state machine and setup wizard
- [x] Implement computer-location map centering
- [x] Implement map-click and coordinate teleport
- [x] Implement clear and restore
- [x] Implement encrypted local SQLite storage
- [x] Implement favorites and history
- [x] Implement exit confirmation and dirty-session recovery
- [x] Verify restore while signed out, expired, and offline

Exit criteria:

- A new user can connect, teleport, and restore without command-line work.
- Sensitive local records are encrypted.
- Restore works independently of entitlement state.

Evidence:

- The desktop shell now provides a same-LAN-first setup checklist, labels only the
  macOS + iOS 27 network path as validated, selects one device, centers on the Mac,
  and exposes teleport, route, joystick, GPX, stop, and restore actions without an
  account or subscription boundary. USB and Windows remain unqualified.
- Both the UI and native device command reject USB, unknown-version, and non-iOS-27
  devices. Character-by-character coordinate entry retains partial input and validates
  and normalizes a complete latitude/longitude pair.
- Simulation plans are encrypted with XChaCha20-Poly1305 before SQLite history
  storage; the per-install key is stored through Keychain/Credential Manager.
- Encrypted favorites/history can be loaded and deleted. Startup detects a persisted
  dirty session and gates restore on selecting the previously used device; a new
  active session no longer incorrectly opens the startup recovery dialog.
- Window-close protection now follows the persisted dirty-session marker, so a stopped
  or completed route still prompts for restore even after its worker is no longer active.
- Restore calls the local Rust/device command directly and has no Better Auth, D1,
  Stripe, network-account, or entitlement dependency. The previously qualified iOS
  27 same-LAN probe restored successfully, but the complete native GUI path still
  needs one physical-device acceptance pass before M3 can be marked complete.
- The debug macOS bundle contains the location permission purpose string and only the
  Enigma executable; the internal M0 probe is feature-gated out of normal bundles.

## M4 — Movement, Joystick, and GPX

Status: `in_progress`

Implementation: complete; physical acceptance is scheduled for 2026-08-19.

- [x] Implement two-point and multi-point straight-line routes
- [x] Implement constant and natural speed profiles
- [x] Implement repetitions and round trips
- [x] Implement pause, resume, restart, and stop
- [x] Implement on-screen joystick and WASD/arrows
- [x] Implement safe GPX import, replay, and export
- [x] Implement informational distance/travel-time cooldown
- [x] Add route-engine property and recovery tests

Exit criteria:

- Route timing and interpolation remain deterministic in tests.
- GPX and joystick sessions can always pause, stop, and restore.
- Invalid or hostile GPX files are rejected safely.

Evidence:

- TypeScript and Rust engines use great-circle interpolation and deterministic
  one-second samples; antimeridian, speed-profile, repetition, round-trip, and
  joystick-distance unit tests pass.
- The desktop route editor draws multi-point routes and exposes speed profiles,
  repetitions, round trips, distance, travel time, and informational cooldown.
- Forward-only repetitions reset to the first route point before replaying; round-trip
  repetitions continue from their shared start/end. Cooldown totals include repetitions
  and round trips in both distance and time.
- On-screen directions and WASD/arrows update the active joystick heading. Release
  waits for device startup/update and then pauses, closing the quick-release race.
- GPX import rejects DTD/entity payloads, malformed coordinates, files over 10 MB,
  tracks over 100,000 points, and fewer than two track/route points; export produces
  a GPX 1.1 track. Import/export and validation tests pass.
- Physical GPX and joystick recovery through the native GUI remains the M4 exit-criteria
  acceptance step; no USB or Windows qualification is inferred.
- A fake-device controller test covers joystick start, pause, direction change, resume,
  stop, and restore without requiring hardware. The short physical GPX fixture and the
  complete M3/M4 acceptance checklist are in `docs/` for the final device pass.
- Both route engines reject plans exceeding 100,000 one-second updates, and the desktop
  disables Start with an actionable warning before such a plan reaches the native layer.

## M5 — Maps, Wi-Fi Beta, and Reliability

Status: `in_progress`

Implementation: complete for the validated same-LAN desktop path; production map
publication, production R2 retention, and physical USB fallback remain pending.

- [ ] Publish versioned global PMTiles, style, fonts, and sprites to R2
- [x] Implement range-aware cached map Worker
- [x] Add OSM attribution and dataset rollback
- [x] Implement prior-paired same-LAN Wi-Fi discovery
- [ ] Add USB fallback (deferred physical qualification)
- [x] Add privacy-safe network diagnostics export
- [x] Add local opt-in crash reporting and allowlisted authenticated delivery
- [ ] Apply and verify 30-day crash-report R2 retention in production
- [x] Complete privacy and location-data egress tests

Exit criteria:

- Global maps load through the production Worker.
- Wi-Fi failures never prevent USB operation.
- Crash payloads and network traffic contain no location data or identifiers.

Evidence:

- Map Worker unit tests cover byte ranges, query-string rejection, and current/versioned
  map, style, font, and sprite rollback behavior. The dataset validator requires a
  versioned PMTiles archive, MapLibre v8 style, OSM attribution, HTTPS-only references,
  fonts, sprites, and emits a SHA-256 object manifest. Production R2 objects are not yet
  published.
- Prior-paired network discovery works on the local macOS host. Location-service
  compatibility is mixed between the two tested iOS versions; see M0 evidence.
- Desktop consent is off by default and persisted locally. Payload construction drops
  raw errors and stack paths; desktop and server tests reject coordinates, device IDs,
  UDIDs, names, email, and tokens. With login bypassed, consent performs no network
  request until an authenticated endpoint and access token exist.
- Safe diagnostics export contains only coarse host/runtime state and device counts;
  a Rust test proves the source coordinate and device metadata never serialize.
- Production crash-bucket lifecycle application and production map publication remain
  deferred; exact handoff commands and privacy invariants are documented in `docs/`.

## M6 — Release Hardening

Status: `in_progress`

Implementation: complete for updater safety, release preflight, and operator
documentation; physical qualification, signing, notarization, and manifest publication
remain pending.

- [ ] Complete physical host/iOS compatibility matrix
- [ ] Sign and notarize macOS build
- [ ] Sign Windows installer
- [x] Create and validate stable and beta updater manifest templates
- [ ] Publish signed stable and beta updater manifests
- [x] Block update installation during active or dirty simulations
- [ ] Physically test a signed update during and after an active simulation
- [x] Complete automated security, privacy, accessibility, and recovery reviews
- [x] Publish setup, troubleshooting, and compatibility documentation in-repository

Exit criteria:

- Every advertised device combination passes set/move/clear.
- Installers and updater signatures verify.
- Active simulation cannot be abandoned silently during exit or update.

Evidence:

- Stable and beta Tauri configuration overlays create updater artifacts only for
  release builds and point at separate HTTPS manifests. Development builds neither
  request signing material nor contact updater endpoints.
- Manifest validation requires valid SemVer/channel pairing, RFC 3339 dates, HTTPS
  query-free URLs scoped to the expected channel, all macOS/Windows targets, and
  non-placeholder signatures for production.
- Nine updater tests prove install is allowed only with an idle simulation and a clear
  durable recovery marker; starting, running, paused, stopping, restore-required,
  error, and idle-but-dirty states all fail closed.
- The release configuration preflight checks bundle targets, macOS minimum version,
  updater permissions/endpoints, CSP invariants, and the location purpose string. Its
  production mode correctly rejects the current `0.0.0` version and placeholder key.
- The unsigned debug `.app` still bundles without release credentials. Local browser
  QA shows the stable update panel, a disabled Check action, an explicit unsigned-build
  explanation, and no console warnings/errors.
- Setup, troubleshooting, compatibility claims, append-only physical matrix,
  signing/notarization, updater publication, privacy, security, accessibility, and
  recovery procedures are documented in `docs/`.
- macOS signing/notarization, Windows signing, real updater artifacts, clean-machine
  installs, and physical device/update acceptance remain unverified.

## M7 — Public V1

Status: `in_progress`

Implementation: launch surfaces and fail-closed release tooling are complete;
production publication, signed promotion, service verification, and physical evidence
remain pending.

- [x] Build website, pricing, downloads, compatibility, privacy, and terms surfaces
- [ ] Publish and externally verify the production website
- [x] Add fail-closed public release manifest and validation
- [x] Add web/map/entitlement health probe and monitoring/support procedures
- [ ] Promote signed builds to stable
- [ ] Verify Stripe production webhooks and email deliverability
- [ ] Verify map and entitlement production health
- [ ] Record release version and supported iOS builds

Exit criteria:

- Production purchase-to-activation flow succeeds.
- Production restore path is verified.
- Monitoring and support procedures are documented.

Evidence:

- Public configuration defaults to development status, version `0.0.0`, billing off,
  no supported builds, and no artifact URLs. Download cards, pricing CTAs, account
  email, and desktop update checks all remain disabled under that configuration.
- Website copy no longer advertises USB, Windows, trials, or downloads as available.
  Compatibility separates the successful macOS + iOS 27 same-LAN probe from pending
  GUI acceptance and every unsupported/deferred path.
- Public release configuration accepts only dedicated query-free HTTPS artifact URLs;
  the stable gate additionally requires all macOS/Windows artifacts, exact iOS builds,
  billing, and a non-zero release version.
- The Public V1 manifest validator requires the exact Git commit, every locked physical
  compatibility row, SHA-256 values, updater signatures, macOS signing/notarization,
  Windows signing, production restore, billing, and dated web/map/entitlement/
  Stripe/email evidence. The template passes structure validation only when placeholder
  allowance is explicit and correctly fails the production gate.
- `/api/health` reports the web process healthy while separately reporting
  `publicReleaseReady: false`, billing false, version `0.0.0`, and zero artifacts. The
  operator health script cross-checks a completed manifest against web and map health
  and optionally performs an authenticated entitlement check.
- Local browser QA covers home, downloads, pricing, compatibility, and sign-in. All
  release/billing/account actions fail closed, and a clean post-optimization pass has no
  console warnings/errors.
- Monitoring, privacy-safe support intake, restore-first incident response, map/service
  isolation, rollback, and the full launch sequence are documented in `docs/`.
- No production deployment, purchase, email, entitlement, map, signed installer,
  updater, or restore claim is made.

## Deferred After V1

- [ ] Address and POI search
- [ ] Road-generated routes and road snapping
- [ ] Jump Teleport
- [ ] Simultaneous multi-device sessions
- [ ] Android
- [ ] iOS 12–16
- [ ] Offline regional map packs
- [ ] Windows ARM64

## Blockers

- Windows and USB qualification are deferred by product direction and do not block
  current implementation. They remain mandatory before advertising those transports
  or platforms as validated.
- Physical iOS 17 and 18 coverage and the exact iOS 27 beta build number are missing.
- The iOS 26.5.2 Wi-Fi path currently fails with `DEVICE_ERROR: service not found`.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-18 | Initial v1 architecture approved | Establish implementation baseline |
| 2026-08-18 | Pin `idevice` revision `63a341d7…` for M0 | Prevent pre-0.2 API drift during feasibility work |
| 2026-08-18 | Enforce activation and token replay limits in D1 | Make concurrency safety independent of request timing |
| 2026-08-18 | Continue implementation after iOS 27 Wi-Fi qualification | Windows and USB tests are deferred, remain open, and cannot support compatibility claims |
| 2026-08-18 | Defer production account/billing configuration and finish desktop local workflows first | Keep production publication separate from desktop implementation and allow macOS + iOS 27 same-LAN testing without login or subscription enforcement |
| 2026-08-18 | Keep the encrypted desktop vault in Rust/rusqlite | Drizzle remains the typed D1 boundary; Rust retains encryption keys and plaintext outside the webview |

## Verification Log

| Date | Milestone | Command or physical test | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-08-18 | M0 | `git ls-remote .../idevice.git HEAD` and source audit | Partial | Revision pinned; physical tests pending |
| 2026-08-18 | M0 | `m0-probe list` over same-LAN Wi-Fi | Partial | Prior-paired iOS 26.5.2 and 27.0 devices enumerated; UDIDs redacted |
| 2026-08-18 | M0 | `m0-probe set <test-coordinate>` then Ctrl-C | Mixed | iOS 27.0 set/restore succeeded; iOS 26.5.2 returned service-not-found |
| 2026-08-18 | M0 | `m0-probe move --index 1 --expected-ios 27.0 ...` | Pass | iOS 27.0 accepted two points in one network session and restored automatically |
| 2026-08-18 | M0 | `m0-probe clear --index 1 --expected-ios 27.0` | Pass | Separate iOS 27.0 clear acknowledged; non-fatal body-length warning observed |
| 2026-08-18 | M1–M5 | `corepack pnpm lint && pnpm check && pnpm test:run && pnpm build` | Pass | 14 JS tests; six workspace checks/builds; Worker dry run |
| 2026-08-18 | M1–M4 | `cargo check --workspace --all-targets && cargo test --workspace --all-targets` | Pass | Three Rust tests on macOS |
| 2026-08-18 | M1 | Local SSR browser QA: home, theme hydration, pricing navigation, console | Pass | Accessible DOM present; no application warnings/errors |
| 2026-08-18 | M1 | `tauri build --debug --no-bundle` | Pass | Native macOS debug binary linked; no signing/bundle claim |
| 2026-08-18 | M1 | Shared UI Vitest suite | Pass | Six tests cover themes, system changes, reduced motion, axe, and dialog keyboard focus |
| 2026-08-18 | M2 | Fresh `wrangler d1 migrations apply enigma-accounts --local` | Pass | One migration; 19 statements executed |
| 2026-08-18 | M2–M4 | `corepack pnpm lint && pnpm check && pnpm test:run && pnpm build` | Pass | Six workspace checks/builds and 35 JavaScript tests; desktop Vite build has a non-failing large-chunk warning |
| 2026-08-18 | M3–M4 | `cargo check --workspace --all-targets && cargo test --workspace --all-targets` | Pass | Seven Rust tests cover qualified-device gating, encrypted storage/dirty exit state, route repetition/capacity, and joystick recovery behavior |
| 2026-08-18 | M3–M4 | Local desktop browser-preview QA | Pass | Qualified/unqualified device gating, character-by-character coordinates, cooldown/repetition totals, oversized-route blocking, teleport/history, favorite save, route controls, joystick release-to-pause, GPX and recovery surfaces; no console warnings/errors |
| 2026-08-18 | M3 | `tauri build --debug --bundles app`, bundle inspection, and native launch smoke | Pass | Debug `Enigma.app` launched; executable SHA-256 `ba692bbd…09ea`; location purpose string present; internal M0 probe absent; unsigned and unnotarized |
| 2026-08-18 | M0 | `cargo check -p enigma-desktop --features m0-probe --bin m0-probe` | Pass | Feature-gated physical diagnostic remains buildable without shipping in Enigma.app |
| 2026-08-18 | M5 | `corepack pnpm lint && pnpm check && pnpm test:run && pnpm build` | Pass | 51 JavaScript tests; map Worker dry run; desktop and website production builds |
| 2026-08-18 | M5 | `cargo fmt --all -- --check && cargo test --workspace --all-targets` | Pass | Eight Rust tests, including diagnostics location and identifier omission |
| 2026-08-18 | M5 | Local desktop browser-preview QA | Pass | Crash consent became enabled after initialization, persisted in the browser mock, diagnostics action remained responsive, and no console warnings/errors appeared |
| 2026-08-19 | M6 | `pnpm --filter @enigma/desktop release:check` | Pass | Development release structure and stable/beta manifest templates validated; placeholders explicitly allowed only in this mode |
| 2026-08-19 | M6 | Production release preflight without `--development` | Expected fail | Rejected version `0.0.0` and placeholder updater public key |
| 2026-08-19 | M6 | `corepack pnpm lint && pnpm check && pnpm test:run` | Pass | 60 JavaScript tests, including nine updater safety cases |
| 2026-08-19 | M6 | `pnpm tauri build --debug --bundles app` | Pass | Unsigned debug Enigma.app bundled without updater signing credentials |
| 2026-08-19 | M6 | Local desktop browser-preview QA | Pass | Stable update surface visible; Check disabled in unsigned build; no console warnings/errors |
| 2026-08-19 | M7 | `corepack pnpm release:check` | Pass | Desktop release structure plus stable/beta and Public V1 template structure validated with explicit placeholder allowance |
| 2026-08-19 | M7 | Public V1 validator without placeholder allowance | Expected fail | Rejected incomplete commit, physical matrix, hashes, signatures, notarization, billing, restore, and service evidence |
| 2026-08-19 | M7 | `corepack pnpm lint && pnpm check && pnpm test:run && pnpm build` | Pass | 64 JavaScript tests; desktop/website builds and map Worker dry run |
| 2026-08-19 | M7 | Local website browser QA | Pass | Development home and navigation; three disabled downloads; disabled pricing and sign-in; truthful compatibility; clean console after Vite optimization |
| 2026-08-19 | M7 | `curl` GET/HEAD `/api/health` | Pass | No-store 200 response reports healthy development service and publicReleaseReady false |
| 2026-08-19 | M0–M7 | Full clean local validation | Pass | Release structure, lint, six workspace type checks/builds, 64 JavaScript tests, map Worker dry run, Cargo format/check, eight Rust tests, and feature-gated M0 probe check |
| 2026-08-19 | M7 | `pnpm tauri build --debug --bundles app` and bundle inspection | Pass | Final debug Enigma.app bundled; executable SHA-256 `0053bd417ea9191fc5378ec35130638d6e5e058666ad3b907549d73070a5022a`; location purpose present; signature unsigned/unverified as expected |

# Enigma

Enigma is a privacy-first desktop location simulation utility for iPhone. The
repository contains a Tauri desktop client, a React Router/Cloudflare account
site, a PMTiles gateway, and a shared HeroUI design system.

Implementation status and verification evidence live in
[`MILESTONES.md`](./MILESTONES.md). A checked task is not evidence of physical
device compatibility unless the matching test appears in that file.

## Workspace

- `apps/desktop` — Tauri 2 desktop application and Rust device engine.
- `apps/web` — account, billing, downloads, and authorization website.
- `apps/map-gateway` — range-aware PMTiles/style gateway for Cloudflare R2.
- `packages/ui` — shared HeroUI v3 theme and components.
- `packages/contracts` — API, device, route, and entitlement contracts.
- `packages/route-engine` — deterministic WGS84 movement engine.

## Local setup

```sh
corepack enable
pnpm install
pnpm check
pnpm test:run
pnpm build
cargo test --workspace
```

Cloud integrations require the bindings and secrets documented in each app's
`.env.example` or `wrangler.jsonc`. Location data must remain local to the
desktop application.

Desktop operators should start with [`docs/desktop-setup.md`](./docs/desktop-setup.md),
[`docs/compatibility.md`](./docs/compatibility.md), and
[`docs/troubleshooting.md`](./docs/troubleshooting.md). Release signing and updater
handoff live in [`docs/release-hardening.md`](./docs/release-hardening.md).
The production gate and incident handoff are
[`docs/launch-checklist.md`](./docs/launch-checklist.md) and
[`docs/support-runbook.md`](./docs/support-runbook.md).

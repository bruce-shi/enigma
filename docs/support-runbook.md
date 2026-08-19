# Monitoring and support runbook

This runbook applies only after a completed `release/generated/public-v1.json` passes
the production release validator. Until then, all services and builds are development
or pre-release surfaces.

## First response priorities

1. Ask whether a simulated location may still be active.
2. If yes, prioritize local restore before login, billing, maps, updates, or log
   collection. Restore must remain usable during every service outage.
3. Ask for Enigma version/commit, host OS build, iOS version/build, transport, and the
   coarse diagnostic code. Never request or record an Apple UDID.
4. Ask the user to inspect and share **Export safe diagnostics** only if needed. Never
   request GPX files, coordinates, favorites, history, raw SQLite files, keychain
   entries, access tokens, or updater private keys.

## Severity

- **SEV-1:** restore is broadly unavailable, a signed artifact is compromised, or
  location/identifier data is observed outside the desktop boundary. Stop promotion,
  disable affected manifests or endpoints, preserve evidence, and begin incident
  response.
- **SEV-2:** production sign-in, entitlement, map, installer, or updater outage with a
  working local restore path. Communicate scope and workaround; do not disable local
  controls.
- **SEV-3:** single-device compatibility or workflow defect. Record the exact matrix
  row and reproduce without collecting identifiers or locations.

## Read-only health checks

```sh
node scripts/validate-public-release.mjs release/generated/public-v1.json
node scripts/check-production-health.mjs release/generated/public-v1.json
```

The first command performs no network access. The second checks the public web and map
health endpoints against the completed release manifest. Set
`ENIGMA_ENTITLEMENT_HEALTH_TOKEN` only in a secure operator environment to include an
authenticated entitlement check; never paste or commit the token. That check updates
the activation's last-seen timestamp.

Stripe webhook and email deliverability require dedicated synthetic transactions and
inbox evidence. Do not infer either from the generic web health endpoint.

## Service isolation

- **Map outage:** map rendering may be blank, but typed coordinates, movement, stop,
  and restore remain local.
- **Account/Stripe/email outage:** login, purchase, and entitlement refresh may fail,
  but the current desktop bypass build and every restore path remain local.
- **Crash bucket outage:** drop the report and continue; never block movement or
  restore, and never queue raw errors or location state.
- **Updater outage:** retain the installed version. Never bypass Tauri signature
  verification or point users at an unsigned artifact.

## Rollback

- Website and account Worker: roll back only through the deployment platform's
  versioned release mechanism and record the deployed revision.
- Maps: change `PMTILES_VERSION` to the last verified version or use its immutable
  `/styles/YYYY-MM/style.json`; style, PMTiles, fonts, and sprites remain pinned.
- Desktop: stop publishing `latest.json` first. Do not replace a signed artifact at an
  existing immutable URL. Publish a new higher signed version after the fix.

## Incident closure

Record timeline, affected versions/matrix rows, whether restore remained available,
health evidence, artifact and dataset versions, remediation commit, and any public
communication. Confirm that retained crash objects still follow the verified 30-day
rule and that no location or persistent device identifier entered incident systems.

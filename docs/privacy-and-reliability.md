# Privacy and reliability review

## Desktop egress boundary

Location coordinates, GPX contents, favorites, history, route samples, Apple UDIDs,
device names, and access tokens are prohibited from diagnostics and crash payloads.
The desktop has three optional network destinations:

- Map style and PMTiles byte-range requests. The configured style URL contains no
  query string, and the self-hosted map-serving routes reject every query string.
- User-initiated Mapbox location search. When a builder configures it, the desktop sends
  the typed query, current-map proximity bias, language, session identifier, and that
  builder's public Mapbox token directly to Mapbox. Enigma does not cache or persist the
  search response. Selecting a result centers the map but does not select or persist a
  simulation coordinate; the user must click the map to do that.
- Authenticated crash delivery. It is off by default, requires explicit consent,
  an HTTPS `/api/crashes` endpoint, and an access token. Until account integration is
  enabled, opting in records only the local preference and performs no request.

Crash payloads contain an app version, platform, deliberately uncollected OS version,
coarse application state, allowlisted error code, timestamp, and an empty sanitized
frame list. Both desktop and server tests reject accidental location or identifier
fields.

Mapbox public tokens are visible in the compiled desktop client by design. Every
builder must supply their own token and is responsible for its usage controls and
Mapbox account. Never place a secret `sk.…` token in a `VITE_` environment variable.

## Safe diagnostics

The desktop's **Export safe diagnostics** action rescans connectivity and exports only
host architecture, dependency revision, coarse simulation state, dirty-session and
consent flags, device counts by transport, qualified same-LAN count, and a coarse scan
error code. It never exports coordinates, device IDs, names, models, builds, or raw
errors. Review the JSON before sharing it.

USB discovery may appear as a count, but USB operation remains disabled and
unqualified. Trusted same-LAN Wi-Fi devices can be selected on other iOS versions for
experimental use; the diagnostics keep the physically qualified iOS 27 count separate.

## Crash bucket retention handoff

Production configuration is intentionally deferred. Before enabling crash delivery,
apply and verify a 30-day expiry rule on `enigma-crash-reports` using a Cloudflare token
with R2 write permission:

```sh
cd apps/web
bunx wrangler r2 bucket lifecycle add enigma-crash-reports --id crash-reports-30d --expire-days 30
bunx wrangler r2 bucket lifecycle list enigma-crash-reports
```

Do not run this rule against `enigma-maps`. Record the returned production rule and a
post-upload expiry check in `MILESTONES.md` before marking retention complete.

## Recovery invariants

- A location-changing command sets the durable dirty marker before touching a device.
- Restore does not require login, subscription, entitlement, or account network access.
- Closing with a dirty marker requires Restore, Keep, or Cancel.
- Failed crash delivery never blocks restore, stop, or app exit.

# Privacy and reliability

Enigma has no account, billing, entitlement, analytics, API, crash-upload, database,
or object-storage service.

## Network boundaries

- MapLibre requests the public OpenFreeMap style, tiles, fonts, and sprites directly.
- Optional Mapbox Search sends the typed query, proximity coordinates, language,
  session identifier, and user-supplied public token directly to Mapbox.
- Signed release builds check a static updater manifest and download artifacts from
  GitHub Releases. Development builds do not contact the updater.
- The landing page is rendered by a Cloudflare Worker with no application bindings,
  storage, telemetry, or API routes.

## Local boundaries

Routes, coordinates, favorites, history, and recovery state remain on the desktop.
Location records are encrypted before SQLite storage. A Mapbox `pk.` token is public
by design and is stored as a local setting; it is excluded from diagnostic exports.

Safe diagnostics omit coordinates, routes, names, UDIDs, models, iOS builds, pairing
records, Mapbox tokens, raw errors, and filesystem stack paths. Diagnostics are saved
only when the user explicitly exports the file.

Restore and exit protection never depend on the map, Mapbox, GitHub, Cloudflare, or
any account service. A failed third-party request cannot block Restore.

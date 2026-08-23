# Enigma map gateway

The gateway serves one versioned PMTiles archive and its style assets from R2.
It never receives user coordinates: MapLibre requests only tile byte ranges by
zoom/x/y-derived offsets inside the PMTiles archive.

Expected R2 keys for dataset `YYYY-MM`:

```text
basemap/YYYY-MM/global.pmtiles
basemap/YYYY-MM/style.json
basemap/YYYY-MM/assets/fonts/...
basemap/YYYY-MM/assets/sprites/...
```

The style file must use `{{PMTILES_URL}}` and `{{ASSET_ORIGIN}}` placeholders.
Asset references append paths such as `/fonts/...` or `/sprites/...` directly to
`{{ASSET_ORIGIN}}`; the Worker inserts the selected version segment.

Validate a dataset and produce a SHA-256 object manifest before any upload:

```sh
bun run dataset:validate ./datasets/2026-08 2026-08 > ./datasets/2026-08.manifest.json
```

Upload each manifest object beneath its exact `basemap/YYYY-MM/` key. For example:

```sh
bunx wrangler r2 object put enigma-maps/basemap/2026-08/global.pmtiles --file ./datasets/2026-08/global.pmtiles
bunx wrangler r2 object put enigma-maps/basemap/2026-08/style.json --file ./datasets/2026-08/style.json
```

Promote a monthly dataset by changing `PMTILES_VERSION` only after every manifest
object is present. Retain the previous version for rollback. The immutable rollback
style is `/styles/YYYY-MM/style.json`; it pins its PMTiles, fonts, and sprites to the
same dataset version.

Do not apply crash-report retention rules to the maps bucket.

## Current production dataset

The `2026-08` bootstrap dataset is live at
`https://enigma-map-gateway.bruceshi.workers.dev`. It contains world coverage
from the 2026-08-22 Protomaps build through native zoom 7; MapLibre overzooms
those vector tiles at closer zooms. This keeps the first production publication
small and replaceable while the full-detail planet release is prepared.

- Current style: `/style.json`
- Immutable rollback style: `/styles/2026-08/style.json`
- Archive: 187,160,643 bytes
- Published objects: 774
- Worker version: `4a383980-63fb-42bf-ac04-09af015c6ad5`

The source, extraction bounds, versions, and checksums are recorded in
`release/2026-08.json`.

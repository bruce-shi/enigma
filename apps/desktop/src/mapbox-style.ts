import type { StyleSpecification } from "maplibre-gl";
import { requiredMapboxAccessToken } from "./mapbox-access-token";

const MAPBOX_STREETS_TILES =
  "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x";

export function createMapboxStreetsStyle(accessToken: string): StyleSpecification {
  const token = requiredMapboxAccessToken(accessToken);
  const tiles = `${MAPBOX_STREETS_TILES}?access_token=${encodeURIComponent(token)}`;

  return {
    version: 8,
    sources: {
      "mapbox-streets": {
        type: "raster",
        tiles: [tiles],
        tileSize: 512,
        maxzoom: 22,
        attribution:
          '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> <a href="https://apps.mapbox.com/feedback/" target="_blank">Improve this map</a>',
      },
    },
    layers: [{ id: "mapbox-streets", type: "raster", source: "mapbox-streets" }],
  };
}

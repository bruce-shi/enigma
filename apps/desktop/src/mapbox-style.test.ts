import { describe, expect, it } from "vitest";
import { createMapboxStreetsStyle } from "./mapbox-style";

const accessToken = "pk.user-owned-public-token";

describe("Mapbox Streets style for MapLibre", () => {
  it("uses Mapbox's raster basemap endpoint without a remote style document", () => {
    const style = createMapboxStreetsStyle(accessToken);
    const source = style.sources["mapbox-streets"];
    if (source?.type !== "raster") throw new Error("Missing raster source");

    expect(source).toMatchObject({
      type: "raster",
      tileSize: 512,
      maxzoom: 22,
    });
    if (!("tiles" in source) || !source.tiles?.[0]) throw new Error("Missing raster tile URL");
    expect(source.tiles[0]).toContain("/tiles/512/{z}/{x}/{y}@2x?");
    const tileUrl = new URL(source.tiles[0]);
    expect(tileUrl.origin).toBe("https://api.mapbox.com");
    expect(tileUrl.searchParams.get("access_token")).toBe(accessToken);
  });

  it("includes required Mapbox Streets attribution", () => {
    const source = createMapboxStreetsStyle(accessToken).sources["mapbox-streets"];
    if (source?.type !== "raster") throw new Error("Missing raster source");
    expect(source.attribution).toContain("© Mapbox");
    expect(source.attribution).toContain("© OpenStreetMap");
    expect(source.attribution).toContain("Improve this map");
  });
});

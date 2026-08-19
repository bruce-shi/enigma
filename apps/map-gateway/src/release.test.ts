import { describe, expect, it } from "vitest";
import { datasetObjectKey, validateDatasetMetadata } from "./release";

const style = {
  version: 8,
  sources: {
    basemap: {
      type: "vector",
      url: "pmtiles://{{PMTILES_URL}}",
      attribution: "© OpenStreetMap contributors",
    },
  },
  glyphs: "{{ASSET_ORIGIN}}/fonts/{fontstack}/{range}.pbf",
  sprite: "{{ASSET_ORIGIN}}/sprites/enigma",
  layers: [],
};

describe("map dataset release validation", () => {
  it("accepts a complete versioned dataset", () => {
    expect(
      validateDatasetMetadata({
        version: "2026-08",
        pmtilesBytes: 1024,
        style,
        assets: ["fonts/Inter/0-255.pbf", "sprites/enigma.json", "sprites/enigma.png"],
      }),
    ).toEqual([]);
    expect(datasetObjectKey("2026-08", "assets/sprites/enigma.png")).toBe(
      "basemap/2026-08/assets/sprites/enigma.png",
    );
  });

  it("rejects incomplete, insecure, or traversal-prone releases", () => {
    expect(
      validateDatasetMetadata({
        version: "latest",
        pmtilesBytes: 10,
        style: { version: 7, source: "http://example.com" },
        assets: [],
      }),
    ).toEqual([
      "dataset version must use YYYY-MM",
      "global.pmtiles is too small to contain a valid PMTiles header",
      "style.json must use MapLibre style version 8",
      "style.json must reference {{PMTILES_URL}}",
      "style.json must reference {{ASSET_ORIGIN}}",
      "style.json must include OpenStreetMap attribution",
      "style.json must not reference insecure HTTP URLs",
      "dataset assets must include at least one fonts/ object",
      "dataset assets must include at least one sprites/ object",
    ]);
    expect(() => datasetObjectKey("2026-08", "../private")).toThrow(/safe relative path/u);
  });
});

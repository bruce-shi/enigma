import { describe, expect, it, vi } from "vitest";
import worker, { contentRangeHeader } from "./index";

const incomingRequest = (url: string) =>
  new Request(url) as unknown as Parameters<typeof worker.fetch>[0];

describe("PMTiles range responses", () => {
  it("formats offset ranges", () => {
    expect(contentRangeHeader({ offset: 100, length: 50 }, 1000)).toBe("bytes 100-149/1000");
  });

  it("formats suffix ranges", () => {
    expect(contentRangeHeader({ suffix: 100 }, 1000)).toBe("bytes 900-999/1000");
  });
});

describe("versioned and private map requests", () => {
  const baseEnv = {
    PMTILES_VERSION: "2026-08",
    ALLOWED_ORIGINS: "tauri://localhost",
  };

  it("rejects query strings so location values cannot enter gateway request handling", async () => {
    const response = await worker.fetch(
      incomingRequest("https://maps.enigma.example/style.json?latitude=49.2827"),
      baseEnv as Env,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/do not accept query parameters/u);
  });

  it("pins map and asset URLs when an older style is selected for rollback", async () => {
    const get = vi.fn().mockResolvedValue({
      httpEtag: '"style-etag"',
      text: async () =>
        JSON.stringify({
          version: 8,
          sources: { basemap: { type: "vector", url: "pmtiles://{{PMTILES_URL}}" } },
          glyphs: "{{ASSET_ORIGIN}}/fonts/{fontstack}/{range}.pbf",
          sprite: "{{ASSET_ORIGIN}}/sprites/enigma",
          layers: [],
        }),
    });
    const response = await worker.fetch(
      incomingRequest("https://maps.enigma.example/styles/2026-07/style.json"),
      { ...baseEnv, MAPS: { get } } as unknown as Env,
    );
    const style = await response.json<Record<string, unknown>>();
    expect(get).toHaveBeenCalledWith("basemap/2026-07/style.json");
    expect(JSON.stringify(style)).toContain(
      "pmtiles://https://maps.enigma.example/maps/2026-07/global.pmtiles",
    );
    expect(JSON.stringify(style)).toContain("https://maps.enigma.example/assets/2026-07/fonts/");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });
});

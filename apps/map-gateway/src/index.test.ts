import { describe, expect, it, vi } from "vitest";
import worker, { contentRangeHeader, decodeAssetPath } from "./index";

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
      baseEnv as unknown as Env,
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

  it("serves URL-encoded font stack names from their decoded R2 keys", async () => {
    const get = vi.fn().mockResolvedValue({
      body: "glyph data",
      httpEtag: '"font-etag"',
      range: undefined,
      size: 10,
      writeHttpMetadata: (headers: Headers) =>
        headers.set("content-type", "application/x-protobuf"),
    });
    const response = await worker.fetch(
      incomingRequest(
        "https://maps.enigma.example/assets/2026-08/fonts/Noto%20Sans%20Regular/0-255.pbf",
      ),
      { ...baseEnv, MAPS: { get } } as unknown as Env,
    );
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(
      "basemap/2026-08/assets/fonts/Noto Sans Regular/0-255.pbf",
      expect.anything(),
    );
  });

  it("rejects malformed and traversal-prone asset paths", () => {
    expect(decodeAssetPath("fonts/Noto%20Sans%20Regular/0-255.pbf")).toBe(
      "fonts/Noto Sans Regular/0-255.pbf",
    );
    expect(decodeAssetPath("fonts/%ZZ/0-255.pbf")).toBeUndefined();
    expect(decodeAssetPath("fonts/%2E%2E/private.txt")).toBeUndefined();
    expect(decodeAssetPath("fonts%5Cprivate.txt")).toBeUndefined();
  });
});

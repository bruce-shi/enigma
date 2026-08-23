import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapboxSearchConfigured,
  parseLocationSuggestions,
  parseRetrievedCoordinate,
  suggestLocations,
} from "./location-search";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mapbox search responses", () => {
  it("keeps only suggestions with a name and Mapbox identifier", () => {
    expect(
      parseLocationSuggestions({
        suggestions: [
          {
            mapbox_id: "dXJuOm1ieHBvaTp0ZXN0",
            name: "Stanley Park",
            full_address: "Stanley Park, Vancouver, British Columbia, Canada",
            feature_type: "poi",
          },
          { name: "Missing identifier" },
        ],
      }),
    ).toEqual([
      {
        id: "dXJuOm1ieHBvaTp0ZXN0",
        name: "Stanley Park",
        description: "Stanley Park, Vancouver, British Columbia, Canada",
        featureType: "poi",
      },
    ]);
  });

  it("extracts longitude and latitude from a retrieved point", () => {
    expect(
      parseRetrievedCoordinate({
        features: [{ geometry: { type: "Point", coordinates: [-123.1443, 49.3043] } }],
      }),
    ).toEqual({ latitude: 49.3043, longitude: -123.1443 });
  });

  it("rejects malformed retrieved coordinates", () => {
    expect(() =>
      parseRetrievedCoordinate({
        features: [{ geometry: { type: "Point", coordinates: [900, 49.3] } }],
      }),
    ).toThrow(/valid coordinates/u);
  });

  it("calls Mapbox directly with the builder's public token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ suggestions: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await suggestLocations({
      query: "Stanley Park",
      accessToken: "pk.user-owned-public-token",
      sessionToken: "30cbf4b8-39f2-4d35-a52c-a47aa82e71c8",
      proximity: { latitude: 49.2827, longitude: -123.1207 },
      language: "en",
    });

    const target = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(target.origin).toBe("https://api.mapbox.com");
    expect(target.pathname).toBe("/search/searchbox/v1/suggest");
    expect(target.searchParams.get("access_token")).toBe("pk.user-owned-public-token");
    expect(target.searchParams.get("limit")).toBe("5");
    expect(target.searchParams.get("proximity")).toBe("-123.1207,49.2827");
  });

  it("stays disabled without a public token", () => {
    expect(mapboxSearchConfigured()).toBe(false);
    expect(mapboxSearchConfigured("pk.")).toBe(false);
    expect(mapboxSearchConfigured("sk.secret-token")).toBe(false);
    expect(mapboxSearchConfigured("pk.user-owned-public-token")).toBe(true);
  });
});

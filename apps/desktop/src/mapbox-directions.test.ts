import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMapboxRoute, requestMapboxRoute } from "./mapbox-directions";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mapbox Directions", () => {
  it("parses a GeoJSON route", () => {
    expect(
      parseMapboxRoute({
        routes: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [-123.1207, 49.2827],
                [-123.1443, 49.3043],
              ],
            },
          },
        ],
      }),
    ).toEqual([
      { latitude: 49.2827, longitude: -123.1207 },
      { latitude: 49.3043, longitude: -123.1443 },
    ]);
  });

  it("rejects an invalid route response", () => {
    expect(() => parseMapboxRoute({ routes: [] })).toThrow(/did not return a route/u);
  });

  it("requests the selected profile and full GeoJSON geometry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              geometry: {
                type: "LineString",
                coordinates: [
                  [-123.1207, 49.2827],
                  [-123.1443, 49.3043],
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestMapboxRoute({
      waypoints: [
        { latitude: 49.2827, longitude: -123.1207 },
        { latitude: 49.3043, longitude: -123.1443 },
      ],
      profile: "walking",
      accessToken: "pk.user-owned-public-token",
    });

    const target = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(target.origin).toBe("https://api.mapbox.com");
    expect(target.pathname).toBe(
      "/directions/v5/mapbox/walking/-123.1207,49.2827;-123.1443,49.3043",
    );
    expect(target.searchParams.get("access_token")).toBe("pk.user-owned-public-token");
    expect(target.searchParams.get("geometries")).toBe("geojson");
    expect(target.searchParams.get("overview")).toBe("full");
  });

  it("surfaces a Mapbox response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "No route found" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      requestMapboxRoute({
        waypoints: [
          { latitude: 49.2827, longitude: -123.1207 },
          { latitude: 49.3043, longitude: -123.1443 },
        ],
        profile: "driving",
        accessToken: "pk.user-owned-public-token",
      }),
    ).rejects.toThrow("No route found");
  });
});

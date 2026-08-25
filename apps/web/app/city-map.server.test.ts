import { describe, expect, it } from "vitest";
import {
  buildCityMap,
  cityMapDetails,
  cityMapPackageResponse,
  cityMapResponse,
  definitionFromSearchResults,
  normalizeCityQuery,
  renderCitySvg,
} from "./city-map.server";

const vancouverSearch = [
  {
    addresstype: "city",
    boundingbox: ["49.1984452", "49.3161714", "-123.2249611", "-123.0232419"],
    display_name: "Vancouver, Metro Vancouver Regional District, British Columbia, Canada",
    lat: "49.2608724",
    lon: "-123.1139529",
    name: "Vancouver",
    osm_id: 1852574,
    osm_type: "relation",
  },
];

const mapPayload: Parameters<typeof renderCitySvg>[1] = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "primary", name: "Main Street" },
      geometry: [
        { lat: 49.22, lon: -123.18 },
        { lat: 49.25, lon: -123.12 },
        { lat: 49.29, lon: -123.05 },
      ],
    },
    {
      type: "node",
      id: 2,
      lat: 49.2608724,
      lon: -123.1139529,
      tags: { place: "city", name: "Vancouver" },
    },
    {
      type: "node",
      id: 3,
      lat: 49.251,
      lon: -123.12,
      tags: { "addr:housenumber": "123", "addr:street": "Main Street" },
    },
    {
      type: "way",
      id: 4,
      center: { lat: 49.252, lon: -123.121 },
      tags: { "addr:housenumber": "125", "addr:street": "Main Street", building: "yes" },
    },
  ],
};

describe("embedded city-map service", () => {
  it("normalizes a deliberate city search and rejects invalid input", () => {
    expect(normalizeCityQuery("  Vancouver,   Canada ")).toBe("Vancouver, Canada");
    expect(() => normalizeCityQuery("")).toThrow(/1 to 96/u);
    expect(() => normalizeCityQuery("x".repeat(97))).toThrow(/1 to 96/u);
  });

  it("turns a geocoder result into bounded board metadata", () => {
    const city = definitionFromSearchResults(vancouverSearch);
    expect(city).toMatchObject({ id: "city-r-1852574", name: "Vancouver" });
    expect(city.bounds.west).toBeGreaterThanOrEqual(-180);
    expect(city.bounds.east).toBeLessThanOrEqual(180);
    expect(city.width).toBe(1200);
    expect(city.height).toBeGreaterThan(500);
  });

  it("renders passive, compact SVG with OpenStreetMap attribution", () => {
    const city = definitionFromSearchResults(vancouverSearch);
    const svg = renderCitySvg(city, mapPayload);
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg"`);
    expect(svg).toContain('class="arterial"');
    expect(svg).toContain("© OpenStreetMap contributors · ODbL");
    expect(svg).not.toMatch(/<script|<foreignObject| href=|url\(/u);
  });

  it("indexes every numbered OSM address against a compact street table", () => {
    const city = definitionFromSearchResults(vancouverSearch);
    const details = cityMapDetails(city, mapPayload);
    expect(details.streets).toContain("Main Street");
    expect(details.buildings).toHaveLength(2);
    expect(details.buildings.map(([number]) => number)).toEqual(["123", "125"]);
    expect(details.buildings.every(([, street]) => details.streets[street] === "Main Street")).toBe(
      true,
    );
    expect(details.streetLabels).toHaveLength(1);
    expect(details.streetClasses).toEqual([2]);
    expect(details.streetLabels[0]).toHaveLength(4);
    expect(details.streetLabels[0]?.[3]).toBeGreaterThan(-90);
    expect(details.streetLabels[0]?.[3]).toBeLessThanOrEqual(90);
    expect(details.streetLabels[0]?.[3]).not.toBe(0);
    expect(details.streetPaths).toHaveLength(1);
    expect(details.streetPaths[0]?.[5].length).toBeGreaterThanOrEqual(4);
  });

  it("returns the metadata and digest contract consumed by the board", async () => {
    const city = definitionFromSearchResults(vancouverSearch);
    const response = await cityMapResponse(city, renderCitySvg(city, mapPayload));
    expect(response.headers.get("Content-Type")).toMatch(/^image\/svg\+xml/u);
    expect(response.headers.get("X-Enigma-Map-Id")).toBe("city-r-1852574");
    expect(response.headers.get("X-Enigma-Map-Name-Encoded")).toBe("Vancouver");
    expect(response.headers.get("X-Enigma-Map-Version")).toBe("2");
    expect(response.headers.get("X-Enigma-Map-Bounds")?.split(",")).toHaveLength(4);
    expect(response.headers.get("X-Enigma-Map-Sha256")).toMatch(/^[0-9a-f]{64}$/u);
    expect(Number(response.headers.get("Content-Length"))).toBe(
      (await response.arrayBuffer()).byteLength,
    );
  });

  it("packages SVG plus a gzip address JSON for one board download", async () => {
    const city = definitionFromSearchResults(vancouverSearch);
    const svg = renderCitySvg(city, mapPayload);
    const details = JSON.stringify(cityMapDetails(city, mapPayload));
    const response = await cityMapPackageResponse(city, svg, details);
    const body = new Uint8Array(await response.arrayBuffer());
    const svgBytes = Number(response.headers.get("X-Enigma-Map-Svg-Bytes"));
    const compressedDetails = body.slice(svgBytes);
    const detailStream = new Blob([compressedDetails])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const decoded = (await new Response(detailStream).json()) as ReturnType<typeof cityMapDetails>;
    expect(response.headers.get("Content-Type")).toBe("application/vnd.enigma.city-map");
    expect(response.headers.get("X-Enigma-Map-Data-Encoding")).toBe("gzip");
    expect(Number(response.headers.get("X-Enigma-Map-Package-Bytes"))).toBe(body.byteLength);
    expect(body.slice(0, 5)).toEqual(new TextEncoder().encode("<?xml"));
    expect(decoded).toMatchObject({ cityName: "Vancouver", version: 1 });
    expect(decoded.streetClasses).toEqual([2]);
  });

  it("performs one geocode and one bounded Overpass request", async () => {
    const requests: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push(String(input));
      if (String(input).includes("nominatim")) {
        return Response.json(vancouverSearch);
      }
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("timeout%3A50");
      return Response.json(mapPayload);
    };
    const result = await buildCityMap("Vancouver, Canada", fakeFetch);
    expect(result.definition.name).toBe("Vancouver");
    expect(requests).toHaveLength(2);
  });
});

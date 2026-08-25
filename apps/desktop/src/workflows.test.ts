// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  exportGpx,
  formatDuration,
  parseCoordinateText,
  parseGpx,
  planPoints,
  routeMetrics,
  suggestedSpeedKph,
} from "./workflows";

describe("desktop route workflows", () => {
  it("uses movement-appropriate suggested speeds for Mapbox route profiles", () => {
    expect(suggestedSpeedKph("driving")).toBe(50);
    expect(suggestedSpeedKph("cycling")).toBe(15);
    expect(suggestedSpeedKph("walking")).toBe(5);
  });

  it("imports a bounded GPX track and exports it without losing coordinates", () => {
    const input = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="49.2827" lon="-123.1207"><ele>12</ele></trkpt>
      <trkpt lat="49.2837" lon="-123.1207"><time>2026-08-19T05:00:00Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const points = parseGpx(input);

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      latitude: 49.2827,
      longitude: -123.1207,
      altitudeMeters: 12,
    });
    expect(parseGpx(exportGpx(points))).toEqual(points);
  });

  it("rejects hostile XML, malformed coordinates, and waypoint-only files", () => {
    expect(() =>
      parseGpx('<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx/>'),
    ).toThrow("not allowed");
    expect(() =>
      parseGpx(
        '<gpx><trk><trkseg><trkpt lat="91" lon="0"/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>',
      ),
    ).toThrow("point 1");
    expect(() =>
      parseGpx('<gpx><trk><trkseg><trkpt/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>'),
    ).toThrow("missing latitude or longitude");
    expect(() => parseGpx('<gpx><wpt lat="1" lon="2"/></gpx>')).toThrow("at least two");
  });

  it("summarizes route distance, time, and saved plan points", () => {
    const points = [
      { latitude: 49.2827, longitude: -123.1207 },
      { latitude: 49.2837, longitude: -123.1207 },
    ];
    const metrics = routeMetrics(points, 3.6);

    expect(metrics.distanceMeters).toBeGreaterThan(100);
    expect(metrics.travelTimeMs).toBeGreaterThan(100_000);
    expect(formatDuration(metrics.travelTimeMs)).toMatch(/min/u);
    const firstPoint = points[0];
    if (!firstPoint) throw new Error("test fixture is missing its first point");
    expect(planPoints({ kind: "teleport", point: firstPoint })).toEqual([firstPoint]);
    const repeatedRoundTrip = routeMetrics(points, 3.6, 2, true);
    expect(repeatedRoundTrip.distanceMeters).toBeCloseTo(metrics.distanceMeters * 4);
    expect(repeatedRoundTrip.travelTimeMs).toBeCloseTo(metrics.travelTimeMs * 4);
  });

  it("parses complete coordinate text without accepting partial or out-of-range input", () => {
    expect(parseCoordinateText("49.2827, -123.1207")).toEqual({
      latitude: 49.2827,
      longitude: -123.1207,
    });
    expect(parseCoordinateText("49.2827,")).toBeUndefined();
    expect(parseCoordinateText("49.2827")).toBeUndefined();
    expect(parseCoordinateText("91, 0")).toBeUndefined();
  });
});

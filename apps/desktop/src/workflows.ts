import type { Coordinate, RoutingProfile, SimulationPlan } from "@enigma/contracts";
import { assertCoordinate, distanceMeters, estimatedTravelTimeMs } from "@enigma/route-engine";

const MAX_GPX_BYTES = 10 * 1024 * 1024;
const MAX_GPX_POINTS = 100_000;

export function suggestedSpeedKph(profile: RoutingProfile): number {
  switch (profile) {
    case "driving":
      return 50;
    case "cycling":
      return 15;
    case "walking":
      return 5;
  }
}

export function parseCoordinateText(value: string): Coordinate | undefined {
  const parts = value.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return undefined;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  const point = { latitude, longitude };
  try {
    assertCoordinate(point);
    return point;
  } catch {
    return undefined;
  }
}

export function parseGpx(text: string): Coordinate[] {
  if (new TextEncoder().encode(text).byteLength > MAX_GPX_BYTES) {
    throw new Error("GPX file exceeds the 10 MB limit");
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
    throw new Error("GPX document types and entities are not allowed");
  }
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("GPX file is not valid XML");
  const nodes = Array.from(document.querySelectorAll("trkpt, rtept"));
  if (nodes.length < 2) throw new Error("GPX file must contain at least two track points");
  if (nodes.length > MAX_GPX_POINTS) throw new Error("GPX file exceeds the 100,000 point limit");

  return nodes.map((node, index) => {
    const latitudeText = node.getAttribute("lat")?.trim();
    const longitudeText = node.getAttribute("lon")?.trim();
    if (!latitudeText || !longitudeText) {
      throw new Error(`GPX point ${index + 1} is missing latitude or longitude`);
    }
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    const elevation = node.querySelector("ele")?.textContent;
    const timestamp = node.querySelector("time")?.textContent?.trim();
    const point: Coordinate = {
      latitude,
      longitude,
      ...(elevation && Number.isFinite(Number(elevation))
        ? { altitudeMeters: Number(elevation) }
        : {}),
      ...(timestamp ? { timestamp } : {}),
    };
    try {
      assertCoordinate(point);
    } catch (error) {
      throw new Error(`GPX point ${index + 1} is invalid: ${errorMessage(error)}`);
    }
    if (timestamp && !Number.isFinite(Date.parse(timestamp))) {
      throw new Error(`GPX point ${index + 1} has an invalid timestamp`);
    }
    return point;
  });
}

export function exportGpx(points: Coordinate[], name = "Enigma route"): string {
  if (points.length < 2) throw new Error("Add at least two route points before exporting GPX");
  points.forEach(assertCoordinate);
  const trackPoints = points
    .map((point) => {
      const elevation =
        point.altitudeMeters === undefined ? "" : `<ele>${point.altitudeMeters}</ele>`;
      const timestamp = point.timestamp ? `<time>${escapeXml(point.timestamp)}</time>` : "";
      return `      <trkpt lat="${point.latitude}" lon="${point.longitude}">${elevation}${timestamp}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Enigma" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${escapeXml(name)}</name><trkseg>
${trackPoints}
  </trkseg></trk>
</gpx>\n`;
}

export function planPoints(plan: SimulationPlan): Coordinate[] {
  if (plan.kind === "teleport") return [plan.point];
  if (plan.kind === "joystick") return [plan.origin];
  return plan.points;
}

export function routeMetrics(
  points: Coordinate[],
  speedKph: number,
  repetitions = 1,
  roundTrip = false,
) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous && point) distance += distanceMeters(previous, point);
  }
  const multiplier = repetitions * (roundTrip ? 2 : 1);
  return {
    distanceMeters: distance * multiplier,
    travelTimeMs: estimatedTravelTimeMs(points, speedKph) * multiplier,
  };
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 min";
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

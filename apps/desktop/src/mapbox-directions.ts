import type { Coordinate, RoutingProfile } from "@enigma/contracts";
import { assertCoordinate } from "@enigma/route-engine";
import { requiredMapboxAccessToken } from "./mapbox-access-token";

const MAPBOX_DIRECTIONS_ORIGIN = "https://api.mapbox.com";
export const MAX_MAPBOX_WAYPOINTS = 25;

export async function requestMapboxRoute({
  waypoints,
  profile,
  accessToken,
  signal,
}: {
  waypoints: Coordinate[];
  profile: RoutingProfile;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<Coordinate[]> {
  if (waypoints.length < 2) throw new Error("Add at least two route points");
  if (waypoints.length > MAX_MAPBOX_WAYPOINTS) {
    throw new Error(`Mapbox routes support up to ${MAX_MAPBOX_WAYPOINTS} waypoints`);
  }
  waypoints.forEach(assertCoordinate);
  const token = requiredMapboxAccessToken(accessToken);
  const coordinates = waypoints.map((point) => `${point.longitude},${point.latitude}`).join(";");
  const url = new URL(`/directions/v5/mapbox/${profile}/${coordinates}`, MAPBOX_DIRECTIONS_ORIGIN);
  url.searchParams.set("access_token", token);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "false");
  const response = await fetch(url, { headers: { accept: "application/json" }, signal });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(mapboxResponseError(payload) ?? `Mapbox routing failed (${response.status})`);
  }
  return parseMapboxRoute(payload);
}

export function parseMapboxRoute(payload: unknown): Coordinate[] {
  const routes = asRecord(payload)?.routes;
  const route = Array.isArray(routes) ? asRecord(routes[0]) : undefined;
  const geometry = asRecord(route?.geometry);
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new Error("Mapbox did not return a route");
  }
  const points = geometry.coordinates.map((value) => {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error("Mapbox returned invalid route coordinates");
    }
    const point = { longitude: Number(value[0]), latitude: Number(value[1]) };
    assertCoordinate(point);
    return point;
  });
  if (points.length < 2) throw new Error("Mapbox returned an empty route");
  return points;
}

function mapboxResponseError(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const message = record?.message ?? record?.error;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

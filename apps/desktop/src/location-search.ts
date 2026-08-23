import type { Coordinate } from "@enigma/contracts";

const MAPBOX_SEARCH_ORIGIN = "https://api.mapbox.com";

export type LocationSuggestion = {
  id: string;
  name: string;
  description?: string;
  featureType?: string;
};

export function mapboxSearchConfigured(): boolean {
  return mapboxAccessToken() !== undefined;
}

export async function suggestLocations({
  query,
  sessionToken,
  proximity,
  language,
  signal,
}: {
  query: string;
  sessionToken: string;
  proximity?: Coordinate;
  language?: string;
  signal?: AbortSignal;
}): Promise<LocationSuggestion[]> {
  const url = new URL("/search/searchbox/v1/suggest", MAPBOX_SEARCH_ORIGIN);
  url.searchParams.set("q", query);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("access_token", requiredMapboxAccessToken());
  url.searchParams.set("limit", "5");
  if (proximity) {
    url.searchParams.set("proximity", `${proximity.longitude},${proximity.latitude}`);
  }
  if (language) url.searchParams.set("language", language);
  const payload = await requestJson(url, signal);
  return parseLocationSuggestions(payload);
}

export async function retrieveLocation({
  id,
  sessionToken,
  language,
  signal,
}: {
  id: string;
  sessionToken: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<Coordinate> {
  const url = new URL(
    `/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`,
    MAPBOX_SEARCH_ORIGIN,
  );
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("access_token", requiredMapboxAccessToken());
  if (language) url.searchParams.set("language", language);
  const payload = await requestJson(url, signal);
  return parseRetrievedCoordinate(payload);
}

export function parseLocationSuggestions(payload: unknown): LocationSuggestion[] {
  const suggestions = asRecord(payload)?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((value) => {
    const suggestion = asRecord(value);
    const id = stringValue(suggestion?.mapbox_id);
    const name = stringValue(suggestion?.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        description:
          stringValue(suggestion?.full_address) ?? stringValue(suggestion?.place_formatted),
        featureType: stringValue(suggestion?.feature_type),
      },
    ];
  });
}

export function parseRetrievedCoordinate(payload: unknown): Coordinate {
  const features = asRecord(payload)?.features;
  const feature = Array.isArray(features) ? asRecord(features[0]) : undefined;
  const geometry = asRecord(feature?.geometry);
  const coordinates = geometry?.coordinates;
  const longitude = Array.isArray(coordinates) ? Number(coordinates[0]) : Number.NaN;
  const latitude = Array.isArray(coordinates) ? Number(coordinates[1]) : Number.NaN;
  if (
    geometry?.type !== "Point" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("The selected location did not include valid coordinates");
  }
  return { latitude, longitude };
}

function mapboxAccessToken(): string | undefined {
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
  return token?.startsWith("pk.") ? token : undefined;
}

function requiredMapboxAccessToken(): string {
  const token = mapboxAccessToken();
  if (!token) {
    throw new Error("Add a Mapbox public token in VITE_MAPBOX_ACCESS_TOKEN");
  }
  return token;
}

async function requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = asRecord(payload);
    const message = stringValue(body?.message) ?? stringValue(body?.error);
    throw new Error(message ?? `Location search failed (${response.status})`);
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

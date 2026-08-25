const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const APPLICATION_ID = "Enigma city map service (https://enigma.bruceshi.com)";

export const MAX_CITY_QUERY_BYTES = 96;
export const MAX_SVG_BYTES = 1_500_000;
export const MAX_DETAIL_JSON_BYTES = 12_000_000;
export const MAX_DETAIL_GZIP_BYTES = 3_000_000;
const MAX_OVERPASS_BYTES = 96 * 1024 * 1024;
const MIN_CITY_SPAN_KM = 8;
const MAX_CITY_SPAN_KM = 24;

export interface CityBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface CityDefinition {
  id: string;
  name: string;
  bounds: CityBounds;
  width: number;
  height: number;
}

interface NominatimResult {
  addresstype?: string;
  boundingbox?: unknown;
  display_name?: string;
  lat?: string;
  lon?: string;
  name?: string;
  osm_id?: number;
  osm_type?: string;
  type?: string;
}

interface GeometryPoint {
  lat: number;
  lon: number;
}

type ProjectedPoint = [number, number];

interface OverpassElement {
  center?: GeometryPoint;
  geometry?: GeometryPoint[];
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  type?: string;
}

interface OverpassPayload {
  elements?: OverpassElement[];
}

type StreetLabel = [streetIndex: number, latitude: number, longitude: number, angleDegrees: number];
type StreetPath = [
  streetIndex: number,
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number,
  points: number[],
];
type PlaceLabel = [name: string, kind: string, latitude: number, longitude: number];
type BuildingAddress = [number: string, streetIndex: number, latitude: number, longitude: number];

export interface CityMapDetails {
  version: 1;
  cityId: string;
  cityName: string;
  bounds: CityBounds;
  streets: string[];
  streetClasses: number[];
  places: PlaceLabel[];
  streetLabels: StreetLabel[];
  streetPaths: StreetPath[];
  buildings: BuildingAddress[];
  attribution: string;
}

export class CityMapError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function normalizeCityQuery(rawQuery: string | null): string {
  const query = (rawQuery ?? "").trim().replace(/\s+/gu, " ");
  const bytes = new TextEncoder().encode(query).byteLength;
  const hasControlCharacter = [...query].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!query || bytes > MAX_CITY_QUERY_BYTES || hasControlCharacter) {
    throw new CityMapError("City must be 1 to 96 UTF-8 bytes", 422);
  }
  return query;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fitUtf8(value: string, maximumBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function normalizedBounds(result: NominatimResult): CityBounds | undefined {
  const latitude = finiteNumber(result.lat);
  const longitude = finiteNumber(result.lon);
  if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 85) return;

  const rawBounds = Array.isArray(result.boundingbox)
    ? result.boundingbox.map(finiteNumber)
    : undefined;
  const hasBounds = rawBounds?.length === 4 && rawBounds.every((value) => value !== undefined);
  const [rawSouth, rawNorth, rawWest, rawEast] = hasBounds
    ? (rawBounds as [number, number, number, number])
    : [latitude, latitude, longitude, longitude];
  const kilometresPerLongitudeDegree = Math.max(8, 111.32 * Math.cos((latitude * Math.PI) / 180));
  const naturalWidthKm = Math.abs(rawEast - rawWest) * kilometresPerLongitudeDegree;
  const naturalHeightKm = Math.abs(rawNorth - rawSouth) * 110.574;
  const widthKm = clamp(naturalWidthKm || 12, MIN_CITY_SPAN_KM, MAX_CITY_SPAN_KM);
  const heightKm = clamp(naturalHeightKm || 12, MIN_CITY_SPAN_KM, MAX_CITY_SPAN_KM);
  const halfLongitude = widthKm / kilometresPerLongitudeDegree / 2;
  const halfLatitude = heightKm / 110.574 / 2;
  const centerLatitude = clamp(latitude, -85 + halfLatitude, 85 - halfLatitude);
  const centerLongitude = clamp(longitude, -180 + halfLongitude, 180 - halfLongitude);
  return {
    west: centerLongitude - halfLongitude,
    south: centerLatitude - halfLatitude,
    east: centerLongitude + halfLongitude,
    north: centerLatitude + halfLatitude,
  };
}

function mapDimensions(bounds: CityBounds): Pick<CityDefinition, "width" | "height"> {
  const meanLatitude = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const geographicWidth = (bounds.east - bounds.west) * Math.cos(meanLatitude);
  const geographicHeight = bounds.north - bounds.south;
  const width = geographicWidth >= geographicHeight ? 1200 : 800;
  return { width, height: Math.round(width * (geographicHeight / geographicWidth)) };
}

function cityName(result: NominatimResult): string {
  const candidate = result.name || result.display_name?.split(",", 1)[0] || "City map";
  return fitUtf8(candidate.trim(), 63) || "City map";
}

function cityId(result: NominatimResult): string | undefined {
  const type = result.osm_type?.slice(0, 1).toLowerCase();
  const id = finiteNumber(result.osm_id);
  if (!type || !/[nwr]/u.test(type) || id === undefined || !Number.isInteger(id)) return;
  return `city-${type}-${Math.abs(id)}`.slice(0, 31);
}

export function definitionFromSearchResults(payload: unknown): CityDefinition {
  if (!Array.isArray(payload)) throw new CityMapError("City search returned invalid data");
  const preferredTypes = new Set([
    "city",
    "town",
    "municipality",
    "borough",
    "village",
    "administrative",
  ]);
  const results = payload.filter(
    (candidate): candidate is NominatimResult =>
      Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate),
  );
  const result =
    results.find((candidate) =>
      preferredTypes.has(candidate.addresstype ?? candidate.type ?? ""),
    ) ?? results[0];
  const bounds = result && normalizedBounds(result);
  const id = result && cityId(result);
  if (!result || !bounds || !id) throw new CityMapError("City was not found", 404);
  return { id, name: cityName(result), bounds, ...mapDimensions(bounds) };
}

async function geocodeCity(query: string, fetcher: typeof fetch): Promise<CityDefinition> {
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    layer: "address",
    limit: "5",
  }).toString();
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://enigma.bruceshi.com/",
      "User-Agent": APPLICATION_ID,
    },
  });
  if (!response.ok) {
    throw new CityMapError(`City search returned HTTP ${response.status}`, 503);
  }
  return definitionFromSearchResults(await response.json());
}

function overpassQuery(bounds: CityBounds): string {
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(7))
    .join(",");
  return `[out:json][timeout:50][maxsize:${MAX_OVERPASS_BYTES}];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](${bbox});
way["railway"="rail"](${bbox});
way["waterway"](${bbox});
way["natural"="water"](${bbox});
way["landuse"="reservoir"](${bbox});
way["leisure"~"^(park|nature_reserve)$"](${bbox});
node["place"~"^(city|town|suburb|neighbourhood|quarter)$"](${bbox});
);out tags geom qt;
nwr["addr:housenumber"](${bbox});out tags center qt;`;
}

async function fetchMapData(
  definition: CityDefinition,
  fetcher: typeof fetch,
): Promise<OverpassPayload> {
  const response = await fetcher(OVERPASS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: "https://enigma.bruceshi.com/",
      "User-Agent": APPLICATION_ID,
    },
    body: new URLSearchParams({ data: overpassQuery(definition.bounds) }),
  });
  if (!response.ok) throw new CityMapError(`Map source returned HTTP ${response.status}`, 503);
  const declaredBytes = finiteNumber(response.headers.get("Content-Length"));
  if (declaredBytes !== undefined && declaredBytes > MAX_OVERPASS_BYTES) {
    throw new CityMapError("Map source response is too large", 422);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_OVERPASS_BYTES) {
    throw new CityMapError("Map source response is too large", 422);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new CityMapError("Map source returned invalid JSON", 503);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as OverpassPayload).elements)
  ) {
    throw new CityMapError("Map source returned invalid data", 503);
  }
  return payload as OverpassPayload;
}

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function perpendicularDistance(
  point: ProjectedPoint,
  start: ProjectedPoint,
  end: ProjectedPoint,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (!dx && !dy) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const amount = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  return Math.hypot(point[0] - (start[0] + amount * dx), point[1] - (start[1] + amount * dy));
}

function simplify(points: ProjectedPoint[], tolerance: number): ProjectedPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  while (ranges.length) {
    const [start, end] = ranges.pop() as [number, number];
    const startPoint = points[start];
    const endPoint = points[end];
    if (!startPoint || !endPoint) continue;
    let furthest = tolerance;
    let candidateIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const candidate = points[index];
      if (!candidate) continue;
      const distance = perpendicularDistance(candidate, startPoint, endPoint);
      if (distance > furthest) {
        furthest = distance;
        candidateIndex = index;
      }
    }
    if (candidateIndex >= 0) {
      keep[candidateIndex] = 1;
      ranges.push([start, candidateIndex], [candidateIndex, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

function projection(definition: CityDefinition) {
  const { bounds, width, height } = definition;
  return (point: GeometryPoint): ProjectedPoint => [
    ((point.lon - bounds.west) / (bounds.east - bounds.west)) * width,
    ((bounds.north - point.lat) / (bounds.north - bounds.south)) * height,
  ];
}

function roadClass(highway: string | undefined): "major" | "arterial" | "collector" | "street" {
  if (highway === "motorway" || highway === "trunk") return "major";
  if (highway === "primary" || highway === "secondary") return "arterial";
  if (highway === "tertiary") return "collector";
  return "street";
}

function roadClassRank(highway: string | undefined): number {
  switch (roadClass(highway)) {
    case "major":
      return 3;
    case "arterial":
      return 2;
    case "collector":
      return 1;
    default:
      return 0;
  }
}

function pathData(
  geometry: GeometryPoint[],
  project: (point: GeometryPoint) => ProjectedPoint,
  tolerance: number,
): string {
  if (geometry.length < 2) return "";
  return simplify(geometry.map(project), tolerance)
    .map(([x, y], index) => `${index ? "L" : "M"}${Math.round(x)} ${Math.round(y)}`)
    .join("");
}

function geometryLength(
  geometry: GeometryPoint[],
  project: (point: GeometryPoint) => ProjectedPoint,
): number {
  let total = 0;
  let previous: ProjectedPoint | undefined;
  for (const point of geometry) {
    const current = project(point);
    if (previous) total += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    previous = current;
  }
  return total;
}

function geometryMidpointWithAngle(
  geometry: GeometryPoint[],
  project: (point: GeometryPoint) => ProjectedPoint,
): { point: GeometryPoint; angle: number } | undefined {
  if (geometry.length < 2) return;
  const projected = geometry.map(project);
  const segmentLengths = projected.slice(1).map((point, index) => {
    const previous = projected[index];
    return previous ? Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0;
  });
  const totalLength = segmentLengths.reduce((total, length) => total + length, 0);
  if (!totalLength) return;
  const midpointLength = totalLength / 2;
  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index] ?? 0;
    if (traversed + segmentLength < midpointLength) {
      traversed += segmentLength;
      continue;
    }
    const start = geometry[index];
    const end = geometry[index + 1];
    const projectedStart = projected[index];
    const projectedEnd = projected[index + 1];
    if (!start || !end || !projectedStart || !projectedEnd || !segmentLength) continue;
    const amount = (midpointLength - traversed) / segmentLength;
    let angle =
      (Math.atan2(projectedEnd[1] - projectedStart[1], projectedEnd[0] - projectedStart[0]) * 180) /
      Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    return {
      point: {
        lat: start.lat + (end.lat - start.lat) * amount,
        lon: start.lon + (end.lon - start.lon) * amount,
      },
      angle: Math.round(angle),
    };
  }
}

function cleanMapLabel(value: string | undefined, maximumBytes: number): string {
  if (!value) return "";
  return fitUtf8(
    [...value]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 ? " " : character;
      })
      .join("")
      .trim()
      .replace(/\s+/gu, " "),
    maximumBytes,
  );
}

function roundedCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function elementCoordinate(element: OverpassElement): GeometryPoint | undefined {
  const latitude = finiteNumber(element.center?.lat ?? element.lat);
  const longitude = finiteNumber(element.center?.lon ?? element.lon);
  if (latitude !== undefined && longitude !== undefined) {
    return { lat: latitude, lon: longitude };
  }
  const geometry = element.geometry;
  if (!geometry?.length) return;
  let latitudeTotal = 0;
  let longitudeTotal = 0;
  let count = 0;
  for (const point of geometry) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    latitudeTotal += point.lat;
    longitudeTotal += point.lon;
    count += 1;
  }
  return count ? { lat: latitudeTotal / count, lon: longitudeTotal / count } : undefined;
}

function pointInBounds(point: GeometryPoint, bounds: CityBounds): boolean {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lon >= bounds.west &&
    point.lon <= bounds.east
  );
}

export function cityMapDetails(
  definition: CityDefinition,
  payload: OverpassPayload,
): CityMapDetails {
  const elements = payload.elements ?? [];
  const roads = elements.filter(
    (element) =>
      element.type === "way" &&
      Boolean(element.tags?.highway) &&
      Array.isArray(element.geometry) &&
      element.geometry.length >= 2,
  );
  const streetNames = new Set<string>();
  const streetClassByName = new Map<string, number>();
  const bestRoadByName = new Map<string, { road: OverpassElement; length: number }>();
  const project = projection(definition);
  for (const road of roads) {
    const street = cleanMapLabel(road.tags?.name, 120);
    const geometry = road.geometry;
    if (!street || !geometry) continue;
    streetNames.add(street);
    streetClassByName.set(
      street,
      Math.max(streetClassByName.get(street) ?? 0, roadClassRank(road.tags?.highway)),
    );
    const length = geometryLength(geometry, project);
    if ((bestRoadByName.get(street)?.length ?? 0) < length) {
      bestRoadByName.set(street, { road, length });
    }
  }

  const addressesByElement = new Map<
    string,
    { number: string; street: string; point: GeometryPoint }
  >();
  for (const element of elements) {
    const number = cleanMapLabel(element.tags?.["addr:housenumber"], 40);
    const point = elementCoordinate(element);
    if (!number || !point || !pointInBounds(point, definition.bounds)) continue;
    const street = cleanMapLabel(
      element.tags?.["addr:street"] ?? element.tags?.["addr:place"],
      120,
    );
    if (street) streetNames.add(street);
    const elementKey = `${element.type ?? "element"}/${element.id ?? addressesByElement.size}`;
    addressesByElement.set(elementKey, { number, street, point });
  }

  const streets = [...streetNames].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const streetIndexes = new Map(streets.map((street, index) => [street, index]));
  const streetClasses = streets.map((street) => streetClassByName.get(street) ?? 0);
  const streetLabels = [...bestRoadByName.entries()]
    .flatMap(([street, { road }]): StreetLabel[] => {
      const geometry = road.geometry;
      const placement = geometry && geometryMidpointWithAngle(geometry, project);
      const streetIndex = streetIndexes.get(street);
      if (!placement || streetIndex === undefined) return [];
      return [
        [
          streetIndex,
          roundedCoordinate(placement.point.lat),
          roundedCoordinate(placement.point.lon),
          placement.angle,
        ],
      ];
    })
    .sort((left, right) => left[0] - right[0]);
  const streetPaths = roads
    .flatMap((road): StreetPath[] => {
      const street = cleanMapLabel(road.tags?.name, 120);
      const streetIndex = streetIndexes.get(street);
      const geometry = road.geometry;
      if (streetIndex === undefined || !geometry) return [];
      const projected = simplify(geometry.map(project), 0.65).map(
        ([x, y]): ProjectedPoint => [Math.round(x), Math.round(y)],
      );
      if (projected.length < 2) return [];
      const xCoordinates = projected.map(([x]) => x);
      const yCoordinates = projected.map(([, y]) => y);
      return [
        [
          streetIndex,
          Math.min(...xCoordinates),
          Math.min(...yCoordinates),
          Math.max(...xCoordinates),
          Math.max(...yCoordinates),
          projected.flat(),
        ],
      ];
    })
    .sort((left, right) => left[0] - right[0]);
  const places = elements
    .filter(
      (element) =>
        element.type === "node" &&
        ["city", "town", "suburb", "neighbourhood", "quarter"].includes(element.tags?.place ?? ""),
    )
    .flatMap((element): PlaceLabel[] => {
      const point = elementCoordinate(element);
      const name = cleanMapLabel(element.tags?.name, 120);
      if (!point || !name || !pointInBounds(point, definition.bounds)) return [];
      return [
        [
          name,
          element.tags?.place ?? "place",
          roundedCoordinate(point.lat),
          roundedCoordinate(point.lon),
        ],
      ];
    })
    .sort((left, right) => {
      const leftRank = left[1] === "city" || left[1] === "town" ? 0 : 1;
      const rightRank = right[1] === "city" || right[1] === "town" ? 0 : 1;
      return leftRank - rightRank || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
    });
  const buildings = [...addressesByElement.values()]
    .map(
      ({ number, street, point }): BuildingAddress => [
        number,
        streetIndexes.get(street) ?? -1,
        roundedCoordinate(point.lat),
        roundedCoordinate(point.lon),
      ],
    )
    .sort(
      (left, right) =>
        left[1] - right[1] ||
        (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0) ||
        left[2] - right[2] ||
        left[3] - right[3],
    );

  return {
    version: 1,
    cityId: definition.id,
    cityName: definition.name,
    bounds: definition.bounds,
    streets,
    streetClasses,
    places,
    streetLabels,
    streetPaths,
    buildings,
    attribution: "© OpenStreetMap contributors · ODbL",
  };
}

export function renderCityDetails(definition: CityDefinition, payload: OverpassPayload): string {
  const json = JSON.stringify(cityMapDetails(definition, payload));
  if (new TextEncoder().encode(json).byteLength > MAX_DETAIL_JSON_BYTES) {
    throw new CityMapError("This city's address index is too large for the board", 422);
  }
  return json;
}

function renderSvgAttempt(
  definition: CityDefinition,
  payload: OverpassPayload,
  tolerance: number,
  localRoadModulo = 1,
): string {
  const elements = payload.elements ?? [];
  const ways = elements.filter(
    (element) => element.type === "way" && Array.isArray(element.geometry),
  );
  const roads = ways.filter((element) => {
    if (!element.tags?.highway) return false;
    return (
      roadClass(element.tags.highway) !== "street" ||
      Math.abs(element.id ?? 0) % localRoadModulo === 0
    );
  });
  const parks = ways.filter(
    (element) => element.tags?.leisure === "park" || element.tags?.leisure === "nature_reserve",
  );
  const water = ways.filter(
    (element) =>
      element.tags?.natural === "water" ||
      element.tags?.waterway === "riverbank" ||
      element.tags?.landuse === "reservoir",
  );
  const waterways = ways.filter(
    (element) => element.tags?.waterway && element.tags.waterway !== "riverbank",
  );
  const rail = ways.filter((element) => element.tags?.railway === "rail");
  const project = projection(definition);
  const combinedPath = (collection: OverpassElement[], className: string, close = false) => {
    const data = collection
      .map((element) => {
        const geometry = element.geometry ?? [];
        const path = pathData(geometry, project, tolerance);
        const first = geometry[0];
        const last = geometry.at(-1);
        const closed =
          close && first && last && first.lat === last.lat && first.lon === last.lon ? "Z" : "";
        return `${path}${closed}`;
      })
      .join("");
    return data ? `<path class="${className}" d="${data}"/>` : "";
  };
  const roadPaths = ["street", "collector", "arterial", "major"]
    .map((className) =>
      combinedPath(
        roads.filter((road) => roadClass(road.tags?.highway) === className),
        className,
      ),
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${definition.width} ${definition.height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(definition.name)} offline street map</title>
  <desc id="description">Compact OpenStreetMap-derived map for choosing a location while offline.</desc>
  <style>.park{fill:#183b32;stroke:#2a594a;stroke-width:1}.water{fill:#0b4053;stroke:#1c6377;stroke-width:1.2}.waterway{fill:none;stroke:#24809a;stroke-width:1.5}.rail{fill:none;stroke:#727f83;stroke-width:1;stroke-dasharray:4 4}.street,.collector,.arterial,.major{fill:none;stroke-linecap:round;stroke-linejoin:round}.street{stroke:#48616a;stroke-width:1}.collector{stroke:#66818a;stroke-width:1.7}.arterial{stroke:#d3a85d;stroke-width:2.7}.major{stroke:#f0d182;stroke-width:4}</style>
  <rect width="100%" height="100%" fill="#10242b"/>
  <g>${combinedPath(parks, "park", true)}</g><g>${combinedPath(water, "water", true)}</g><g>${combinedPath(waterways, "waterway")}</g><g>${combinedPath(rail, "rail")}</g><g>${roadPaths}</g>
  <text x="${definition.width - 10}" y="${definition.height - 10}" text-anchor="end" fill="#9fb5bc" font-family="sans-serif" font-size="11">© OpenStreetMap contributors · ODbL</text>
</svg>
`;
}

export function renderCitySvg(definition: CityDefinition, payload: OverpassPayload): string {
  for (const [tolerance, localRoadModulo] of [
    [0.65, 1],
    [1.1, 1],
    [1.25, 2],
    [1.5, 3],
  ] as const) {
    const svg = renderSvgAttempt(definition, payload, tolerance, localRoadModulo);
    if (new TextEncoder().encode(svg).byteLength <= MAX_SVG_BYTES) return svg;
  }
  throw new CityMapError("This city map is too detailed for the board", 422);
}

export async function buildCityMap(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<{ definition: CityDefinition; svg: string; details: string }> {
  const definition = await geocodeCity(query, fetcher);
  return buildCityMapForDefinition(definition, fetcher);
}

export async function buildCityMapForDefinition(
  definition: CityDefinition,
  fetcher: typeof fetch = fetch,
): Promise<{ definition: CityDefinition; svg: string; details: string }> {
  const payload = await fetchMapData(definition, fetcher);
  return {
    definition,
    svg: renderCitySvg(definition, payload),
    details: renderCityDetails(definition, payload),
  };
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(body: Uint8Array): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new Uint8Array(body).buffer));
}

async function gzip(body: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(body).buffer])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function mapMetadataHeaders(definition: CityDefinition): Headers {
  return new Headers({
    "Cache-Control": "public, max-age=86400, s-maxage=2592000",
    "X-Content-Type-Options": "nosniff",
    "X-Enigma-Map-Bounds": [
      definition.bounds.west,
      definition.bounds.south,
      definition.bounds.east,
      definition.bounds.north,
    ].join(","),
    "X-Enigma-Map-Height": String(definition.height),
    "X-Enigma-Map-Id": definition.id,
    "X-Enigma-Map-Name-Encoded": encodeURIComponent(definition.name),
    "X-Enigma-Map-Version": "2",
    "X-Enigma-Map-Width": String(definition.width),
  });
}

export async function cityMapResponse(definition: CityDefinition, svg: string): Promise<Response> {
  const body = new TextEncoder().encode(svg);
  const digest = await sha256(body);
  const headers = mapMetadataHeaders(definition);
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Type", "image/svg+xml; charset=utf-8");
  headers.set("ETag", `"${digest}"`);
  headers.set("X-Enigma-Map-Sha256", digest);
  return new Response(body, { status: 200, headers });
}

export async function cityMapDetailsResponse(
  definition: CityDefinition,
  details: string,
): Promise<Response> {
  const body = new TextEncoder().encode(details);
  const digest = await sha256(body);
  const headers = mapMetadataHeaders(definition);
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("ETag", `"${digest}"`);
  headers.set("X-Enigma-Map-Data-Sha256", digest);
  return new Response(body, { status: 200, headers });
}

export async function cityMapPackageResponse(
  definition: CityDefinition,
  svg: string,
  details: string,
): Promise<Response> {
  const svgBody = new TextEncoder().encode(svg);
  const detailBody = new TextEncoder().encode(details);
  const compressedDetails = await gzip(detailBody);
  if (compressedDetails.byteLength > MAX_DETAIL_GZIP_BYTES) {
    throw new CityMapError("This city's compressed address index is too large for the board", 422);
  }
  const body = new Uint8Array(svgBody.byteLength + compressedDetails.byteLength);
  body.set(svgBody, 0);
  body.set(compressedDetails, svgBody.byteLength);
  const [packageDigest, svgDigest, detailDigest] = await Promise.all([
    sha256(body),
    sha256(svgBody),
    sha256(compressedDetails),
  ]);
  const headers = mapMetadataHeaders(definition);
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Type", "application/vnd.enigma.city-map");
  headers.set("ETag", `"${packageDigest}"`);
  headers.set("X-Enigma-Map-Sha256", packageDigest);
  headers.set("X-Enigma-Map-Package-Bytes", String(body.byteLength));
  headers.set("X-Enigma-Map-Svg-Bytes", String(svgBody.byteLength));
  headers.set("X-Enigma-Map-Svg-Sha256", svgDigest);
  headers.set("X-Enigma-Map-Data-Bytes", String(compressedDetails.byteLength));
  headers.set("X-Enigma-Map-Data-Uncompressed-Bytes", String(detailBody.byteLength));
  headers.set("X-Enigma-Map-Data-Sha256", detailDigest);
  headers.set("X-Enigma-Map-Data-Encoding", "gzip");
  return new Response(body, { status: 200, headers });
}

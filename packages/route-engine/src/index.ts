import {
  type Coordinate,
  LOCATION_LIMITS,
  type PathPlan,
  type RouteOptions,
} from "@enigma/contracts";

const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function assertCoordinate(point: Coordinate): void {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    throw new RangeError("Coordinates must be finite numbers");
  }
  if (
    point.latitude < LOCATION_LIMITS.minLatitude ||
    point.latitude > LOCATION_LIMITS.maxLatitude
  ) {
    throw new RangeError("Latitude must be between -90 and 90");
  }
  if (
    point.longitude < LOCATION_LIMITS.minLongitude ||
    point.longitude > LOCATION_LIMITS.maxLongitude
  ) {
    throw new RangeError("Longitude must be between -180 and 180");
  }
}

export function assertRouteOptions(options: RouteOptions): void {
  if (
    options.speedKph < LOCATION_LIMITS.minSpeedKph ||
    options.speedKph > LOCATION_LIMITS.maxSpeedKph
  ) {
    throw new RangeError("Speed must be between 0.4 and 108 km/h");
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
    throw new RangeError("Repetitions must be a positive integer");
  }
  if (options.updateIntervalMs !== 1000) {
    throw new RangeError("V1 simulations update once per second");
  }
}

export function distanceMeters(start: Coordinate, end: Coordinate): number {
  assertCoordinate(start);
  assertCoordinate(end);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(normalizeLongitude(end.longitude - start.longitude));
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function interpolateGreatCircle(
  start: Coordinate,
  end: Coordinate,
  fraction: number,
): Coordinate {
  assertCoordinate(start);
  assertCoordinate(end);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError("Interpolation fraction must be between 0 and 1");
  }

  const lat1 = toRadians(start.latitude);
  const lon1 = toRadians(start.longitude);
  const lat2 = toRadians(end.latitude);
  const lon2 = toRadians(end.longitude);
  const angularDistance = distanceMeters(start, end) / EARTH_RADIUS_METERS;

  if (angularDistance < Number.EPSILON) return { ...start };

  const sinDistance = Math.sin(angularDistance);
  const a = Math.sin((1 - fraction) * angularDistance) / sinDistance;
  const b = Math.sin(fraction * angularDistance) / sinDistance;
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);

  return {
    latitude: toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y))),
    longitude: normalizeLongitude(toDegrees(Math.atan2(y, x))),
    altitudeMeters:
      start.altitudeMeters === undefined || end.altitudeMeters === undefined
        ? undefined
        : start.altitudeMeters + (end.altitudeMeters - start.altitudeMeters) * fraction,
  };
}

function seededVariation(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43_758.5453;
  const normalized = value - Math.floor(value);
  return 0.95 + normalized * 0.1;
}

function effectiveSpeed(options: RouteOptions, sampleIndex: number): number {
  if (options.speedProfile === "constant") return options.speedKph;
  return options.speedKph * seededVariation(options.naturalVariationSeed ?? 1, sampleIndex);
}

export function expandRoutePoints(plan: PathPlan): Coordinate[] {
  if (plan.points.length < 2) throw new RangeError("A path needs at least two points");
  plan.points.forEach(assertCoordinate);
  assertRouteOptions(plan.options);

  const base = plan.options.roundTrip
    ? [...plan.points, ...plan.points.slice(0, -1).reverse()]
    : [...plan.points];
  const expanded: Coordinate[] = [];
  for (let repetition = 0; repetition < plan.options.repetitions; repetition += 1) {
    const startsWherePreviousEnded = repetition > 0 && coordinatesEqual(expanded.at(-1), base[0]);
    expanded.push(...(startsWherePreviousEnded ? base.slice(1) : base));
  }
  return expanded;
}

export function buildRouteSamples(plan: PathPlan): Coordinate[] {
  if (plan.points.length < 2) throw new RangeError("A path needs at least two points");
  plan.points.forEach(assertCoordinate);
  assertRouteOptions(plan.options);
  const points = plan.options.roundTrip
    ? [...plan.points, ...plan.points.slice(0, -1).reverse()]
    : [...plan.points];
  const first = points[0];
  if (!first) return [];
  const samples: Coordinate[] = [{ ...first }];
  let sampleIndex = 0;

  for (let repetition = 0; repetition < plan.options.repetitions; repetition += 1) {
    if (repetition > 0 && !coordinatesEqual(samples.at(-1), first)) {
      assertSampleCapacity(samples.length);
      samples.push({ ...first });
    }
    for (let segment = 0; segment < points.length - 1; segment += 1) {
      const start = points[segment];
      const end = points[segment + 1];
      if (!start || !end) continue;
      const length = distanceMeters(start, end);
      let traveled = 0;

      while (traveled < length) {
        const metersPerTick = (effectiveSpeed(plan.options, sampleIndex) * 1000) / 3600;
        traveled = Math.min(length, traveled + metersPerTick);
        assertSampleCapacity(samples.length);
        samples.push(interpolateGreatCircle(start, end, traveled / length));
        sampleIndex += 1;
      }
    }
  }

  return samples;
}

function assertSampleCapacity(length: number): void {
  if (length >= LOCATION_LIMITS.maxRouteSamples) {
    throw new RangeError(
      `Route exceeds ${LOCATION_LIMITS.maxRouteSamples.toLocaleString()} updates; increase speed, shorten the route, or reduce repetitions`,
    );
  }
}

function coordinatesEqual(left?: Coordinate, right?: Coordinate): boolean {
  return left?.latitude === right?.latitude && left?.longitude === right?.longitude;
}

export function advanceJoystick(
  origin: Coordinate,
  headingDegrees: number,
  speedKph: number,
  elapsedMs = 1000,
): Coordinate {
  assertCoordinate(origin);
  if (speedKph < LOCATION_LIMITS.minSpeedKph || speedKph > LOCATION_LIMITS.maxSpeedKph) {
    throw new RangeError("Speed must be between 0.4 and 108 km/h");
  }
  const distance = (speedKph * 1000 * elapsedMs) / 3_600_000;
  const angularDistance = distance / EARTH_RADIUS_METERS;
  const bearing = toRadians(((headingDegrees % 360) + 360) % 360);
  const lat1 = toRadians(origin.latitude);
  const lon1 = toRadians(origin.longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { latitude: toDegrees(lat2), longitude: normalizeLongitude(toDegrees(lon2)) };
}

export function estimatedTravelTimeMs(points: Coordinate[], speedKph: number): number {
  if (points.length < 2) return 0;
  if (speedKph <= 0) throw new RangeError("Speed must be greater than zero");
  let meters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous && point) meters += distanceMeters(previous, point);
  }
  return (meters / ((speedKph * 1000) / 3600)) * 1000;
}

import { describe, expect, it } from "vitest";
import {
  advanceJoystick,
  buildRouteSamples,
  distanceMeters,
  interpolateGreatCircle,
} from "./index";

describe("route engine", () => {
  it("uses the shortest path across the antimeridian", () => {
    const midpoint = interpolateGreatCircle(
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
      0.5,
    );
    expect(Math.abs(midpoint.longitude)).toBeCloseTo(180, 5);
  });

  it("produces deterministic natural-speed samples", () => {
    const plan = {
      kind: "path" as const,
      points: [
        { latitude: 49.2827, longitude: -123.1207 },
        { latitude: 49.2837, longitude: -123.1207 },
      ],
      options: {
        speedKph: 5,
        speedProfile: "natural" as const,
        repetitions: 1,
        roundTrip: false,
        updateIntervalMs: 1000 as const,
        naturalVariationSeed: 42,
      },
    };
    expect(buildRouteSamples(plan)).toEqual(buildRouteSamples(plan));
  });

  it("advances a joystick north at the configured speed", () => {
    const origin = { latitude: 49.2827, longitude: -123.1207 };
    const next = advanceJoystick(origin, 0, 3.6, 1000);
    expect(distanceMeters(origin, next)).toBeCloseTo(1, 2);
    expect(next.latitude).toBeGreaterThan(origin.latitude);
  });

  it("rejects invalid coordinates", () => {
    expect(() =>
      distanceMeters({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toThrow("Latitude");
  });

  it("replays forward-only repetitions from the start and ends round trips at the start", () => {
    const start = { latitude: 0, longitude: 0 };
    const end = { latitude: 0, longitude: 0.00001 };
    const options = {
      speedKph: 108,
      speedProfile: "constant" as const,
      repetitions: 2,
      roundTrip: false,
      updateIntervalMs: 1000 as const,
    };
    const repeated = buildRouteSamples({ kind: "path", points: [start, end], options });
    expect(repeated.filter((point) => point.latitude === 0 && point.longitude === 0)).toHaveLength(
      2,
    );
    expect(repeated.at(-1)?.latitude).toBeCloseTo(end.latitude, 10);
    expect(repeated.at(-1)?.longitude).toBeCloseTo(end.longitude, 10);

    const roundTrip = buildRouteSamples({
      kind: "path",
      points: [start, end],
      options: { ...options, roundTrip: true },
    });
    expect(roundTrip.at(-1)?.latitude).toBeCloseTo(start.latitude, 10);
    expect(roundTrip.at(-1)?.longitude).toBeCloseTo(start.longitude, 10);
  });

  it("rejects routes that would allocate too many one-second updates", () => {
    expect(() =>
      buildRouteSamples({
        kind: "path",
        points: [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 1 },
        ],
        options: {
          speedKph: 0.4,
          speedProfile: "constant",
          repetitions: 1,
          roundTrip: false,
          updateIntervalMs: 1000,
        },
      }),
    ).toThrow("100,000 updates");
  });
});

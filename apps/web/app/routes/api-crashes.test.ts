import { describe, expect, it } from "vitest";
import { crashSchema } from "./api-crashes";

const validReport = {
  schemaVersion: 1,
  appVersion: "1.0.0",
  platform: "macos",
  osVersion: "not-collected",
  errorCode: "LOCATION_SERVICE_FAILED",
  stackFrames: [],
  coarseState: "error",
  occurredAt: "2026-08-18T20:00:00.000Z",
} as const;

describe("crash report ingress privacy", () => {
  it("accepts only the documented coarse payload", () => {
    expect(crashSchema.safeParse(validReport).success).toBe(true);
  });

  it.each([
    { latitude: 49.2827 },
    { longitude: -123.1207 },
    { coordinates: [49.2827, -123.1207] },
    { deviceId: "private-device" },
    { udid: "private-udid" },
    { email: "person@example.com" },
    { token: "private-token" },
  ])("rejects non-allowlisted fields: %o", (extra) => {
    expect(crashSchema.safeParse({ ...validReport, ...extra }).success).toBe(false);
  });
});

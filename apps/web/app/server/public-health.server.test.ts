import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "./public-health.server";

describe("public web health payload", () => {
  it("reports development as healthy but not release-ready", () => {
    expect(
      buildHealthPayload({
        status: "development",
        version: "0.0.0",
        supportedIosBuilds: [],
        billingEnabled: false,
        monthlyPriceLabel: "Not configured",
        yearlyPriceLabel: "Not configured",
        downloads: {},
      }),
    ).toEqual({
      ok: true,
      service: "enigma-web",
      releaseStatus: "development",
      releaseVersion: "0.0.0",
      publicReleaseReady: false,
      billingConfigured: false,
      publishedArtifactCount: 0,
    });
  });
});

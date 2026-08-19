import { describe, expect, it } from "vitest";
import { getPublicReleaseConfig, publicReleaseReady } from "./public-config.server";

function environment(overrides: Record<string, string> = {}): Env {
  return overrides as unknown as Env;
}

describe("public release configuration", () => {
  it("fails closed when production values are absent", () => {
    const config = getPublicReleaseConfig(environment());
    expect(config).toEqual({
      status: "development",
      version: "0.0.0",
      supportedIosBuilds: [],
      billingEnabled: false,
      monthlyPriceLabel: "Not configured",
      yearlyPriceLabel: "Not configured",
      downloads: {},
    });
    expect(publicReleaseReady(config)).toBe(false);
  });

  it("accepts a complete stable release configuration", () => {
    const config = getPublicReleaseConfig(
      environment({
        PUBLIC_RELEASE_STATUS: "stable",
        PUBLIC_RELEASE_VERSION: "1.0.0",
        PUBLIC_SUPPORTED_IOS_BUILDS: "27.0 (24A123), 27.0 (24A124)",
        PUBLIC_BILLING_ENABLED: "true",
        PUBLIC_MONTHLY_PRICE_LABEL: "$12 / month",
        PUBLIC_YEARLY_PRICE_LABEL: "$99 / year",
        PUBLIC_MACOS_ARM64_DOWNLOAD_URL:
          "https://releases.enigma.example/stable/1.0.0/enigma-aarch64.dmg",
        PUBLIC_MACOS_X64_DOWNLOAD_URL:
          "https://releases.enigma.example/stable/1.0.0/enigma-x86_64.dmg",
        PUBLIC_WINDOWS_X64_DOWNLOAD_URL:
          "https://releases.enigma.example/stable/1.0.0/enigma-x64.exe",
      }),
    );
    expect(publicReleaseReady(config)).toBe(true);
    expect(config.supportedIosBuilds).toHaveLength(2);
  });

  it("drops download URLs outside the dedicated release origin", () => {
    const config = getPublicReleaseConfig(
      environment({
        PUBLIC_MACOS_ARM64_DOWNLOAD_URL: "https://example.com/file.dmg?latitude=49.2",
      }),
    );
    expect(config.downloads).toEqual({});
  });
});

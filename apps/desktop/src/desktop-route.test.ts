import { describe, expect, it } from "vitest";
import { desktopRouteFromHash, desktopRouteHash } from "./desktop-route";

describe("desktop route", () => {
  it("maps the settings hash to the dedicated settings page", () => {
    expect(desktopRouteFromHash("#/settings")).toBe("settings");
    expect(desktopRouteFromHash("#/settings/")).toBe("settings");
  });

  it("falls back to the workspace and produces stable route hashes", () => {
    expect(desktopRouteFromHash("")).toBe("workspace");
    expect(desktopRouteFromHash("#/unknown")).toBe("workspace");
    expect(desktopRouteHash("workspace")).toBe("#/");
    expect(desktopRouteHash("settings")).toBe("#/settings");
  });
});

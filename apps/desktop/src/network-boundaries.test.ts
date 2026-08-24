import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("standalone desktop network boundary", () => {
  it("allows only direct map providers in the webview CSP", async () => {
    const configuration = JSON.parse(
      await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    );
    const csp = String(configuration.app.security.csp);
    expect(csp).toContain("https://api.mapbox.com");
    expect(csp).not.toContain("openfreemap.org");
    expect(csp).not.toMatch(/api\.enigma|maps\.enigma|map-gateway|r2|pmtiles/u);
  });

  it("contains no crash uploader or first-party API call in the application shell", async () => {
    const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/fetch\(|crash report|VITE_CRASH|VITE_ACCOUNT|entitlement/u);
  });
});

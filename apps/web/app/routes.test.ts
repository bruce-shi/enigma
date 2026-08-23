import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import routes from "./routes";

describe("landing-only website", () => {
  it("exports only the index route", () => {
    expect(routes).toHaveLength(1);
    expect(JSON.stringify(routes)).not.toMatch(/api|account|auth|dashboard|pricing/u);
  });

  it("declares no application bindings or observability", async () => {
    const configuration = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(configuration).not.toMatch(/d1_databases|r2_buckets|send_email|observability|vars/u);
  });

  it("does not persist landing-page state or theme preferences", async () => {
    const sources = await Promise.all(
      ["./root.tsx", "./components/SiteShell.tsx", "./routes/home.tsx"].map((path) =>
        readFile(new URL(path, import.meta.url), "utf8"),
      ),
    );
    expect(sources.join("\n")).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|ScrollRestoration/u,
    );
  });
});

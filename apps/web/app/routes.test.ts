import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  documentationPages,
  getDocumentationPage,
  requireDocumentationPage,
  rewriteDocumentationLink,
} from "./docs";
import routes from "./routes";

describe("public website", () => {
  it("exports the landing page and nested documentation routes", () => {
    expect(routes).toHaveLength(2);
    expect(JSON.stringify(routes)).toMatch(/docs-page|:slug/u);
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

  it("leads with product capabilities instead of license or signup messaging", async () => {
    const sources = await Promise.all(
      ["./root.tsx", "./components/SiteShell.tsx", "./routes/home.tsx"].map((path) =>
        readFile(new URL(path, import.meta.url), "utf8"),
      ),
    );
    const copy = sources.join("\n");
    expect(copy).not.toMatch(/GPL-3\.0|without an account|no (?:Enigma )?account/u);
    expect(copy).toMatch(/Teleport|Build a route|Steer with a joystick|Replay GPX/u);
  });

  it("publishes only the curated documentation set with unique routes and sources", () => {
    expect(documentationPages.map((page) => page.path)).toEqual([
      "/docs",
      "/docs/desktop-setup",
      "/docs/embedded-setup",
      "/docs/compatibility",
      "/docs/troubleshooting",
      "/docs/privacy",
    ]);
    expect(new Set(documentationPages.map((page) => page.path)).size).toBe(
      documentationPages.length,
    );
    expect(new Set(documentationPages.map((page) => page.source)).size).toBe(
      documentationPages.length,
    );
    expect(documentationPages.map((page) => page.source)).not.toContain(
      "docs/release-hardening.md",
    );
  });

  it("rewrites public Markdown links to website routes", () => {
    expect(rewriteDocumentationLink("desktop-setup.md")).toBe("/docs/desktop-setup");
    expect(rewriteDocumentationLink("docs/privacy-and-reliability.md#local-boundaries")).toBe(
      "/docs/privacy#local-boundaries",
    );
    expect(rewriteDocumentationLink("release-hardening.md")).toBe(
      "https://github.com/bruce-shi/enigma/blob/main/docs/release-hardening.md",
    );
    expect(rewriteDocumentationLink("https://example.com/guide")).toBe("https://example.com/guide");
  });

  it("keeps raw HTML disabled in rendered Markdown", async () => {
    const renderer = await readFile(
      new URL("./components/MarkdownArticle.tsx", import.meta.url),
      "utf8",
    );
    expect(renderer).toMatch(/skipHtml/u);
    expect(renderer).not.toMatch(/rehypeRaw|dangerouslySetInnerHTML/u);
  });

  it("turns unknown documentation slugs into a real 404 response", () => {
    expect(getDocumentationPage("missing")).toBeUndefined();
    try {
      requireDocumentationPage("missing");
      throw new Error("Expected requireDocumentationPage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(404);
    }
  });
});

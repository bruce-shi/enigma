import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./http.server";

const env = { PUBLIC_ORIGIN: "https://enigma.example" } as Env;

describe("browser mutation origin checks", () => {
  it("allows the configured website origin", () => {
    const request = new Request("https://enigma.example/api/desktop/activations", {
      headers: { origin: "https://enigma.example" },
    });

    expect(() => assertSameOrigin(request, env)).not.toThrow();
  });

  it("rejects a cross-origin browser request", () => {
    const request = new Request("https://enigma.example/api/desktop/activations", {
      headers: { origin: "https://attacker.example" },
    });

    try {
      assertSameOrigin(request, env);
      throw new Error("expected the origin check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(403);
    }
  });
});

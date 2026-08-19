import type { CrashReportSubmission } from "@enigma/contracts";
import { describe, expect, it, vi } from "vitest";
import { assertCrashReportPrivacy, createCrashReport, submitCrashReport } from "./privacy";

describe("desktop privacy boundary", () => {
  it("constructs an allowlisted crash report without stack paths or device data", () => {
    const report = createCrashReport(
      new Error("could not connect to the selected private device"),
      "connecting",
      new Date("2026-08-18T20:00:00.000Z"),
    );
    expect(report).toEqual({
      schemaVersion: 1,
      appVersion: "0.0.0",
      platform: "macos",
      osVersion: "not-collected",
      errorCode: "NETWORK_OPERATION_FAILED",
      stackFrames: [],
      coarseState: "connecting",
      occurredAt: "2026-08-18T20:00:00.000Z",
    });
    expect(JSON.stringify(report)).not.toContain("private device");
  });

  it("performs no network request without consent and authenticated configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const report = createCrashReport(new Error("boom"), "error");
    await expect(
      submitCrashReport({
        consent: false,
        endpoint: "https://enigma.example/api/crashes",
        accessToken: "secret",
        report,
        fetcher,
      }),
    ).resolves.toBe("disabled");
    await expect(
      submitCrashReport({
        consent: true,
        endpoint: "https://enigma.example/api/crashes",
        report,
        fetcher,
      }),
    ).resolves.toBe("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only the allowlisted report to a query-free HTTPS endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const report = createCrashReport(new Error("boom"), "error");
    await expect(
      submitCrashReport({
        consent: true,
        endpoint: "https://enigma.example/api/crashes",
        accessToken: "access-token",
        report,
        fetcher,
      }),
    ).resolves.toBe("sent");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://enigma.example/api/crashes");
    expect(JSON.parse(String(init?.body))).toEqual(report);
  });

  it("rejects accidental location or identifier fields", () => {
    const unsafe = {
      ...createCrashReport(new Error("boom"), "error"),
      latitude: 49.2827,
      nested: { udid: "private" },
    } as CrashReportSubmission;
    expect(() => assertCrashReportPrivacy(unsafe)).toThrow(/forbidden field/u);
  });
});

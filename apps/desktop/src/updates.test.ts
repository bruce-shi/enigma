import { describe, expect, it } from "vitest";
import { evaluateUpdateInstall, updaterConfigured } from "./updates";

describe("desktop update safety", () => {
  it("allows installation only when the simulation is idle and recovery is clear", () => {
    expect(evaluateUpdateInstall({ dirtySession: false, simulationState: "idle" })).toEqual({
      allowed: true,
    });
  });

  it.each(["starting", "running", "paused", "stopping", "restore_required", "error"] as const)(
    "blocks installation while simulation state is %s",
    (simulationState) => {
      expect(evaluateUpdateInstall({ dirtySession: false, simulationState })).toEqual({
        allowed: false,
        reason: "Stop and restore the current session before installing an update.",
      });
    },
  );

  it("treats the durable dirty marker as authoritative even if the worker is idle", () => {
    expect(evaluateUpdateInstall({ dirtySession: true, simulationState: "idle" })).toEqual({
      allowed: false,
      reason: "Restore the iPhone's real location before installing an update.",
    });
  });

  it("keeps unsigned development builds disconnected from updater endpoints", () => {
    expect(updaterConfigured()).toBe(false);
  });
});

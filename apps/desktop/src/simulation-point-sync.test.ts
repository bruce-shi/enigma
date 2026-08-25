import { describe, expect, it } from "vitest";
import { shouldSyncSnapshotPoint } from "./simulation-point-sync";

describe("simulation point synchronization", () => {
  it("does not overwrite a new selection with the last teleported point", () => {
    expect(shouldSyncSnapshotPoint("restore_required", "teleport", "teleport")).toBe(false);
  });

  it("tracks the point for a visible moving simulation", () => {
    expect(shouldSyncSnapshotPoint("running", "route", "route")).toBe(true);
    expect(shouldSyncSnapshotPoint("paused", "joystick", "joystick")).toBe(true);
  });

  it("does not overwrite an editor for another mode or a finished simulation", () => {
    expect(shouldSyncSnapshotPoint("running", "route", "teleport")).toBe(false);
    expect(shouldSyncSnapshotPoint("restore_required", "route", "route")).toBe(false);
  });
});

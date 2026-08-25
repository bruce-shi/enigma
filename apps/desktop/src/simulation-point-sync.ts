import type { SimulationState } from "@enigma/contracts";

export type EditorMode = "teleport" | "route" | "joystick" | "gpx";

export function shouldSyncSnapshotPoint(
  state: SimulationState,
  activeMode: EditorMode | undefined,
  visibleMode: EditorMode,
): boolean {
  return (
    activeMode !== undefined &&
    activeMode !== "teleport" &&
    activeMode === visibleMode &&
    (state === "running" || state === "paused")
  );
}

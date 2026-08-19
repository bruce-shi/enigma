import type { SimulationState } from "@enigma/contracts";

export interface DesktopUpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface UpdateInstallGate {
  allowed: boolean;
  reason?: string;
}

type PendingUpdate = NonNullable<
  Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater")["check"]>>
>;

let pendingUpdate: PendingUpdate | null = null;

export function updaterConfigured(): boolean {
  return import.meta.env.VITE_UPDATER_READY === "true";
}

export function evaluateUpdateInstall({
  dirtySession,
  simulationState,
}: {
  dirtySession: boolean;
  simulationState: SimulationState;
}): UpdateInstallGate {
  if (dirtySession) {
    return {
      allowed: false,
      reason: "Restore the iPhone's real location before installing an update.",
    };
  }
  if (simulationState !== "idle") {
    return {
      allowed: false,
      reason: "Stop and restore the current session before installing an update.",
    };
  }
  return { allowed: true };
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdateInfo | null> {
  if (!("__TAURI_INTERNALS__" in globalThis) || !updaterConfigured()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  pendingUpdate?.close();
  pendingUpdate = await check({ timeout: 30_000 });
  if (!pendingUpdate) return null;
  return {
    version: pendingUpdate.version,
    ...(pendingUpdate.date ? { date: pendingUpdate.date } : {}),
    ...(pendingUpdate.body ? { body: pendingUpdate.body } : {}),
  };
}

export async function installPendingUpdate({
  dirtySession,
  simulationState,
  onProgress,
}: {
  dirtySession: boolean;
  simulationState: SimulationState;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const gate = evaluateUpdateInstall({ dirtySession, simulationState });
  if (!gate.allowed) throw new Error(gate.reason);
  if (!pendingUpdate) throw new Error("Check for an update before installing it.");
  let downloaded = 0;
  let total: number | undefined;
  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength;
      onProgress?.(total ? `Downloading 0 of ${total} bytes` : "Downloading update");
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(total ? `Downloading ${downloaded} of ${total} bytes` : "Downloading update");
    } else if (event.event === "Finished") {
      onProgress?.("Update installed. Quit and reopen Enigma to finish.");
    }
  });
  pendingUpdate.close();
  pendingUpdate = null;
}

import type {
  Coordinate,
  DeviceSummary,
  SimulationPlan,
  SimulationSnapshot,
} from "@enigma/contracts";

export interface LocalPlanRecord {
  id: string;
  name: string;
  createdAt: string;
  plan: SimulationPlan;
}

export type SavedPlanKind = "favorite" | "history";

const inTauri = () => "__TAURI_INTERNALS__" in globalThis;
let mockSnapshot: SimulationSnapshot = { state: "idle", progress: 0, elapsedMs: 0 };
const mockHistory: LocalPlanRecord[] = [];
const mockFavorites: LocalPlanRecord[] = [];
let mockCrashReportingConsent = false;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri()) {
    const api = await import("@tauri-apps/api/core");
    return api.invoke<T>(command, args);
  }
  return browserMock<T>(command, args);
}

async function browserMock<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  switch (command) {
    case "list_devices":
      return [
        {
          id: "browser-preview",
          name: "Browser preview iPhone",
          model: "iPhone",
          osVersion: "27.0",
          transport: "network",
          state: "ready",
        },
        {
          id: "browser-preview-ios26",
          name: "Unqualified iOS preview",
          model: "iPhone",
          osVersion: "26.5.2",
          transport: "network",
          state: "ready",
        },
        {
          id: "browser-preview-usb",
          name: "Unqualified USB preview",
          model: "iPhone",
          osVersion: "27.0",
          transport: "usb",
          state: "ready",
        },
      ] as T;
    case "connect_device":
      return {
        id: String(args?.deviceId ?? "browser-preview"),
        name: "Browser preview iPhone",
        model: "iPhone",
        osVersion: "27.0",
        transport: "network",
        state: "ready",
      } as T;
    case "get_simulation_snapshot":
      return mockSnapshot as T;
    case "set_location":
      mockSnapshot = {
        state: "running",
        point: args?.point as Coordinate,
        progress: 1,
        elapsedMs: 0,
      };
      return undefined as T;
    case "start_simulation": {
      const plan = args?.plan as SimulationPlan;
      const point =
        plan.kind === "teleport"
          ? plan.point
          : plan.kind === "joystick"
            ? plan.origin
            : plan.points[0];
      mockSnapshot = { state: "running", point, progress: 0, elapsedMs: 0 };
      mockHistory.unshift({
        id: crypto.randomUUID(),
        name: plan.kind === "gpx" ? "GPX route" : plan.kind === "path" ? "Route" : plan.kind,
        createdAt: new Date().toISOString(),
        plan,
      });
      return undefined as T;
    }
    case "control_simulation":
      mockSnapshot = {
        ...mockSnapshot,
        state:
          args?.action === "pause"
            ? "paused"
            : args?.action === "stop"
              ? "restore_required"
              : "running",
      };
      return undefined as T;
    case "clear_location":
      mockSnapshot = { state: "idle", progress: 0, elapsedMs: 0 };
      return undefined as T;
    case "list_history":
      return mockHistory as T;
    case "list_favorites":
      return mockFavorites as T;
    case "save_favorite": {
      const favorite = {
        id: crypto.randomUUID(),
        name: String(args?.name ?? "Favorite"),
        createdAt: new Date().toISOString(),
        plan: args?.plan as SimulationPlan,
      };
      mockFavorites.unshift(favorite);
      return favorite as T;
    }
    case "delete_saved_plan": {
      const records = args?.kind === "favorite" ? mockFavorites : mockHistory;
      const index = records.findIndex((record) => record.id === args?.id);
      if (index >= 0) records.splice(index, 1);
      return undefined as T;
    }
    case "has_dirty_session":
      return false as T;
    case "get_crash_reporting_consent":
      return mockCrashReportingConsent as T;
    case "set_crash_reporting_consent":
      mockCrashReportingConsent = Boolean(args?.consent);
      return undefined as T;
    case "export_diagnostics":
      return JSON.stringify(
        {
          schemaVersion: 1,
          appVersion: "0.0.0-browser-preview",
          platform: "browser-preview",
          architecture: "unknown",
          simulationState: mockSnapshot.state,
          connection: {
            validatedPath: "macos_ios27_same_lan",
            networkDeviceCount: 2,
            qualifiedNetworkDeviceCount: 1,
            usbDeviceCount: 1,
            usbQualification: "deferred",
          },
          containsLocationData: false,
          containsDeviceIdentifiers: false,
        },
        null,
        2,
      ) as T;
    case "get_host_location":
      return browserGeolocation() as Promise<T>;
    default:
      return (args ?? null) as T;
  }
}

function browserGeolocation(): Promise<Coordinate> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Computer location is unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => reject(new Error("Computer location permission was denied or is unavailable")),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  });
}

export const desktopApi = {
  listDevices: () => invoke<DeviceSummary[]>("list_devices"),
  connectDevice: (deviceId: string) => invoke<DeviceSummary>("connect_device", { deviceId }),
  disconnectDevice: () => invoke<void>("disconnect_device"),
  getHostLocation: async () => {
    try {
      return await invoke<Coordinate>("get_host_location");
    } catch {
      return browserGeolocation();
    }
  },
  setLocation: (point: Coordinate) => invoke<void>("set_location", { point }),
  startSimulation: (plan: SimulationPlan) => invoke<void>("start_simulation", { plan }),
  controlSimulation: (action: "pause" | "resume" | "restart" | "stop") =>
    invoke<void>("control_simulation", { action }),
  updateJoystickHeading: (headingDegrees: number) =>
    invoke<void>("update_joystick_heading", { headingDegrees }),
  clearLocation: () => invoke<void>("clear_location"),
  getSimulationSnapshot: () => invoke<SimulationSnapshot>("get_simulation_snapshot"),
  latestHistory: () => invoke<SimulationPlan | null>("latest_history"),
  listHistory: () => invoke<LocalPlanRecord[]>("list_history"),
  listFavorites: () => invoke<LocalPlanRecord[]>("list_favorites"),
  saveFavorite: (name: string, plan: SimulationPlan) =>
    invoke<LocalPlanRecord>("save_favorite", { name, plan }),
  deleteSavedPlan: (id: string, kind: SavedPlanKind) =>
    invoke<void>("delete_saved_plan", { id, kind }),
  exportDiagnostics: () => invoke<string>("export_diagnostics"),
  getCrashReportingConsent: () => invoke<boolean>("get_crash_reporting_consent"),
  setCrashReportingConsent: (consent: boolean) =>
    invoke<void>("set_crash_reporting_consent", { consent }),
  hasDirtySession: () => invoke<boolean>("has_dirty_session"),
  recoverDirtySession: (choice: "restore" | "keep") =>
    invoke<void>("recover_dirty_session", { choice }),
  resolveExit: (choice: "restore" | "keep" | "cancel") => invoke<void>("resolve_exit", { choice }),
};

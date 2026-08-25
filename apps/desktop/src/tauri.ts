import type {
  Coordinate,
  DeviceSummary,
  RouteOptions,
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

export interface ProvisioningResult {
  boardPort: string;
  pairingFingerprint: string;
  pairingBytes: number;
}

const inTauri = () => "__TAURI_INTERNALS__" in globalThis;
let mockSnapshot: SimulationSnapshot = { state: "idle", progress: 0, elapsedMs: 0 };
const mockHistory: LocalPlanRecord[] = [];
const mockFavorites: LocalPlanRecord[] = [];
let mockMapboxAccessToken: string | undefined;
const browserPreviewDevices: DeviceSummary[] = [
  {
    id: "browser-preview",
    name: "Browser preview iPhone",
    model: "iPhone",
    osVersion: "27.0",
    transport: "network",
    state: "ready",
  },
  {
    id: "browser-preview-ios18",
    name: "Wi-Fi beta iPhone",
    model: "iPhone",
    osVersion: "18.7.10",
    transport: "network",
    state: "ready",
  },
  {
    id: "browser-preview-usb",
    name: "USB preview iPhone",
    model: "iPhone",
    osVersion: "27.0",
    transport: "usb",
    state: "ready",
  },
];

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
      return browserPreviewDevices as T;
    case "connect_device":
      return (browserPreviewDevices.find((device) => device.id === args?.deviceId) ??
        browserPreviewDevices[0]) as T;
    case "provision_embedded":
      return {
        boardPort: "/dev/cu.wchusbserial-preview",
        pairingFingerprint: "0123456789ab",
        pairingBytes: 8192,
      } as T;
    case "enable_desktop_wifi":
      return undefined as T;
    case "get_simulation_snapshot":
      return mockSnapshot as T;
    case "set_location":
      mockSnapshot = {
        state: "restore_required",
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
      mockSnapshot = {
        state: plan.kind === "teleport" ? "restore_required" : "running",
        point,
        progress: plan.kind === "teleport" ? 1 : 0,
        elapsedMs: 0,
      };
      mockHistory.unshift({
        id: crypto.randomUUID(),
        name: plan.kind === "gpx" ? "GPX route" : plan.kind === "path" ? "Route" : plan.kind,
        createdAt: new Date().toISOString(),
        plan,
      });
      return undefined as T;
    }
    case "extend_route_simulation":
      return undefined as T;
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
    case "get_mapbox_access_token":
      return mockMapboxAccessToken as T;
    case "set_mapbox_access_token":
      mockMapboxAccessToken = typeof args?.token === "string" ? args.token : undefined;
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
  provisionEmbedded: (deviceId: string) =>
    invoke<ProvisioningResult>("provision_embedded", { deviceId }),
  enableDesktopWifi: (deviceId: string) => invoke<void>("enable_desktop_wifi", { deviceId }),
  getHostLocation: async () => {
    try {
      return await invoke<Coordinate>("get_host_location");
    } catch {
      return browserGeolocation();
    }
  },
  setLocation: (point: Coordinate) => invoke<void>("set_location", { point }),
  startSimulation: (plan: SimulationPlan) => invoke<void>("start_simulation", { plan }),
  extendRouteSimulation: (points: Coordinate[], options: RouteOptions) =>
    invoke<void>("extend_route_simulation", { points, options }),
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
  getMapboxAccessToken: () => invoke<string | null>("get_mapbox_access_token"),
  setMapboxAccessToken: (token?: string) =>
    invoke<void>("set_mapbox_access_token", { token: token || null }),
  hasDirtySession: () => invoke<boolean>("has_dirty_session"),
  recoverDirtySession: (choice: "restore" | "keep") =>
    invoke<void>("recover_dirty_session", { choice }),
  resolveExit: (choice: "restore" | "keep" | "cancel") => invoke<void>("resolve_exit", { choice }),
};

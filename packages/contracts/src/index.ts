type DeviceTransport = "usb" | "network";

export type DeviceState =
  | "disconnected"
  | "connecting"
  | "needs_driver"
  | "needs_trust"
  | "needs_developer_mode"
  | "preparing"
  | "ready"
  | "simulating"
  | "error";

export interface Coordinate {
  latitude: number;
  longitude: number;
  altitudeMeters?: number;
  timestamp?: string;
}

export interface DeviceSummary {
  /** Session-scoped opaque identifier. Never persist or log an Apple UDID. */
  id: string;
  name: string;
  model?: string;
  osVersion?: string;
  osBuild?: string;
  transport: DeviceTransport;
  state: DeviceState;
  diagnosticCode?: DeviceDiagnosticCode;
}

type DeviceDiagnosticCode =
  | "APPLE_DRIVER_MISSING"
  | "DEVICE_NOT_TRUSTED"
  | "DEVELOPER_MODE_DISABLED"
  | "DEVELOPER_SERVICE_UNAVAILABLE"
  | "PAIR_RECORD_MISSING"
  | "NETWORK_DEVICE_UNREACHABLE"
  | "NO_DEVICE"
  | "UNKNOWN";

type SpeedProfile = "constant" | "natural";

export interface RouteOptions {
  speedKph: number;
  speedProfile: SpeedProfile;
  repetitions: number;
  roundTrip: boolean;
  updateIntervalMs: 1000;
  naturalVariationSeed?: number;
}

interface TeleportPlan {
  kind: "teleport";
  point: Coordinate;
}

export interface PathPlan {
  kind: "path" | "gpx";
  points: Coordinate[];
  options: RouteOptions;
  honorTimestamps?: boolean;
}

interface JoystickPlan {
  kind: "joystick";
  origin: Coordinate;
  speedKph: number;
  headingDegrees: number;
}

export type SimulationPlan = TeleportPlan | PathPlan | JoystickPlan;

export type SimulationState =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "stopping"
  | "restore_required"
  | "error";

export interface SimulationSnapshot {
  state: SimulationState;
  point?: Coordinate;
  progress: number;
  elapsedMs: number;
  remainingMs?: number;
  error?: string;
}

export const LOCATION_LIMITS = {
  minLatitude: -90,
  maxLatitude: 90,
  minLongitude: -180,
  maxLongitude: 180,
  minSpeedKph: 0.4,
  maxSpeedKph: 108,
  maxGpxBytes: 10 * 1024 * 1024,
  maxGpxPoints: 100_000,
  maxRouteSamples: 100_000,
} as const;

import type { CrashReportSubmission, DeviceState, SimulationState } from "@enigma/contracts";

export type CrashDeliveryResult = "disabled" | "not_configured" | "sent" | "failed";

const forbiddenKeys = new Set([
  "altitude",
  "altitudeMeters",
  "coordinate",
  "coordinates",
  "deviceId",
  "email",
  "latitude",
  "longitude",
  "name",
  "token",
  "udid",
]);

export function classifyCrashError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("trust") || message.includes("pair")) return "DEVICE_PAIRING_FAILED";
  if (message.includes("developer mode")) return "DEVELOPER_MODE_UNAVAILABLE";
  if (message.includes("service") || message.includes("location")) return "LOCATION_SERVICE_FAILED";
  if (message.includes("network") || message.includes("connect")) return "NETWORK_OPERATION_FAILED";
  if (message.includes("storage") || message.includes("database") || message.includes("encrypt"))
    return "LOCAL_STORAGE_FAILED";
  return "DESKTOP_OPERATION_FAILED";
}

export function createCrashReport(
  error: unknown,
  coarseState: DeviceState | SimulationState,
  occurredAt = new Date(),
): CrashReportSubmission {
  return {
    schemaVersion: 1,
    appVersion: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
    platform: desktopPlatform(),
    osVersion: "not-collected",
    errorCode: classifyCrashError(error),
    stackFrames: [],
    coarseState,
    occurredAt: occurredAt.toISOString(),
  };
}

export function assertCrashReportPrivacy(report: CrashReportSubmission): void {
  visit(report as unknown, "report");
}

export async function submitCrashReport({
  consent,
  endpoint,
  accessToken,
  report,
  fetcher = fetch,
}: {
  consent: boolean;
  endpoint?: string;
  accessToken?: string;
  report: CrashReportSubmission;
  fetcher?: typeof fetch;
}): Promise<CrashDeliveryResult> {
  if (!consent) return "disabled";
  if (!endpoint || !accessToken || !safeCrashEndpoint(endpoint)) return "not_configured";
  assertCrashReportPrivacy(report);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(report),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

function safeCrashEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.endsWith("/api/crashes")
    );
  } catch {
    return false;
  }
}

function desktopPlatform(): "macos" | "windows" {
  if (typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")) {
    return "windows";
  }
  return "macos";
}

function visit(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) visit(entry, `${path}[${index}]`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.has(key))
      throw new Error(`crash report contains forbidden field ${path}.${key}`);
    visit(entry, `${path}.${key}`);
  }
}

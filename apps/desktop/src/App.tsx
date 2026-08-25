import type {
  Coordinate,
  DeviceSummary,
  RouteOptions,
  RoutingProfile,
  SimulationPlan,
  SimulationSnapshot,
} from "@enigma/contracts";
import { LOCATION_LIMITS } from "@enigma/contracts";
import {
  AppShell,
  ConfirmExitDialog,
  DeviceStatus,
  EmptyState,
  FormField,
  RoutePanel,
  Surface,
} from "@enigma/ui";
import { Button } from "@heroui/react";
import {
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Download,
  Gamepad2,
  LoaderCircle,
  LocateFixed,
  MapPinPlus,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Settings2,
  Square,
  Star,
  Trash2,
  Undo2,
  Upload,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DesktopRoute, desktopRouteFromHash, desktopRouteHash } from "./desktop-route";
import { LocationSearch } from "./LocationSearch";
import { MapView } from "./MapView";
import { mapboxAccessTokenConfigured } from "./mapbox-access-token";
import { MAX_MAPBOX_WAYPOINTS, requestMapboxRoute } from "./mapbox-directions";
import { SettingsPage } from "./SettingsPage";
import { desktopApi, type LocalPlanRecord, type SavedPlanKind } from "./tauri";
import {
  checkForDesktopUpdate,
  type DesktopUpdateInfo,
  evaluateUpdateInstall,
  installPendingUpdate,
  updaterConfigured,
} from "./updates";
import {
  exportGpx,
  formatDistance,
  formatDuration,
  parseCoordinateText,
  parseGpx,
  planPoints,
  routeMetrics,
  suggestedSpeedKph,
} from "./workflows";

type EditorMode = "teleport" | "route" | "joystick" | "gpx";
type SidebarTab = "devices" | "library";
type ProvisioningStatus = {
  tone: "pending" | "success" | "error";
  message: string;
  operation?: "desktop" | "board";
};

const defaultSnapshot: SimulationSnapshot = {
  state: "idle",
  progress: 0,
  elapsedMs: 0,
};

const modes: Array<{ id: EditorMode; label: string; icon: typeof MapPinPlus }> = [
  { id: "teleport", label: "Teleport", icon: MapPinPlus },
  { id: "route", label: "Route", icon: RouteIcon },
  { id: "joystick", label: "Joystick", icon: Gamepad2 },
  { id: "gpx", label: "GPX", icon: Upload },
];

export function App() {
  const [route, setRoute] = useState<DesktopRoute>(() =>
    desktopRouteFromHash(globalThis.location.hash),
  );
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selected, setSelected] = useState<DeviceSummary>();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("devices");
  const [point, setPoint] = useState<Coordinate>();
  const [mapCenter, setMapCenter] = useState<Coordinate & { zoom?: number }>();
  const [routePoints, setRoutePoints] = useState<Coordinate[]>([]);
  const [routeWaypoints, setRouteWaypoints] = useState<Coordinate[]>([]);
  const [routingProfile, setRoutingProfile] = useState<RoutingProfile>("driving");
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string>();
  const [mapError, setMapError] = useState<string>();
  const [mode, setMode] = useState<EditorMode>("teleport");
  const [activeMode, setActiveMode] = useState<EditorMode>();
  const [speedKph, setSpeedKph] = useState(() => suggestedSpeedKph("driving"));
  const [speedProfile, setSpeedProfile] = useState<"constant" | "natural">("constant");
  const [repetitions, setRepetitions] = useState(1);
  const [roundTrip, setRoundTrip] = useState(false);
  const [gpxName, setGpxName] = useState<string>();
  const [favoriteName, setFavoriteName] = useState("");
  const [favorites, setFavorites] = useState<LocalPlanRecord[]>([]);
  const [history, setHistory] = useState<LocalPlanRecord[]>([]);
  const [snapshot, setSnapshot] = useState(defaultSnapshot);
  const [dirtySession, setDirtySession] = useState(false);
  const [startupRecoveryPending, setStartupRecoveryPending] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [provisioningStatus, setProvisioningStatus] = useState<ProvisioningStatus>();
  const [mapboxAccessToken, setMapboxAccessToken] = useState<string>();
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdateInfo>();
  const [updateMessage, setUpdateMessage] = useState<string>();
  const joystickMovementRef = useRef<Promise<boolean> | undefined>(undefined);
  const routedRouteRef = useRef<{
    waypoints: Coordinate[];
    profile: RoutingProfile;
  }>(undefined);

  useEffect(() => {
    const syncRoute = () => setRoute(desktopRouteFromHash(globalThis.location.hash));
    globalThis.addEventListener("hashchange", syncRoute);
    return () => globalThis.removeEventListener("hashchange", syncRoute);
  }, []);

  const navigate = useCallback((next: DesktopRoute) => {
    const hash = desktopRouteHash(next);
    if (globalThis.location.hash === hash) {
      setRoute(next);
    } else {
      globalThis.location.hash = hash;
    }
  }, []);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    try {
      setBusy(true);
      setError(undefined);
      return await operation();
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const runAction = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    try {
      setBusy(true);
      setError(undefined);
      await operation();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const next = await run(desktopApi.listDevices);
    if (!next) return;
    setDevices(next);
    setSelected((current) =>
      current ? next.find((device) => device.id === current.id) : undefined,
    );
  }, [run]);

  const refreshLibrary = useCallback(async () => {
    const result = await run(() =>
      Promise.all([desktopApi.listFavorites(), desktopApi.listHistory()]),
    );
    if (!result) return;
    setFavorites(result[0]);
    setHistory(result[1]);
  }, [run]);

  useEffect(() => {
    void refreshDevices();
    void refreshLibrary();
    void desktopApi
      .hasDirtySession()
      .then((dirty) => {
        setDirtySession(dirty);
        setStartupRecoveryPending(dirty);
      })
      .catch(() => undefined);
    void desktopApi
      .getMapboxAccessToken()
      .then((token) => setMapboxAccessToken(token ?? undefined))
      .catch(() => undefined);
  }, [refreshDevices, refreshLibrary]);

  useEffect(() => {
    if (mode !== "route") {
      setRoutingLoading(false);
      setRoutingError(undefined);
      return;
    }
    setRoutingError(undefined);
    if (routeWaypoints.length < 2) {
      routedRouteRef.current = { waypoints: routeWaypoints, profile: routingProfile };
      setRoutePoints(routeWaypoints);
      setRoutingLoading(false);
      return;
    }
    if (
      routedRouteRef.current?.profile === routingProfile &&
      sameCoordinates(routedRouteRef.current.waypoints, routeWaypoints)
    ) {
      setRoutingLoading(false);
      return;
    }
    setRoutePoints(routeWaypoints);
    if (!mapboxAccessTokenConfigured(mapboxAccessToken)) {
      setRoutingLoading(false);
      setRoutingError("Add a Mapbox public token in Settings to calculate road routes");
      return;
    }
    const controller = new AbortController();
    setRoutingLoading(true);
    void requestMapboxRoute({
      waypoints: routeWaypoints,
      profile: routingProfile,
      accessToken: mapboxAccessToken,
      signal: controller.signal,
    })
      .then((points) => {
        if (!controller.signal.aborted) {
          routedRouteRef.current = { waypoints: routeWaypoints, profile: routingProfile };
          setRoutePoints(points);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRoutingError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRoutingLoading(false);
      });
    return () => controller.abort();
  }, [mapboxAccessToken, mode, routeWaypoints, routingProfile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void desktopApi
        .getSimulationSnapshot()
        .then((next) => {
          setSnapshot(next);
          if (next.point) setPoint(next.point);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let unlisten: undefined | (() => void);
    if ("__TAURI_INTERNALS__" in globalThis) {
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        unlisten = await listen("enigma://exit-requested", () => setExitOpen(true));
      });
    }
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (startupRecoveryPending && selected) setRecoveryOpen(true);
  }, [selected, startupRecoveryPending]);

  const options = useMemo<RouteOptions>(
    () => ({
      speedKph,
      speedProfile,
      repetitions,
      roundTrip,
      updateIntervalMs: 1000,
      ...(speedProfile === "natural" ? { naturalVariationSeed: 1 } : {}),
    }),
    [repetitions, roundTrip, speedKph, speedProfile],
  );

  const currentPlan = useMemo<SimulationPlan | null>(() => {
    if (mode === "teleport") return point ? { kind: "teleport", point } : null;
    if (mode === "joystick") {
      return point ? { kind: "joystick", origin: point, speedKph, headingDegrees: 0 } : null;
    }
    if (mode === "route") {
      if (routePoints.length < 2 || routingLoading || routingError) return null;
      return {
        kind: "path",
        points: routePoints,
        waypoints: routeWaypoints,
        routingProfile,
        options,
      };
    }
    if (routePoints.length < 2) return null;
    return { kind: "gpx", points: routePoints, options };
  }, [
    mode,
    options,
    point,
    routePoints,
    routeWaypoints,
    routingError,
    routingLoading,
    routingProfile,
    speedKph,
  ]);

  const metrics = useMemo(
    () =>
      routePoints.length > 1 ? routeMetrics(routePoints, speedKph, repetitions, roundTrip) : null,
    [repetitions, roundTrip, routePoints, speedKph],
  );

  const connect = async (deviceId: string) => {
    const device = await run(() => desktopApi.connectDevice(deviceId));
    if (!device) return;
    setSelected(device);
    if (startupRecoveryPending) setRecoveryOpen(true);
  };

  const provisionBoard = async (deviceId: string) => {
    setBusy(true);
    setError(undefined);
    setProvisioningStatus({
      tone: "pending",
      operation: "board",
      message:
        "Provisioning board… keep the iPhone unlocked, approve Apple's pairing prompt, and close serial monitors.",
    });
    try {
      const result = await desktopApi.provisionEmbedded(deviceId);
      setProvisioningStatus({
        tone: "success",
        message: `Board provisioned on ${result.boardPort} · pairing ${result.pairingFingerprint}`,
      });
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setProvisioningStatus({ tone: "error", message: `Provisioning failed: ${message}` });
    } finally {
      setBusy(false);
    }
  };

  const enableDesktopWifi = async (deviceId: string) => {
    setBusy(true);
    setError(undefined);
    setProvisioningStatus({
      tone: "pending",
      operation: "desktop",
      message: "Enabling desktop Wi-Fi… keep the iPhone unlocked and approve Trust if prompted.",
    });
    try {
      await desktopApi.enableDesktopWifi(deviceId);
      setProvisioningStatus({
        tone: "success",
        message:
          "Desktop Wi-Fi enabled. Put this Mac and iPhone on the same network, disconnect USB, then scan again.",
      });
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setProvisioningStatus({ tone: "error", message: `Wi-Fi setup failed: ${message}` });
    } finally {
      setBusy(false);
    }
  };

  const locateComputer = async () => {
    const location = await run(desktopApi.getHostLocation);
    if (location) setMapCenter(location);
  };

  const startCurrent = useCallback(async () => {
    if (!selected) {
      setError("Select a ready iPhone connected over Wi-Fi before starting a simulation");
      return;
    }
    if (!currentPlan) {
      setError(
        mode === "route" || mode === "gpx"
          ? "Add at least two route points"
          : "Choose a coordinate first",
      );
      return;
    }
    if (!(await runAction(() => desktopApi.startSimulation(currentPlan)))) return;
    setActiveMode(mode);
    setDirtySession(true);
    setSnapshot((current) => ({ ...current, state: "running" }));
    await refreshLibrary();
  }, [currentPlan, mode, refreshLibrary, runAction, selected]);

  const control = useCallback(
    async (action: "pause" | "resume" | "restart" | "stop") => {
      if (!(await runAction(() => desktopApi.controlSimulation(action)))) return false;
      setSnapshot((current) => ({
        ...current,
        state: action === "pause" ? "paused" : action === "stop" ? "restore_required" : "running",
      }));
      return true;
    },
    [runAction],
  );

  const driveJoystick = useCallback(
    async (headingDegrees: number) => {
      if (!selected || !point) {
        setError("Select an iPhone and a starting coordinate first");
        return false;
      }
      if (
        activeMode === "joystick" &&
        (snapshot.state === "running" || snapshot.state === "paused")
      ) {
        if (!(await runAction(() => desktopApi.updateJoystickHeading(headingDegrees))))
          return false;
        if (snapshot.state === "paused" && !(await control("resume"))) return false;
        return true;
      }
      const plan: SimulationPlan = {
        kind: "joystick",
        origin: point,
        speedKph,
        headingDegrees,
      };
      if (!(await runAction(() => desktopApi.startSimulation(plan)))) return false;
      setActiveMode("joystick");
      setDirtySession(true);
      setSnapshot((current) => ({ ...current, state: "running" }));
      await refreshLibrary();
      return true;
    },
    [activeMode, control, point, refreshLibrary, runAction, selected, snapshot.state, speedKph],
  );

  const pressJoystick = useCallback(
    (headingDegrees: number) => {
      const movement = driveJoystick(headingDegrees);
      joystickMovementRef.current = movement;
      return movement;
    },
    [driveJoystick],
  );

  const releaseJoystick = useCallback(async () => {
    const movement = joystickMovementRef.current;
    joystickMovementRef.current = undefined;
    if (movement && (await movement)) await control("pause");
  }, [control]);

  useEffect(() => {
    if (mode !== "joystick") return;
    const headings: Record<string, number> = {
      ArrowUp: 0,
      w: 0,
      ArrowRight: 90,
      d: 90,
      ArrowDown: 180,
      s: 180,
      ArrowLeft: 270,
      a: 270,
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const heading = headings[event.key];
      if (heading === undefined || event.repeat) return;
      event.preventDefault();
      void pressJoystick(heading);
    };
    const keyup = (event: KeyboardEvent) => {
      if (headings[event.key] === undefined) return;
      event.preventDefault();
      void releaseJoystick();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [mode, pressJoystick, releaseJoystick]);

  const restore = async () => {
    if (!selected) {
      setError("Select the previously used iPhone before restoring its real location");
      return;
    }
    if (!(await runAction(desktopApi.clearLocation))) return;
    setSnapshot(defaultSnapshot);
    setActiveMode(undefined);
    setDirtySession(false);
    setStartupRecoveryPending(false);
    setRecoveryOpen(false);
  };

  const recover = async (choice: "restore" | "keep") => {
    if (!(await runAction(() => desktopApi.recoverDirtySession(choice)))) return;
    if (choice === "restore") {
      setSnapshot(defaultSnapshot);
      setActiveMode(undefined);
      setDirtySession(false);
    }
    setStartupRecoveryPending(false);
    setRecoveryOpen(false);
  };

  const loadPlan = (record: LocalPlanRecord) => {
    const nextPoints = planPoints(record.plan);
    setPoint(nextPoints[0]);
    setRoutePoints(record.plan.kind === "path" || record.plan.kind === "gpx" ? nextPoints : []);
    setRouteWaypoints(
      record.plan.kind === "path" ? (record.plan.waypoints ?? routeEndpoints(nextPoints)) : [],
    );
    if (record.plan.kind === "path") {
      setRoutingProfile(record.plan.routingProfile ?? "driving");
    }
    setMode(
      record.plan.kind === "path" ? "route" : record.plan.kind === "gpx" ? "gpx" : record.plan.kind,
    );
    if (record.plan.kind === "path" || record.plan.kind === "gpx") {
      setSpeedKph(record.plan.options.speedKph);
      setSpeedProfile(record.plan.options.speedProfile);
      setRepetitions(record.plan.options.repetitions);
      setRoundTrip(record.plan.options.roundTrip);
    } else if (record.plan.kind === "joystick") {
      setSpeedKph(record.plan.speedKph);
    }
    if (nextPoints[0]) setMapCenter(nextPoints[0]);
  };

  const saveFavorite = async () => {
    if (!currentPlan || !favoriteName.trim()) {
      setError("Name the current point or route before saving it as a favorite");
      return;
    }
    const favorite = await run(() => desktopApi.saveFavorite(favoriteName, currentPlan));
    if (!favorite) return;
    setFavoriteName("");
    await refreshLibrary();
  };

  const deleteSaved = async (record: LocalPlanRecord, kind: SavedPlanKind) => {
    if (!(await runAction(() => desktopApi.deleteSavedPlan(record.id, kind)))) return;
    await refreshLibrary();
  };

  const importGpx = async (file?: File) => {
    if (!file) return;
    try {
      setError(undefined);
      const points = parseGpx(await file.text());
      setRoutePoints(points);
      setRouteWaypoints([]);
      setPoint(points[0]);
      setMapCenter(points[0]);
      setGpxName(file.name.replace(/\.gpx$/iu, ""));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadGpx = () => {
    try {
      const contents = exportGpx(routePoints, gpxName ?? "Enigma route");
      const url = URL.createObjectURL(new Blob([contents], { type: "application/gpx+xml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(gpxName ?? "enigma-route")}.gpx`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadDiagnostics = async () => {
    const contents = await run(desktopApi.exportDiagnostics);
    if (!contents) return;
    downloadTextFile(contents, "enigma-diagnostics.json", "application/json");
  };

  const saveMapboxAccessToken = async (token?: string): Promise<boolean> => {
    if (!(await runAction(() => desktopApi.setMapboxAccessToken(token)))) return false;
    setMapboxAccessToken(token);
    return true;
  };

  const extendRunningRoute = async (next: Coordinate) => {
    const previous = routeWaypoints.at(-1);
    if (!previous) {
      setRoutingError("The running route has no endpoint to extend");
      return;
    }
    if (routingLoading) return;
    setRoutingLoading(true);
    setRoutingError(undefined);
    setError(undefined);
    try {
      const leg = await requestMapboxRoute({
        waypoints: [previous, next],
        profile: routingProfile,
        accessToken: mapboxAccessToken ?? "",
      });
      await desktopApi.extendRouteSimulation(leg, options);
      const nextWaypoints = [...routeWaypoints, next];
      routedRouteRef.current = { waypoints: nextWaypoints, profile: routingProfile };
      setRoutePoints((current) => [...current, ...leg.slice(1)]);
      setRouteWaypoints(nextWaypoints);
    } catch (cause) {
      setRoutingError(errorMessage(cause));
    } finally {
      setRoutingLoading(false);
    }
  };

  const onMapClick = (next: Coordinate) => {
    if (mode === "route") {
      if (routeWaypoints.length >= MAX_MAPBOX_WAYPOINTS) {
        setRoutingError(`Mapbox routes support up to ${MAX_MAPBOX_WAYPOINTS} waypoints`);
        return;
      }
      if (activeMode === "route" && (snapshot.state === "running" || snapshot.state === "paused")) {
        void extendRunningRoute(next);
        return;
      }
      setRouteWaypoints((current) => [...current, next]);
      setPoint(next);
      return;
    }
    setPoint(next);
  };

  const selectMode = (nextMode: EditorMode) => {
    if (nextMode !== mode) {
      if (nextMode === "route") {
        setSpeedKph(suggestedSpeedKph(routingProfile));
      } else if (nextMode === "joystick" || nextMode === "gpx") {
        setSpeedKph(5);
      }
    }
    setMode(nextMode);
  };

  const running = snapshot.state === "running";
  const paused = snapshot.state === "paused";
  const canRestart = activeMode && activeMode !== "teleport";
  const routeTooLong =
    (mode === "route" || mode === "gpx") &&
    Boolean(metrics && metrics.travelTimeMs / 1000 >= LOCATION_LIMITS.maxRouteSamples);
  const updateGate = evaluateUpdateInstall({
    dirtySession,
    simulationState: snapshot.state,
  });

  const checkForUpdates = async () => {
    if (!updaterConfigured()) {
      setUpdateMessage("Update checks are disabled until this build has production signing keys.");
      return;
    }
    const update = await run(checkForDesktopUpdate);
    if (update === undefined) return;
    setAvailableUpdate(update ?? undefined);
    setUpdateMessage(update ? `Enigma ${update.version} is available.` : "Enigma is up to date.");
  };

  const installUpdate = async () => {
    if (!updateGate.allowed) {
      setError(updateGate.reason);
      return;
    }
    const installed = await runAction(() =>
      installPendingUpdate({
        dirtySession,
        simulationState: snapshot.state,
        onProgress: setUpdateMessage,
      }),
    );
    if (installed) setAvailableUpdate(undefined);
  };

  const dialogs = (
    <>
      <ConfirmExitDialog
        onCancel={() => setExitOpen(false)}
        onKeep={() => void runAction(() => desktopApi.resolveExit("keep"))}
        onRestore={() => void runAction(() => desktopApi.resolveExit("restore"))}
        open={exitOpen}
      />
      <ConfirmExitDialog
        cancelLabel="Not now"
        description="Enigma detected an unfinished local session. Select the previously used iPhone and restore it before beginning another simulation. This recovery does not require login or network account access."
        keepLabel="Keep current point"
        onCancel={() => setRecoveryOpen(false)}
        onKeep={() => void recover("keep")}
        onRestore={() => void recover("restore")}
        open={recoveryOpen}
        restoreDisabled={!selected}
        restoreLabel="Restore now"
        title="Recover previous session"
      />
    </>
  );

  if (route === "settings") {
    return (
      <>
        <SettingsPage
          availableUpdate={availableUpdate}
          busy={busy}
          error={error}
          mapboxAccessToken={mapboxAccessToken}
          onBack={() => navigate("workspace")}
          onCheckForUpdates={() => void checkForUpdates()}
          onDownloadDiagnostics={() => void downloadDiagnostics()}
          onInstallUpdate={() => void installUpdate()}
          onSaveMapboxAccessToken={saveMapboxAccessToken}
          updateBlockedReason={updateGate.allowed ? undefined : updateGate.reason}
          updateMessage={updateMessage}
          updaterAvailable={updaterConfigured()}
        />
        {dialogs}
      </>
    );
  }

  return (
    <AppShell
      context={
        selected
          ? `${selected.name} · ${selected.transport === "network" ? "Wi-Fi beta" : "USB unqualified"}`
          : "macOS · local access"
      }
      navigation={
        <Button onPress={() => navigate("settings")} variant="ghost">
          <Settings2 size={16} /> Settings
        </Button>
      }
      actions={
        <>
          <span className="hidden rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success md:inline-flex">
            Local control
          </span>
          <Button isDisabled={busy} onPress={refreshDevices} variant="ghost">
            <RefreshCw size={16} /> Refresh
          </Button>
        </>
      }
    >
      <div className="grid min-h-[calc(100dvh-4rem)] grid-cols-1 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)_20rem] lg:overflow-hidden xl:grid-cols-[22rem_minmax(0,1fr)_22rem]">
        <aside className="border-r border-border bg-surface-secondary/40 p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
          <div
            aria-label="Device and library sections"
            className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm"
            role="tablist"
          >
            <button
              aria-controls="sidebar-devices-panel"
              aria-selected={sidebarTab === "devices"}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
                sidebarTab === "devices"
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
              }`}
              id="sidebar-devices-tab"
              onClick={() => setSidebarTab("devices")}
              role="tab"
              tabIndex={sidebarTab === "devices" ? 0 : -1}
              type="button"
            >
              <Wifi aria-hidden size={15} /> Devices
              {devices.length > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    sidebarTab === "devices" ? "bg-white/20" : "bg-surface-tertiary"
                  }`}
                >
                  {devices.length}
                </span>
              )}
            </button>
            <button
              aria-controls="sidebar-library-panel"
              aria-selected={sidebarTab === "library"}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
                sidebarTab === "library"
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
              }`}
              id="sidebar-library-tab"
              onClick={() => setSidebarTab("library")}
              role="tab"
              tabIndex={sidebarTab === "library" ? 0 : -1}
              type="button"
            >
              <Star aria-hidden size={15} /> Library
            </button>
          </div>

          {sidebarTab === "devices" && (
            <div
              aria-labelledby="sidebar-devices-tab"
              className="mt-4"
              id="sidebar-devices-panel"
              role="tabpanel"
            >
              <RoutePanel title={selected ? "1. iPhone connected" : "1. Connect iPhone"}>
                {selected ? (
                  <div className="mb-4 flex items-start gap-3 rounded-xl bg-success/10 p-3 text-success">
                    <CircleCheck aria-hidden className="mt-0.5 shrink-0" size={18} />
                    <div>
                      <p className="text-sm font-semibold">Connected over Wi-Fi</p>
                      <p className="mt-0.5 text-xs text-success/80">
                        {selected.name} is ready. Choose a location and movement mode.
                      </p>
                    </div>
                  </div>
                ) : (
                  <ol className="mb-4 grid gap-2 text-sm text-muted-foreground">
                    <li>1. Connect and unlock the iPhone by USB, then approve Apple Trust.</li>
                    <li>2. Enable desktop Wi-Fi, provision the embedded board, or do both.</li>
                    <li>
                      3. For desktop use, reconnect with this Mac and iPhone on the same network.
                    </li>
                  </ol>
                )}
                {provisioningStatus && (
                  <p
                    aria-live="polite"
                    className={`mb-3 rounded-xl p-3 text-xs font-medium ${
                      provisioningStatus.tone === "success"
                        ? "bg-success/15 text-success"
                        : provisioningStatus.tone === "error"
                          ? "bg-danger/15 text-danger"
                          : "bg-accent/15 text-accent"
                    }`}
                  >
                    {provisioningStatus.message}
                  </p>
                )}
                {devices.length === 0 ? (
                  <EmptyState
                    title="No iPhone found"
                    description="Connect and unlock the iPhone by USB for first-time local pairing. Pairing stays between this Mac and iPhone."
                    action={
                      <Button onPress={refreshDevices}>
                        <Wifi size={16} /> Scan devices
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-2">
                    {devices.map((device) => {
                      const validated =
                        device.transport === "network" && device.osVersion?.startsWith("27.");
                      const wifiAvailable = device.transport === "network";
                      const selectable = wifiAvailable && device.state === "ready";
                      const connected = selected?.id === device.id;
                      return (
                        <div
                          className={`rounded-xl border p-3 text-left transition-colors ${connected ? "border-success bg-success/5 ring-2 ring-success/20" : "border-border bg-surface"}`}
                          key={device.id}
                        >
                          <DeviceStatus {...device} />
                          <p
                            className={`mt-2 text-xs ${wifiAvailable ? "text-success" : "text-warning"} ${connected ? "font-medium" : ""}`}
                          >
                            {connected
                              ? `${device.osVersion ? `iOS ${device.osVersion}` : "Unknown iOS"} · connected over Wi-Fi`
                              : validated
                                ? `Validated same-LAN path · iOS ${device.osVersion}`
                                : wifiAvailable
                                  ? `${device.osVersion ? `iOS ${device.osVersion}` : "Unknown iOS"} · Wi-Fi beta available`
                                  : device.transport === "usb"
                                    ? `${device.osVersion ? `iOS ${device.osVersion}` : "Unknown iOS"} · initial provisioning source`
                                    : `${device.osVersion ? `iOS ${device.osVersion}` : "Unknown iOS"} · unavailable`}
                          </p>
                          {connected ? (
                            <div
                              aria-label={`${device.name} connected over Wi-Fi`}
                              className="mt-3 flex min-h-8 w-full items-center justify-center gap-2 rounded-full bg-success/15 px-3 text-sm font-semibold text-success"
                              role="status"
                            >
                              <CircleCheck aria-hidden size={16} /> Connected
                            </div>
                          ) : selectable ? (
                            <Button
                              className="mt-3 w-full"
                              isDisabled={busy}
                              onPress={() => void connect(device.id)}
                              size="sm"
                            >
                              <Wifi size={15} />{" "}
                              {selected ? "Switch to this iPhone" : "Connect over Wi-Fi"}
                            </Button>
                          ) : device.transport === "usb" && device.state === "ready" ? (
                            <div className="mt-3 grid gap-2">
                              <Button
                                isDisabled={busy}
                                onPress={() => void enableDesktopWifi(device.id)}
                                size="sm"
                              >
                                {provisioningStatus?.tone === "pending" &&
                                provisioningStatus.operation === "desktop" ? (
                                  <LoaderCircle className="animate-spin" size={15} />
                                ) : (
                                  <Wifi size={15} />
                                )}
                                Enable desktop Wi-Fi
                              </Button>
                              <Button
                                isDisabled={busy}
                                onPress={() => void provisionBoard(device.id)}
                                size="sm"
                                variant="secondary"
                              >
                                {provisioningStatus?.tone === "pending" &&
                                provisioningStatus.operation === "board" ? (
                                  <LoaderCircle className="animate-spin" size={15} />
                                ) : (
                                  <Cable size={15} />
                                )}
                                Provision embedded board
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </RoutePanel>
            </div>
          )}

          {dirtySession && (
            <Surface className="mt-4 border-warning/50 p-4 text-sm">
              <p className="font-semibold text-warning">A simulated location may be active</p>
              <p className="mt-2 text-muted-foreground">
                Select the same iPhone, then restore before starting another session.
              </p>
              <Button
                className="mt-3 w-full"
                isDisabled={!selected}
                onPress={() => setRecoveryOpen(true)}
                variant="secondary"
              >
                Review recovery
              </Button>
            </Surface>
          )}

          {sidebarTab === "library" && (
            <div aria-labelledby="sidebar-library-tab" id="sidebar-library-panel" role="tabpanel">
              <LocalLibrary
                favorites={favorites}
                history={history}
                onDelete={deleteSaved}
                onLoad={loadPlan}
              />
            </div>
          )}
        </aside>

        <section className="relative min-h-[560px] bg-surface-tertiary lg:h-full lg:min-h-0 lg:overflow-hidden">
          <MapView
            accessToken={mapboxAccessToken}
            center={mapCenter}
            onMapClick={onMapClick}
            onMapError={setMapError}
            point={point}
            routePoints={mode === "route" || mode === "gpx" ? routePoints : []}
            waypoints={mode === "route" ? routeWaypoints : []}
          />
          <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
            <LocationSearch
              accessToken={mapboxAccessToken}
              center={point ?? mapCenter}
              onCenter={(coordinate, zoom) => setMapCenter({ ...coordinate, zoom })}
            />
            <Button onPress={locateComputer} variant="secondary">
              <LocateFixed size={16} /> Center on this Mac
            </Button>
            {mode === "route" && routeWaypoints.length > 0 && (
              <Button
                isDisabled={activeMode === "route" && (running || paused)}
                onPress={() => {
                  setRouteWaypoints((current) => current.slice(0, -1));
                }}
                variant="secondary"
              >
                <Undo2 size={16} /> Undo point
              </Button>
            )}
          </div>
          {(error ?? routingError ?? mapError) && (
            <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border border-danger/40 bg-danger/90 p-3 text-sm text-white shadow-lg">
              {error ?? routingError ?? mapError}
            </div>
          )}
        </section>

        <aside className="border-l border-border bg-surface-secondary/40 p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
          <RoutePanel title="2. Choose movement">
            <fieldset className="grid grid-cols-2 gap-2" aria-label="Movement mode">
              {modes.map(({ id, label, icon: Icon }) => (
                <Button
                  aria-label={`${label} mode${mode === id ? ", selected" : ""}`}
                  key={id}
                  onPress={() => selectMode(id)}
                  variant={mode === id ? "primary" : "secondary"}
                >
                  <Icon size={16} /> {label}
                </Button>
              ))}
            </fieldset>

            <div className="mt-5">
              {mode === "teleport" && <CoordinateEditor point={point} setPoint={setPoint} />}
              {mode === "route" && (
                <RouteEditor
                  options={{ repetitions, roundTrip, routingProfile, speedKph, speedProfile }}
                  pointCount={routeWaypoints.length}
                  routingError={routingError}
                  routingLoading={routingLoading}
                  setRepetitions={setRepetitions}
                  setRoundTrip={setRoundTrip}
                  setRoutingProfile={(profile) => {
                    setRoutingProfile(profile);
                    setSpeedKph(suggestedSpeedKph(profile));
                  }}
                  setSpeedKph={setSpeedKph}
                  setSpeedProfile={setSpeedProfile}
                />
              )}
              {mode === "joystick" && (
                <JoystickEditor
                  onDirection={pressJoystick}
                  onRelease={releaseJoystick}
                  point={point}
                  setPoint={setPoint}
                  setSpeedKph={setSpeedKph}
                  speedKph={speedKph}
                />
              )}
              {mode === "gpx" && (
                <GpxEditor
                  name={gpxName}
                  onExport={downloadGpx}
                  onFile={importGpx}
                  pointCount={routePoints.length}
                  setSpeedKph={setSpeedKph}
                  speedKph={speedKph}
                />
              )}
            </div>

            {metrics && (mode === "route" || mode === "gpx") && (
              <div className="mt-4 rounded-xl bg-surface-tertiary p-3 text-sm">
                <p className="font-medium">
                  {formatDistance(metrics.distanceMeters)} · {formatDuration(metrics.travelTimeMs)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Informational cooldown: allow roughly the simulated travel time before abrupt
                  long-distance changes.
                </p>
                {routeTooLong && (
                  <p className="mt-2 text-xs font-medium text-danger">
                    This route exceeds 100,000 updates. Increase speed, shorten it, or reduce
                    repetitions before starting.
                  </p>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {!running && !paused && mode !== "joystick" && (
                <Button
                  isDisabled={!currentPlan || !selected || busy || routeTooLong}
                  onPress={startCurrent}
                >
                  <Play size={16} /> {mode === "teleport" ? "Set location" : "Start"}
                </Button>
              )}
              {running && activeMode !== "teleport" && (
                <Button onPress={() => void control("pause")} variant="secondary">
                  <Pause size={16} /> Pause
                </Button>
              )}
              {paused && (
                <Button onPress={() => void control("resume")}>
                  <Play size={16} /> Resume
                </Button>
              )}
              {(running || paused) && canRestart && (
                <Button onPress={() => void control("restart")} variant="secondary">
                  <RefreshCw size={16} /> Restart
                </Button>
              )}
              {(running || paused) && activeMode !== "teleport" && (
                <Button onPress={() => void control("stop")} variant="secondary">
                  <Square size={14} /> Stop
                </Button>
              )}
              <Button isDisabled={!selected} onPress={restore} variant="danger">
                <RotateCcw size={16} /> Restore
              </Button>
            </div>
          </RoutePanel>

          <Surface className="mt-4 p-4">
            <h2 className="font-semibold">Save locally</h2>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Favorite name"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                maxLength={80}
                onChange={(event) => setFavoriteName(event.target.value)}
                placeholder="Home, commute…"
                value={favoriteName}
              />
              <Button isIconOnly isDisabled={!currentPlan} onPress={saveFavorite}>
                <Star aria-label="Save favorite" size={17} />
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Favorites, routes, GPX, and history are encrypted before SQLite storage on this Mac.
            </p>
          </Surface>
        </aside>
      </div>
      {dialogs}
    </AppShell>
  );
}

function CoordinateEditor({
  point,
  setPoint,
}: {
  point?: Coordinate;
  setPoint: (point: Coordinate) => void;
}) {
  const formatPoint = (next?: Coordinate) =>
    next ? `${next.latitude.toFixed(6)}, ${next.longitude.toFixed(6)}` : "";
  const [coordinateText, setCoordinateText] = useState(() => formatPoint(point));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setCoordinateText(formatPoint(point));
  }, [point]);

  return (
    <FormField label="Latitude, longitude" hint="Click the map or paste decimal coordinates.">
      <input
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        onChange={(event) => {
          const value = event.currentTarget.value;
          setCoordinateText(value);
          const next = parseCoordinateText(value);
          if (next) setPoint(next);
        }}
        onBlur={() => {
          editingRef.current = false;
          setCoordinateText(formatPoint(point));
        }}
        onFocus={() => {
          editingRef.current = true;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="49.282700, -123.120700"
        value={coordinateText}
      />
    </FormField>
  );
}

function RouteEditor({
  pointCount,
  options,
  routingError,
  routingLoading,
  setSpeedKph,
  setSpeedProfile,
  setRepetitions,
  setRoundTrip,
  setRoutingProfile,
}: {
  pointCount: number;
  options: {
    speedKph: number;
    speedProfile: "constant" | "natural";
    repetitions: number;
    roundTrip: boolean;
    routingProfile: RoutingProfile;
  };
  routingError?: string;
  routingLoading: boolean;
  setSpeedKph: (value: number) => void;
  setSpeedProfile: (value: "constant" | "natural") => void;
  setRepetitions: (value: number) => void;
  setRoundTrip: (value: boolean) => void;
  setRoutingProfile: (value: RoutingProfile) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="rounded-xl bg-accent/10 p-3 text-sm text-accent">
        Click the map to add up to {MAX_MAPBOX_WAYPOINTS} waypoints. {pointCount} selected.
      </p>
      <FormField label="Mapbox road routing">
        <select
          className="rounded-lg border border-border bg-surface px-3 py-2"
          onChange={(event) => setRoutingProfile(event.target.value as RoutingProfile)}
          value={options.routingProfile}
        >
          <option value="driving">Driving</option>
          <option value="walking">Walking</option>
          <option value="cycling">Cycling</option>
        </select>
      </FormField>
      {routingLoading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="animate-spin" size={14} /> Calculating road route…
        </p>
      )}
      {routingError && <p className="text-xs text-danger">{routingError}</p>}
      <MovementOptions
        repetitions={options.repetitions}
        roundTrip={options.roundTrip}
        setRepetitions={setRepetitions}
        setRoundTrip={setRoundTrip}
        setSpeedKph={setSpeedKph}
        setSpeedProfile={setSpeedProfile}
        speedKph={options.speedKph}
        speedProfile={options.speedProfile}
      />
    </div>
  );
}

function MovementOptions({
  speedKph,
  speedProfile,
  repetitions,
  roundTrip,
  setSpeedKph,
  setSpeedProfile,
  setRepetitions,
  setRoundTrip,
}: {
  speedKph: number;
  speedProfile: "constant" | "natural";
  repetitions: number;
  roundTrip: boolean;
  setSpeedKph: (value: number) => void;
  setSpeedProfile: (value: "constant" | "natural") => void;
  setRepetitions: (value: number) => void;
  setRoundTrip: (value: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Speed (km/h)">
        <input
          className="min-w-0 w-full rounded-lg border border-border bg-surface px-3 py-2"
          max={108}
          min={0.4}
          onChange={(event) => setSpeedKph(Number(event.target.value))}
          step={0.1}
          type="number"
          value={speedKph}
        />
      </FormField>
      <FormField label="Speed profile">
        <select
          className="min-w-0 w-full rounded-lg border border-border bg-surface px-3 py-2"
          onChange={(event) => setSpeedProfile(event.target.value as "constant" | "natural")}
          value={speedProfile}
        >
          <option value="constant">Constant</option>
          <option value="natural">Natural</option>
        </select>
      </FormField>
      <FormField label="Repetitions">
        <input
          className="min-w-0 w-full rounded-lg border border-border bg-surface px-3 py-2"
          min={1}
          onChange={(event) => setRepetitions(Math.max(1, Number(event.target.value)))}
          type="number"
          value={repetitions}
        />
      </FormField>
      <label className="flex h-10 min-w-0 items-center gap-2 self-end px-1 text-sm font-medium">
        <input
          checked={roundTrip}
          onChange={(event) => setRoundTrip(event.target.checked)}
          type="checkbox"
        />
        Round trip
      </label>
    </div>
  );
}

function JoystickEditor({
  point,
  speedKph,
  setPoint,
  setSpeedKph,
  onDirection,
  onRelease,
}: {
  point?: Coordinate;
  speedKph: number;
  setPoint: (point: Coordinate) => void;
  setSpeedKph: (value: number) => void;
  onDirection: (heading: number) => Promise<boolean>;
  onRelease: () => Promise<void>;
}) {
  return (
    <div className="grid gap-4">
      <CoordinateEditor point={point} setPoint={setPoint} />
      <FormField label="Speed (km/h)" hint="Hold WASD or arrow keys; release to pause.">
        <input
          className="rounded-lg border border-border bg-surface px-3 py-2"
          max={108}
          min={0.4}
          onChange={(event) => setSpeedKph(Number(event.target.value))}
          step={0.1}
          type="number"
          value={speedKph}
        />
      </FormField>
      <div className="mx-auto grid w-36 grid-cols-3 gap-2">
        <span />
        <DirectionButton
          heading={0}
          icon={ChevronUp}
          label="Move north"
          onDirection={onDirection}
          onRelease={onRelease}
        />
        <span />
        <DirectionButton
          heading={270}
          icon={ChevronLeft}
          label="Move west"
          onDirection={onDirection}
          onRelease={onRelease}
        />
        <span className="grid place-items-center text-xs text-muted-foreground">WASD</span>
        <DirectionButton
          heading={90}
          icon={ChevronRight}
          label="Move east"
          onDirection={onDirection}
          onRelease={onRelease}
        />
        <span />
        <DirectionButton
          heading={180}
          icon={ChevronDown}
          label="Move south"
          onDirection={onDirection}
          onRelease={onRelease}
        />
      </div>
    </div>
  );
}

function DirectionButton({
  heading,
  icon: Icon,
  label,
  onDirection,
  onRelease,
}: {
  heading: number;
  icon: typeof ChevronUp;
  label: string;
  onDirection: (heading: number) => Promise<boolean>;
  onRelease: () => Promise<void>;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-11 place-items-center rounded-xl border border-border bg-surface hover:border-accent active:bg-accent/15"
      onPointerCancel={() => void onRelease()}
      onPointerDown={() => void onDirection(heading)}
      onPointerUp={() => void onRelease()}
      type="button"
    >
      <Icon size={20} />
    </button>
  );
}

function GpxEditor({
  pointCount,
  name,
  speedKph,
  setSpeedKph,
  onFile,
  onExport,
}: {
  pointCount: number;
  name?: string;
  speedKph: number;
  setSpeedKph: (value: number) => void;
  onFile: (file?: File) => Promise<void>;
  onExport: () => void;
}) {
  return (
    <div className="grid gap-4">
      <label className="grid cursor-pointer gap-2 rounded-xl border border-dashed border-border bg-surface p-4 text-center text-sm hover:border-accent">
        <Upload className="mx-auto" size={22} />
        <span>{name ? `${name} · ${pointCount} points` : "Import a GPX track"}</span>
        <input
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void onFile(file);
          }}
          type="file"
        />
      </label>
      <FormField label="Replay speed (km/h)">
        <input
          className="rounded-lg border border-border bg-surface px-3 py-2"
          max={108}
          min={0.4}
          onChange={(event) => setSpeedKph(Number(event.target.value))}
          step={0.1}
          type="number"
          value={speedKph}
        />
      </FormField>
      <Button isDisabled={pointCount < 2} onPress={onExport} variant="secondary">
        <Download size={16} /> Export current GPX
      </Button>
      <p className="text-xs text-muted-foreground">
        Imports reject document types, entities, malformed coordinates, files over 10 MB, and tracks
        over 100,000 points.
      </p>
    </div>
  );
}

function LocalLibrary({
  favorites,
  history,
  onLoad,
  onDelete,
}: {
  favorites: LocalPlanRecord[];
  history: LocalPlanRecord[];
  onLoad: (record: LocalPlanRecord) => void;
  onDelete: (record: LocalPlanRecord, kind: SavedPlanKind) => Promise<void>;
}) {
  return (
    <Surface className="mt-4 p-4">
      <h2 className="font-semibold">Local library</h2>
      <LibraryGroup
        empty="No favorites yet"
        icon={Star}
        kind="favorite"
        onDelete={onDelete}
        onLoad={onLoad}
        records={favorites}
        title="Favorites"
      />
      <LibraryGroup
        empty="History appears after a simulation starts"
        icon={RefreshCw}
        kind="history"
        onDelete={onDelete}
        onLoad={onLoad}
        records={history.slice(0, 8)}
        title="Recent history"
      />
    </Surface>
  );
}

function LibraryGroup({
  title,
  empty,
  records,
  kind,
  icon: Icon,
  onLoad,
  onDelete,
}: {
  title: string;
  empty: string;
  records: LocalPlanRecord[];
  kind: SavedPlanKind;
  icon: typeof Star;
  onLoad: (record: LocalPlanRecord) => void;
  onDelete: (record: LocalPlanRecord, kind: SavedPlanKind) => Promise<void>;
}) {
  return (
    <div className="mt-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon size={13} /> {title}
      </p>
      {records.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2 grid gap-1">
          {records.map((record) => (
            <div className="flex items-center gap-1" key={record.id}>
              <button
                className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-tertiary"
                onClick={() => onLoad(record)}
                type="button"
              >
                {record.name}
              </button>
              <button
                aria-label={`Delete ${record.name}`}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
                onClick={() => void onDelete(record, kind)}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-+|-+$/gu, "") || "enigma-route"
  );
}

function routeEndpoints(points: Coordinate[]): Coordinate[] {
  const first = points[0];
  const last = points.at(-1);
  return first && last ? [first, last] : [];
}

function sameCoordinates(left: Coordinate[], right: Coordinate[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point.latitude === right[index]?.latitude && point.longitude === right[index]?.longitude,
    )
  );
}

function downloadTextFile(contents: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { AppShell, Surface } from "@enigma/ui";
import { Button } from "@heroui/react";
import { ArrowLeft, Download, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "./updates";

export function SettingsPage({
  availableUpdate,
  busy,
  error,
  mapboxAccessToken,
  onBack,
  onCheckForUpdates,
  onDownloadDiagnostics,
  onInstallUpdate,
  onSaveMapboxAccessToken,
  updateBlockedReason,
  updateMessage,
  updaterAvailable,
}: {
  availableUpdate?: DesktopUpdateInfo;
  busy: boolean;
  error?: string;
  mapboxAccessToken?: string;
  onBack: () => void;
  onCheckForUpdates: () => void;
  onDownloadDiagnostics: () => void;
  onInstallUpdate: () => void;
  onSaveMapboxAccessToken: (token?: string) => Promise<boolean>;
  updateBlockedReason?: string;
  updateMessage?: string;
  updaterAvailable: boolean;
}) {
  const [mapboxTokenDraft, setMapboxTokenDraft] = useState(mapboxAccessToken ?? "");
  const [mapboxMessage, setMapboxMessage] = useState<string>();

  useEffect(() => setMapboxTokenDraft(mapboxAccessToken ?? ""), [mapboxAccessToken]);

  const saveMapboxToken = async () => {
    const token = mapboxTokenDraft.trim();
    const saved = await onSaveMapboxAccessToken(token || undefined);
    if (saved) {
      setMapboxMessage(
        token ? "Mapbox maps, search, and routing are enabled." : "Mapbox token removed.",
      );
    }
  };

  return (
    <AppShell
      context="Settings · local preferences"
      navigation={
        <Button onPress={onBack} variant="ghost">
          <ArrowLeft size={16} /> Back to map
        </Button>
      }
    >
      <div className="h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain bg-surface-secondary/40">
        <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Desktop</p>
            <h1 className="mt-1 text-2xl font-semibold">Settings</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Manage Mapbox access, diagnostics, and application updates.
            </p>
          </div>

          <div className="grid gap-4">
            {error && (
              <p aria-live="polite" className="rounded-xl bg-danger/15 p-4 text-sm text-danger">
                {error}
              </p>
            )}
            <Surface className="p-5 text-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-base font-semibold">
                  <ShieldCheck size={18} /> Local data
                </p>
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                  Local
                </span>
              </div>
              <p className="mt-3 text-muted-foreground">
                Enigma stores routes, favorites, history, and recovery state only on this computer.
                Diagnostic files are created only when you choose to export them.
              </p>
              <Button className="mt-4 w-full" onPress={onDownloadDiagnostics} variant="secondary">
                <Download size={16} /> Export safe diagnostics
              </Button>
            </Surface>

            <Surface className="p-5 text-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-base font-semibold">
                  <KeyRound size={18} /> Mapbox maps and routing
                </p>
                <span className="rounded-full bg-surface-tertiary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {mapboxAccessToken ? "Configured" : "Off"}
                </span>
              </div>
              <p className="mt-3 text-muted-foreground">
                Supply a client-visible Mapbox public token beginning with <code>pk.</code> to load
                Mapbox Streets, search for places, and calculate driving, walking, or cycling
                routes. Requests go directly to Mapbox.
              </p>
              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Mapbox public token
                </span>
                <input
                  autoComplete="off"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  disabled={busy}
                  maxLength={2048}
                  onChange={(event) => {
                    setMapboxTokenDraft(event.currentTarget.value);
                    setMapboxMessage(undefined);
                  }}
                  placeholder="pk.…"
                  spellCheck={false}
                  type="password"
                  value={mapboxTokenDraft}
                />
              </label>
              {mapboxMessage && <p className="mt-2 text-xs text-success">{mapboxMessage}</p>}
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" isDisabled={busy} onPress={() => void saveMapboxToken()}>
                  Save token
                </Button>
                <Button
                  isDisabled={busy || (!mapboxAccessToken && !mapboxTokenDraft)}
                  onPress={() => {
                    setMapboxTokenDraft("");
                    void onSaveMapboxAccessToken(undefined).then((saved) => {
                      if (saved) setMapboxMessage("Mapbox token removed.");
                    });
                  }}
                  variant="secondary"
                >
                  <Trash2 size={16} /> Remove
                </Button>
              </div>
            </Surface>

            <Surface className="p-5 text-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Desktop updates</h2>
                <span className="rounded-full bg-surface-tertiary px-2.5 py-1 text-xs uppercase text-muted-foreground">
                  stable
                </span>
              </div>
              <p className="mt-3 text-muted-foreground">
                Stable releases come from GitHub and are verified with the Tauri updater signature.
                Installation remains blocked until every simulated location is restored.
              </p>
              {updateMessage && <p className="mt-3 text-xs">{updateMessage}</p>}
              {availableUpdate && updateBlockedReason && (
                <p className="mt-2 text-xs font-medium text-warning">{updateBlockedReason}</p>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  className="flex-1"
                  isDisabled={!updaterAvailable || busy}
                  onPress={onCheckForUpdates}
                  variant="secondary"
                >
                  <RefreshCw size={16} /> Check
                </Button>
                {availableUpdate && (
                  <Button
                    className="flex-1"
                    isDisabled={Boolean(updateBlockedReason) || busy}
                    onPress={onInstallUpdate}
                  >
                    Install {availableUpdate.version}
                  </Button>
                )}
              </div>
              {!updaterAvailable && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Disabled in this unsigned development build.
                </p>
              )}
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

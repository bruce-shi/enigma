import { AppShell, Surface } from "@enigma/ui";
import { Button } from "@heroui/react";
import { ArrowLeft, Download, RefreshCw, ShieldCheck } from "lucide-react";
import type { DesktopUpdateInfo } from "./updates";

export function SettingsPage({
  availableUpdate,
  busy,
  crashConsent,
  onBack,
  onCheckForUpdates,
  onDownloadDiagnostics,
  onInstallUpdate,
  onUpdateCrashConsent,
  updateBlockedReason,
  updateChannel,
  updateMessage,
  updaterAvailable,
}: {
  availableUpdate?: DesktopUpdateInfo;
  busy: boolean;
  crashConsent: boolean;
  onBack: () => void;
  onCheckForUpdates: () => void;
  onDownloadDiagnostics: () => void;
  onInstallUpdate: () => void;
  onUpdateCrashConsent: (consent: boolean) => void;
  updateBlockedReason?: string;
  updateChannel: string;
  updateMessage?: string;
  updaterAvailable: boolean;
}) {
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
              Manage local privacy, diagnostics, and application updates.
            </p>
          </div>

          <div className="grid gap-4">
            <Surface className="p-5 text-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-base font-semibold">
                  <ShieldCheck size={18} /> Local-only access
                </p>
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                  Local
                </span>
              </div>
              <p className="mt-3 text-muted-foreground">
                Account and subscription enforcement is intentionally bypassed while the desktop
                workflow is completed.
              </p>
              <label className="mt-5 flex items-start gap-3 rounded-xl bg-surface-tertiary p-4">
                <input
                  checked={crashConsent}
                  className="mt-1"
                  disabled={busy}
                  onChange={(event) => onUpdateCrashConsent(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">Share anonymous crash reports</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Opt-in is stored locally. Reports exclude coordinates, device identifiers,
                    names, tokens, and stack paths. Delivery stays off until authenticated
                    production access is configured.
                  </span>
                </span>
              </label>
              <Button className="mt-4 w-full" onPress={onDownloadDiagnostics} variant="secondary">
                <Download size={16} /> Export safe diagnostics
              </Button>
            </Surface>

            <Surface className="p-5 text-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Desktop updates</h2>
                <span className="rounded-full bg-surface-tertiary px-2.5 py-1 text-xs uppercase text-muted-foreground">
                  {updateChannel}
                </span>
              </div>
              <p className="mt-3 text-muted-foreground">
                Enigma verifies updater signatures. Installation is blocked until every simulated
                location is restored, even if the route worker has already stopped.
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

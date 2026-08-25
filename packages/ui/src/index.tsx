import type { DeviceState, SimulationState } from "@enigma/contracts";
import { AlertDialog, Button } from "@heroui/react";
import { Laptop, Moon, Pause, Play, RotateCcw, Smartphone, Sun } from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";

export function EnigmaMark({ className = "" }: { className?: string }) {
  return <img alt="" aria-hidden className={className} src="/enigma-mark-reversed.png" />;
}

function resolveTheme(preference: ThemePreference): "enigma-light" | "enigma-dark" {
  if (preference === "dark") return "enigma-dark";
  if (preference === "light") return "enigma-light";
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "enigma-dark"
    : "enigma-light";
}

function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "enigma-dark");
}

function useEnigmaTheme(
  storageKey = "enigma.theme",
): [ThemePreference, (preference: ThemePreference) => void] {
  // The deterministic first snapshot keeps SSR hydration stable. The website's
  // inline head script still applies the persisted visual theme before paint.
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let storedPreference: ThemePreference = "system";
    if (typeof document !== "undefined") {
      const cookie = document.cookie.match(/(?:^|; )enigma_theme=([^;]+)/u)?.[1];
      const storedCookie = cookie ? decodeURIComponent(cookie) : undefined;
      if (storedCookie === "light" || storedCookie === "dark" || storedCookie === "system") {
        storedPreference = storedCookie;
      }
    }
    if (storedPreference === "system" && typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored === "light" || stored === "dark" || stored === "system") {
        storedPreference = stored;
      }
    }
    setPreference(storedPreference);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    applyTheme(preference);
    localStorage.setItem(storageKey, preference);
    // biome-ignore lint/suspicious/noDocumentCookie: SSR reads this cookie before hydration
    document.cookie = `enigma_theme=${encodeURIComponent(preference)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    if (preference !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [preference, ready, storageKey]);

  return [preference, setPreference];
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useEnigmaTheme();
  const next: ThemePreference =
    theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = `Theme: ${theme}. Switch to ${next}.`;
  return (
    <Button aria-label={label} isIconOnly={compact} onPress={() => setTheme(next)} variant="ghost">
      {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
      {!compact && <span className="capitalize">{theme}</span>}
    </Button>
  );
}

export interface AppShellProps extends PropsWithChildren {
  product?: string;
  context?: string;
  navigation?: ReactNode;
  actions?: ReactNode;
  showThemeToggle?: boolean;
}

export function AppShell({
  product = "Enigma",
  context,
  navigation,
  actions,
  showThemeToggle = true,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 flex min-h-16 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <EnigmaMark className="size-9 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{product}</p>
            {context && <p className="truncate text-xs text-muted-foreground">{context}</p>}
          </div>
        </div>
        <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
          {navigation}
        </nav>
        <div className="flex items-center gap-2">
          {actions}
          {showThemeToggle && <ThemeToggle compact />}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

const stateLabels: Record<DeviceState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  needs_driver: "Apple driver required",
  needs_trust: "Trust required",
  needs_developer_mode: "Developer Mode required",
  preparing: "Preparing developer service",
  ready: "Ready",
  simulating: "Simulating",
  error: "Needs attention",
};

export function DeviceStatus({
  state,
  name,
  transport,
}: {
  state: DeviceState;
  name?: string;
  transport?: "usb" | "network";
}) {
  const healthy = state === "ready" || state === "simulating";
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <span
        className={`grid size-10 place-items-center rounded-full ${healthy ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
      >
        <Smartphone aria-hidden size={20} />
      </span>
      <div>
        <p className="font-medium">{name ?? "No iPhone selected"}</p>
        <p className="text-sm text-muted-foreground">
          {stateLabels[state]}
          {transport ? ` · ${transport === "usb" ? "USB" : "Wi-Fi beta"}` : ""}
        </p>
      </div>
    </div>
  );
}

export function Surface({ className = "", ...props }: ComponentPropsWithoutRef<"section">) {
  return <section className={`enigma-surface ${className}`} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-48 place-items-center p-8 text-center">
      <div className="max-w-md">
        <Laptop aria-hidden className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function SimulationControls({
  state,
  onStart,
  onPause,
  onResume,
  onStop,
  onRestore,
}: {
  state: SimulationState;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRestore: () => void;
}) {
  const running = state === "running";
  const paused = state === "paused";
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Simulation controls</legend>
      {running ? (
        <Button onPress={onPause} variant="secondary">
          <Pause size={16} /> Pause
        </Button>
      ) : paused ? (
        <Button onPress={onResume}>
          <Play size={16} /> Resume
        </Button>
      ) : (
        <Button onPress={onStart}>
          <Play size={16} /> Start
        </Button>
      )}
      <Button isDisabled={!running && !paused} onPress={onStop} variant="secondary">
        Stop
      </Button>
      <Button onPress={onRestore} variant="danger">
        <RotateCcw size={16} /> Restore
      </Button>
    </fieldset>
  );
}

export function RoutePanel({ title = "Route", children }: PropsWithChildren<{ title?: string }>) {
  return (
    <Surface className="p-4">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </Surface>
  );
}

export function FormField({
  label,
  hint,
  error,
  children,
}: PropsWithChildren<{ label: string; hint?: string; error?: string }>) {
  return (
    // The slotted form control is nested inside the label at runtime.
    // biome-ignore lint/a11y/noLabelWithoutControl: the child slot is the associated control
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {(error || hint) && (
        <span className={error ? "text-danger" : "text-muted-foreground"}>{error ?? hint}</span>
      )}
    </label>
  );
}

export function ConfirmExitDialog({
  open,
  onRestore,
  onKeep,
  onCancel,
  title = "Location simulation is active",
  description = "Restore is safest. Keeping the last point is best-effort and iOS may reset it after a reboot or service restart.",
  cancelLabel = "Cancel",
  keepLabel = "Keep and exit",
  restoreLabel = "Restore and exit",
  restoreDisabled = false,
}: {
  open: boolean;
  onRestore: () => void;
  onKeep: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  cancelLabel?: string;
  keepLabel?: string;
  restoreLabel?: string;
  restoreDisabled?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  useEffect(() => {
    if (!open && wasOpenRef.current && returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <AlertDialog.Backdrop
      isOpen={open}
      isKeyboardDismissDisabled={false}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <AlertDialog.Container placement="center" size="lg">
        <AlertDialog.Dialog aria-describedby="exit-description">
          <AlertDialog.Header>
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body id="exit-description">{description}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button onPress={onCancel} variant="ghost">
              {cancelLabel}
            </Button>
            <Button onPress={onKeep} variant="secondary">
              {keepLabel}
            </Button>
            <Button autoFocus isDisabled={restoreDisabled} onPress={onRestore}>
              <RotateCcw aria-hidden size={16} /> {restoreLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

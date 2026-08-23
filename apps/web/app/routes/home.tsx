import {
  ArrowRight,
  Cable,
  Code2,
  Download,
  KeyRound,
  LockKeyhole,
  MapPinned,
  MonitorCheck,
  Wifi,
} from "lucide-react";
import { ButtonLink, SiteShell } from "../components/SiteShell";

const repository = "https://github.com/bruce-shi/enigma";

const features = [
  {
    icon: MapPinned,
    title: "Map, routes, and joystick",
    body: "Teleport, replay GPX, or simulate deterministic movement from the desktop map.",
  },
  {
    icon: MonitorCheck,
    title: "Desktop or embedded",
    body: "Control a paired iPhone from the desktop, or provision the ESP32-S3 board for independent use.",
  },
  {
    icon: Wifi,
    title: "Local device transport",
    body: "Pair once over USB, then use the supported same-LAN desktop path or the board-owned Wi-Fi network.",
  },
  {
    icon: LockKeyhole,
    title: "No Enigma account",
    body: "Routes, coordinates, favorites, history, and recovery state stay on your computer.",
  },
];

export default function Home() {
  return (
    <SiteShell>
      <section className="overflow-hidden px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              GPL-3.0 open source
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">
              Test an iPhone location without an account or Enigma cloud.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Enigma is a local-first desktop and embedded utility for developers, QA teams, and
              controlled location workflows. Maps come directly from OpenFreeMap, with optional
              user-configured Mapbox place search.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink className="gap-2" size="lg" to={repository}>
                <Code2 size={18} /> View source <ArrowRight size={17} />
              </ButtonLink>
              <ButtonLink
                className="gap-2"
                size="lg"
                to={`${repository}/releases`}
                variant="secondary"
              >
                <Download size={18} /> GitHub Releases
              </ButtonLink>
            </div>
          </div>
          <div className="enigma-surface grid aspect-[4/3] place-items-center bg-surface-secondary p-6">
            <div className="relative size-full overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_30%_35%,var(--accent)_0_2px,transparent_3px),linear-gradient(135deg,var(--surface-tertiary),var(--surface))]">
              <div className="absolute left-[28%] top-[32%] size-5 rounded-full border-4 border-accent bg-surface shadow-lg" />
              <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-border bg-surface/90 p-4 backdrop-blur">
                <p className="font-medium">No Enigma-hosted runtime services</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Local device control · encrypted local library · direct map providers
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface-secondary/35 px-6 py-20" id="features">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }) => (
            <article className="enigma-surface p-5" key={title}>
              <Icon className="text-accent" size={22} />
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-6 py-20" id="setup">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Two local workflows
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <article className="enigma-surface p-6">
              <MonitorCheck className="text-accent" size={24} />
              <h2 className="mt-4 text-xl font-semibold">Desktop standalone</h2>
              <ol className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground">
                <li>1. Connect and unlock the iPhone by USB and approve Apple Trust.</li>
                <li>2. Enable desktop Wi-Fi from Enigma, then put both devices on the same LAN.</li>
                <li>3. Disconnect USB, scan again, and connect to the Wi-Fi device.</li>
              </ol>
            </article>
            <article className="enigma-surface p-6">
              <Cable className="text-accent" size={24} />
              <h2 className="mt-4 text-xl font-semibold">Embedded standalone</h2>
              <ol className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground">
                <li>1. Flash the supported ESP32-S3 board and pair the iPhone on the desktop.</li>
                <li>2. Provision the pairing bundle locally over the board serial connection.</li>
                <li>3. Join the board Wi-Fi from the iPhone and use its touch controls.</li>
              </ol>
            </article>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Apple Trust, Developer Mode, and modern pairing approvals remain mandatory and cannot be
            bypassed.
          </p>
        </div>
      </section>

      <section
        className="border-y border-border bg-surface-secondary/35 px-6 py-20"
        id="compatibility"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Compatibility
          </p>
          <h2 className="mt-3 text-3xl font-semibold md:text-4xl">Evidence before claims</h2>
          <p className="mt-5 max-w-3xl leading-7 text-muted-foreground">
            The currently validated desktop path is macOS 12+ with a previously paired iOS 27 device
            over same-LAN Wi-Fi. USB runtime control, Windows, and other iOS versions remain
            unqualified until their physical test matrices pass. The Lichuang ESP32-S3 display and
            touch path is verified; full Wi-Fi/iPhone acceptance remains in progress.
          </p>
          <ButtonLink
            className="mt-6"
            to={`${repository}/blob/main/docs/compatibility.md`}
            variant="secondary"
          >
            Read compatibility evidence
          </ButtonLink>
        </div>
      </section>

      <section className="px-6 py-20" id="privacy">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
          <article className="enigma-surface p-6 md:col-span-2">
            <LockKeyhole className="text-accent" size={24} />
            <h2 className="mt-4 text-xl font-semibold">Local data and direct providers</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Enigma has no account, billing, entitlement, analytics, or crash-upload backend.
              Location libraries remain encrypted locally. OpenFreeMap receives normal map tile
              requests. If you configure Mapbox search, typed queries, proximity coordinates,
              language, a session identifier, and your public token go directly to Mapbox.
            </p>
          </article>
          <article className="enigma-surface p-6">
            <KeyRound className="text-accent" size={24} />
            <h2 className="mt-4 text-xl font-semibold">Bring your own search token</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The map works without credentials. Optional Mapbox search accepts only a
              client-visible public token beginning with <code>pk.</code>, stored on the local
              computer.
            </p>
          </article>
        </div>
      </section>

      <section className="border-t border-border bg-surface-secondary/35 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-semibold">Authorized testing only</h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Use Enigma only with devices, applications, and services you are authorized to test. It
            does not guarantee compatibility, account safety, or compliance with third-party terms.
            Review the source, build it yourself, and contribute under GPL-3.0-only.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink to={`${repository}/blob/main/README.md`}>Build from source</ButtonLink>
            <ButtonLink to={`${repository}/blob/main/CONTRIBUTING.md`} variant="secondary">
              Contribute
            </ButtonLink>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

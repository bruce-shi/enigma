import {
  Activity,
  ArrowRight,
  Cable,
  Code2,
  Download,
  Gamepad2,
  Gauge,
  History,
  MapPinPlus,
  MonitorCheck,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Route,
  Smartphone,
  Star,
  Upload,
  Wifi,
} from "lucide-react";
import type { MetaFunction } from "react-router";
import { ButtonLink, SiteShell } from "../components/SiteShell";
import { createPageMeta, defaultSeo, homeStructuredData } from "../seo";

const repository = "https://github.com/bruce-shi/enigma";

const movementModes = [
  {
    icon: MapPinPlus,
    title: "Teleport",
    body: "Pick a point on the map or enter exact coordinates, then move the connected iPhone there.",
  },
  {
    icon: Route,
    title: "Build a route",
    body: "Place multiple waypoints, follow roads or paths by driving, walking, or cycling, and preview the journey before starting.",
  },
  {
    icon: Gamepad2,
    title: "Steer with a joystick",
    body: "Guide movement in any direction and adjust your heading while the simulation is running.",
  },
  {
    icon: Upload,
    title: "Replay GPX",
    body: "Import an existing GPX track, inspect it on the map, and run the same journey again.",
  },
];

const routeTools = [
  {
    icon: Gauge,
    title: "Set the pace",
    body: "Tune movement from walking speed through driving speed, with constant or natural variation.",
  },
  {
    icon: Repeat2,
    title: "Repeat or return",
    body: "Run a route multiple times or turn it into a round trip with a single setting.",
  },
  {
    icon: Pause,
    title: "Stay in control",
    body: "Pause, resume, restart, or stop your journey whenever you want to change direction.",
  },
  {
    icon: Star,
    title: "Keep useful routes",
    body: "Save favorites and revisit recent routes instead of building the same journey again.",
  },
];

const gpsUseCases = [
  {
    icon: Gamepad2,
    title: "Location-based games",
    body: "Explore location-based games from anywhere with walking, heading, route, and GPS-triggered movement under your control.",
  },
  {
    icon: MapPinPlus,
    title: "Geofences and live maps",
    body: "Move across boundaries and coordinates deliberately to check map updates, regional content, check-ins, and other location-aware behavior.",
  },
  {
    icon: Repeat2,
    title: "Custom GPS routes",
    body: "Replay the same GPX track and speed profile, repeat favorite journeys, and move at walking, cycling, or driving speed.",
  },
];

export const meta: MetaFunction = () => [
  ...createPageMeta({
    ...defaultSeo,
    path: "/",
  }),
  { "script:ld+json": homeStructuredData },
];

export default function Home() {
  return (
    <SiteShell>
      <section className="overflow-hidden px-6 py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[.88fr_1.12fr]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              iPhone GPS location changer
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">
              Change your location. Move your way.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Teleport to a point, draw a path, import a GPX track, or steer with a joystick. Enigma
              puts iPhone GPS movement in your hands from one focused map workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink className="gap-2" size="lg" to={`${repository}/releases`}>
                <Download size={18} /> Download Enigma <ArrowRight size={17} />
              </ButtonLink>
              <ButtonLink className="gap-2" size="lg" to="/docs" variant="secondary">
                <Code2 size={18} /> Read the docs
              </ButtonLink>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <MonitorCheck className="text-accent" size={17} /> macOS desktop
              </span>
              <span className="flex items-center gap-2">
                <Wifi className="text-accent" size={17} /> Same-LAN control
              </span>
              <span className="flex items-center gap-2">
                <Cable className="text-accent" size={17} /> ESP32-S3 workflow
              </span>
            </div>
          </div>

          <div
            aria-hidden
            className="enigma-surface overflow-hidden bg-surface-secondary shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
              <span className="size-2.5 rounded-full bg-danger/70" />
              <span className="size-2.5 rounded-full bg-warning" />
              <span className="size-2.5 rounded-full bg-success/80" />
              <span className="ml-2 text-xs font-medium text-muted-foreground">Enigma · Route</span>
              <span className="ml-auto flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                <Smartphone size={12} /> iPhone connected
              </span>
            </div>
            <div className="grid min-h-[430px] md:grid-cols-[1.45fr_.8fr]">
              <div className="relative min-h-72 overflow-hidden border-b border-border bg-[linear-gradient(35deg,transparent_48%,color-mix(in_oklab,var(--border)_55%,transparent)_49%,color-mix(in_oklab,var(--border)_55%,transparent)_51%,transparent_52%),linear-gradient(-35deg,transparent_48%,color-mix(in_oklab,var(--border)_40%,transparent)_49%,color-mix(in_oklab,var(--border)_40%,transparent)_51%,transparent_52%),linear-gradient(var(--surface-secondary),var(--surface-tertiary))] bg-[length:88px_88px,120px_120px,auto] md:border-b-0 md:border-r">
                <svg
                  className="absolute inset-0 size-full"
                  fill="none"
                  preserveAspectRatio="none"
                  viewBox="0 0 500 430"
                >
                  <title>Illustrated route from point A to point B</title>
                  <path
                    d="M70 330C115 304 119 238 174 228C232 218 245 282 306 260C366 238 351 151 427 105"
                    stroke="color-mix(in oklab, var(--accent) 22%, transparent)"
                    strokeLinecap="round"
                    strokeWidth="13"
                  />
                  <path
                    d="M70 330C115 304 119 238 174 228C232 218 245 282 306 260C366 238 351 151 427 105"
                    stroke="var(--accent)"
                    strokeDasharray="8 10"
                    strokeLinecap="round"
                    strokeWidth="4"
                  />
                </svg>
                <span className="absolute bottom-[19%] left-[11%] grid size-8 place-items-center rounded-full border-4 border-surface bg-accent text-xs font-bold text-accent-foreground shadow-lg">
                  A
                </span>
                <span className="absolute right-[9%] top-[18%] grid size-8 place-items-center rounded-full border-4 border-surface bg-foreground text-xs font-bold text-background shadow-lg">
                  B
                </span>
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-xl border border-border bg-surface/90 px-4 py-3 shadow-lg backdrop-blur">
                  <div>
                    <p className="text-xs text-muted-foreground">Current location</p>
                    <p className="mt-0.5 text-sm font-semibold">Route in progress</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-accent">
                    <Activity size={15} /> Moving
                  </div>
                </div>
              </div>
              <div className="bg-surface p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Movement mode
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-lg border border-border px-2.5 py-2 text-center">
                    Teleport
                  </span>
                  <span className="rounded-lg bg-accent px-2.5 py-2 text-center font-medium text-accent-foreground">
                    Route
                  </span>
                  <span className="rounded-lg border border-border px-2.5 py-2 text-center">
                    Joystick
                  </span>
                  <span className="rounded-lg border border-border px-2.5 py-2 text-center">
                    GPX
                  </span>
                </div>
                <div className="mt-5 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Speed</span>
                      <span className="font-medium">5.0 km/h</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-[42%] rounded-full bg-accent" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-y border-border py-3 text-xs">
                    <span className="text-muted-foreground">Motion</span>
                    <span className="font-medium">Natural</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-secondary p-3 text-center">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Distance</p>
                      <p className="mt-1 text-sm font-semibold">4.2 km</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Est. time</p>
                      <p className="mt-1 text-sm font-semibold">50 min</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-xs font-semibold text-accent-foreground">
                    <Play fill="currentColor" size={13} /> Start route
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface-secondary/35 px-6 py-20" id="features">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              Four ways to move
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
              Choose the movement mode that fits the journey.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Start with a single coordinate or build a repeatable journey. Every mode stays in the
              same map workspace, so switching approaches does not interrupt your flow.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {movementModes.map(({ icon: Icon, title, body }) => (
              <article className="enigma-surface p-5" key={title}>
                <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Icon size={21} />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20" id="games">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              GPS movement for apps and games
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
              Explore location-based experiences from anywhere.
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
              Change the GPS position on a real iPhone for location-based games, geofences, live
              maps, and route-aware apps. Save favorite places and routes, then return to them
              whenever you like.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {gpsUseCases.map(({ icon: Icon, title, body }) => (
              <article className="enigma-surface p-6" key={title}>
                <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Icon size={21} />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface-secondary/35 px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[.82fr_1.18fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              Route controls
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
              Shape the movement, not just the destination.
            </h2>
            <p className="mt-5 leading-7 text-muted-foreground">
              Enigma turns a line on the map into a controllable virtual journey. Adjust pace and
              repetition before you start, then change direction while it is running.
            </p>
          </div>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {routeTools.map(({ icon: Icon, title, body }) => (
              <article className="flex gap-4" key={title}>
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-surface-tertiary text-accent">
                  <Icon size={19} />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface-secondary/35 px-6 py-20" id="setup">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              From map to iPhone
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
              Start moving in three steps.
            </h2>
          </div>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            <li className="enigma-surface p-6">
              <span className="text-sm font-semibold text-accent">01</span>
              <Smartphone className="mt-5 text-accent" size={24} />
              <h3 className="mt-4 text-lg font-semibold">Pair your iPhone</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Connect once by USB, unlock the device, and approve Apple Trust and Developer Mode.
              </p>
            </li>
            <li className="enigma-surface p-6">
              <span className="text-sm font-semibold text-accent">02</span>
              <Route className="mt-5 text-accent" size={24} />
              <h3 className="mt-4 text-lg font-semibold">Choose how to move</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Drop a point, draw a route, load a GPX file, or switch to joystick control.
              </p>
            </li>
            <li className="enigma-surface p-6">
              <span className="text-sm font-semibold text-accent">03</span>
              <Play className="mt-5 text-accent" size={24} />
              <h3 className="mt-4 text-lg font-semibold">Run the session</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Start moving, adjust the speed or direction along the way, and restore the true
                location when done.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-2">
          <article className="enigma-surface p-7">
            <MonitorCheck className="text-accent" size={26} />
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-accent">
              Desktop workflow
            </p>
            <h2 className="mt-3 text-2xl font-semibold">Plan and control from the Mac.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Work from the full map, route editor, favorites, and history. After pairing, connect
              to a previously trusted iPhone over the same local network.
            </p>
          </article>
          <article className="enigma-surface p-7">
            <Cable className="text-accent" size={26} />
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-accent">
              Embedded workflow
            </p>
            <h2 className="mt-3 text-2xl font-semibold">Take the controls with the board.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Provision a supported ESP32-S3 display from the desktop, then use its own Wi-Fi
              network and touch interface for a compact standalone setup.
            </p>
          </article>
        </div>
      </section>

      <section
        className="border-y border-border bg-surface-secondary/35 px-6 py-20"
        id="compatibility"
      >
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              Compatibility
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">See the supported setup.</h2>
            <p className="mt-5 max-w-3xl leading-7 text-muted-foreground">
              The currently validated desktop path is macOS 12+ with a previously paired iOS 27
              device over same-LAN Wi-Fi. The Lichuang ESP32-S3 display and touch path is verified;
              full board-to-iPhone acceptance is still in progress.
            </p>
          </div>
          <ButtonLink to="/docs/compatibility" variant="secondary">
            View compatibility details
          </ButtonLink>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
          <article className="enigma-surface p-6 md:col-span-2">
            <History className="text-accent" size={24} />
            <h2 className="mt-4 text-xl font-semibold">A route library for journeys you repeat</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Routes, coordinates, favorites, history, and recovery state stay together on your
              computer. The library is encrypted locally so your favorite journeys are ready for the
              next session.
            </p>
          </article>
          <article className="enigma-surface p-6">
            <RotateCcw className="text-accent" size={24} />
            <h2 className="mt-4 text-xl font-semibold">Recover unfinished sessions</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              If a run is interrupted, Enigma detects the unfinished session and guides you back to
              a clean device state before another simulation begins.
            </p>
          </article>
        </div>
      </section>

      <section className="border-t border-border bg-foreground px-6 py-20 text-background">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-background/65">
              Ready to map a route?
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold md:text-4xl">
              Bring flexible GPS movement to your iPhone.
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-background/70">
              Use Enigma responsibly and follow the rules of any apps, games, or services you use.
            </p>
          </div>
          <ButtonLink
            className="shrink-0 gap-2 bg-background text-foreground hover:bg-background/90"
            size="lg"
            to={`${repository}/releases`}
          >
            <Download size={18} /> Get Enigma
          </ButtonLink>
        </div>
      </section>
    </SiteShell>
  );
}

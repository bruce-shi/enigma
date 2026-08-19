import { ArrowRight, LockKeyhole, MapPinned, MonitorCheck, Wifi } from "lucide-react";
import { ButtonLink, SiteShell } from "../components/SiteShell";

const features = [
  {
    icon: MapPinned,
    title: "Map, routes, and joystick",
    body: "Teleport, replay GPX, or simulate deterministic straight-line movement.",
  },
  {
    icon: MonitorCheck,
    title: "Fail-closed compatibility",
    body: "The current build enables only the physically validated macOS and iOS 27 same-LAN path.",
  },
  {
    icon: Wifi,
    title: "Wi-Fi beta",
    body: "Reconnect over the same LAN after initial USB pairing. USB operation itself remains unqualified.",
  },
  {
    icon: LockKeyhole,
    title: "Location stays local",
    body: "Routes, coordinates, GPX, favorites, and history are encrypted on your computer.",
  },
];

export default function Home() {
  return (
    <SiteShell>
      <section className="overflow-hidden px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              Enigma Desktop
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">
              Test an iPhone location without sending it to the cloud.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              A local-first desktop utility for developers, QA teams, and controlled location
              workflows. The current preview targets macOS with a previously paired iOS 27 device on
              the same LAN.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink size="lg" to="/downloads">
                View release status <ArrowRight size={17} />
              </ButtonLink>
              <ButtonLink size="lg" to="/compatibility" variant="secondary">
                Compatibility
              </ButtonLink>
            </div>
          </div>
          <div className="enigma-surface grid aspect-[4/3] place-items-center bg-surface-secondary p-6">
            <div className="relative size-full overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_30%_35%,var(--accent)_0_2px,transparent_3px),linear-gradient(135deg,var(--surface-tertiary),var(--surface))]">
              <div className="absolute left-[28%] top-[32%] size-5 rounded-full border-4 border-accent bg-surface shadow-lg" />
              <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-border bg-surface/90 p-4 backdrop-blur">
                <p className="font-medium">No location data leaves this computer</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Encrypted local history · one-click restore
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="border-t border-border bg-surface-secondary/35 px-6 py-20">
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
    </SiteShell>
  );
}

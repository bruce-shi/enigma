import { SiteShell } from "../components/SiteShell";

export default function Terms() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold">Terms</h1>
        <div className="mt-8 grid gap-5 leading-7 text-muted-foreground">
          <p>
            Enigma is intended for authorized testing and controlled location workflows. It does not
            guarantee compatibility with every iOS build or third-party application.
          </p>
          <p>
            Wi-Fi support is beta. Developer Mode and initial USB pairing are required for the
            supported location-service path.
          </p>
          <p>
            Any cooldown or travel-time display is informational and is not an anti-ban or
            account-safety guarantee.
          </p>
        </div>
      </main>
    </SiteShell>
  );
}

import { SiteShell } from "../components/SiteShell";

export default function Terms() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold">Terms</h1>
        <p className="mt-3 text-sm text-muted-foreground">Draft · updated August 19, 2026</p>
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
            A device is supported only when its exact host, iOS build, and transport appear on the
            compatibility page. Enumeration or source-code support does not establish compatibility.
          </p>
          <p>
            Any cooldown or travel-time display is informational and is not an anti-ban or
            account-safety guarantee.
          </p>
          <p>
            The current development build is unsigned, unnotarized, and not offered for public
            download or purchase. Public service terms require a separate production review before
            launch.
          </p>
        </div>
      </main>
    </SiteShell>
  );
}

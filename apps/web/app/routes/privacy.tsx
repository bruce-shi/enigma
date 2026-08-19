import { SiteShell } from "../components/SiteShell";

export default function Privacy() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold">Privacy</h1>
        <div className="mt-8 grid gap-5 leading-7 text-muted-foreground">
          <p>
            Enigma stores routes, coordinates, GPX files, favorites, and location history only in
            encrypted local desktop storage.
          </p>
          <p>
            The account service stores identity, subscription, computer activation, and token
            records. It does not receive location content.
          </p>
          <p>
            Crash reporting is optional and accepts an allowlisted diagnostic schema without
            coordinates, routes, email addresses, auth tokens, or Apple device identifiers.
          </p>
        </div>
      </main>
    </SiteShell>
  );
}

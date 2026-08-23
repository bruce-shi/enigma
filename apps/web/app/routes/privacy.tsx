import { SiteShell } from "../components/SiteShell";

export default function Privacy() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold">Privacy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Draft · updated August 23, 2026</p>
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
          <p>
            Map requests use a versioned style and PMTiles byte ranges. The map gateway rejects
            query strings, and Enigma does not append coordinates or device identifiers to map URLs.
          </p>
          <p>
            Optional location search sends the typed query, current-map proximity bias, language,
            session identifier, and the builder&apos;s public token directly to Mapbox. Enigma does
            not cache or persist search responses, and selecting a result only centers the map.
          </p>
          <p>
            Production crash delivery remains disabled until authenticated desktop access and a
            verified 30-day R2 deletion rule are present. Turning consent on in the current desktop
            build stores only that preference locally and sends nothing.
          </p>
          <p>
            Safe diagnostics contain coarse host/runtime state and device counts. They omit device
            names, IDs, models, iOS builds, raw errors, and all location content.
          </p>
        </div>
      </main>
    </SiteShell>
  );
}

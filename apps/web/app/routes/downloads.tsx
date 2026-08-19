import { Button } from "@heroui/react";
import { Download, ShieldCheck, TriangleAlert } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ButtonLink, SiteShell } from "../components/SiteShell";
import { envFrom } from "../server/http.server";
import { getPublicReleaseConfig, publicReleaseReady } from "../server/public-config.server";

export function loader({ context }: LoaderFunctionArgs) {
  const config = getPublicReleaseConfig(envFrom(context));
  return { config, ready: publicReleaseReady(config) };
}

export default function Downloads() {
  const { config, ready } = useLoaderData<typeof loader>();
  const buildLabel = config.status === "development" ? "Development only" : config.status;
  return (
    <SiteShell>
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Enigma {config.version}
          </p>
          <h1 className="mt-3 text-4xl font-semibold md:text-6xl">Desktop downloads</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Downloads fail closed until signed installers, exact device-build evidence, billing, and
            production health checks are all present.
          </p>
        </div>

        {!ready && (
          <div className="mt-8 flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-5">
            <TriangleAlert className="mt-0.5 shrink-0 text-warning" size={22} />
            <div>
              <p className="font-semibold">No public build is available</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The current artifact is unsigned and intended for local development and physical
                acceptance only. It must not be redistributed.
              </p>
            </div>
          </div>
        )}

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <DownloadCard
            href={ready ? config.downloads.macosArm64 : undefined}
            label="macOS · Apple silicon"
            status={ready ? "Signed and notarized" : buildLabel}
          />
          <DownloadCard
            href={ready ? config.downloads.macosX64 : undefined}
            label="macOS · Intel"
            status={ready ? "Signed and notarized" : buildLabel}
          />
          <DownloadCard
            href={ready ? config.downloads.windowsX64 : undefined}
            label="Windows · x64"
            status={ready ? "Signed" : "Qualification deferred"}
          />
        </div>

        <section className="enigma-surface mt-8 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-success" size={20} />
            <h2 className="font-semibold">Compatibility claims</h2>
          </div>
          {config.supportedIosBuilds.length > 0 ? (
            <ul className="mt-4 grid gap-2 text-sm text-muted-foreground">
              {config.supportedIosBuilds.map((build) => (
                <li key={build}>iOS {build}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No exact iOS build has completed the public release matrix yet.
            </p>
          )}
          <ButtonLink className="mt-5" to="/compatibility" variant="secondary">
            Review compatibility
          </ButtonLink>
        </section>
      </main>
    </SiteShell>
  );
}

function DownloadCard({ label, status, href }: { label: string; status: string; href?: string }) {
  return (
    <article className="enigma-surface p-6">
      <Download className="text-accent" size={22} />
      <h2 className="mt-4 font-semibold">{label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{status}</p>
      {href ? (
        <ButtonLink className="mt-5 w-full" to={href}>
          Download
        </ButtonLink>
      ) : (
        <Button className="mt-5 w-full" isDisabled>
          Not available
        </Button>
      )}
    </article>
  );
}
